import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';

dotenv.config({ path: path.resolve('.env') });

const MAIN_WORKFLOW_ID = process.argv[2] || process.env.SIMULATOR_WORKFLOW_ID || 'RrIniaNJCUC72nfI';
const SCHEDULER_WORKFLOW_ID = process.argv[3] || 'yXF0Egl61b548yzv';
const N8N_BASE_URL = process.env.N8N_BASE_URL;
const N8N_API_KEY = process.env.N8N_PUBLIC_API_TOKEN;
const INVENTORY_DOCUMENT_ID = process.env.INVENTORY_SHEET_DOCUMENT_ID || '1AHeDsZin_U5ZzfAB50i7JZvOoJcP9uAM71RRZgnDlgo';
const INVENTORY_TAB_NAME = process.env.INVENTORY_SHEET_TAB_NAME || 'fincas_inventory_ajustada_real';

if (!N8N_BASE_URL || !N8N_API_KEY) {
  throw new Error('Missing N8N_BASE_URL or N8N_PUBLIC_API_TOKEN in .env');
}

const DEFAULT_SETTINGS = {
  tonePreset: 'calido_profesional',
  toneGuidelinesExtra: '',
  initialMessageTemplate:
    'Excelente día!🤩🌅\nMi nombre es Santiago Gallego\nDepaseoenfincas.com, estaré frente a tu reserva!⚡\nPor favor indícame:\n*Fechas exactas?\n*Número de huéspedes?\n*Localización?\n*Tarifa aproximada por noche\n\n🌎 En el momento disponemos de propiedades en Anapoima, Villeta, La Vega, Girardot, Eje cafetero, Carmen de Apicalá, Antioquia y Villavicencio.',
  handoffMessage: 'Te voy a pasar con un asesor humano para continuar con tu solicitud.',
  followupWindowStart: '08:00',
  followupWindowEnd: '22:00',
  followupMessageQualifying:
    'Hola, sigo atento para ayudarte con la búsqueda de tu finca. Si quieres, compárteme fechas, número de personas y zona y retomamos.',
  followupMessageOffering:
    'Hola, sigo atento. Si quieres, te comparto más opciones o ajustamos la búsqueda por zona, capacidad o presupuesto.',
  followupMessageVerifyingAvailability:
    'Hola, sigo atento con tu solicitud. Si quieres, también puedo ayudarte a revisar otra opción similar.',
  coverageZonesText:
    'Anapoima, Villeta, La Vega, Girardot, Eje cafetero, Carmen de Apicalá, Antioquia y Villavicencio',
  maxPropertiesToShow: 3,
};

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
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

