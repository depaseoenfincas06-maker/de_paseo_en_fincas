#!/usr/bin/env python3
"""
Fix: Prepare qualifying greeting context lee $json.raw.* que está vacío
después del routing chain. El resultado es que greeting_name_candidate
siempre queda null aunque client_name SÍ esté en la DB.

Cambio: reemplazar la lista de source candidates para que incluya
$('Get Context-conversations1').item.json.client_name como fuente
principal — esa es la fuente canónica del nombre en DB.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

for n in wf['nodes']:
    if n['name'] != 'Prepare qualifying greeting context': continue
    code = n['parameters']['jsCode']

    OLD = (
"function resolveGreetingNameCandidate() {\n"
"  const sourceCandidates = [\n"
"    raw?.conversation?.meta?.sender?.name,\n"
"    input.client_name,\n"
"    raw?.contact?.name,\n"
"    raw?.sender?.name,\n"
"    raw?.meta?.name,\n"
"    raw?.meta?.sender?.name,\n"
"  ];"
    )
    NEW = (
"function resolveGreetingNameCandidate() {\n"
"  // PRIMARY source: Get Context-conversations1.client_name (the canonical\n"
"  // value persisted from the Chatwoot WhatsApp profile via Normalize\n"
"  // inbound payload). The legacy `raw.*` paths below stay as fallbacks\n"
"  // for execs that somehow arrive without Get Context having run, but in\n"
"  // practice the DB read is what actually populates this — `raw` is\n"
"  // typically empty by the time greeting context runs (it's chained via\n"
"  // Route QUALIFYING state? which doesn't propagate the raw webhook).\n"
"  let dbName = null;\n"
"  try { dbName = $('Get Context-conversations1').item.json.client_name || null; } catch (e) {}\n"
"  const sourceCandidates = [\n"
"    dbName,\n"
"    raw?.conversation?.meta?.sender?.name,\n"
"    input.client_name,\n"
"    raw?.contact?.name,\n"
"    raw?.sender?.name,\n"
"    raw?.meta?.name,\n"
"    raw?.meta?.sender?.name,\n"
"  ];"
    )
    if OLD not in code:
        print('!! sourceCandidates marker not found'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    print('✓ Prepare qualifying greeting context: dbName agregado como fuente primaria')
    break
else:
    print('!! node not found'); sys.exit(2)

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
