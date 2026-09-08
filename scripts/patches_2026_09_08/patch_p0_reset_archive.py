#!/usr/bin/env python3
"""P0 (8-sep-2026): RESET archiva antes de borrar.

Inserta el nodo Postgres "Archive RESET conversation" entre `Is RESET command?`[true]
y `Delete RESET messages`. Copia conversación + mensajes + follow_on a
public.conversations_archive (migración 20260908180000_reset_archive.sql).
Requiere que la migración esté aplicada. Idempotente.
"""
import json, os, subprocess, sys, uuid

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from n8n_patch_lib import get_workflow, put_workflow, backup  # noqa: E402

CA = '2NV08zRFKENUsQVC'
NODE_NAME = 'Archive RESET conversation'
QUERY = """with params as (
  select nullif({{ "'" + String($('Normalize inbound payload').first().json.wa_id || '').replace(/'/g, "''") + "'" }}, '')::text as wa_id
),
archived as (
  insert into public.conversations_archive (wa_id, reason, conversation, messages, follow_on)
  select
    c.wa_id,
    'reset',
    to_jsonb(c),
    coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from public.messages m where m.conversation_id = c.wa_id), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at) from public.follow_on f where f.conversation_id = c.wa_id), '[]'::jsonb)
  from public.conversations c
  join params p on p.wa_id is not null and c.wa_id = p.wa_id
  returning id
)
select
  (select wa_id from params) as wa_id,
  (select count(*)::integer from archived) as archived_count;"""

def main():
    wf = get_workflow(CA); backup(CA)
    names = {n['name']: n for n in wf['nodes']}
    if NODE_NAME in names:
        print('ya aplicado'); return
    delete_msgs = names['Delete RESET messages']
    node = {
        'parameters': {'operation': 'executeQuery', 'query': QUERY, 'options': {}},
        'id': str(uuid.uuid4()), 'name': NODE_NAME,
        'type': 'n8n-nodes-base.postgres', 'typeVersion': delete_msgs['typeVersion'],
        'position': [delete_msgs['position'][0] - 260, delete_msgs['position'][1] - 160],
        'credentials': delete_msgs['credentials'],
        'onError': 'continueRegularOutput',  # archivar jamás bloquea el reset
    }
    wf['nodes'].append(node)
    conns = wf['connections']
    outs = conns['Is RESET command?']['main']
    assert outs[0] and outs[0][0]['node'] == 'Delete RESET messages', outs[0]
    outs[0][0]['node'] = NODE_NAME
    conns[NODE_NAME] = {'main': [[{'node': 'Delete RESET messages', 'type': 'main', 'index': 0}]]}
    print('CA active:', put_workflow(CA, wf))
    print('ok: Is RESET command? → Archive RESET conversation → Delete RESET messages')

if __name__ == '__main__':
    main()