function sanitizeWorkflowForUpdate(workflow) {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: Object.fromEntries(
      Object.entries({
        executionOrder: workflow.settings?.executionOrder || 'v1',
        timezone: workflow.settings?.timezone || 'America/Bogota',
        callerPolicy: workflow.settings?.callerPolicy,
        availableInMCP: workflow.settings?.availableInMCP,
      }).filter(([, value]) => value !== undefined),
    ),
  };
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Missing node ${name}`);
  return node;
}

function upsertNode(workflow, node) {
  const index = workflow.nodes.findIndex((item) => item.name === node.name);
  if (index === -1) {
    workflow.nodes.push(node);
  } else {
    workflow.nodes[index] = {
      ...workflow.nodes[index],
      ...node,
      credentials: node.credentials || workflow.nodes[index].credentials,
    };
  }
}

function upsertAssignment(node, name, value, type) {
  const assignments = node.parameters.assignments.assignments;
  const existing = assignments.find((item) => item.name === name);
  const next = {
    id: existing?.id || crypto.randomUUID(),
    name,
    value,
    type,
  };

  if (existing) {
    Object.assign(existing, next);
  } else {
    assignments.push(next);
  }
}

function replaceText(text, searchValue, replaceValue) {
  return String(text || '').replace(searchValue, replaceValue);
}

function patchPrompt(prompt, mapper) {
  return mapper(String(prompt || ''));
}

function buildSettingsQuery() {
  return `with defaults as (
  select
    ${sqlLiteral(DEFAULT_SETTINGS.tonePreset)}::text as tone_preset,
    ${sqlLiteral(DEFAULT_SETTINGS.toneGuidelinesExtra)}::text as tone_guidelines_extra,
    ${sqlLiteral(DEFAULT_SETTINGS.initialMessageTemplate)}::text as initial_message_template,
    ${sqlLiteral(DEFAULT_SETTINGS.handoffMessage)}::text as handoff_message,
    null::text as owner_contact_override,
    true::boolean as global_bot_enabled,
    true::boolean as followup_enabled,
    time '${DEFAULT_SETTINGS.followupWindowStart}' as followup_window_start,
    time '${DEFAULT_SETTINGS.followupWindowEnd}' as followup_window_end,
    ${sqlLiteral(DEFAULT_SETTINGS.followupMessageQualifying)}::text as followup_message_qualifying,
    ${sqlLiteral(DEFAULT_SETTINGS.followupMessageOffering)}::text as followup_message_offering,
    ${sqlLiteral(DEFAULT_SETTINGS.followupMessageVerifyingAvailability)}::text as followup_message_verifying_availability,
    true::boolean as inventory_sheet_enabled,
    ${sqlLiteral(INVENTORY_DOCUMENT_ID)}::text as inventory_sheet_document_id,
    ${sqlLiteral(INVENTORY_TAB_NAME)}::text as inventory_sheet_tab_name,
    ${sqlLiteral(DEFAULT_SETTINGS.coverageZonesText)}::text as coverage_zones_text,
    ${DEFAULT_SETTINGS.maxPropertiesToShow}::integer as max_properties_to_show
),
settings as (
  select *
  from public.agent_settings
  where id = 1
  limit 1
)
select
  coalesce(s.tone_preset, d.tone_preset) as tone_preset,
  coalesce(s.tone_guidelines_extra, d.tone_guidelines_extra) as tone_guidelines_extra,
  coalesce(s.initial_message_template, d.initial_message_template) as initial_message_template,
  coalesce(s.handoff_message, d.handoff_message) as handoff_message,
  coalesce(s.owner_contact_override, d.owner_contact_override) as owner_contact_override,
  coalesce(s.global_bot_enabled, d.global_bot_enabled) as global_bot_enabled,
  coalesce(s.followup_enabled, d.followup_enabled) as followup_enabled,
  to_char(coalesce(s.followup_window_start, d.followup_window_start), 'HH24:MI') as followup_window_start,
  to_char(coalesce(s.followup_window_end, d.followup_window_end), 'HH24:MI') as followup_window_end,
  coalesce(s.followup_message_qualifying, d.followup_message_qualifying) as followup_message_qualifying,
  coalesce(s.followup_message_offering, d.followup_message_offering) as followup_message_offering,
  coalesce(
    s.followup_message_verifying_availability,
    d.followup_message_verifying_availability
  ) as followup_message_verifying_availability,
  coalesce(s.inventory_sheet_enabled, d.inventory_sheet_enabled) as inventory_sheet_enabled,
  coalesce(s.inventory_sheet_document_id, d.inventory_sheet_document_id) as inventory_sheet_document_id,
  coalesce(s.inventory_sheet_tab_name, d.inventory_sheet_tab_name) as inventory_sheet_tab_name,
  coalesce(s.coverage_zones_text, d.coverage_zones_text) as coverage_zones_text,
  coalesce(s.max_properties_to_show, d.max_properties_to_show) as max_properties_to_show
