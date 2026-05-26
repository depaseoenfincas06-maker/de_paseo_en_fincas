#!/usr/bin/env python3
"""
Reemplaza el handoff text customer-facing en los 7 nodos del customer
agent que lo tienen hardcoded como fallback. El texto nuevo:

  ANTES:    "Te voy a pasar con un asesor humano para continuar con tu solicitud."
  DESPUÉS:  "Dame un momento, te paso con mi compañero del área encargada para continuar con tu solicitud."

Nodos afectados:
  - Get agent settings (Postgres SELECT, CTE defaults)
  - Code in JavaScript1 (handoffText fallback)
  - Build audio transcription failure result (Code)
  - Compute deterministic prechecks (Code)
  - Parse QA validator (Code)
  - Build direct workflow result (Code)
  - Build unknown state payload (Code)
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

OLD = 'Te voy a pasar con un asesor humano para continuar con tu solicitud.'
NEW = 'Dame un momento, te paso con mi compañero del área encargada para continuar con tu solicitud.'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

touched = []
for n in wf['nodes']:
    params = n.get('parameters') or {}
    serialized = json.dumps(params, ensure_ascii=False)
    if OLD in serialized:
        # Replace and rebuild params from the modified JSON
        replaced = serialized.replace(OLD, NEW)
        n['parameters'] = json.loads(replaced)
        touched.append(n['name'])

if not touched:
    print('!! no nodes contained the OLD text — nothing to patch')
    sys.exit(2)

for name in touched:
    print(f'✓ {name}')

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
print(f'PUT ok. active={out.get("active")} | nodes touched={len(touched)}')
if not out.get('active'):
    subprocess.run(['curl','-sk','-X','POST', URL+'/activate', '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True)
