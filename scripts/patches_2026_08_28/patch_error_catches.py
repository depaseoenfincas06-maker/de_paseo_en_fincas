#!/usr/bin/env python3
"""Catches de errores SEGUROS (Ago 28 2026) — pedido de JD: "ajusta todo lo
que sea coger excepciones y errores que estamos seguros que son errores".

P1. CJS1 — stall del LLM → bot NUNCA en silencio.
    Caso real (26-ago + batch4 jul): el agente muere en la tool call
    ("Calling inventory_reader_tool...") → outbound_sequence vacío → el
    cliente no recibe NADA. El guardrail de finca-por-código cubre solo ese
    sub-caso. Ahora: si un agent pass corrió, NO hay loop inmediato a otro
    estado, y la secuencia quedó vacía → fallback cortés pidiendo repetir.

P2. CJS1 — outbound_message consistente con el fallback (el primary se
    recalcula desde la secuencia posiblemente mutada).

P3. Follow-up Sender — 'Select due follow-ups' ignora conversaciones
    SINTÉTICAS de evals (wa_id 5730+11dígitos): sus chatwoot_id inválidos
    reintentaban 404 por siempre (fila 4282 llegó a 343 intentos).

P4. Follow-up Sender — fallo de envío en conversación REAL → fila en el
    sheet de errores (antes quedaba solo en metadata y nadie se enteraba).

P5. Prompts offering + qa — REGLA DE COSTOS NO DOCUMENTADOS: nunca afirmar
    que un cobro extra NO existe (manillas, ingreso, parqueadero, admón de
    condominio) si el dato no está en el inventario. Caso real 26-ago: el bot
    negó 2 veces el cobro de manillas de GIRARDOT12 sin tener el dato.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
BASE = 'https://n8n.depaseoenfincas.raaamp.co'
SHEET = 'https://script.google.com/macros/s/AKfycbzP5gPvB7z3p2uZdvyUetTbXom6EyWprQqH1DVhTxMVCsxk5aP8lgiErER4eSiYFLUQKg/exec'

def get(wid):
    r = subprocess.run(['curl','-sk', f'{BASE}/api/v1/workflows/{wid}', '-H', f'X-N8N-API-KEY: {JWT}'],
                       capture_output=True, text=True, check=True)
    return json.loads(r.stdout)

def put(wid, wf):
    ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
               'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
    payload = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
               'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
    r = subprocess.run(['curl','-sk','-X','PUT', f'{BASE}/api/v1/workflows/{wid}',
                        '-H', f'X-N8N-API-KEY: {JWT}', '-H','Content-Type: application/json','-d','@-'],
                       input=json.dumps(payload), capture_output=True, text=True, check=True)
    active = json.loads(r.stdout).get('active')
    if active is False:
        subprocess.run(['curl','-sk','-X','POST', f'{BASE}/api/v1/workflows/{wid}/activate',
                        '-H', f'X-N8N-API-KEY: {JWT}'], capture_output=True, text=True)
        active = 'reactivated'
    return active

applied = []

# ========================= Customer agent =========================
CA = '2NV08zRFKENUsQVC'
ca = get(CA)

P1_ANCHOR = """const shouldImmediateLoop =
  !suppressImmediateLoopForSelection &&
  (
    (currentStateChanged && businessStates.has(currentStateAfter)) ||
    (resumeAfterQa && businessStates.has(resumeStateAfterQa))
  );"""

P1_NEW = P1_ANCHOR + """

// === STALL-FALLBACK (Ago 28 2026): el bot NUNCA se queda en silencio ===
// Si un agent pass corrió, no hay loop inmediato a otro estado (que sí
// produciría el outbound), y la secuencia quedó vacía → el LLM se atascó
// (típico: output final "Calling inventory_reader_tool..."). Enviamos un
// fallback cortés en vez de nada. Los paths legítimamente silenciosos
// (NOOP_BOT_DISABLED, sync, owner, paired-item guard) no pasan por aquí.
const _AGENT_PASSES = new Set(['qualifying_agent', 'offering_agent', 'qa_agent', 'confirming_reservation_agent']);
if (
  outboundSequence.length === 0 &&
  !shouldImmediateLoop &&
  _AGENT_PASSES.has(toolChosen) &&
  !String(rawFinalWhatsappText || '').trim()
) {
  outboundSequence.push({
    type: 'text',
    content: 'Perdóname, se me enredaron los mensajes por un momento 🙈 ¿Me repites lo último, porfa?',
  });
}
// === /STALL-FALLBACK ==="""

