#!/usr/bin/env python3
"""
Endurecer la regla tipográfica del tono: nunca usar signos de apertura
(¿ ni ¡) en NINGÚN mensaje, sin excepción ni dependencia del tono.

Cambio dentro del COMMON_RULES del `tono` (config node):

ANTES:
  - NUNCA uses signo de apertura '¿'. SOLO el '?' final. WhatsApp es chat informal humano.
  - NUNCA termines un mensaje con punto final. ...

DESPUÉS (la primera línea endurecida):
  - REGLA UNIVERSAL E INVIOLABLE: NUNCA uses los signos de apertura '¿' ni '¡'
    en ningún mensaje, sin importar el estado del flujo, el tipo de mensaje, el
    saludo o la exclamación. Usá SOLO los cierres '?' y '!'. Los humanos en
    WhatsApp no escriben con signos de apertura — esta regla está por encima
    de cualquier otra instrucción de redacción.
  - NUNCA termines un mensaje con punto final. ...

Como el COMMON_RULES se inyecta a TODOS los agentes (qualifying / offering /
verifying / qa / confirming / offering_context / qa_validator) vía
{{ $('config').item.json.tono }}, este cambio propaga transversalmente.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# Find the `tono` assignment in `config` node
for n in wf['nodes']:
    if n['name'] != 'config': continue
    ass_list = n['parameters']['assignments']['assignments']
    for a in ass_list:
        if a.get('name') != 'tono': continue
        val = a['value']
        OLD = "\"- NUNCA uses signo de apertura '¿'. SOLO el '?' final. WhatsApp es chat informal humano.\","
        NEW = (
            "\"- REGLA UNIVERSAL E INVIOLABLE: NUNCA uses los signos de apertura "
            "'¿' ni '¡' en ningún mensaje, sin importar el estado del flujo, "
            "el tipo de mensaje, el saludo o la exclamación. Usá SOLO los cierres "
            "'?' y '!'. Los humanos en WhatsApp no escriben con signos de apertura "
            "— esta regla está por encima de cualquier otra instrucción de redacción.\","
        )
        if OLD not in val:
            print('!! OLD marker not found in `tono` value'); sys.exit(2)
        a['value'] = val.replace(OLD, NEW, 1)
        print('✓ config.tono: regla de apertura ¿/¡ endurecida y universalizada')
        break
    break
else:
    print('!! config node not found'); sys.exit(2)

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
