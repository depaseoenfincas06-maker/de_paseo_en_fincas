#!/usr/bin/env python3
"""Add farewell_message_template + partial_payment_template to Get agent settings query."""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# Add to defaults (after visit_offer_message_template) AND to coalesce list
OLD_DEFAULTS = "    ''::text as visit_offer_message_template\n),"
NEW_DEFAULTS = (
"    ''::text as visit_offer_message_template,\n"
"    ''::text as farewell_message_template,\n"
"    ''::text as partial_payment_template\n),"
)

OLD_SELECT_END = "  coalesce(s.visit_offer_message_template, d.visit_offer_message_template) as visit_offer_message_template"
NEW_SELECT_END = (
"  coalesce(s.visit_offer_message_template, d.visit_offer_message_template) as visit_offer_message_template,\n"
"  coalesce(s.farewell_message_template, d.farewell_message_template) as farewell_message_template,\n"
"  coalesce(s.partial_payment_template, d.partial_payment_template) as partial_payment_template"
)

found = False
for n in wf['nodes']:
    if n['name'] != 'Get agent settings': continue
    q = n['parameters'].get('query','')
    if 'farewell_message_template' in q:
        print('!! already present'); sys.exit(0)
    if OLD_DEFAULTS not in q:
        print('!! defaults anchor missing'); sys.exit(2)
    if OLD_SELECT_END not in q:
        print('!! select anchor missing'); sys.exit(2)
    q = q.replace(OLD_DEFAULTS, NEW_DEFAULTS, 1).replace(OLD_SELECT_END, NEW_SELECT_END, 1)
    n['parameters']['query'] = q
    print('✓ Get agent settings: 2 new columns added')
    found = True
    break

if not found:
    print('!! not found'); sys.exit(2)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
