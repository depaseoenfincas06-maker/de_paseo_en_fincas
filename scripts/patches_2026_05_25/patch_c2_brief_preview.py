#!/usr/bin/env python3
"""Add chatwoot_brief_preview to CodeJS1 output JSON so brief content is
inspectable via n8n exec API. Stored only when brief was built (regardless
of POST success)."""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# Wrap the entire brief block with a captured variable
# Replace start of the IIFE:
OLD = """// === Brief HITL hand-off (T-C.2 — May 25 2026) ===
// Cuando el outbound de este turno contiene el PDF de confirmación,
// enviar un brief de la conversación como private_note a Chatwoot.
// El asesor humano que toma el hand-off lo ve sin que el cliente lo vea.
// Determinístico (sin LLM call) para mantener latencia + costo bajo.
await (async function _sendBriefIfDocumentReady() {"""

NEW = """// === Brief HITL hand-off (T-C.2 — May 25 2026) ===
// Cuando el outbound de este turno contiene el PDF de confirmación,
// enviar un brief de la conversación como private_note a Chatwoot.
// El asesor humano que toma el hand-off lo ve sin que el cliente lo vea.
// Determinístico (sin LLM call) para mantener latencia + costo bajo.
var _chatwootBriefPreview = null;
await (async function _sendBriefIfDocumentReady() {"""

# Replace the build of `var brief =` to also set the preview
OLD2 = """      '\\n_PDF de confirmación enviado al cliente. Cliente esperando instrucciones de pago._';
    if (!chatwootId) {
      console.error('[brief-sender DEBUG] simulator (no chatwoot_id) — brief content follows:\\n' + brief);
      return;
    }"""

NEW2 = """      '\\n_PDF de confirmación enviado al cliente. Cliente esperando instrucciones de pago._';
    _chatwootBriefPreview = brief;
    if (!chatwootId) {
      console.error('[brief-sender DEBUG] simulator (no chatwoot_id) — brief content follows:\\n' + brief);
      return;
    }"""

# Add chatwoot_brief_preview to the returned JSON
OLD3 = "      loop_owner_unavailable: false,\n    },\n  },\n];"
NEW3 = "      loop_owner_unavailable: false,\n      chatwoot_brief_preview: _chatwootBriefPreview,\n    },\n  },\n];"

found = False
for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    if 'chatwoot_brief_preview' in code:
        print('!! preview already present'); sys.exit(0)
    for o, ne in [(OLD, NEW), (OLD2, NEW2), (OLD3, NEW3)]:
        if o not in code:
            print(f'!! anchor not found: {o[:80]!r}'); sys.exit(2)
        code = code.replace(o, ne, 1)
    n['parameters']['jsCode'] = code
    print('✓ chatwoot_brief_preview added to CodeJS1 output')
    found = True
    break

if not found:
    print('!! node not found'); sys.exit(2)

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
