#!/usr/bin/env python3
"""
Track C.2 — Brief HITL hand-off post-DOCUMENT_READY.

Requerimiento de Juan: cuando una conversación llega a DOCUMENT_READY
(PDF generado, listo para pago humano), el asesor que recibe el hand-off
debe ver un brief rápido para no perder tiempo re-leyendo toda la
conversación. "La gente está lista para pagar pero ya necesitamos no
dejarlos ir."

Implementación inline en Code in JavaScript1 (al final, antes del return):
1. Detecta si outbound_sequence contiene un media_url con
   /api/reservation-confirmation.pdf.
2. Construye un brief estructurado determinístico con datos disponibles:
   - cliente: nombre, doc, contacto, dirección
   - finca elegida: código + zona
   - fechas + noches + #personas
   - Notas de proceso: heurísticas sobre cambios detectados (#personas,
     cambio de finca, pago parcial, etc.) escaneando recent_messages.
3. POSTea como `private: true` a Chatwoot
   /api/v1/accounts/2/conversations/{chatwoot_id}/messages.
4. ignoreHttpStatusErrors + try/catch — no debe bloquear el flow del PDF
   si Chatwoot falla.

Idempotencia: el brief solo se construye/envía cuando el outbound_sequence
del turno actual contiene el PDF. En el turn siguiente (RESERVATION_APPROVED
etc.) no se vuelve a generar.

Skipea simulator (no tiene chatwoot_id).
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# Anchor: just before the final return
OLD = "var _sanitizedPrimaryOutboundMessage = _stripOpeningPunctuation(primaryOutboundMessage);\n\nreturn ["

# Inject brief sender block right before the return
BRIEF_BLOCK = r"""var _sanitizedPrimaryOutboundMessage = _stripOpeningPunctuation(primaryOutboundMessage);

