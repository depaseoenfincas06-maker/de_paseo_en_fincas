#!/usr/bin/env python3
"""Re-add chatwoot_brief_preview field for test visibility (current code state)."""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD1 = """await (async function _sendBriefIfDocumentReady() {"""
NEW1 = """var _chatwootBriefPreview = null;
await (async function _sendBriefIfDocumentReady() {"""

OLD2 = """      '\\n_PDF de confirmación enviado al cliente. Cliente esperando instrucciones de pago._';
    if (!chatwootId) return;"""
NEW2 = """      '\\n_PDF de confirmación enviado al cliente. Cliente esperando instrucciones de pago._';
    _chatwootBriefPreview = brief;
    if (!chatwootId) return;"""

OLD3 = "      loop_owner_unavailable: false,\n    },\n  },\n];"
NEW3 = "      loop_owner_unavailable: false,\n      chatwoot_brief_preview: _chatwootBriefPreview,\n    },\n  },\n];"

for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    if 'chatwoot_brief_preview' in code:
        print('!! already present'); sys.exit(0)
    for o, ne in [(OLD1, NEW1), (OLD2, NEW2), (OLD3, NEW3)]:
        if o not in code:
            print(f'!! anchor missing: {o[:80]!r}'); sys.exit(2)
        code = code.replace(o, ne, 1)
    n['parameters']['jsCode'] = code
    print('✓ preview re-added')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
