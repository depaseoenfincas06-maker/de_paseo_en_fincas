import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';

dotenv.config({ path: path.resolve('.env') });

const MAIN_WORKFLOW_ID = process.argv[2] || process.env.SIMULATOR_WORKFLOW_ID || 'RrIniaNJCUC72nfI';
const SCHEDULER_WORKFLOW_ID = process.argv[3] || 'yXF0Egl61b548yzv';
const N8N_BASE_URL = process.env.N8N_BASE_URL;
const N8N_API_KEY = process.env.N8N_PUBLIC_API_TOKEN;

if (!N8N_BASE_URL || !N8N_API_KEY) {
  throw new Error('Missing N8N_BASE_URL or N8N_PUBLIC_API_TOKEN');
}

async function api(pathname, options = {}) {
  const response = await fetch(`${N8N_BASE_URL}${pathname}`, {
    ...options,
    headers: {
      'X-N8N-API-KEY': N8N_API_KEY,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} ${pathname}`);
    error.payload = payload;
    throw error;
  }

  return payload;
}

function sanitizeWorkflowSettings(settings) {
  return Object.fromEntries(Object.entries(settings || {}).filter(([, value]) => value !== undefined));
}

function sanitizeWorkflowForUpdate(workflow) {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: sanitizeWorkflowSettings({
      executionOrder: workflow.settings?.executionOrder || 'v1',
      timezone: workflow.settings?.timezone || 'America/Bogota',
      callerPolicy: workflow.settings?.callerPolicy,
      availableInMCP: workflow.settings?.availableInMCP,
    }),
  };
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Missing node ${name}`);
  return node;
}

const normalizedScheduleQuery = `with convo as (
  select *
  from public.conversations
  where wa_id = {{ "'" + String($('Merge Sets1').item.json.conversation_key).replace(/'/g, "''") + "'" }}
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
    c.followup_count,
    c.followup_enabled,
    c.waiting_for,
    c.agente_activo,
    case
      when c.agente_activo = false or c.followup_enabled = false then null
      when c.waiting_for = 'CLIENT' and c.last_message_from = 'AGENT' then
        case
          when coalesce(c.followup_count, 0) <= 0 then now() + interval '2 hours'
          when coalesce(c.followup_count, 0) = 1 then now() + interval '24 hours'
          else now() + interval '72 hours'
        end
      else null
    end as raw_scheduled_for,
    case
      when c.current_state = 'QUALIFYING' then
        'Hola, sigo atento para ayudarte con la búsqueda de tu finca. Si quieres, compárteme fechas, número de personas y zona y retomamos.'
      when c.current_state = 'OFFERING' then
        'Hola, sigo atento. Si quieres, te comparto más opciones o ajustamos la búsqueda por zona, capacidad o presupuesto.'
      when c.current_state = 'VERIFYING_AVAILABILITY' then
        'Hola, sigo atento con tu solicitud. Si quieres, también puedo ayudarte a revisar otra opción similar.'
      else
        'Hola, sigo atento para ayudarte con tu solicitud.'
    end as follow_on_message
  from convo c
),
normalized as (
  select
    p.*,
    case
      when p.raw_scheduled_for is null then null
      when ((p.raw_scheduled_for AT TIME ZONE 'America/Bogota')::time < time '08:00') then
        (date_trunc('day', p.raw_scheduled_for AT TIME ZONE 'America/Bogota') + interval '8 hours') AT TIME ZONE 'America/Bogota'
      when ((p.raw_scheduled_for AT TIME ZONE 'America/Bogota')::time >= time '22:00') then
        (date_trunc('day', p.raw_scheduled_for AT TIME ZONE 'America/Bogota') + interval '1 day' + interval '8 hours') AT TIME ZONE 'America/Bogota'
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
  returning c.wa_id, c.next_followup_at, c.followup_count, c.waiting_for, n.current_state, n.follow_on_message
),
inserted as (
  insert into public.follow_on (
    conversation_id,
    message,
    scheduled_for,
    status,
    metadata
  )
  select
    uc.wa_id,
    uc.follow_on_message,
    uc.next_followup_at,
    'pendiente',
    jsonb_build_object(
      'source', 'main_workflow',
      'source_state', uc.current_state,
      'followup_count_at_schedule', coalesce(uc.followup_count, 0),
      'allowed_window', jsonb_build_object('start', '08:00', 'end', '22:00', 'timezone', 'America/Bogota')
    )
  from updated_conversation uc
  where uc.next_followup_at is not null
  returning id, conversation_id, scheduled_for, status
)
select
  (select count(*) from cancel_existing) as cancelled_previous,
  (select count(*) from inserted) as inserted_count,
  (select scheduled_for from inserted order by id desc limit 1) as scheduled_for,
  (select status from inserted order by id desc limit 1) as status;`;

const schedulerCancelQuery = `update public.follow_on f
set
  status = 'cancelada',
  cancelled_at = now(),
  cancel_reason = 'conversation_not_eligible',
  updated_at = now()
from public.conversations c
where f.conversation_id = c.wa_id
  and f.status = 'pendiente'
  and f.scheduled_for <= now()
  and (
    c.agente_activo = false
    or coalesce(c.waiting_for, 'CLIENT') <> 'CLIENT'
    or c.chatwoot_id is null
  )
returning f.id;`;

const schedulerSelectQuery = `select
  f.id,
  f.conversation_id,
  f.message,
  f.scheduled_for,
  c.chatwoot_id,
  c.current_state
from public.follow_on f
join public.conversations c on c.wa_id = f.conversation_id
where f.status = 'pendiente'
  and f.scheduled_for <= now()
  and c.agente_activo = true
  and coalesce(c.waiting_for, 'CLIENT') = 'CLIENT'
  and c.chatwoot_id is not null
  and ((now() AT TIME ZONE 'America/Bogota')::time >= time '08:00')
  and ((now() AT TIME ZONE 'America/Bogota')::time < time '22:00')
order by f.scheduled_for asc;`;

async function patchWorkflow(workflowId, patchFn) {
  const workflow = await api(`/api/v1/workflows/${workflowId}`);
  patchFn(workflow);
  const isActive = Boolean(workflow.active);

  if (isActive) {
    await api(`/api/v1/workflows/${workflowId}/deactivate`, { method: 'POST' });
  }

  await api(`/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    body: JSON.stringify(sanitizeWorkflowForUpdate(workflow)),
  });

  if (isActive) {
    await api(`/api/v1/workflows/${workflowId}/activate`, { method: 'POST' });
  }

  return api(`/api/v1/workflows/${workflowId}`);
}

const updatedMain = await patchWorkflow(MAIN_WORKFLOW_ID, (workflow) => {
  findNode(workflow, 'Agregar follow on').parameters.query = normalizedScheduleQuery;
});

const updatedScheduler = await patchWorkflow(SCHEDULER_WORKFLOW_ID, (workflow) => {
  findNode(workflow, 'Cancel ineligible follow on').parameters.query = schedulerCancelQuery;
  findNode(workflow, 'Select due follow on').parameters.query = schedulerSelectQuery;
});

await fs.writeFile(path.resolve('current_workflow.json'), JSON.stringify(updatedMain, null, 2));
await fs.writeFile(path.resolve('follow_on_scheduler_workflow.json'), JSON.stringify(updatedScheduler, null, 2));

console.log(
  JSON.stringify(
    {
      mainWorkflowId: updatedMain.id,
      schedulerWorkflowId: updatedScheduler.id,
      mainVersionId: updatedMain.versionId,
      schedulerVersionId: updatedScheduler.versionId,
      schedulerActive: updatedScheduler.active,
    },
    null,
    2,
  ),
);