// === Brief HITL hand-off (T-C.2 — May 25 2026) ===
// Cuando el outbound de este turno contiene el PDF de confirmación,
// enviar un brief de la conversación como private_note a Chatwoot.
// El asesor humano que toma el hand-off lo ve sin que el cliente lo vea.
// Determinístico (sin LLM call) para mantener latencia + costo bajo.
await (async function _sendBriefIfDocumentReady() {
  try {
    var hasPdf = (outboundSequence || []).some(function(it) {
      return it && it.media_url && /\/api\/reservation-confirmation\.pdf/.test(String(it.media_url));
    });
    if (!hasPdf) return;
    var chatwootId = $('Get Context-conversations1').item.json.chatwoot_id ||
                     $('Merge Sets1').item.json.chatwoot_id || null;
    if (!chatwootId) return; // simulator runs no tienen chatwoot_id
    // Datos del contexto
    var sf = $('Get Context-conversations1').item.json.selected_finca || {};
    var sc = $('Get Context-conversations1').item.json.search_criteria || {};
    var ex = $('Get Context-conversations1').item.json.extras || {};
    var cr = (ex && ex.confirming_reservation) || {};
    var name = cr.nombre_completo || $('Get Context-conversations1').item.json.client_name || 'cliente';
    var doc = (cr.tipo_documento ? cr.tipo_documento + ' ' : '') + (cr.numero_documento || '');
    var phone = cr.celular || '';
    var email = cr.correo || '';
    var addr = cr.direccion || '';
    var fincaCode = sf.codigo_original || sf.finca_id || sf.nombre || 'finca';
    var fincaZone = sf.zona || sf.municipio || '';
    var fechaIni = sc.fecha_inicio || '';
    var fechaFin = sc.fecha_fin || '';
    var personas = sc.personas != null ? sc.personas : '';
    var noches = '';
    try {
      if (fechaIni && fechaFin) {
        var diff = (new Date(fechaFin) - new Date(fechaIni)) / 86400000;
        if (Number.isFinite(diff) && diff >= 0) noches = Math.round(diff);
      }
    } catch (e) {}
    // Heurísticas sobre recent_messages: detectar cambios/eventos clave
    var changes = [];
    try {
      var recent = ($('Fetch messages1').item.json.recent_messages) || [];
      if (typeof recent === 'string') { try { recent = JSON.parse(recent); } catch (e2) { recent = []; } }
      var patterns = [
        { re: /\b(?:ahora\s+somos|ya\s+somos|seremos)\s+(\d+)\b/i, kind: 'personas_change' },
        { re: /\b(?:m[áa]s\s+barat|m[áa]s\s+econ[óo]mic|menos\s+costos|menor\s+precio)/i, kind: 'price_pref' },
        { re: /\b(?:cambio|cambiar|mejor|otra|cambiemos)\s+(?:de\s+)?(?:finca|propiedad|opci[óo]n)/i, kind: 'finca_change' },
        { re: /\b(?:pago\s+parcial|menos\s+del\s+50|bloqueo\s+con|separar\s+con)/i, kind: 'partial_payment' },
        { re: /\b(?:visit|conocer\s+la\s+finca|ir\s+a\s+ver)/i, kind: 'visit_request' },
        { re: /\b(?:mascot|perr|gat)/i, kind: 'pets_mentioned' },
        { re: /\b(?:ni[ñn]os?|menor(?:es)?)\s+de?\s+\d/i, kind: 'kids_age_mentioned' },
      ];
      var inboundCount = 0;
      for (var i = 0; i < recent.length && inboundCount < 20; i++) {
        var m = recent[i];
        if (!m || m.direction !== 'INBOUND') continue;
        inboundCount++;
        var c = String(m.content || '').slice(0, 200);
        for (var p of patterns) {
          if (p.re.test(c)) changes.push({ kind: p.kind, content: c.slice(0, 120) });
        }
      }
    } catch (e3) { /* ignore */ }
    var KIND_LABELS = {
      personas_change: 'Cambió de # personas durante la conversación',
      price_pref: 'Pidió opciones más económicas',
      finca_change: 'Cambió de finca en algún momento',
      partial_payment: 'Mencionó pago parcial / menos del 50%',
      visit_request: 'Pidió visitar la finca antes de reservar',
      pets_mentioned: 'Mencionó mascotas',
      kids_age_mentioned: 'Mencionó edades de niños',
    };
    var seen = new Set();
    var changeBullets = [];
    for (var ch of changes) {
      if (seen.has(ch.kind)) continue;
      seen.add(ch.kind);
      changeBullets.push('• ' + (KIND_LABELS[ch.kind] || ch.kind));
    }
    var brief =
      '🤖 *Brief automático del agente — listo para pago*\n' +
      '\n' +
      '*Cliente:* ' + name + (doc ? ' (' + doc + ')' : '') + '\n' +
      '*Contacto:* ' + phone + (email ? ' · ' + email : '') + '\n' +
      (addr ? '*Dirección:* ' + addr + '\n' : '') +
      '\n' +
      '*Finca:* ' + fincaCode + (fincaZone ? ' — ' + fincaZone : '') + '\n' +
      '*Fechas:* ' + (fechaIni || '?') + ' → ' + (fechaFin || '?') + (noches !== '' ? ' (' + noches + ' noches)' : '') + '\n' +
      '*Grupo:* ' + personas + ' personas\n' +
      (changeBullets.length ? '\n*Notas del proceso:*\n' + changeBullets.join('\n') + '\n' : '') +
      '\n_PDF de confirmación enviado al cliente. Cliente esperando instrucciones de pago._';
    await this.helpers.httpRequest({
      url: 'https://chat.depaseoenfincas.raaamp.co/api/v1/accounts/2/conversations/' + String(chatwootId) + '/messages',
      method: 'POST',
      headers: {
        'api_access_token': 'HHtQoPLW991XS8Rcu5thbZ5x',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: brief,
        private: true,
        message_type: 'outgoing',
      }),
      timeout: 7000,
      ignoreHttpStatusErrors: true,
    });
    console.error('[brief-sender] private_note posted to chatwoot_id=' + chatwootId + ' (' + changeBullets.length + ' change-notes)');
  } catch (e) {
    console.error('[brief-sender] failed:', String(e).slice(0, 300));
  }
})();

return ["""

found = False
for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    if OLD not in code:
        print('!! return anchor not found'); sys.exit(2)
    if '[brief-sender]' in code or 'T-C.2' in code:
        print('!! brief sender already present, skipping')
    else:
        n['parameters']['jsCode'] = code.replace(OLD, BRIEF_BLOCK, 1)
        print('✓ Code in JavaScript1: brief HITL sender inserted before return')
    found = True
    break

if not found:
    print('!! Code in JavaScript1 not found'); sys.exit(2)

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
