#!/usr/bin/env python3
"""Fix de persistencia (May 26 2026): last_inventory_items se sobreescribía
en cada llamada a BIT. Cuando el cliente seleccionaba una finca y BIT volvía
a correr con otra query, el cache perdía la finca elegida → rehydration fallaba
→ PDF con $0 en depósito/limpieza.

Fix: query del nodo "Persist last_inventory_items" ahora hace MERGE por
finca_id en vez de overwrite. Items nuevos pisan los viejos del mismo id;
items viejos que no están en la corrida nueva se conservan. Cap a 60 items
para evitar crecimiento infinito.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD_QUERY = """update public.conversations
set last_inventory_items = {{ "'" + JSON.stringify({items: $json.items || [], similar_items: $json.similar_items || [], selected_finca: $json.selected_finca || null}).replace(/'/g, "''") + "'" }}::jsonb,
    last_inventory_at = now()
where wa_id = {{ "'" + String($('Fetch fresh search_criteria').first().json.wa_id || $('When inventory tool is called').first().json.wa_id || '').replace(/'/g, "''") + "'" }};"""

# Query nueva: MERGE por finca_id.
# - 'items': nuevos primero, viejos no presentes después, cap a 60.
# - 'similar_items': overwrite (es señal contextual del turno, no histórica).
# - 'selected_finca': overwrite si viene en NEW, sino conserva el viejo.
NEW_QUERY = """update public.conversations c
set
  last_inventory_items = jsonb_build_object(
    'items', (
      select coalesce(jsonb_agg(it order by ord, idx), '[]'::jsonb)
      from (
        select it, ord, idx from (
          select new_it as it, 0 as ord, row_number() over () as idx
          from jsonb_array_elements(coalesce({{ "'" + JSON.stringify({items: $json.items || [], similar_items: $json.similar_items || [], selected_finca: $json.selected_finca || null}).replace(/'/g, "''") + "'" }}::jsonb -> 'items', '[]'::jsonb)) as new_it
          union all
          select old_it as it, 1 as ord, row_number() over () + 10000 as idx
          from jsonb_array_elements(coalesce(c.last_inventory_items -> 'items', '[]'::jsonb)) as old_it
          where old_it ->> 'finca_id' is not null
            and not exists (
              select 1
              from jsonb_array_elements(coalesce({{ "'" + JSON.stringify({items: $json.items || [], similar_items: $json.similar_items || [], selected_finca: $json.selected_finca || null}).replace(/'/g, "''") + "'" }}::jsonb -> 'items', '[]'::jsonb)) as ni
              where ni ->> 'finca_id' = old_it ->> 'finca_id'
            )
        ) ranked
        limit 60
      ) capped
    ),
    'similar_items', coalesce({{ "'" + JSON.stringify({items: $json.items || [], similar_items: $json.similar_items || [], selected_finca: $json.selected_finca || null}).replace(/'/g, "''") + "'" }}::jsonb -> 'similar_items', '[]'::jsonb),
    'selected_finca', coalesce(
      {{ "'" + JSON.stringify({items: $json.items || [], similar_items: $json.similar_items || [], selected_finca: $json.selected_finca || null}).replace(/'/g, "''") + "'" }}::jsonb -> 'selected_finca',
      c.last_inventory_items -> 'selected_finca'
    )
  ),
  last_inventory_at = now()
where c.wa_id = {{ "'" + String($('Fetch fresh search_criteria').first().json.wa_id || $('When inventory tool is called').first().json.wa_id || '').replace(/'/g, "''") + "'" }};"""

found = False
for n in wf['nodes']:
    if n['name'] != 'Persist last_inventory_items': continue
    q = n['parameters'].get('query','')
    if 'jsonb_build_object' in q and 'merged' in q.lower() or 'cap a 60' in q.lower() or 'capped' in q:
        # rough heuristic: already merged?
        if 'capped' in q:
            print('!! already deployed (capped found)'); sys.exit(0)
    if q.strip() != OLD_QUERY.strip():
        print('!! current query does not match expected OLD_QUERY')
        print('--- actual ---')
        print(q)
        sys.exit(2)
    n['parameters']['query'] = NEW_QUERY
    print('✓ Persist last_inventory_items: query reemplazada por MERGE por finca_id (cap 60)')
    found = True
    break

if not found:
    print('!! node Persist last_inventory_items not found'); sys.exit(3)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
