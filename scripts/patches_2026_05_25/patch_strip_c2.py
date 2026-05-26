#!/usr/bin/env python3
"""
Strip C.2 brief sender — la decisión de Juan es usar la infra existente
de selection_notification (que YA fires en RESERVATION_APPROVED). Sólo
falta poblar selection_notification_recipients.

El brief deployado fue redundante. Lo removemos completamente:
- bloque IIFE _sendBriefIfDocumentReady
- variable _chatwootBriefPreview
- campo chatwoot_brief_preview en return JSON
- declaration de var _chatwootBriefPreview
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

found = False
for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']

    # Find the brief block start
    start = code.find('// === Brief HITL hand-off (T-C.2')
    if start < 0:
        print('!! brief block not found (already stripped?)')
        sys.exit(0)

    # Find the end (closing })(); + blank line)
    end_marker = "})();\n\nreturn ["
    end = code.find(end_marker, start)
    if end < 0:
        print('!! end of brief block not found'); sys.exit(2)
    end += len("})();\n\n")  # keep the blank line + "return ["

    # Remove the brief block
    code = code[:start] + code[end:]

    # Also remove the preview field from return
    code = code.replace(
        "      loop_owner_unavailable: false,\n      chatwoot_brief_preview: _chatwootBriefPreview,\n    },",
        "      loop_owner_unavailable: false,\n    },",
        1
    )

    n['parameters']['jsCode'] = code
    print('✓ C.2 brief stripped')
    found = True
    break

if not found:
    print('!! node not found'); sys.exit(2)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
