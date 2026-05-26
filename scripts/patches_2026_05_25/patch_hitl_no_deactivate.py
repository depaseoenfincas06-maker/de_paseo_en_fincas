#!/usr/bin/env python3
"""
Strip auto-deactivation of bot on HITL_REQUEST and RESERVATION_APPROVED.

User decision (25-may 2026): cuando se notifica al asesor (HITL o
RESERVATION_APPROVED), el bot DEBE seguir activo y responder preguntas
del cliente. SOLO se desactiva cuando el asesor responde por Chatwoot
(detectado por sender_type=user en el inbound).

Cambios en normalizePostActions:
1. Quitar `raw.agente_activo = false` del bloque RESERVATION_APPROVED
2. Quitar `raw.agente_activo = false` del bloque HITL_REQUEST

NO toco las notificaciones — esas siguen disparándose normalmente.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# Strip 1: RESERVATION_APPROVED block — keep state transition + reason, drop deactivation
OLD1 = """      raw.state_transition ||= 'HITL';
      raw.waiting_for ||= 'HUMAN_HANDOFF';
      raw.agente_activo = false;
      raw.hitl_reason ||= 'reservation_approved';"""
NEW1 = """      raw.state_transition ||= 'HITL';
      raw.waiting_for ||= 'HUMAN_HANDOFF';
      // NOTE (May 25 2026): bot NO se desactiva en RESERVATION_APPROVED.
      // El asesor recibe notificación WhatsApp via selection_notification,
      // pero el bot sigue respondiendo. Se desactiva cuando el asesor
      // efectivamente responde por Chatwoot (detectado en Normalize inbound).
      raw.hitl_reason ||= 'reservation_approved';"""

# Strip 2: HITL_REQUEST direct deactivation
OLD2 = """  if ((parsed?.action === 'HITL' || intent === 'HITL_REQUEST') && raw.agente_activo === undefined) {
    raw.agente_activo = false;
  }"""
NEW2 = """  // NOTE (May 25 2026): HITL_REQUEST ya NO desactiva el bot.
  // El bot sigue respondiendo. Solo se desactiva cuando el asesor
  // responde por Chatwoot (detectado en Normalize inbound payload).
  // if ((parsed?.action === 'HITL' || intent === 'HITL_REQUEST') && raw.agente_activo === undefined) {
  //   raw.agente_activo = false;
  // }"""

for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    changes = 0
    for o, ne in [(OLD1, NEW1), (OLD2, NEW2)]:
        if o in code:
            code = code.replace(o, ne, 1)
            changes += 1
        elif ne in code:
            print(f'  (already stripped)')
        else:
            print(f'!! anchor not found: {o[:80]!r}')
    n['parameters']['jsCode'] = code
    print(f'✓ auto-deactivations stripped ({changes} replacements)')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
