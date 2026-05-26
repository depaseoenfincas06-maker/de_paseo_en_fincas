#!/usr/bin/env python3
"""Acortar el mensaje de transición qualifying→offering.
De: "Con esa información ya puedo buscar las mejores opciones para tu grupo. Dame un momento mientras consulto disponibilidad y te envío las alternativas"
A:  "Dame un momento mientras consulto disponibilidad y te envío las mejores alternativas"
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD1 = 'Bloque 2 (dos frases, no pregunta): "Con esa información ya puedo buscar las mejores opciones para tu grupo. Dame un momento mientras consulto disponibilidad y te envío las alternativas"'
NEW1 = 'Bloque 2 (una frase corta, no pregunta): "Dame un momento mientras consulto disponibilidad y te envío las mejores alternativas"'

OLD2 = '''  Ejemplo literal:
    Entendido Juan, buscamos entonces una propiedad en Girardot del 16 al 18 de mayo para 15 personas.

    Con esa información ya puedo buscar las mejores opciones para tu grupo. Dame un momento mientras consulto disponibilidad y te envío las alternativas'''

NEW2 = '''  Ejemplo literal:
    Entendido Juan, buscamos entonces una propiedad en Girardot del 16 al 18 de mayo para 15 personas.

    Dame un momento mientras consulto disponibilidad y te envío las mejores alternativas'''

for n in wf['nodes']:
    if n['name'] != 'Run qualifying pass': continue
    sm = n['parameters']['options']['systemMessage']
    changes = 0
    for o, ne in [(OLD1, NEW1), (OLD2, NEW2)]:
        if o in sm:
            sm = sm.replace(o, ne, 1)
            changes += 1
        else:
            print(f'!! anchor not found: {o[:80]!r}')
    n['parameters']['options']['systemMessage'] = sm
    print(f'✓ qualifying: {changes} replacements')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
