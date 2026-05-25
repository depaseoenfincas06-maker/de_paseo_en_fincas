#!/usr/bin/env python3
"""
Patch v3 de Agregar follow on:
- Remover el guard "count >= 1 then null" (cada turno del bot inicia un nuevo
  ciclo de follow-ups; si el cliente respondió, el ciclo viejo terminó).
- Resetear followup_count=0 y funnel_status='active' EN EL MISMO UPDATE de
  conversations. Esto asegura que tras cada turno del bot, el conteo arranca
  de cero y la convo vuelve a 'active' si estaba en 'lost'.
- Mantener resto de la lógica (ventana 08-22, cancel previo, etc.).
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
    c.waiting_for,
    s.window_start,
    s.window_end,
    case
      when c.agente_activo = false or c.followup_enabled = false or s.followup_enabled = false then null
      when c.waiting_for not in ('CLIENT', 'CLIENT_APPROVAL') then null
      when c.last_message_from <> 'AGENT' then null
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
    followup_count = 0,
    funnel_status = 'active',
    updated_at = now()
  from normalized n
  where c.wa_id = n.conversation_id
  returning
    c.wa_id,
    c.next_followup_at,
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
    1,
    jsonb_build_object(
      'source', 'main_workflow',
      'source_state', uc.current_state,
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
  (select status from inserted order by id desc limit 1) as status;"""

for n in wf['nodes']:
    if n['name'] != 'Agregar follow on': continue
    n['parameters']['query'] = NEW_QUERY
    print('✓ Agregar follow on v3:')
    print('  - Sin guard de count>=1 (siempre programa FU #1 cuando el bot responde)')
    print('  - UPDATE resetea followup_count=0 y funnel_status=active')
    print('  - attempt_number=1 hardcoded en INSERT (es siempre FU #1 desde acá)')
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
