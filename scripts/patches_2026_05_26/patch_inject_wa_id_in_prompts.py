#!/usr/bin/env python3
"""El sub-exec del inventory_reader_tool NO puede leer $('Merge Sets1') ni
otros nodos del parent. Mi fallback en Fetch fresh search_criteria fue inútil.

La única forma de pasar wa_id confiablemente al sub-exec es que el AI agent
lo incluya como arg de la tool call. Para garantizar eso:

1. Inyectar wa_id_runtime en el top del system message de cada AI agent
   que usa inventory_reader_tool (offering, qa, verifying_availability,
   confirming_reservation). El valor sale de $('Merge Sets1').conversation_key
   evaluado en parent context.
2. Agregar regla explícita: "cuando llames a inventory_reader_tool, SIEMPRE
   pasa wa_id={wa_id_runtime} (no opcional)".
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# Header to prepend
HEADER = """[CONTEXTO RUNTIME — NO MODIFICAR]
wa_id_runtime: {{ $('Merge Sets1').first().json.conversation_key }}
[/CONTEXTO RUNTIME]

⚠️ REGLA TOOL-CALL OBLIGATORIA: cuando llames al inventory_reader_tool, SIEMPRE incluye el campo `wa_id` con el valor exacto de wa_id_runtime de arriba. NO es opcional. Sin esto el sistema no puede persistir el inventario en cache y los siguientes turnos pierden datos.

"""

TARGET_AGENTS = ['Run offering pass', 'Run qa pass', 'Run verifying_availability pass', 'Run confirming_reservation pass', 'Run qualifying pass']

patched = []
for n in wf['nodes']:
    if n.get('name') not in TARGET_AGENTS: continue
    sm = n['parameters']['options']['systemMessage']
    if 'wa_id_runtime' in sm:
        patched.append(f'{n["name"]}: already')
        continue
    n['parameters']['options']['systemMessage'] = HEADER + sm
    patched.append(f'{n["name"]}: prepended')

print('\n'.join(patched))

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
