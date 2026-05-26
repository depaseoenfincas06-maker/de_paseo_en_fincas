#!/usr/bin/env python3
"""Bug: el sanitizer de ¿/¡ aplicaba solo a outboundSequence en CodeJS1,
PERO Run offering context pass corre DESPUÉS de CodeJS1 y su context_message
("¡Claro que sí!") se inyecta en outboundSequence vía Finalize offering
outbound — sin pasar por el sanitizer.

Fix: aplicar _stripOpeningPunctuation a contextMessage dentro de Finalize
offering outbound antes de usarlo.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """const contextMessage = extractContextMessage(contextSource);
const shouldInject ="""

NEW = """let contextMessage = extractContextMessage(contextSource);
// Sanitize opening punctuation (¿/¡) — el offering context pass corre
// después de CodeJS1's sanitizer, así que aplicamos el mismo strip acá.
contextMessage = String(contextMessage || '').replace(/[¿¡] */g, '').replace(/  +/g, ' ');
const shouldInject ="""

for n in wf['nodes']:
    if n['name'] != 'Finalize offering outbound': continue
    code = n['parameters']['jsCode']
    if 'Sanitize opening punctuation' in code:
        print('!! already deployed'); sys.exit(0)
    if OLD not in code:
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    print('✓ Finalize offering outbound: contextMessage sanitized (¿/¡ stripped)')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
