#!/usr/bin/env python3
"""Fase 3 (informe cliente, 8-sep-2026) — customer agent 2NV08zRFKENUsQVC.

P3.2  Handoff real:
      a) En estado HITL el texto "te paso con mi compañero" se dice UNA vez; los mensajes
         siguientes reciben un texto de espera (config.hitl_waiting_message o default) y las
         preguntas factuales siguen yendo al QA (el validator no cambia).
      b) Al entrar a HITL o al aprobar la reserva: nota PRIVADA en Chatwoot con el resumen
         estructurado para el humano + etiqueta `handoff` / `reserva-aprobada`. Las notas
         privadas NO re-entran al bot (Normalize inbound las ignora).
P3.4  Lead perdido por chatwoot_id viejo (caso Javier Plata): si el chatwoot_id guardado no
      coincide con el entrante y la conversación lleva > 7 días sin actividad, se adopta el
      nuevo id (mapping + policy + upsert) en vez de ignorar al cliente en silencio.
P3.5  Mesa de Yeguas (municipio): alias de zona propio + el matcher también compara contra
      nombre/finca_id; Normalize Inventory descarta "amenidades" que en realidad son texto
      pegado (filas MESA DE YEGUAS CASA APxx). Prompts: no convertir Mesa de Yeguas en Anapoima.
P3.6  Orden: sin fechas + personas NO se pasa de QUALIFYING a OFFERING (no cards antes de
      preguntar), salvo que el cliente nombre una finca por código.
P3.7  Tarjeta de crédito: regla del 5 % de recargo en prompts QA + confirming.

Lee CHATWOOT_API_TOKEN de .env al desplegar (no queda en el repo).
Idempotente.
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from n8n_patch_lib import get_workflow, put_workflow, backup, node, replace_once, _env  # noqa: E402

CA = '2NV08zRFKENUsQVC'
applied = []
wf = get_workflow(CA)
backup(CA)
CW_TOKEN = _env().get('CHATWOOT_API_TOKEN', '')
if not CW_TOKEN:
    raise SystemExit('falta CHATWOOT_API_TOKEN en .env')

# ------------------------------------------------------------------ P3.2a HITL: handoff una sola vez
unk = node(wf, 'Build unknown state payload')
UNK_NEW = r"""const handoffMessage =
  $('config').first().json.handoff_message ||
  'Dame un momento, te paso con mi compañero del área encargada para continuar con tu solicitud.';

// P3.2 (8-sep-2026): en HITL el handoff se dice UNA sola vez. Si la conversación
// YA está en HITL, el cliente recibe un texto de espera (no el mismo handoff en loop).
let conv = {};
try { conv = $('Get Context-conversations1').first().json || {}; } catch (e) { conv = {}; }
const alreadyHitl = String(conv.current_state || '').trim() === 'HITL';
const waitingMessage =
  $('config').first().json.hitl_waiting_message ||
  'Ya le avisé a mi compañero del área encargada y te escribe en breve por este mismo chat ☀️ Si mientras tanto tienes alguna pregunta sobre la finca, dime y te la respondo';
const text = alreadyHitl ? waitingMessage : handoffMessage;
const postActions = { waiting_for: 'CLIENT' };
if (!alreadyHitl) postActions.hitl_reason = 'unsupported_state';

