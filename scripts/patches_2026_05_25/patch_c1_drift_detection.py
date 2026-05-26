#!/usr/bin/env python3
"""
Track C.1 — Validation gate ampliado con drift detection.

Bug original (casos 1.1 y 1.2 del feedback 25-may):
  - Cliente cambia personas (16 → 19) en CONFIRMING. PDF sale con 16.
  - Cliente cambia noches (6 → 5). PDF sale con 6, 4 veces seguidas.
  - PDF sale con valores en cero / vacíos (caso 15-may 21:31/21:34).

T2.2 validation gate (deployed antes) cubre el caso de campos vacíos pero
NO cubre discrepancia conversacional (el campo está poblado, pero con
valor viejo, anterior al cambio del cliente).

Fix en dos capas:

1) Capa determinística — _detectConversationalDrift():
   Escanea últimos 5 INBOUND messages buscando:
   - "somos N", "vamos N", "N personas", "ahora somos N" → personas absoluta
   - "N noches" → noches
   - Nombres de meses ("mayo", "diciembre"...) → fechas
   Compara contra payload.huespedes, payload.noches, payload.fecha_inicio (mes).
   Si discrepancia → returns reasons array.

2) Si hay drift, NO se emite PDF — se devuelve text item pidiendo
   confirmación explícita al cliente, listando cada campo en discrepancia
   y el valor del payload vs el conversacional.

3) Capa de prompt (acompaña el fix, en patch separado):
   Regla en confirming_reservation_agent para que detecte cambios en los
   últimos turnos y re-llame inventory_reader_tool antes de DOCUMENT_READY.

Limitaciones conocidas:
- Frases "delta" tipo "van 3 niños más" se ignoran (no podemos sumar
  determinísticamente; el LLM debe normalizar a "ahora somos N").
- Si el cliente nunca dice un número absoluto post-cambio, no hay drift
  detectado — la regla de prompt es la última defensa.
- Months parsing es laxo: si menciona "mayo" pero el payload está en
  mayo, no dispara. Si menciona "diciembre" y payload está en mayo → drift.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# === Helper function — to insert just before createReservationDocumentItem ===
HELPER_FN = r"""
// === Conversational drift detection (T-C.1 — May 25 2026) ===
// Escanea últimos N INBOUND messages buscando referencias absolutas a
// personas/noches/meses que difieran del payload final del PDF. Si hay
// discrepancia, createReservationDocumentItem la usa para bloquear el
// PDF y pedir confirmación al cliente. NO interpreta deltas (ej. "van 3
// más") — eso es responsabilidad del LLM (regla de prompt).
function _detectConversationalDrift(payload, recentMessages) {
  if (!Array.isArray(recentMessages) || !recentMessages.length) return [];
  // recent_messages viene newest-first (order by created_at desc)
  var inbound = [];
  for (var i = 0; i < recentMessages.length && inbound.length < 5; i++) {
    var m = recentMessages[i];
    if (m && m.direction === 'INBOUND' && typeof m.content === 'string' && m.content.trim()) {
      inbound.push(m);
    }
  }
  if (!inbound.length) return [];

  function _extractAbsolutePersonas(text) {
    var s = String(text || '').toLowerCase();
    // Si hay phrase de delta, no extraemos absolutos de este mensaje
    // (ej. "van 3 niños más" — el 3 NO es total).
    var deltaPat = /\b(?:m[aá]s|menos|adicionales?|extra)\s+\d+\b|\b\d+\s*(?:m[aá]s|menos|adicionales?|extra)\b/;
    var hasDelta = deltaPat.test(s);
    // Definitivo: "ahora somos N", "ya somos N", "seremos N"
    var nowPat = /\b(?:ahora\s+somos|ya\s+somos|somos\s+ahora|seremos|ser[íi]amos)\s+(\d{1,3})\b/;
    var nm = s.match(nowPat);
    if (nm) return { definitive: Number(nm[1]) };
    if (hasDelta) return { definitive: null }; // delta phrase, skip absolutos
    // Absolutos genéricos: "somos N", "vamos N", "N personas/adultos/huespedes/pax", "para N personas"
    var absPats = [
      /\bsomos\s+(\d{1,3})\b/g,
      /\bvamos\s+(\d{1,3})\b/g,
      /\bpara\s+(\d{1,3})\s*(?:personas?|adultos?|huespedes?|hu[eé]spedes?|pax)\b/g,
      /\b(\d{1,3})\s*(?:personas?|adultos?|huespedes?|hu[eé]spedes?|pax)\b/g,
    ];
    var found = [];
    for (var p = 0; p < absPats.length; p++) {
      var mm;
      while ((mm = absPats[p].exec(s)) !== null) {
        var n = Number(mm[1]);
        if (Number.isFinite(n) && n >= 2 && n <= 200) found.push(n);
      }
    }
    if (found.length) return { definitive: found[found.length - 1] };
    return { definitive: null };
  }

  function _extractNoches(text) {
    var s = String(text || '').toLowerCase();
    var m = s.match(/\b(\d{1,2})\s*noches?\b/);
    if (m) {
      var n = Number(m[1]);
      if (n >= 1 && n <= 30) return n;
    }
    return null;
  }

  var MONTH_MAP = {
    'enero':1,'febrero':2,'marzo':3,'abril':4,'mayo':5,'junio':6,
    'julio':7,'agosto':8,'septiembre':9,'octubre':10,'noviembre':11,'diciembre':12
  };
  function _extractMonths(text) {
    var s = String(text || '').toLowerCase();
    var found = [];
    for (var name in MONTH_MAP) {
      if (s.indexOf(name) >= 0) found.push(MONTH_MAP[name]);
    }
    return found;
  }

  var lastPersonas = null;
  var lastNoches = null;
  var lastMonths = null;
  for (var k = 0; k < inbound.length; k++) {
    var c = inbound[k].content;
    if (lastPersonas == null) {
      var pp = _extractAbsolutePersonas(c);
      if (pp.definitive != null) lastPersonas = pp.definitive;
    }
    if (lastNoches == null) {
      var nn = _extractNoches(c);
      if (nn != null) lastNoches = nn;
    }
    if (lastMonths == null) {
      var ms = _extractMonths(c);
      if (ms.length) lastMonths = ms;
    }
    if (lastPersonas != null && lastNoches != null && lastMonths != null) break;
  }

  var reasons = [];
  if (lastPersonas != null) {
    var payloadPersonas = Number(payload.huespedes || 0);
    if (payloadPersonas > 0 && payloadPersonas !== lastPersonas) {
      reasons.push({ field: 'personas', conversational: lastPersonas, payload: payloadPersonas });
    }
  }
  if (lastNoches != null) {
    var payloadNoches = Number(payload.noches || 0);
    if (payloadNoches > 0 && payloadNoches !== lastNoches) {
      reasons.push({ field: 'noches', conversational: lastNoches, payload: payloadNoches });
    }
  }
  if (lastMonths && lastMonths.length) {
    var payloadMonth = Number(String(payload.fecha_inicio || '').slice(5,7));
    if (payloadMonth >= 1 && payloadMonth <= 12 && lastMonths.indexOf(payloadMonth) < 0) {
      // Convertir lastMonths a nombres legibles
      var rev = {};
      for (var nm2 in MONTH_MAP) rev[MONTH_MAP[nm2]] = nm2;
      var convNames = lastMonths.map(function(n){ return rev[n] || String(n); }).join('/');
      reasons.push({ field: 'fecha', conversational: convNames, payload: payload.fecha_inicio + ' a ' + payload.fecha_fin });
    }
  }
  return reasons;
}

