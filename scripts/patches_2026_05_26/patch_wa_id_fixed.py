#!/usr/bin/env python3
"""Fix wa_id missing en sub-exec de inventory_reader_tool.

Síntoma: a veces el LLM no incluye wa_id al llamar al tool → en el sub-exec
`Fetch fresh search_criteria` no encuentra la conversación → wa_id queda
vacío → `Persist last_inventory_items` ejecuta con `where c.wa_id = ''` →
0 filas afectadas pero reporta success → el cache no se actualiza.

Fix: agregar wa_id al schema del inventory_reader_tool con valor PARENT-evaluated
(no $fromAI). Así n8n evalúa la expresión en el contexto del parent (donde
Merge Sets1 sí existe) antes de enviar al sub-exec, garantizando que SIEMPRE
llegue el wa_id correcto.
"""
import json, subprocess, sys, uuid

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

WA_ID_FIELD = {
    "id": "wa-id-fixed-" + str(uuid.uuid4())[:8],
    "displayName": "wa_id",
    "required": True,
    "defaultMatch": False,
    "display": True,
    "canBeUsedToMatch": True,
    "type": "string",
    "removed": False,
    "stringValue": "={{ String($('Merge Sets1').first().json.conversation_key || '') }}"
}

found = False
for n in wf['nodes']:
    if n.get('name') != 'inventory_reader_tool': continue
    wi = n['parameters'].get('workflowInputs', {})
    schema = wi.get('schema', [])
    existing = [s for s in schema if s.get('displayName') == 'wa_id']
    if existing:
        # ya existe — ver si tiene stringValue parent-evaluated
        e = existing[0]
        if 'Merge Sets1' in e.get('stringValue',''):
            print('!! wa_id already wired to Merge Sets1'); sys.exit(0)
        else:
            print(f'!! wa_id field exists with stringValue={e.get("stringValue")} — replacing')
            e['stringValue'] = WA_ID_FIELD['stringValue']
            e['required'] = True
    else:
        schema.insert(0, WA_ID_FIELD)
        print('✓ added wa_id field (parent-evaluated from Merge Sets1)')
    wi['schema'] = schema
    n['parameters']['workflowInputs'] = wi
    found = True
    break

if not found:
    print('!! inventory_reader_tool not found'); sys.exit(2)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