return [
  {
    json: {
      action: 'HITL',
      route_mode: 'HITL',
      reason: alreadyHitl ? 'hitl_waiting' : 'unsupported_state',
      final_whatsapp_text: text,
      post_actions: postActions,
      tool_output: {
        intent: alreadyHitl ? 'HITL_WAITING' : 'HITL_REQUEST',
        respuesta: text,
      },
      current_state_changed: false,
    },
  },
];
"""
if 'HITL_WAITING' in unk['parameters']['jsCode']:
    applied.append('P3.2a unknown state: already')
else:
    unk['parameters']['jsCode'] = UNK_NEW
    applied.append('P3.2a Build unknown state payload: handoff una vez + espera')

# ------------------------------------------------------------------ P3.2b nota privada + etiqueta en Chatwoot
prep = node(wf, 'Prepare selection notifications')
pc = prep['parameters']['jsCode']
NOTE_ANCHOR = "return [\n  {\n    json: {\n      ...engine,\n      selection_notification_count: batch.length,"
NOTE_BLOCK = r"""// === P3.2 (8-sep-2026): nota privada + etiqueta en Chatwoot para el humano ===
// Solo al ENTRAR a HITL (no en cada mensaje mientras espera) o al aprobar la reserva.
try {
  const _intent = candidate.intent;
  const _prevState = String(candidate.currentStateBefore || '');
  const _shouldNote = candidate.shouldNotify === true && chatwootId && (
    (_intent === 'HITL_REQUEST' && _prevState !== 'HITL') || _intent === 'RESERVATION_APPROVED'
  );
  if (_shouldNote) {
    const _cw = 'https://chat.depaseoenfincas.raaamp.co/api/v1/accounts/2/conversations/' + chatwootId;
    const _hdr = { api_access_token: '__CHATWOOT_TOKEN__', 'Content-Type': 'application/json' };
    let _lastMsg = '';
    try { _lastMsg = String($('Merge Sets1').first().json['last-message'] || '').slice(0, 300); } catch (e) {}
    let _ex = {};
    try { _ex = $('Get Context-conversations1').first().json.extras || {}; } catch (e) {}
    const _npa = (engine.normalized_post_actions && typeof engine.normalized_post_actions === 'object') ? engine.normalized_post_actions : {};
    if (_npa.extras && typeof _npa.extras === 'object') _ex = Object.assign({}, _ex, _npa.extras);
    const _cr = _ex.confirming_reservation || {};
    const _emp = _ex.servicio_empleada || {};
    const _q = (selectedFinca && selectedFinca.quote) || {};
    const _cop = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
    const _datos = [_cr.nombre_completo, _cr.tipo_documento ? (_cr.tipo_documento + ' ' + (_cr.numero_documento || '')) : null, _cr.correo, _cr.direccion, _cr.celular].filter(Boolean).join(' · ');
    const _lines = [
      _intent === 'RESERVATION_APPROVED' ? '✅ RESERVA APROBADA POR EL CLIENTE — requiere gestión humana (datos bancarios / bloqueo)' : '🙋 EL BOT PASÓ AL CLIENTE A UN HUMANO (handoff)',
      'Cliente: ' + clientName + ' · WhatsApp +' + (waId || 'sin dato'),
      'Finca: ' + (selectedFincaId || 'sin finca elegida') + (selectedFinca && selectedFinca.nombre ? ' (' + selectedFinca.nombre + ')' : ''),
      'Fechas: ' + fechas + ' · Personas: ' + (searchCriteria.personas != null ? searchCriteria.personas : 'sin dato') + ' · Zona: ' + (searchCriteria.zona || 'sin dato'),
      'Total cotizado: ' + (_q.total ? _cop(_q.total) : (_cr.last_doc_total ? _cop(_cr.last_doc_total) : 'sin dato')) + (_emp.solicitado ? ' · empleadas solicitadas: ' + _emp.cantidad + ' (' + _cop(_emp.subtotal) + ')' : ''),
      'Datos del cliente: ' + (_datos || 'sin datos aún'),
      'Motivo: ' + (_npa.hitl_reason && _npa.hitl_reason !== '__IGNORE__' ? _npa.hitl_reason : _intent),
      'Último mensaje del cliente: "' + _lastMsg + '"',
      'El bot sigue respondiendo preguntas hasta que un asesor escriba por Chatwoot.',
    ];
    await this.helpers.httpRequest({ url: _cw + '/messages', method: 'POST', headers: _hdr, json: true, timeout: 10000,
      body: { content: _lines.join('\n'), message_type: 'outgoing', private: true } });
    const _label = _intent === 'RESERVATION_APPROVED' ? 'reserva-aprobada' : 'handoff';
    let _existing = [];
    try {
      const r = await this.helpers.httpRequest({ url: _cw + '/labels', method: 'GET', headers: _hdr, json: true, timeout: 10000 });
      _existing = (r && Array.isArray(r.payload)) ? r.payload : [];
    } catch (e) { _existing = []; }
    const _labels = Array.from(new Set(_existing.concat([_label])));
    await this.helpers.httpRequest({ url: _cw + '/labels', method: 'POST', headers: _hdr, json: true, timeout: 10000, body: { labels: _labels } });
    console.log('[P3.2] nota privada + etiqueta ' + _label + ' en Chatwoot conv ' + chatwootId);
  }
} catch (e) { console.error('[P3.2] nota Chatwoot falló: ' + (e && e.message)); }
// === /P3.2 ===

