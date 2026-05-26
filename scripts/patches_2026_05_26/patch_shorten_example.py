#!/usr/bin/env python3
"""Fix example block (whitespace had 4-space indent on blank line)."""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = 'Entendido Juan, buscamos entonces una propiedad en Girardot del 16 al 18 de mayo para 15 personas.\n    \n    Con esa información ya puedo buscar las mejores opciones para tu grupo. Dame un momento mientras consulto disponibilidad y te envío las alternativas'
NEW = 'Entendido Juan, buscamos entonces una propiedad en Girardot del 16 al 18 de mayo para 15 personas.\n    \n    Dame un momento mientras consulto disponibilidad y te envío las mejores alternativas'

for n in wf['nodes']:
    if n['name'] != 'Run qualifying pass': continue
    sm = n['parameters']['options']['systemMessage']
    if OLD not in sm:
        print('!! anchor still not found'); sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(OLD, NEW, 1)
    print('✓ qualifying: example block updated')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
