#!/usr/bin/env python3
"""El stringValue del schema field 'wa_id' del inventory_reader_tool con
$('Merge Sets1') no se resuelve en el sub-exec (devuelve '').

Fix: cambiar el WHERE del Fetch fresh search_criteria para tener fallback:
1) primero intenta wa_id desde el input (When inventory tool is called)
2) si vacío, intenta desde $('Merge Sets1').first().json.conversation_key
3) si vacío, queda vacío y la query devuelve fila vacía (comportamiento previo).

Como `Fetch fresh search_criteria` corre en el sub-exec del MISMO workflow id,
debería tener acceso a $('Merge Sets1') que corrió en el parent.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD_WHERE = "  on c.wa_id = {{ \"'\" + String($('When inventory tool is called').first().json.wa_id || '').replace(/'/g, \"''\") + \"'\" }}"

NEW_WHERE = """  on c.wa_id = {{ "'" + (function(){
  var fromInput = String($('When inventory tool is called').first().json.wa_id || '').trim();
  if (fromInput) return fromInput.replace(/'/g, "''");
  try {
    var fromMerge = String($('Merge Sets1').first().json.conversation_key || '').trim();
    if (fromMerge) return fromMerge.replace(/'/g, "''");
  } catch (e) {}
  return '';
})() + "'" }}"""

# Also update Persist last_inventory_items WHERE clause same way
OLD_PERSIST_WHERE = "where c.wa_id = {{ \"'\" + String($('Fetch fresh search_criteria').first().json.wa_id || $('When inventory tool is called').first().json.wa_id || '').replace(/'/g, \"''\") + \"'\" }};"

NEW_PERSIST_WHERE = """where c.wa_id = {{ "'" + (function(){
  var fromFetch = String($('Fetch fresh search_criteria').first().json.wa_id || '').trim();
  if (fromFetch) return fromFetch.replace(/'/g, "''");
  var fromInput = String($('When inventory tool is called').first().json.wa_id || '').trim();
  if (fromInput) return fromInput.replace(/'/g, "''");
  try {
    var fromMerge = String($('Merge Sets1').first().json.conversation_key || '').trim();
    if (fromMerge) return fromMerge.replace(/'/g, "''");
  } catch (e) {}
  return '';
})() + "'" }};"""

patched = []
for n in wf['nodes']:
    if n.get('name') == 'Fetch fresh search_criteria':
        q = n['parameters']['query']
        if 'fromMerge' in q:
            patched.append('Fetch fresh: already')
            continue
        if OLD_WHERE not in q:
            print('!! Fetch fresh anchor not found')
            print('---actual---')
            print(q[-500:])
            sys.exit(2)
        n['parameters']['query'] = q.replace(OLD_WHERE, NEW_WHERE, 1)
        patched.append('Fetch fresh: WHERE patched')
    elif n.get('name') == 'Persist last_inventory_items':
        q = n['parameters']['query']
        if 'fromFetch' in q:
            patched.append('Persist: already')
            continue
        if OLD_PERSIST_WHERE not in q:
            print('!! Persist anchor not found')
            print('---actual end---')
            print(q[-500:])
            sys.exit(3)
        n['parameters']['query'] = q.replace(OLD_PERSIST_WHERE, NEW_PERSIST_WHERE, 1)
        patched.append('Persist: WHERE patched')

print('\n'.join(patched) or 'nothing matched')

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