return [
  {
    json: {
      ...engine,
      selection_notification_count: batch.length,""".replace('__CHATWOOT_TOKEN__', CW_TOKEN)
if '[P3.2] nota privada' in pc:
    applied.append('P3.2b nota Chatwoot: already')
else:
    prep['parameters']['jsCode'] = replace_once(pc, NOTE_ANCHOR, NOTE_BLOCK, 'P3.2b nota Chatwoot')
    applied.append('P3.2b Prepare selection notifications: nota privada + etiqueta')

# ------------------------------------------------------------------ P3.4 chatwoot_id viejo
mapq = node(wf, 'Resolve existing phone mapping')
MQ_OLD = "  c.agente_activo,\n  c.current_state\nfrom incoming i"
MQ_NEW = "  c.agente_activo,\n  c.current_state,\n  c.last_interaction,\n  c.updated_at\nfrom incoming i"
if 'c.last_interaction,' in mapq['parameters']['query']:
    applied.append('P3.4 mapping query: already')
else:
    mapq['parameters']['query'] = replace_once(mapq['parameters']['query'], MQ_OLD, MQ_NEW, 'P3.4 mapping query')
    applied.append('P3.4 Resolve existing phone mapping: +last_interaction/updated_at')

pol = node(wf, 'Resolve thread policy')
POL_OLD = """    } else if (storedChatwootId === resolvedChatwootId) {
      allow = true;
    } else {
      ignoreReason = 'thread_conflict_active_chatwoot_conversation';
    }"""
POL_NEW = """    } else if (storedChatwootId === resolvedChatwootId) {
      allow = true;
    } else if ((function () {
      // P3.4 (8-sep-2026): chatwoot_id guardado de una conversación vieja (>7 días sin
      // actividad, p.ej. instancia anterior de Chatwoot) → adoptar el nuevo id en vez de
      // ignorar al cliente en silencio (caso Javier Plata, sin respuesta desde mayo).
      const t = Date.parse(existing.last_interaction || existing.updated_at || '');
      return !Number.isFinite(t) || (Date.now() - t) > 7 * 24 * 3600 * 1000;
    })()) {
      allow = true;
      adoptedChatwootId = true;
    } else {
      ignoreReason = 'thread_conflict_active_chatwoot_conversation';
    }"""
pcode = pol['parameters']['jsCode']
if 'adoptedChatwootId' in pcode:
    applied.append('P3.4 thread policy: already')
else:
    pcode = replace_once(pcode, "let allow = false;\nlet ignoreReason = normalized.ignore_reason || null;", "let allow = false;\nlet adoptedChatwootId = false;\nlet ignoreReason = normalized.ignore_reason || null;", 'P3.4 policy vars')
    pcode = replace_once(pcode, POL_OLD, POL_NEW, 'P3.4 policy branch')
    pcode = replace_once(pcode, "      allow_automation: allow,\n      ignore_reason: ignoreReason,", "      allow_automation: allow,\n      adopted_chatwoot_id: adoptedChatwootId,\n      ignore_reason: ignoreReason,", 'P3.4 policy output')
    pol['parameters']['jsCode'] = pcode
    applied.append('P3.4 Resolve thread policy: adopta chatwoot_id si la conversación está vieja')

ctx = node(wf, 'Get Context-conversations1')
UP_OLD = "    when public.conversations.agente_activo = false then excluded.chatwoot_id\n    else public.conversations.chatwoot_id\n  end,"
UP_NEW = "    when public.conversations.agente_activo = false then excluded.chatwoot_id\n    -- P3.4 (8-sep-2026): conversación vieja (>7 días) → adoptar el chatwoot_id nuevo\n    when coalesce(public.conversations.last_interaction, public.conversations.updated_at) < now() - interval '7 days' then excluded.chatwoot_id\n    else public.conversations.chatwoot_id\n  end,"
if 'P3.4 (8-sep-2026): conversación vieja' in ctx['parameters']['query']:
    applied.append('P3.4 upsert: already')
else:
    ctx['parameters']['query'] = replace_once(ctx['parameters']['query'], UP_OLD, UP_NEW, 'P3.4 upsert')
    applied.append('P3.4 Get Context upsert: adopta chatwoot_id nuevo si la conv es vieja')

# ------------------------------------------------------------------ P3.5 Mesa de Yeguas
bit = node(wf, 'Build Inventory Tool Response')
bc = bit['parameters']['jsCode']
ALIAS_ANCHOR = "const zoneAliasDefinitions = [\n  {"
ALIAS_NEW = """const zoneAliasDefinitions = [
  {
    // P3.5 (8-sep-2026): Mesa de Yeguas es un municipio propio del inventario (JD).
    keys: ['mesa de yeguas', 'mesadeyeguas', 'yeguas'],
    label: 'Mesa de Yeguas',
    targets: ['mesa de yeguas'],
  },
  {"""
if "keys: ['mesa de yeguas'" in bc:
    applied.append('P3.5 alias: already')
else:
    bc = replace_once(bc, ALIAS_ANCHOR, ALIAS_NEW, 'P3.5 alias')
    applied.append('P3.5 BIT: alias Mesa de Yeguas')
MATCH_OLD = "    if (itemMunicipio && (itemMunicipio.includes(target) || target.includes(itemMunicipio))) return 'strong';\n    // weak fallback"
MATCH_NEW = """    if (itemMunicipio && (itemMunicipio.includes(target) || target.includes(itemMunicipio))) return 'strong';
    // P3.5 (8-sep-2026): el municipio también puede vivir en nombre/finca_id (filas
    // "MESA DE YEGUAS CASA APxx" con zona/municipio = Anapoima). Solo targets >= 5 chars.
    if (target.length >= 5) {
      const itemLabel = normalizeText(String(item.nombre || '') + ' ' + String(item.finca_id || '') + ' ' + String(item.codigo_original || ''));
      if (itemLabel.includes(target)) return 'strong';
    }
    // weak fallback"""
if 'P3.5 (8-sep-2026): el municipio también' in bc:
    applied.append('P3.5 matcher: already')
else:
    bc = replace_once(bc, MATCH_OLD, MATCH_NEW, 'P3.5 matcher')
    applied.append('P3.5 BIT: matcher por nombre/finca_id')
CUNDI_OLD = "    targets: ['anapoima', 'villeta', 'la vega', 'girardot', 'carmen de apicala', 'la mesa', 'mesitas del colegio',\n              'ricaurte', 'melgar', 'arbelaez', 'fusagasuga'],"
CUNDI_NEW = "    targets: ['anapoima', 'villeta', 'la vega', 'girardot', 'carmen de apicala', 'la mesa', 'mesitas del colegio',\n              'ricaurte', 'melgar', 'arbelaez', 'fusagasuga', 'mesa de yeguas'],"
if "'fusagasuga', 'mesa de yeguas'" in bc:
    applied.append('P3.5 cundinamarca targets: already')
else:
    bc = replace_once(bc, CUNDI_OLD, CUNDI_NEW, 'P3.5 cundinamarca targets')
    applied.append('P3.5 BIT: Mesa de Yeguas dentro de "cerca a Bogotá"')
bit['parameters']['jsCode'] = bc

ninv = node(wf, 'Normalize Inventory')
NI_OLD = "      amenidades: toCsv(pick(row, ['amenidades_csv', 'Amenidades'])),"
NI_NEW = "      // P3.5 (8-sep-2026): descartar 'amenidades' que son texto pegado (multilínea / > 40 chars / viñetas)\n      amenidades: toCsv(pick(row, ['amenidades_csv', 'Amenidades'])).filter((a) => a.length <= 40 && !/[\\n\\r]/.test(a) && !/^[\\*•\\-–]/.test(a)),"
if 'P3.5 (8-sep-2026): descartar' in ninv['parameters']['jsCode']:
    applied.append('P3.5 Normalize: already')
else:
    ninv['parameters']['jsCode'] = replace_once(ninv['parameters']['jsCode'], NI_OLD, NI_NEW, 'P3.5 Normalize amenidades')
    applied.append('P3.5 Normalize Inventory: amenidades saneadas')

for pname in ('Run qualifying pass', 'Run offering pass'):
    p = node(wf, pname)
    s = p['parameters']['options']['systemMessage']
    if 'MESA DE YEGUAS (8-sep-2026)' in s:
        applied.append(f'P3.5 prompt {pname}: already')
        continue
    RULE = "\n- MESA DE YEGUAS (8-sep-2026): Mesa de Yeguas es un municipio/destino propio del inventario. Si el cliente lo pide, usa zona = \"Mesa de Yeguas\" tal cual (NO lo conviertas en \"Anapoima\"); el sistema sabe buscarlo. Nunca inventes cuántas casas hay allí ni sus capacidades: consulta el tool.\n"
    # anclamos al final del system message (aditivo)
    p['parameters']['options']['systemMessage'] = s.rstrip('\n') + RULE
    applied.append(f'P3.5 prompt {pname}: regla Mesa de Yeguas')

# ------------------------------------------------------------------ P3.6 orden: no cards sin fechas+personas
cjs = node(wf, 'Code in JavaScript1')
code = cjs['parameters']['jsCode']
GATE_ANCHOR = "  // === /P2.1 + P2.3 ===\n\n  const normalized = {"
GATE_BLOCK = r"""  // === P3.6 (8-sep-2026): sin fechas + personas NO se pasa a OFFERING (no cards antes de preguntar) ===
  if (tool === 'qualifying_agent' && raw.state_transition === 'OFFERING') {
    try {
      const _fin = Object.assign({}, _safeSearchCriteria(), (raw.search_criteria && typeof raw.search_criteria === 'object') ? raw.search_criteria : {});
      const _msg = _stripAccentsLower(_lastClientMessage());
      const _namedFinca = /\b[a-zñ_]{3,}[\s_#-]{0,3}\d{1,3}\b/.test(_msg) && !/\b\d{1,2}\s*(personas?|px|pax|noches?|de\s+[a-z]+)\b/.test(_msg);
      const _missing = [];
      if (!_fin.fecha_inicio || !_fin.fecha_fin) _missing.push('las fechas de entrada y salida');
      if (!(Number(_fin.personas) > 0)) _missing.push('cuántas personas van');
      if (_missing.length && !_namedFinca) {
        raw.state_transition = undefined;
        raw.waiting_for = 'CLIENT';
        const _ask = 'Listo. Para mostrarte opciones que sí apliquen necesito ' + _missing.join(' y ') + '. Me las compartes?';
        if (toolOutput && typeof toolOutput === 'object') { toolOutput.respuesta = _ask; toolOutput.datos_completos = false; }
        if (parsed && typeof parsed === 'object') { parsed.final_whatsapp_text = _ask; parsed.current_state_changed = false; }
        console.log('[P3.6] transición a OFFERING bloqueada: faltan ' + _missing.join(', '));
      }
    } catch (e) { console.error('[P3.6] ' + (e && e.message)); }
  }
  // === /P2.1 + P2.3 ===

  const normalized = {"""
if '[P3.6] transición a OFFERING bloqueada' in code:
    applied.append('P3.6 gate: already')
else:
    code = replace_once(code, GATE_ANCHOR, GATE_BLOCK, 'P3.6 gate')
    applied.append('P3.6 CJS1: gate QUALIFYING→OFFERING sin fechas/personas')
cjs['parameters']['jsCode'] = code

# ------------------------------------------------------------------ P3.7 tarjeta 5 %
TARJETA = """
- PAGO CON TARJETA DE CRÉDITO (regla de negocio, 8-sep-2026): el pago con tarjeta de crédito tiene un recargo del 5 % sobre el valor pagado con tarjeta. Menciónalo SIEMPRE que el cliente pregunte por pagar con tarjeta o por medios de pago, y nunca digas que no hay recargo.
"""
for pname in ('Run qa pass', 'Run confirming_reservation pass'):
    p = node(wf, pname)
    s = p['parameters']['options']['systemMessage']
    if 'PAGO CON TARJETA DE CRÉDITO (regla de negocio' in s:
        applied.append(f'P3.7 prompt {pname}: already')
        continue
    if pname == 'Run confirming_reservation pass':
        s = replace_once(s, "\nOUTPUT\nDevuelve EXCLUSIVAMENTE JSON válido:", TARJETA + "\nOUTPUT\nDevuelve EXCLUSIVAMENTE JSON válido:", 'P3.7 confirming')
    else:
        s = s.rstrip('\n') + TARJETA
    p['parameters']['options']['systemMessage'] = s
    applied.append(f'P3.7 prompt {pname}: tarjeta 5 %')

print('CA active:', put_workflow(CA, wf))
print('\n'.join(applied))
