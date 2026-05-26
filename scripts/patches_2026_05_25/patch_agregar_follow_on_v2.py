#!/usr/bin/env python3
"""
Patch Agregar follow on (customer agent 2NV08zRFKENUsQVC).

Cambios:
1) settings CTE: lee también followup_first_offset_minutes (default 180).
2) plan CTE: solo programa FU #1 (cuando followup_count=0). Para count>=1
   devuelve NULL (el cron del Follow-up Sender se encarga del FU #2 y #3).
3) raw_scheduled_for: now() + (offset_minutes || ' minutes')::interval.
4) inserted CTE: agrega attempt_number=count+1; message=NULL (el cron decide
   al disparar, vía LLM o template según ventana 24h).
5) Elimina precomputación de templates por estado (el cron tiene su propia
   lógica de generación).
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

NEW_QUERY = """with convo as (
  select *
  from public.conversations
  where wa_id = {{ "'" + String($('Merge Sets1').item.json.conversation_key).replace(/'/g, "''") + "'" }}
),
settings as (
  with defaults as (
    select
      true::boolean as followup_enabled,
      time '08:00' as window_start,
      time '22:00' as window_end,
      180 as first_offset_minutes
  )
  select
    coalesce(s.followup_enabled, d.followup_enabled) as followup_enabled,
    coaleske_replaced_below
    coalesce(s.followup_window_start, d.window_start) as window_start,
    coalesce(s.followup_window_end, d.window_end) as window_end,
    coalesce(s.followup_first_offset_minutes, d.first_offset_minutes) as first_offset_minutes
  from defaults d
  left join public.agent_settings s on s.id = 1
),
cancel_existing as (
  update public.follow_on
  set
    status = 'cancelada',
    cancelled_at = now(),
    cancel_reason = 'rescheduled',
    updated_at = now()
  where conversation_id = {{ "'" + String($('Merge Sets1').item.json.conversation_key).replace(/'/g, "''") + "'" }}
    and status = 'pendiente'
  returning id
),
plan as (
  select
    c.wa_id as conversation_id,
    c.current_state,
    coalesce(c.followup_count, 0) as followup_count,
    c.followup_enabled,
    c.waiting_for,
    c.agente_activo,
    s.window_start,
    s.window_end,
    case
      when c.agente_activo = false or c.followup_enabled = false or s.followup_enabled = false then null
      when c.waiting_for not in ('CLIENT', 'CLIENT_APPROVAL') then null
      when c.last_message_from <> 'AGENT' then null
      when coalesce(c.followup_count, 0) >= 1 then null
      else now() + (s.first_offset_minutes || ' minutes')::interval
    end as raw_scheduled_for
  from convo c
  cross join settings s
),
normalized as (
  select
    p.*,
    case
      when p.raw_scheduled_for is null then null
      when ((p.raw_scheduled_for AT TIME ZONE 'America/Bogota')::time < p.window_start) then
        (date_trunc('day', p.raw_scheduled_for AT TIME ZONE 'America/Bogota') + (p.window_start - time '00:00')) AT TIME ZONE 'America/Bogota'
      when ((p.raw_scheduled_for AT TIME ZONE 'America/Bogota')::time >= p.window_end) then
        (date_trunc('day', p.raw_scheduled_for AT TIME ZONE 'America/Bogota') + interval '1 day' + (p.window_start - time '00:00')) AT TIME ZONE 'America/Bogota'
      else p.raw_scheduled_for
    end as scheduled_for
  from plan p
),
updated_conversation as (
  update public.conversations c
  set
    next_followup_at = n.scheduled_for,
    updated_at = now()
  from normalized n
  where c.wa_id = n.conversation_id
  returning
    c.wa_id,
    c.next_followup_at,
    c.followup_count,
    c.waiting_for,
    n.current_state,
    n.window_start,
    n.window_end
),
inserted as (
  insert into public.follow_on (
    conversation_id,
    message,
    scheduled_for,
    status,
    attempt_number,
    metadata
  )
  select
    uc.wa_id,
    NULL,
    uc.next_followup_at,
    'pendiente',
    coalesce(uc.followup_count, 0) + 1,
    jsonb_build_object(
      'source', 'main_workflow',
      'source_state', uc.current_state,
      'followup_count_at_schedule', coalesce(uc.followup_count, 0),
      'allowed_window', jsonb_build_object(
        'start', to_char(uc.window_start, 'HH24:MI'),
        'end', to_char(uc.window_end, 'HH24:MI'),
        'timezone', 'America/Bogota'
      )
    )
  from updated_conversation uc
  where uc.next_followup_at is not null
  returning id, conversation_id, scheduled_for, status, attempt_number
)
select
  (select count(*) from cancel_existing) as cancelled_previous,
  (select count(*) from inserted) as inserted_count,
  (select scheduled_for from inserted order by id desc limit 1) as scheduled_for,
  (select attempt_number from inserted order by id desc limit 1) as attempt_number,
  (select status from inserted order by id desc limit 1) as status;""".replace("coaleske_replaced_below\n    ", "")

for n in wf['nodes']:
    if n['name'] != 'Agregar follow on': continue
    n['parameters']['query'] = NEW_QUERY
    print('✓ Agregar follow on: SQL reescrito')
    print('  Templates por estado removidas del SELECT (el cron decide).')
    print('  Solo programa FU #1 cuando followup_count=0.')
    print('  Lee followup_first_offset_minutes de agent_settings (1 en pruebas, 180 en prod).')
    print('  message=NULL, attempt_number=count+1.')
    break

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