from defaults d
left join settings s on true
limit 1;`;
}

function buildSettingsNode(credentials) {
  return {
    id: '3f769a1f-2b5e-49f4-b08e-fb503dc0701b',
    name: 'Get agent settings',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2,
    position: [3680, 800],
    credentials,
    parameters: {
      operation: 'executeQuery',
      query: buildSettingsQuery(),
      options: {},
    },
  };
}

function buildRestoreInboundNode() {
  return {
    id: '5f6e5f5d-63cb-4fd4-864f-78f5ce2f9d9c',
    name: 'Restore inbound payload',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [3920, 800],
    parameters: {
      jsCode: `return [
  {
    json: {
      ...$('Resolve thread policy').item.json,
    },
  },
];`,
    },
  };
}

function buildMainFollowOnQuery() {
  return `with convo as (
  select *
  from public.conversations
  where wa_id = {{ "'" + String($('Merge Sets1').item.json.conversation_key).replace(/'/g, "''") + "'" }}
),
settings as (
  with defaults as (
    select
      true::boolean as followup_enabled,
      time '${DEFAULT_SETTINGS.followupWindowStart}' as window_start,
      time '${DEFAULT_SETTINGS.followupWindowEnd}' as window_end,
      ${sqlLiteral(DEFAULT_SETTINGS.followupMessageQualifying)}::text as msg_qualifying,
      ${sqlLiteral(DEFAULT_SETTINGS.followupMessageOffering)}::text as msg_offering,
      ${sqlLiteral(DEFAULT_SETTINGS.followupMessageVerifyingAvailability)}::text as msg_verifying
  )
  select
    coalesce(s.followup_enabled, d.followup_enabled) as followup_enabled,
    coalesce(s.followup_window_start, d.window_start) as window_start,
    coalesce(s.followup_window_end, d.window_end) as window_end,
    coalesce(s.followup_message_qualifying, d.msg_qualifying) as msg_qualifying,
    coalesce(s.followup_message_offering, d.msg_offering) as msg_offering,
    coalesce(s.followup_message_verifying_availability, d.msg_verifying) as msg_verifying
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
    c.followup_count,
    c.followup_enabled,
    c.waiting_for,
    c.agente_activo,
    s.window_start,
    s.window_end,
    case
      when c.agente_activo = false or c.followup_enabled = false or s.followup_enabled = false then null
      when c.waiting_for = 'CLIENT' and c.last_message_from = 'AGENT' then
        case
          when coalesce(c.followup_count, 0) <= 0 then now() + interval '2 hours'
          when coalesce(c.followup_count, 0) = 1 then now() + interval '24 hours'
          else now() + interval '72 hours'
        end
      else null
    end as raw_scheduled_for,
    case
      when c.current_state = 'QUALIFYING' then s.msg_qualifying
      when c.current_state = 'OFFERING' then s.msg_offering
      when c.current_state = 'VERIFYING_AVAILABILITY' then s.msg_verifying
      else s.msg_qualifying
    end as follow_on_message
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
    n.follow_on_message,
    n.window_start,
    n.window_end
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
      'allowed_window', jsonb_build_object(
        'start', to_char(uc.window_start, 'HH24:MI'),
        'end', to_char(uc.window_end, 'HH24:MI'),
        'timezone', 'America/Bogota'
      )
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
}

function buildSchedulerSelectQuery() {
  return `with settings as (
  with defaults as (
    select
      time '${DEFAULT_SETTINGS.followupWindowStart}' as window_start,
      time '${DEFAULT_SETTINGS.followupWindowEnd}' as window_end
  )
  select
    coalesce(s.followup_window_start, d.window_start) as window_start,
    coalesce(s.followup_window_end, d.window_end) as window_end
  from defaults d
  left join public.agent_settings s on s.id = 1
)
select
  f.id,
  f.conversation_id,
  f.message,
  f.scheduled_for,
  c.chatwoot_id,
  c.current_state
from public.follow_on f
join public.conversations c on c.wa_id = f.conversation_id
cross join settings s
where f.status = 'pendiente'
  and f.scheduled_for <= now()
  and c.agente_activo = true
  and coalesce(c.waiting_for, 'CLIENT') = 'CLIENT'
  and c.chatwoot_id is not null
  and ((now() AT TIME ZONE 'America/Bogota')::time >= s.window_start)
  and ((now() AT TIME ZONE 'America/Bogota')::time < s.window_end)
order by f.scheduled_for asc;`;
}

function patchAllowAutomationNode(node) {
  node.parameters.conditions = {
    options: {
      caseSensitive: true,
      leftValue: '',
      typeValidation: 'loose',
      version: 3,
    },
    conditions: [
      {
        id: crypto.randomUUID(),
        leftValue: "={{ $('Resolve thread policy').item.json.allow_automation === true }}",
        rightValue: '',
        operator: {
          type: 'boolean',
          operation: 'true',
          singleValue: true,
        },
      },
      {
        id: crypto.randomUUID(),
        leftValue: "={{ $('Get agent settings').item.json.global_bot_enabled === true }}",
        rightValue: '',
        operator: {
          type: 'boolean',
          operation: 'true',
          singleValue: true,
        },
      },
    ],
    combinator: 'and',
  };
}

function patchConfigNode(node) {
  upsertAssignment(node, 'insertar_mensjae', true, 'boolean');
  upsertAssignment(
    node,
    'tono',
    `={{ (() => {
  const preset = $('Get agent settings').item.json.tone_preset || '${DEFAULT_SETTINGS.tonePreset}';
  const extra = String($('Get agent settings').item.json.tone_guidelines_extra || '').trim();
  const presets = {
    calido_profesional: '- No inventes información. Solo usa el input.\\n- Mensajes cortos para WhatsApp (máx 500 caracteres).\\n- Tuteo, tono amigable, máximo 2 emojis.\\n- Si el cliente pide hablar con humano o visitar: intent=HITL_REQUEST.\\n- Responde natural, como un humano, sin sonar adulador.\\n- Sé respetuoso, amable y firme.\\n- Si el interés real no es alquilar una finca, redirígelo con claridad.\\n- Usa doble salto de línea entre párrafos.',
    premium_cercano: '- No inventes información. Solo usa el input.\\n- Mensajes cortos para WhatsApp (máx 500 caracteres).\\n- Tono premium, cercano y seguro.\\n- Tuteo, máximo 2 emojis.\\n- Habla con claridad, sin exagerar ni sonar adulador.\\n- Si el cliente pide humano o visita: intent=HITL_REQUEST.\\n- Usa doble salto de línea entre párrafos.',
    directo_eficiente: '- No inventes información. Solo usa el input.\\n- Mensajes breves y concretos para WhatsApp.\\n- Tuteo, máximo 1 emoji.\\n- Prioriza claridad y velocidad.\\n- Si el cliente pide humano o visita: intent=HITL_REQUEST.\\n- Usa doble salto de línea entre párrafos.'
  };
  return [presets[preset] || presets.calido_profesional, extra].filter(Boolean).join('\\n');
})() }}`,
    'string',
  );
  upsertAssignment(node, 'current_message', "={{ String($json.chatInput || $json.current_message || $json.text || '').trim() }}", 'string');
  upsertAssignment(
    node,
    'conversation_key',
    "={{ String($json.wa_id || $json.phone || $json.sessionId || $json.conversationId || $json.metadata?.conversationKey || $json.metadata?.conversation_id || $json.metadata?.wa_id || $json.metadata?.chatId || $execution.id) }}",
    'string',
  );
  upsertAssignment(
    node,
    'client_name',
    "={{ $json.client_name || $json.metadata?.client_name || $json.metadata?.name || $json.metadata?.user?.name || null }}",
    'string',
  );
  upsertAssignment(
    node,
    'chatwoot_id',
    "={{ $json.chatwoot_id || $json.metadata?.chatwoot_id || null }}",
    'string',
  );
  upsertAssignment(node, 'message_type', "={{ $json.message_type || 'TEXT' }}", 'string');
  upsertAssignment(
    node,
    'tone_preset',
    "={{ $('Get agent settings').item.json.tone_preset || 'calido_profesional' }}",
    'string',
  );
  upsertAssignment(
    node,
    'tone_guidelines_extra',
    "={{ $('Get agent settings').item.json.tone_guidelines_extra || '' }}",
    'string',
  );
  upsertAssignment(
    node,
    'initial_message_template',
    "={{ $('Get agent settings').item.json.initial_message_template }}",
    'string',
  );
  upsertAssignment(node, 'handoff_message', "={{ $('Get agent settings').item.json.handoff_message }}", 'string');
  upsertAssignment(
    node,
    'owner_contact_override',
    "={{ $('Get agent settings').item.json.owner_contact_override || '' }}",
    'string',
  );
  upsertAssignment(
    node,
    'global_bot_enabled',
    "={{ $('Get agent settings').item.json.global_bot_enabled === true }}",
    'boolean',
  );
  upsertAssignment(
    node,
    'followup_enabled_global',
    "={{ $('Get agent settings').item.json.followup_enabled === true }}",
    'boolean',
  );
  upsertAssignment(
    node,
    'followup_window_start',
    "={{ $('Get agent settings').item.json.followup_window_start || '08:00' }}",
    'string',
  );
  upsertAssignment(
    node,
    'followup_window_end',
    "={{ $('Get agent settings').item.json.followup_window_end || '22:00' }}",
    'string',
  );
  upsertAssignment(
    node,
    'followup_message_qualifying',
    "={{ $('Get agent settings').item.json.followup_message_qualifying }}",
    'string',
  );
  upsertAssignment(
    node,
    'followup_message_offering',
    "={{ $('Get agent settings').item.json.followup_message_offering }}",
    'string',
  );
  upsertAssignment(
    node,
    'followup_message_verifying_availability',
    "={{ $('Get agent settings').item.json.followup_message_verifying_availability }}",
    'string',
  );
  upsertAssignment(
    node,
    'inventory_sheet_enabled',
    "={{ $('Get agent settings').item.json.inventory_sheet_enabled === true }}",
    'boolean',
  );
  upsertAssignment(
    node,
    'inventory_sheet_document_id',
    "={{ $('Get agent settings').item.json.inventory_sheet_document_id }}",
    'string',
  );
  upsertAssignment(node, 'inventory_sheet_gid', process.env.INVENTORY_SHEET_GID || '1708735749', 'string');
  upsertAssignment(
    node,
    'inventory_sheet_tab_name',
    "={{ $('Get agent settings').item.json.inventory_sheet_tab_name }}",
    'string',
  );
  upsertAssignment(
    node,
    'coverage_zones_text',
    "={{ $('Get agent settings').item.json.coverage_zones_text }}",
    'string',
  );
  upsertAssignment(
    node,
    'max_properties_to_show',
    "={{ Number($('Get agent settings').item.json.max_properties_to_show || 3) }}",
    'number',
  );
}

function patchQualifyingPrompt(prompt) {
  let next = String(prompt || '');

  next = replaceText(
    next,
    '- Si el cliente te pide una zona donde no tenemos corbertura, no preguntes por los datos mínimos',
    '- Si el cliente te pide una zona donde no tenemos cobertura, no preguntes por los datos mínimos.\n- Toma como referencia de cobertura vigente: {{ $(\'config\').item.json.coverage_zones_text }}.',
  );

  next = next.replace(
    /Nota:[\s\S]*$/m,
    `Nota:
- Si el current_message es el único mensaje relevante, usa como base este mensaje inicial configurable del negocio, ajustando solo el saludo según la hora del día:
"{{ $('config').item.json.initial_message_template }}"
- Si necesitas mencionar cobertura, usa esta referencia vigente:
"{{ $('config').item.json.coverage_zones_text }}"`,
  );

  return next;
}

function patchOfferingPrompt(prompt) {
  let next = String(prompt || '');
  next = replaceText(
    next,
    '- Presentar hasta 3 fincas relevantes.',
    '- Presentar hasta {{ $(\'config\').item.json.max_properties_to_show }} fincas relevantes.',
  );
  return next;
}

function patchOrchestratorPrompt(prompt) {
  let next = String(prompt || '');
  next = replaceText(
    next,
    'final_whatsapp_text = "Te voy a pasar con un asesor humano para continuar con tu solicitud."',
    'final_whatsapp_text = "{{ $(\'config\').item.json.handoff_message }}"',
  );
  next = replaceText(
    next,
    'final_whatsapp_text = "Ya confirmé que la finca que elegiste está disponible. Te voy a pasar con un asesor humano para continuar con la reserva y el pago."',
    'final_whatsapp_text = "Ya confirmé que la finca que elegiste está disponible.\\n\\n{{ $(\'config\').item.json.handoff_message }}"',
  );
  next = replaceText(
    next,
    'final_whatsapp_text = "Te voy a pasar con un asesor humano para continuar con tu reserva."',
    'final_whatsapp_text = "{{ $(\'config\').item.json.handoff_message }}"',
  );
  return next;
}

function patchCodeNode(jsCode) {
  return String(jsCode || '').replace(
    "const handoffText = 'Te voy a pasar con un asesor humano para continuar con tu solicitud.';",
    "const handoffText = $('config').item.json.handoff_message || 'Te voy a pasar con un asesor humano para continuar con tu solicitud.';",
  );
}

function patchInventoryResponseCode(jsCode) {
  let next = String(jsCode || '');

  next = replaceText(
    next,
    "const meta = $json.inventory_meta || { access_ok: true, error_message: null, count: inventory.length, total_rows: inventory.length };",
    "const meta = $json.inventory_meta || { access_ok: true, error_message: null, count: inventory.length, total_rows: inventory.length };\nlet settings = {};\ntry {\n  settings = $('Get agent settings').item.json || {};\n} catch {\n  settings = {};\n}\nconst ownerContactOverride = compact(settings.owner_contact_override || settings.ownerContactOverride);",
  );

  next = replaceText(
    next,
    "const limit = Math.max(1, Math.min(5, toNumber(payload.limit, 3) || 3));",
    "const defaultLimit = Math.max(1, Math.min(10, toNumber(settings.max_properties_to_show || settings.maxPropertiesToShow, 3) || 3));\nconst limit = Math.max(1, Math.min(10, toNumber(payload.limit, defaultLimit) || defaultLimit));",
  );

  next = replaceText(next, 'owner_contacto: item.owner_contacto,', 'owner_contacto: ownerContactOverride || item.owner_contacto,');

  return next;
}

function connectMain(workflow, source, target) {
  workflow.connections[source] = {
    ...(workflow.connections[source] || {}),
    main: [[{ node: target, type: 'main', index: 0 }]],
  };
}

async function patchWorkflow(workflowId, patchFn) {
  const workflow = await api(`/api/v1/workflows/${workflowId}`);
  patchFn(workflow);
  const wasActive = workflow.active === true;

  if (wasActive) {
    await api(`/api/v1/workflows/${workflowId}/deactivate`, { method: 'POST' });
  }

  const updated = await api(`/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    body: JSON.stringify(sanitizeWorkflowForUpdate(workflow)),
  });

  if (wasActive) {
    await api(`/api/v1/workflows/${workflowId}/activate`, { method: 'POST' });
  }

  return api(`/api/v1/workflows/${workflowId}`);
}

const updatedMain = await patchWorkflow(MAIN_WORKFLOW_ID, (workflow) => {
  const postgresCredentials = findNode(workflow, 'Get Context-conversations1').credentials;
  upsertNode(workflow, buildSettingsNode(postgresCredentials));
  upsertNode(workflow, buildRestoreInboundNode());

  connectMain(workflow, 'Resolve thread policy', 'Get agent settings');
  connectMain(workflow, 'Get agent settings', 'Restore inbound payload');
  connectMain(workflow, 'Restore inbound payload', 'Allow automation?');

  patchAllowAutomationNode(findNode(workflow, 'Allow automation?'));
  patchConfigNode(findNode(workflow, 'config'));
  findNode(workflow, 'Agregar follow on').parameters.query = buildMainFollowOnQuery();
  findNode(workflow, 'Build Inventory Tool Response').parameters.jsCode = patchInventoryResponseCode(
    findNode(workflow, 'Build Inventory Tool Response').parameters.jsCode,
  );
  findNode(workflow, 'Code in JavaScript1').parameters.jsCode = patchCodeNode(
    findNode(workflow, 'Code in JavaScript1').parameters.jsCode,
  );
  findNode(workflow, 'Orquestador AI1').parameters.options.systemMessage = patchOrchestratorPrompt(
    findNode(workflow, 'Orquestador AI1').parameters.options.systemMessage,
  );
  findNode(workflow, 'qualifying_agent').parameters.text = patchQualifyingPrompt(
    findNode(workflow, 'qualifying_agent').parameters.text,
  );
  findNode(workflow, 'offering_agent').parameters.text = patchOfferingPrompt(
    findNode(workflow, 'offering_agent').parameters.text,
  );
});

const updatedScheduler = await patchWorkflow(SCHEDULER_WORKFLOW_ID, (workflow) => {
  findNode(workflow, 'Select due follow on').parameters.query = buildSchedulerSelectQuery();
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
    },
    null,
    2,
  ),
);