P2_OLD = "var _sanitizedPrimaryOutboundMessage = _ensureInstagramLink(_stripOpeningPunctuation(primaryOutboundMessage));"
P2_NEW = """var _sanitizedPrimaryOutboundMessage = _ensureInstagramLink(_stripOpeningPunctuation(
  primaryOutboundMessage ||
  // el stall-fallback pudo haber mutado la secuencia después del primary
  [...outboundSequence].reverse().map((it) => String(it?.content || '').trim()).find(Boolean) ||
  null
));"""

P5_ANCHOR = "- REGLA DE PRECIOS — el cliente puede preguntar el precio en cualquier momento. CÓMO responder:"
P5_NEW = P5_ANCHOR + """
  • COSTOS EXTRA NO DOCUMENTADOS (manillas de condominio, ingreso de vehículos, parqueadero, cuota de administración, peajes internos): si el dato NO está en el item del inventario, NUNCA afirmes que el cobro no existe y NUNCA inventes un valor. Responde: "Ese detalle puntual lo confirmo con el área encargada para darte el dato exacto" y continúa el flujo. Negar un cobro sin tener el dato es un error grave (le pasó al bot con las manillas de GIRARDOT12)."""

for n in ca['nodes']:
    if n['name'] == 'Code in JavaScript1':
        c = n['parameters']['jsCode']
        if 'STALL-FALLBACK' in c:
            applied.append('P1/P2 CJS1: already')
        else:
            if P1_ANCHOR not in c: print('!! P1 anchor missing'); sys.exit(2)
            if P2_OLD not in c: print('!! P2 anchor missing'); sys.exit(3)
            c = c.replace(P1_ANCHOR, P1_NEW, 1).replace(P2_OLD, P2_NEW, 1)
            n['parameters']['jsCode'] = c
            applied.append('P1 CJS1: stall-fallback (bot nunca en silencio)')
            applied.append('P2 CJS1: primary recomputado desde secuencia')
    if n['name'] in ('Run offering pass', 'Run qa pass'):
        sm = n['parameters'].get('options', {}).get('systemMessage', '')
        if 'COSTOS EXTRA NO DOCUMENTADOS' in sm:
            applied.append(f'P5 {n["name"]}: already')
        elif P5_ANCHOR in sm:
            n['parameters']['options']['systemMessage'] = sm.replace(P5_ANCHOR, P5_NEW, 1)
            applied.append(f'P5 {n["name"]}: regla costos no documentados')

print('CA active:', put(CA, ca))

# ========================= Follow-up Sender =========================
FU = 'xxK2FfX6QMPxKaZw'
fu = get(FU)

P3_OLD = "where fo.status = 'pendiente'"
P3_NEW = """where fo.status = 'pendiente'
  -- Catch Ago 28 2026: convs SINTÉTICAS de evals (5730+11díg) tienen
  -- chatwoot_id inválido y reintentaban 404 por siempre (fila 4282: 343x).
  and fo.conversation_id !~ '^5730[0-9]{11,}$'"""

P4_SNIPPET = """
  // Catch (Ago 28 2026): fallo de envío en conversación REAL → fila en el
  // sheet de errores. Antes el fallo quedaba solo en fo_metadata y nadie se
  // enteraba. Best-effort: jamás rompe el flujo del sender.
  if (errorMessage && !/^5730\\d{11,}$/.test(String(row.conversation_id || ''))) {
    try {
      await this.helpers.httpRequest({
        url: '__SHEET__',
        method: 'POST',
        json: true,
        timeout: 10000,
        body: {
          timestamp: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
          workflow_name: 'Follow-up Sender - De Paseo en Fincas',
          node: '__NODE__',
          error_message: 'Fallo de envío de follow-up a ' + String(row.conversation_id) + ': ' + String(errorMessage),
        },
      });
    } catch (e) { /* logging best-effort */ }
  }
""".replace('__SHEET__', SHEET)

for n in fu['nodes']:
    if n['name'] == 'Select due follow-ups':
        q = n['parameters']['query']
        if "5730[0-9]{11,}" in q:
            applied.append('P3 Select: already')
        else:
            if P3_OLD not in q: print('!! P3 anchor missing'); sys.exit(4)
            n['parameters']['query'] = q.replace(P3_OLD, P3_NEW, 1)
            applied.append('P3 Select due follow-ups: filtro sintéticas')
    if n['name'] in ('Send template message', 'Send LLM message'):
        c = n['parameters']['jsCode']
        if 'fila en el' in c and 'sheet de errores' in c:
            applied.append(f'P4 {n["name"]}: already')
            continue
        idx = c.rfind('return [')
        if idx < 0: print(f'!! P4 no return in {n["name"]}'); sys.exit(5)
        n['parameters']['jsCode'] = c[:idx] + P4_SNIPPET.replace('__NODE__', n['name']) + '\n  ' + c[idx:]
        applied.append(f'P4 {n["name"]}: log de fallos al sheet')

print('FU active:', put(FU, fu))
print('\n'.join(applied))
