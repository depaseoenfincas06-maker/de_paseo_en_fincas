#!/usr/bin/env python3
"""Strip the debug instrumentation from C.2:
- Remove `chatwoot_brief_preview` from the return JSON
- Remove the `_chatwootBriefPreview` capture variable
- Remove the simulator-only console.error DEBUG line
Keep the production brief sender intact.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# 1. Remove the preview return field
RM1_OLD = "      loop_owner_unavailable: false,\n      chatwoot_brief_preview: _chatwootBriefPreview,\n    },\n  },\n];"
RM1_NEW = "      loop_owner_unavailable: false,\n    },\n  },\n];"

# 2. Remove the capture variable declaration
RM2_OLD = """var _chatwootBriefPreview = null;
await (async function _sendBriefIfDocumentReady() {"""
RM2_NEW = """await (async function _sendBriefIfDocumentReady() {"""

# 3. Remove the simulator DEBUG branch (revert to early return)
RM3_OLD = """      '\\n_PDF de confirmación enviado al cliente. Cliente esperando instrucciones de pago._';
    _chatwootBriefPreview = brief;
    if (!chatwootId) {
      console.error('[brief-sender DEBUG] simulator (no chatwoot_id) — brief content follows:\\n' + brief);
      return;
    }"""
RM3_NEW = """      '\\n_PDF de confirmación enviado al cliente. Cliente esperando instrucciones de pago._';
    if (!chatwootId) return;"""

found = False
for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    changes = 0
    for o, ne in [(RM1_OLD, RM1_NEW), (RM2_OLD, RM2_NEW), (RM3_OLD, RM3_NEW)]:
        if o in code:
            code = code.replace(o, ne, 1)
            changes += 1
    n['parameters']['jsCode'] = code
    print(f'✓ debug stripped ({changes} replacements applied)')
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
