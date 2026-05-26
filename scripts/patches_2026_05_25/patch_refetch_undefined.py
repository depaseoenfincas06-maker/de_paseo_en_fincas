#!/usr/bin/env python3
"""
Bug encontrado en exec 8736 (post-CHANGE_FINCA loop re-execution):
  error.message: 'column "undefined" does not exist'
  Failing SQL last line: `on c.wa_id = undefined;`

Causa: el template `{{ "'" + String($('Merge Sets1').item.json.conversation_key || '').replace(/'/g, "''") + "'" }}`
asume que $('Merge Sets1').item está disponible. En el LOOP re-exec
después de Wrap offering result (path post-CHANGE_FINCA), n8n no expone
.item del Merge Sets1 del run anterior → la expresión tira TypeError → el
template engine renderea la palabra literal `undefined` sin las comillas
→ PG la lee como column reference → falla con SQLSTATE 42703.

Fix: envolver la lookup en try-catch + fallback a $('Normalize inbound
payload').item.json.wa_id (que SIEMPRE corre primero en el workflow y
está accesible desde cualquier nodo posterior, incluyendo loops). Si por
algún motivo ni eso está, devolver string vacío explícito '' para que
quede `c.wa_id = ''` (NO match, LEFT JOIN returns null inventory — el
flow sigue sin crashear).
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """on c.wa_id = {{ "'" + String($('Merge Sets1').item.json.conversation_key || '').replace(/'/g, "''") + "'" }};"""

NEW = """on c.wa_id = {{ (function(){
  // Defensive resolution: $('Merge Sets1').item puede ser undefined en
  // re-execs del loop (post-CHANGE_FINCA / post-tool-call). Fallback a
  // Normalize inbound payload (siempre corre primero, siempre accesible).
  function _try(fn){ try { var v = fn(); return v != null && String(v).trim() !== '' ? String(v) : null; } catch (e) { return null; } }
  var k = _try(function(){ return $('Merge Sets1').item.json.conversation_key; })
       || _try(function(){ return $('Normalize inbound payload').item.json.wa_id; })
       || '';
  return "'" + String(k).replace(/'/g, "''") + "'";
})() }};"""

found = False
for n in wf['nodes']:
    if n['name'] != 'Refetch last_inventory_items': continue
    q = n['parameters'].get('query', '')
    if OLD not in q:
        print('!! Refetch anchor not found'); sys.exit(2)
    n['parameters']['query'] = q.replace(OLD, NEW, 1)
    print('✓ Refetch last_inventory_items: defensive wa_id resolution added')
    found = True
    break

if not found:
    print('!! Refetch node not found'); sys.exit(2)

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
