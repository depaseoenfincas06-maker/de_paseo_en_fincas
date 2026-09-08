#!/usr/bin/env python3
"""Fase 3 (informe cliente, 8-sep-2026) — Follow-up Sender xxK2FfX6QMPxKaZw.

Causa raíz de los "Hola! ¿Qué te parecieron las opciones?" cada 30 min que vio el cliente:
`agent_settings.followup_first_offset_minutes = 2` (desde el 26-may; latente mientras el cron
estuvo muerto jul-ago). Ese UPDATE (2 → 180) lo hace JD con su OK. Este patch agrega las
GUARDAS que faltaban para que, sea cual sea el offset, un follow-up NUNCA salga:
  * si el cliente escribió hace menos de 10 minutos,
  * si el bot envió algo hace menos de 30 minutos,
  * si la conversación está en HITL (esperando a un humano).
Y arregla el nombre: "Hola 573117360736, ¿pudiste…" (client_name con el número o el dominio)
→ saludo sin nombre.
Idempotente.
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from n8n_patch_lib import get_workflow, put_workflow, backup, node, replace_once  # noqa: E402

FU = 'xxK2FfX6QMPxKaZw'
applied = []
wf = get_workflow(FU)
backup(FU)

sel = node(wf, 'Select due follow-ups')
q = sel['parameters']['query']
LAT_OLD = ") li on true\ncross join lateral ("
LAT_NEW = """) li on true
left join lateral (
  select max(m.created_at) as last_outbound_at
  from public.messages m
  where m.conversation_id = fo.conversation_id
    and m.direction = 'OUTBOUND'
) lo on true
cross join lateral ("""
COND_OLD = "  and c.last_message_from = 'AGENT'\n"
COND_NEW = """  and c.last_message_from = 'AGENT'
  -- P3.1 (8-sep-2026): guardas anti-spam. Nunca un follow-up si el cliente escribió hace
  -- < 10 min, si el bot envió algo hace < 30 min, o si la conversación espera a un humano.
  and coalesce(li.last_inbound_at, fo.created_at) < now() - interval '10 minutes'
  and coalesce(lo.last_outbound_at, fo.created_at) < now() - interval '30 minutes'
  and coalesce(c.current_state, '') <> 'HITL'
"""
if 'P3.1 (8-sep-2026): guardas anti-spam' in q:
    applied.append('P3.1 select: already')
else:
    q = replace_once(q, LAT_OLD, LAT_NEW, 'P3.1 lateral outbound')
    q = replace_once(q, COND_OLD, COND_NEW, 'P3.1 conditions')
    sel['parameters']['query'] = q
    applied.append('P3.1 Select due follow-ups: guardas 10 min inbound / 30 min outbound / no HITL')

tpl = node(wf, 'Send template message')
c = tpl['parameters']['jsCode']
NAME_OLD = "const clientName = String(row.client_name || 'hola').trim() || 'hola';"
NAME_NEW = """// P3.1 (8-sep-2026): client_name puede venir con el número o un dominio → saludo sin nombre.
const _rawName = String(row.client_name || '').trim();
const _badName = !_rawName || /^\\+?\\d{7,}$/.test(_rawName) || /\\.(com|co|net|org)\\b/i.test(_rawName) || /^depaseo/i.test(_rawName);
const clientName = _badName ? 'de nuevo' : _rawName;"""
if 'P3.1 (8-sep-2026): client_name puede venir' in c:
    applied.append('P3.1 template name: already')
else:
    tpl['parameters']['jsCode'] = replace_once(c, NAME_OLD, NAME_NEW, 'P3.1 template name')
    applied.append('P3.1 Send template message: nombre saneado')

ag = node(wf, 'Follow-up Agent')
t = ag['parameters'].get('text', '')
AG_OLD = "=Cliente: {{ $json.client_name || 'cliente' }}"
AG_NEW = "=Cliente: {{ (function(){ var n = String($json.client_name || '').trim(); if (!n || /^\\+?\\d{7,}$/.test(n) || /\\.(com|co|net|org)\\b/i.test(n) || /^depaseo/i.test(n)) return 'cliente (no uses nombre)'; return n; })() }}"
if 'no uses nombre' in t:
    applied.append('P3.1 agent name: already')
else:
    ag['parameters']['text'] = replace_once(t, AG_OLD, AG_NEW, 'P3.1 agent name')
    applied.append('P3.1 Follow-up Agent: nombre saneado')

print('FU active:', put_workflow(FU, wf))
print('\n'.join(applied))
