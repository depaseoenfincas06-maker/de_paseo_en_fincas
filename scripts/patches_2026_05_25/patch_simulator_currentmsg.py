#!/usr/bin/env python3
"""
Fix: Normalize inbound payload simulator branch sets chatInput correctly
pero `current_message` solo lee `payload.current_message` (ignora chatInput).
Eso hace que Merge Sets1.last-message quede vacío en testing simulator,
y el qualifying agent recibe un mensaje vacío → no extrae nada.

Cambio: current_message: compact(payload.current_message || chatInput || '')
(fallback al chatInput).
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

for n in wf['nodes']:
    if n['name'] != 'Normalize inbound payload': continue
    code = n['parameters']['jsCode']
    OLD = "        current_message: compact(payload.current_message || ''),"
    NEW = "        current_message: compact(payload.current_message || chatInput || ''),"
    if OLD not in code:
        print('!! marker not found'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    print('✓ Normalize inbound payload: simulator branch current_message falls back to chatInput')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload = {
    'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED},
}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL,
                     '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload), capture_output=True, text=True, check=True)
out = json.loads(r2.stdout)
print(f'PUT ok. active={out.get("active")}')
if not out.get('active'):
    subprocess.run(['curl','-sk','-X','POST', URL+'/activate', '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True)
