#!/usr/bin/env python3
"""Fix HITL loop (May 29 2026): tras un HITL, el 'QA validator' (LLM router)
se queda enganchado en route_mode='HITL' porque el historial reciente muestra
el handoff en curso. Resultado: el bot repite el mensaje fijo
'Dame un momento, te paso con mi compañero...' a CADA pregunta siguiente, en
vez de seguir contestando como agente (confirmado en conv 573112407139).

Fix determinístico en 'Parse QA validator': si el bot YA entregó el handoff en
alguna de sus últimas 3 respuestas (OUTBOUND con 'te paso con mi compa'),
degrada el route_mode HITL → STATE para que el agente normal conteste la
pregunta puntual. El asesor ya fue notificado en el primer HITL; al degradar a
STATE el intent deja de ser HITL_REQUEST → no se duplica la notificación.

El primer HITL sigue intacto (handoff + notificación una sola vez). Solo se
suprime la REPETICIÓN robótica en los turnos siguientes.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# 1) Insertar el cómputo de effectiveRouteMode justo después de `const reason`.
ANCHOR = "const reason = typeof parsed?.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : null;"
INSERT = ANCHOR + """

// === Anti-loop HITL (May 29 2026) ===
// Si el bot ya entregó el handoff en alguna de sus últimas 3 respuestas, NO
// repetir el mensaje fijo: degradar HITL → STATE para que el agente conteste
// normal. El asesor ya fue notificado en el primer HITL.
const _recentMsgs = (() => {
  try { return $('Fetch messages1').first().json.recent_messages || []; }
  catch (e) { return []; }
})();
let _outboundSeen = 0;
let _recentHandoff = false;
for (let _i = 0; _i < _recentMsgs.length && _outboundSeen < 3; _i += 1) {
  const _m = _recentMsgs[_i] || {};
  if (String(_m.direction || '').toUpperCase() !== 'OUTBOUND') continue;
  _outboundSeen += 1;
  if (/te paso con mi compa/i.test(String(_m.content || ''))) { _recentHandoff = true; break; }
}
const effectiveRouteMode = routeMode === 'HITL' && _recentHandoff ? 'STATE' : routeMode;"""

# 2) Reescribir el return usando effectiveRouteMode en vez de routeMode.
OLD_RETURN = """return [
  {
    json: {
      ...source,
      route_mode: routeMode,
      reason,
      action: routeMode === 'HITL' ? 'HITL' : 'CONTINUE',
      post_actions:
        routeMode === 'HITL'
          ? {
              waiting_for: 'CLIENT',
            }
          : {},
      tool_output:
        routeMode === 'HITL'
          ? {
              intent: 'HITL_REQUEST',
              respuesta: handoffMessage,
            }
          : null,
      final_whatsapp_text: routeMode === 'HITL' ? handoffMessage : null,
      current_state_changed: false,
      effective_state: source.effective_state || currentState,
    },
  },
];"""

NEW_RETURN = """return [
  {
    json: {
      ...source,
      route_mode: effectiveRouteMode,
      reason,
      action: effectiveRouteMode === 'HITL' ? 'HITL' : 'CONTINUE',
      post_actions:
        effectiveRouteMode === 'HITL'
          ? {
              waiting_for: 'CLIENT',
            }
          : {},
      tool_output:
        effectiveRouteMode === 'HITL'
          ? {
              intent: 'HITL_REQUEST',
              respuesta: handoffMessage,
            }
          : null,
      final_whatsapp_text: effectiveRouteMode === 'HITL' ? handoffMessage : null,
      current_state_changed: false,
      effective_state: source.effective_state || currentState,
    },
  },
];"""

found = False
for n in wf['nodes']:
    if n['name'] != 'Parse QA validator': continue
    code = n['parameters']['jsCode']
    if 'effectiveRouteMode' in code:
        print('!! already deployed'); sys.exit(0)
    if ANCHOR not in code:
        print('!! reason anchor not found'); sys.exit(2)
    if OLD_RETURN not in code:
        print('!! return anchor not found'); sys.exit(3)
    code = code.replace(ANCHOR, INSERT, 1)
    code = code.replace(OLD_RETURN, NEW_RETURN, 1)
    n['parameters']['jsCode'] = code
    print('✓ Parse QA validator: anti-loop HITL (degrada HITL→STATE si ya hubo handoff)')
    found = True
    break
if not found: sys.exit(4)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
