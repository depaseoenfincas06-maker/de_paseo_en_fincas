#!/usr/bin/env python3
"""Update Follow-up Sender workflow to use the template names Juan got approved
in Meta: followup_24h_check_in_es (FU#2 at 24h) + followup_farewell_es (FU#3 final).
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = 'xxK2FfX6QMPxKaZw'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = "const templateName = attempt >= 3 ? 'follow_up_final_check_in' : 'follow_up_warm_reengagement';"
NEW = "const templateName = attempt >= 3 ? 'followup_farewell_es' : 'followup_24h_check_in_es';"

for n in wf['nodes']:
    if n['name'] != 'Send template message': continue
    code = n['parameters']['jsCode']
    if OLD not in code:
        if 'followup_24h_check_in_es' in code:
            print('!! already updated'); sys.exit(0)
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    print('✓ Follow-up Sender: template names updated to Juan approved versions')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
