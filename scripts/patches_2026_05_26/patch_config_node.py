#!/usr/bin/env python3
"""Add farewell_message_template + partial_payment_template to config node."""
import json, subprocess, sys, uuid

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

for n in wf['nodes']:
    if n['name'] != 'config': continue
    vals = n['parameters'].get('values',{}).get('values',[])
    if not vals:
        vals = n['parameters'].get('assignments',{}).get('assignments',[])
        is_assignments = True
    else:
        is_assignments = False
    # Check if already added
    names = [v.get('name') for v in vals]
    if 'farewell_message_template' in names:
        print('!! already added'); sys.exit(0)
    # Append new entries
    new_entries = [
        {
            'id': 'farewell-template-aaaa-bbbb-cccc-d0001',
            'name': 'farewell_message_template',
            'value': "={{ $('Get agent settings').item.json.farewell_message_template || '' }}",
            'type': 'string',
        },
        {
            'id': 'partial-payment-template-aaaa-bbbb-cccc-d0001',
            'name': 'partial_payment_template',
            'value': "={{ $('Get agent settings').item.json.partial_payment_template || '' }}",
            'type': 'string',
        },
    ]
    vals.extend(new_entries)
    if is_assignments:
        n['parameters']['assignments']['assignments'] = vals
    else:
        n['parameters']['values']['values'] = vals
    print(f'✓ config: added 2 entries. Total now: {len(vals)}')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