"""

# === Insertion point: just before "function createReservationDocumentItem" ===
ANCHOR_BEFORE = "function createReservationDocumentItem(selectedFinca, toolOutputParsed, finalWhatsappText) {"

# === Drift check block — insert after T2.2 gate, before encodeBase64UrlJson ===
DRIFT_OLD = (
"  if (__missing.length > 0) {\n"
"    console.error('[createReservationDocumentItem] DOCUMENT_READY blocked, missing:', __missing.join(', '));\n"
"    var __list = __missing.map(function(m) { return '• ' + m; }).join('\\n');\n"
"    return {\n"
"      type: 'text',\n"
"      content: 'Antes de generar tu confirmación necesito completar estos datos:\\n\\n' + __list + '\\n\\nMe los compartes y te armo el PDF',\n"
"      media_url: null,\n"
"      media_urls: undefined,\n"
"      property_title: null,\n"
"      property_id: finca.finca_id || null,\n"
"    };\n"
"  }\n"
"\n"
"  var encoded = encodeBase64UrlJson(payload);"
)

DRIFT_NEW = (
"  if (__missing.length > 0) {\n"
"    console.error('[createReservationDocumentItem] DOCUMENT_READY blocked, missing:', __missing.join(', '));\n"
"    var __list = __missing.map(function(m) { return '• ' + m; }).join('\\n');\n"
"    return {\n"
"      type: 'text',\n"
"      content: 'Antes de generar tu confirmación necesito completar estos datos:\\n\\n' + __list + '\\n\\nMe los compartes y te armo el PDF',\n"
"      media_url: null,\n"
"      media_urls: undefined,\n"
"      property_title: null,\n"
"      property_id: finca.finca_id || null,\n"
"    };\n"
"  }\n"
"\n"
"  // === Drift detection (T-C.1 — May 25 2026) ===\n"
"  // Después del gate de campos vacíos, comparamos el payload con lo\n"
"  // que el cliente realmente dijo en los últimos turnos. Si menciona\n"
"  // un # de personas/noches o un mes distinto al payload, NO emitimos\n"
"  // PDF — pedimos confirmación explícita primero. Esto bloquea el bug\n"
"  // de PDF con personas/noches/fechas viejas cuando el LLM no actualizó\n"
"  // search_criteria después de un cambio del cliente.\n"
"  try {\n"
"    var __recent = ($('Fetch messages1').item.json.recent_messages) || [];\n"
"    if (typeof __recent === 'string') { try { __recent = JSON.parse(__recent); } catch (e) { __recent = []; } }\n"
"    var __drift = _detectConversationalDrift(payload, __recent);\n"
"    if (__drift && __drift.length) {\n"
"      console.error('[createReservationDocumentItem] DRIFT detected:', JSON.stringify(__drift));\n"
"      var __ask = __drift.map(function(d) {\n"
"        if (d.field === 'personas') return '• Personas: mencionaste ' + d.conversational + ' pero la confirmación está armada para ' + d.payload + '. ¿Cuál uso?';\n"
"        if (d.field === 'noches')   return '• Noches: mencionaste ' + d.conversational + ' pero la confirmación está armada para ' + d.payload + '. ¿Cuál uso?';\n"
"        if (d.field === 'fecha')    return '• Fechas: mencionaste ' + d.conversational + ' pero la confirmación está armada para ' + d.payload + '. ¿Cuáles uso?';\n"
"        return '• ' + d.field;\n"
"      }).join('\\n');\n"
"      return {\n"
"        type: 'text',\n"
"        content: 'Antes de generar el PDF quiero confirmar contigo:\\n\\n' + __ask + '\\n\\nMe lo aclaras y te armo la confirmación correctamente',\n"
"        media_url: null,\n"
"        media_urls: undefined,\n"
"        property_title: null,\n"
"        property_id: finca.finca_id || null,\n"
"      };\n"
"    }\n"
"  } catch (e) {\n"
"    console.error('[createReservationDocumentItem] drift check failed:', String(e).slice(0, 200));\n"
"  }\n"
"\n"
"  var encoded = encodeBase64UrlJson(payload);"
)

found = False
for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']

    # Step 1: insert helper function just before createReservationDocumentItem
    if ANCHOR_BEFORE not in code:
        print('!! anchor for createReservationDocumentItem not found'); sys.exit(2)
    if '_detectConversationalDrift' in code:
        print('!! _detectConversationalDrift already present — skipping helper insertion (idempotent re-run?)')
    else:
        code = code.replace(ANCHOR_BEFORE, HELPER_FN + ANCHOR_BEFORE, 1)

    # Step 2: insert drift check after T2.2 gate, before encodeBase64UrlJson
    if DRIFT_OLD not in code:
        print('!! DRIFT_OLD anchor not found (T2.2 gate block missing or modified)'); sys.exit(2)
    if 'DRIFT detected' in code:
        print('!! drift check block already present — skipping (idempotent)')
    else:
        code = code.replace(DRIFT_OLD, DRIFT_NEW, 1)

    n['parameters']['jsCode'] = code
    print('✓ Code in JavaScript1: drift detection helper + check inserted')
    found = True
    break

if not found:
    print('!! Code in JavaScript1 node not found'); sys.exit(2)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {
    'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED},
}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL,
                     '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
out = json.loads(r2.stdout)
print(f'PUT ok. active={out.get("active")}')
if not out.get('active'):
    subprocess.run(['curl','-sk','-X','POST', URL+'/activate', '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True)
