import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';

dotenv.config({ path: path.resolve('.env') });

const MAIN_WORKFLOW_ID = process.env.SIMULATOR_WORKFLOW_ID || 'RrIniaNJCUC72nfI';
const N8N_BASE_URL = process.env.N8N_BASE_URL;
const N8N_API_KEY = process.env.N8N_PUBLIC_API_TOKEN;
const CHATWOOT_BASE_URL = (process.env.CHATWOOT_BASE_URL || '').replace(/\/$/, '');
const CHATWOOT_ACCOUNT_ID = String(process.env.CHATWOOT_ACCOUNT_ID || '1');
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN || '';
const KAPSO_API_BASE_URL = (process.env.KAPSO_API_BASE_URL || 'https://api.kapso.ai').replace(/\/$/, '');
const KAPSO_API_KEY = process.env.KAPSO_API_KEY || '';
const KAPSO_WHATSAPP_PHONE_NUMBER_ID = process.env.KAPSO_WHATSAPP_PHONE_NUMBER_ID || '';
const KAPSO_WHATSAPP_BUSINESS_ACCOUNT_ID = process.env.KAPSO_WHATSAPP_BUSINESS_ACCOUNT_ID || '';

const SELECTION_SENDER_NAME = 'WhatsApp Selection Notification Sender - De Paseo en Fincas';
const DEFAULT_SELECTION_TEMPLATE_NAME = 'staff_finca_selected_v1';
const DEFAULT_SELECTION_TEMPLATE_LANGUAGE = 'es_CO';

if (!N8N_BASE_URL || !N8N_API_KEY) {
  throw new Error('Missing N8N_BASE_URL or N8N_PUBLIC_API_TOKEN in .env');
}

if (!CHATWOOT_BASE_URL || !CHATWOOT_API_TOKEN) {
  throw new Error('Missing CHATWOOT_BASE_URL or CHATWOOT_API_TOKEN in .env');
}

if (!KAPSO_API_KEY || !KAPSO_WHATSAPP_PHONE_NUMBER_ID || !KAPSO_WHATSAPP_BUSINESS_ACCOUNT_ID) {
  throw new Error('Missing KAPSO_API_KEY or WhatsApp sender ids in .env');
}

function newId() {
  return crypto.randomUUID();
}

function rlWorkflowRef(id, name = null) {
  return {
    __rl: true,
    mode: 'id',
    value: id,
    ...(name ? { cachedResultName: name, cachedResultUrl: `/workflow/${id}` } : {}),
  };
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

async function n8nApi(pathname, options = {}) {
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
    const error = new Error(`n8n HTTP ${response.status} ${pathname}`);
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function chatwootApi(pathname, options = {}) {
  const response = await fetch(`${CHATWOOT_BASE_URL}${pathname}`, {
    ...options,
    headers: {
      api_access_token: CHATWOOT_API_TOKEN,
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
    const error = new Error(`Chatwoot HTTP ${response.status} ${pathname}`);
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function kapsoApi(pathname, options = {}) {
  const response = await fetch(`${KAPSO_API_BASE_URL}${pathname}`, {
    ...options,
    headers: {
      'X-API-Key': KAPSO_API_KEY,
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
    const error = new Error(`Kapso HTTP ${response.status} ${pathname}`);
    error.payload = payload;
    throw error;
  }

  return payload;
}

function findNode(workflow, name) {
  return workflow.nodes.find((node) => node.name === name);
}

function ensureNode(workflow, node) {
  const existing = findNode(workflow, node.name);
  if (existing) {
    Object.assign(existing, node, { id: existing.id });
    return existing;
  }
  workflow.nodes.push(node);
  return node;
}

function setMainConnections(workflow, sourceName, branches) {
  workflow.connections[sourceName] = {
    ...(workflow.connections[sourceName] || {}),
    main: branches.map((branch) =>
      (branch || []).map((nodeName) => ({ node: nodeName, type: 'main', index: 0 })),
    ),
  };
}

function setAssignment(node, name, value, type = 'string') {
  const assignments = node.parameters.assignments.assignments;
  const existing = assignments.find((item) => item.name === name);
  if (existing) {
    existing.value = value;
    existing.type = type;
    return existing;
  }
  const assignment = { id: newId(), name, value, type };
  assignments.push(assignment);
  return assignment;
}

function normalizeInboundCode() {
  return `const payload = $json.body && typeof $json.body === 'object' ? $json.body : ($json || {});
const digitsOnly = (value) => String(value || '').replace(/\\D+/g, '').trim();
const compact = (value) => String(value || '').trim();
const toNullableBoolean = (value) => {
  if (value === true || value === false) return value;
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'si', 'sí', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return null;
};

const looksLikeChatwoot =
  payload.event !== undefined ||
  payload.conversation !== undefined ||
  payload.contact !== undefined ||
  payload.sender !== undefined;

if (!looksLikeChatwoot) {
  const waId = digitsOnly(payload.wa_id || payload.phone || payload.conversationId || payload.sessionId);
  const chatInput = compact(payload.chatInput || payload.text || payload.current_message);
  return [
    {
      json: {
        source: 'simulator',
        event_type: 'message_created',
        is_sync_event: false,
        eligible: Boolean(waId && chatInput),
        ignore_reason: waId && chatInput ? null : 'missing_wa_id_or_text',
        chatInput,
        chatwoot_id: payload.chatwoot_id || null,
        chatwoot_status: null,
        wa_id: waId,
        client_name: compact(payload.client_name || payload.clientName || waId) || null,
        message_type: 'TEXT',
        ia_activa: null,
        ia_activa_present: false,
        local_sequence: Number(payload.local_sequence || 0) || 0,
        client_message_id: compact(payload.client_message_id || payload.clientMessageId) || null,
      },
    },
  ];
}

const eventType = String(payload.event || '').toLowerCase();
const conversationId = payload.conversation?.id || payload.conversation_id || null;
const conversationStatus =
  payload.conversation?.status ||
  payload.conversation_status ||
  payload.status ||
  null;
const phoneCandidates = [
  payload.contact?.phone_number,
  payload.sender?.phone_number,
  payload.conversation?.meta?.sender?.phone_number,
  payload.meta?.sender?.phone_number,
  payload.contact_inbox?.source_id,
  payload.conversation?.meta?.contact?.phone_number,
];
const waId = phoneCandidates.map(digitsOnly).find(Boolean) || '';
const senderType = String(
  payload.sender?.type ||
    payload.sender_type ||
    payload.conversation?.meta?.sender?.type ||
    '',
).toLowerCase();
const messageType = String(payload.message_type || '').toLowerCase();
const privateMessage = payload.private === true;
const content =
  compact(payload.content) ||
  compact(payload.message?.content) ||
  compact(payload.message_content);
const syncEvent = eventType === 'conversation_created' || eventType === 'conversation_updated';
const incoming =
  messageType === 'incoming' ||
  messageType === '0' ||
  senderType === 'contact' ||
  payload.incoming === true;
const customIaRaw =
  payload.conversation?.custom_attributes?.ia_activa ??
  payload.custom_attributes?.ia_activa ??
  payload.changed_attributes?.custom_attributes?.ia_activa ??
  payload.changed_attributes?.ia_activa ??
  null;
const iaActiva = toNullableBoolean(customIaRaw);
const iaActivaPresent = !(customIaRaw === null || customIaRaw === undefined || customIaRaw === '');

let ignoreReason = null;

if (syncEvent) {
  if (!waId && !conversationId) {
    ignoreReason = 'missing_conversation_identity';
  }
} else if (eventType && eventType !== 'message_created') {
  ignoreReason = 'unsupported_event';
} else if (privateMessage) {
  ignoreReason = 'private_message';
} else if (!incoming) {
  ignoreReason = 'not_incoming_customer_message';
} else if (!content) {
  ignoreReason = 'empty_content';
} else if (!waId && !conversationId) {
  ignoreReason = 'missing_phone_number_and_chatwoot_thread';
}

return [
  {
    json: {
      source: 'chatwoot',
      event_type: eventType || 'message_created',
      is_sync_event: syncEvent,
      eligible: ignoreReason === null,
      ignore_reason: ignoreReason,
      chatInput: content,
      chatwoot_id: conversationId ? String(conversationId) : null,
      chatwoot_status: conversationStatus ? String(conversationStatus) : null,
      wa_id: waId,
      client_name:
        payload.contact?.name ||
        payload.sender?.name ||
        payload.conversation?.meta?.sender?.name ||
        null,
      message_type: 'TEXT',
      ia_activa: iaActiva,
      ia_activa_present: iaActivaPresent,
      raw: payload,
    },
  },
];`;
}

function resolveExistingPhoneMappingQuery() {
  return `with incoming as (
  select
    nullif({{ "'" + String($('Normalize inbound payload').item.json.wa_id || '').replace(/'/g, "''") + "'" }}, '')::text as wa_id,
    {{ $('Normalize inbound payload').item.json.chatwoot_id ? Number($('Normalize inbound payload').item.json.chatwoot_id) : 'null' }}::integer as chatwoot_id
)
select
  i.wa_id as incoming_wa_id,
  i.chatwoot_id as incoming_chatwoot_id,
  c.wa_id,
  c.chatwoot_id,
  c.agente_activo,
  c.current_state
from incoming i
left join public.conversations c
  on (
    i.wa_id is not null
    and c.wa_id = i.wa_id
  )
  or (
    i.wa_id is null
    and i.chatwoot_id is not null
    and c.chatwoot_id = i.chatwoot_id
  )
order by c.updated_at desc nulls last
limit 1;`;
}

function resolveThreadPolicyCode() {
  return `const normalized = $('Normalize inbound payload').item.json;
const existing = $json || {};

const resolvedWaId = String(normalized.wa_id || existing.wa_id || '').trim();
const resolvedChatwootId = normalized.chatwoot_id
  ? String(normalized.chatwoot_id)
  : existing.chatwoot_id
    ? String(existing.chatwoot_id)
    : null;
const storedChatwootId = existing.chatwoot_id ? String(existing.chatwoot_id) : null;

let allow = false;
let ignoreReason = normalized.ignore_reason || null;

if (normalized.source === 'simulator') {
  allow = normalized.eligible === true;
} else if (normalized.is_sync_event === true) {
  allow = false;
  if (!ignoreReason && !resolvedWaId && !resolvedChatwootId) {
    ignoreReason = 'missing_conversation_identity';
  }
} else {
  if (!ignoreReason) {
    if (!resolvedChatwootId) {
      ignoreReason = 'missing_chatwoot_id';
    } else if (!resolvedWaId) {
      ignoreReason = 'missing_phone_number';
    } else if (existing.agente_activo === false) {
      ignoreReason = 'automation_disabled';
    } else if (!storedChatwootId) {
      allow = true;
    } else if (storedChatwootId === resolvedChatwootId) {
      allow = true;
    } else {
      ignoreReason = 'thread_conflict_active_chatwoot_conversation';
    }
  }
}

return [
  {
    json: {
      ...normalized,
      wa_id: resolvedWaId || null,
      chatwoot_id: resolvedChatwootId,
      allow_automation: allow,
      ignore_reason: ignoreReason,
      stored_chatwoot_id: storedChatwootId,
      stored_wa_id: existing.wa_id || null,
      current_state: existing.current_state || null,
      agente_activo_existing:
        typeof existing.agente_activo === 'boolean' ? existing.agente_activo : null,
    },
  },
];`;
}

function getAgentSettingsQuery() {
  return `with defaults as (
  select
    'calido_profesional'::text as tone_preset,
    ''::text as tone_guidelines_extra,
    'Excelente día!🤩🌅
Mi nombre es Santiago Gallego
Depaseoenfincas.com, estaré frente a tu reserva!⚡
Por favor indícame:
*Fechas exactas?
*Número de huéspedes?
*Localización?
*Tarifa aproximada por noche

🌎 En el momento disponemos de propiedades en Anapoima, Villeta, La Vega, Girardot, Eje cafetero, Carmen de Apicalá, Antioquia y Villavicencio.'::text as initial_message_template,
    'Te voy a pasar con un asesor humano para continuar con tu solicitud.'::text as handoff_message,
    null::text as owner_contact_override,
    true::boolean as global_bot_enabled,
    true::boolean as followup_enabled,
    time '08:00' as followup_window_start,
    time '22:00' as followup_window_end,
    'Hola, sigo atento para ayudarte con la búsqueda de tu finca. Si quieres, compárteme fechas, número de personas y zona y retomamos.'::text as followup_message_qualifying,
    'Hola, sigo atento. Si quieres, te comparto más opciones o ajustamos la búsqueda por zona, capacidad o presupuesto.'::text as followup_message_offering,
    'Hola, sigo atento con tu solicitud. Si quieres, también puedo ayudarte a revisar otra opción similar.'::text as followup_message_verifying_availability,
    true::boolean as inventory_sheet_enabled,
    '1AHeDsZin_U5ZzfAB50i7JZvOoJcP9uAM71RRZgnDlgo'::text as inventory_sheet_document_id,
    'fincas_inventory_ajustada_real'::text as inventory_sheet_tab_name,
    'Anapoima, Villeta, La Vega, Girardot, Eje cafetero, Carmen de Apicalá, Antioquia y Villavicencio'::text as coverage_zones_text,
    3::integer as max_properties_to_show,
    true::boolean as selection_notification_enabled,
    ''::text as selection_notification_recipients,
    'staff_finca_selected_v1'::text as selection_notification_template_name,
    'es_CO'::text as selection_notification_template_language
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
  coalesce(s.max_properties_to_show, d.max_properties_to_show) as max_properties_to_show,
  coalesce(s.selection_notification_enabled, d.selection_notification_enabled) as selection_notification_enabled,
  coalesce(s.selection_notification_recipients, d.selection_notification_recipients) as selection_notification_recipients,
  coalesce(s.selection_notification_template_name, d.selection_notification_template_name) as selection_notification_template_name,
  coalesce(s.selection_notification_template_language, d.selection_notification_template_language) as selection_notification_template_language
from defaults d
left join settings s on true
limit 1;`;
}

function insertSelectionCandidateHelper(code) {
  if (code.includes('function buildSelectionNotificationCandidate(')) return code;

  const helper = `
function buildSelectionNotificationCandidate({ toolChosen, toolOutputParsed, normalizedPostActions, currentState, currentStateAfter }) {
  const intent = toolOutputParsed?.intent || null;
  const selectedFincaId =
    normalizedPostActions.selected_finca_id !== '__IGNORE__' &&
    normalizedPostActions.selected_finca_id !== '__CLEAR__'
      ? normalizedPostActions.selected_finca_id
      : toolOutputParsed?.finca_elegida_id || toolOutputParsed?.selected_finca?.finca_id || null;
  const selectedFinca =
    normalizedPostActions.selected_finca !== '__IGNORE__' &&
    normalizedPostActions.selected_finca !== '__CLEAR__'
      ? normalizedPostActions.selected_finca
      : toolOutputParsed?.selected_finca || null;
  const searchCriteria =
    normalizedPostActions.search_criteria !== '__IGNORE__'
      ? normalizedPostActions.search_criteria
      : $('Get Context-conversations1').item.json.search_criteria || {};

  return {
    shouldNotify:
      toolChosen === 'offering_agent' &&
      intent === 'CLIENT_CHOSE' &&
      currentStateAfter === 'VERIFYING_AVAILABILITY' &&
      Boolean(selectedFincaId),
    intent,
    currentStateBefore: currentState,
    currentStateAfter,
    selectedFincaId,
    selectedFinca,
    searchCriteria,
  };
}
`;

  return code.replace('const item = $input.first();', `${helper}\nconst item = $input.first();`);
}

function patchCodeNode(code) {
  let next = insertSelectionCandidateHelper(code);

  const currentStateBlock = `const currentStateChanged =
  parsed?.current_state_changed === true ||
  normalizeBoolean(parsed?.current_state_changed) ||
  stateActuallyChanged;

const handoffText = $('config').item.json.handoff_message || 'Te voy a pasar con un asesor humano para continuar con tu solicitud.';`;

  const replacementBlock = `const currentStateChanged =
  parsed?.current_state_changed === true ||
  normalizeBoolean(parsed?.current_state_changed) ||
  stateActuallyChanged;
const currentStateAfter =
  requestedStateTransition !== '__IGNORE__'
    ? requestedStateTransition
    : currentState;
const selectionNotificationCandidate = buildSelectionNotificationCandidate({
  toolChosen,
  toolOutputParsed,
  normalizedPostActions,
  currentState,
  currentStateAfter,
});

const handoffText = $('config').item.json.handoff_message || 'Te voy a pasar con un asesor humano para continuar con tu solicitud.';`;

  next = next.replace(currentStateBlock, replacementBlock);

  const returnSnippet = `      chatwoot_id:
        $('Get Context-conversations1').item.json.chatwoot_id || $('Merge Sets1').item.json.chatwoot_id || null,
      conversation_key:
        parsed?.tool_input?.context?.conversation?.id || $('Merge Sets1').item.json.conversation_key,`;

  const returnReplacement = `      chatwoot_id:
        $('Get Context-conversations1').item.json.chatwoot_id || $('Merge Sets1').item.json.chatwoot_id || null,
      current_state_after: currentStateAfter,
      selection_notification_candidate: selectionNotificationCandidate,
      conversation_key:
        parsed?.tool_input?.context?.conversation?.id || $('Merge Sets1').item.json.conversation_key,`;

  next = next.replace(returnSnippet, returnReplacement);
  return next;
}

function upsertSelectionSenderWorkflowDefinition() {
  return {
    name: SELECTION_SENDER_NAME,
    nodes: [
      {
        parameters: {
          inputSource: 'passthrough',
        },
        id: newId(),
        name: 'When selection sender is called',
        type: 'n8n-nodes-base.executeWorkflowTrigger',
        typeVersion: 1.1,
        position: [240, 240],
      },
      {
        parameters: {
          jsCode: `const parseBatch = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const input = $json || {};
const batch = parseBatch(
  input.selection_notification_batch_json ||
    input.selection_notification_batch ||
    input.batch_json ||
    input.batch,
);

return batch
  .filter((item) => item && item.conversation_id && item.selected_finca_id && item.recipient_phone)
  .map((item, index) => ({
    json: {
      ...item,
      sequence_index: index,
    },
  }));`,
        },
        id: newId(),
        name: 'Expand selection notification batch',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [480, 240],
      },
      {
        parameters: {
          operation: 'executeQuery',
          query: `with input as (
  select
    {{ "'" + String($json.conversation_id).replace(/'/g, "''") + "'" }}::text as conversation_id,
    {{ "'" + String($json.selected_finca_id).replace(/'/g, "''") + "'" }}::text as selected_finca_id,
    {{ "'" + String($json.recipient_phone).replace(/'/g, "''") + "'" }}::text as recipient_phone,
    {{ "'" + String($json.template_name || '${DEFAULT_SELECTION_TEMPLATE_NAME}').replace(/'/g, "''") + "'" }}::text as template_name,
    {{ "'" + String($json.template_language || '${DEFAULT_SELECTION_TEMPLATE_LANGUAGE}').replace(/'/g, "''") + "'" }}::text as template_language,
    {{ "'" + JSON.stringify($json.payload || {}).replace(/'/g, "''") + "'" }}::jsonb as payload
),
inserted as (
  insert into public.selection_notifications (
    conversation_id,
    selected_finca_id,
    recipient_phone,
    template_name,
    template_language,
    status,
    payload
  )
  select
    input.conversation_id,
    input.selected_finca_id,
    input.recipient_phone,
    input.template_name,
    input.template_language,
    'pending',
    input.payload
  from input
  on conflict (conversation_id, selected_finca_id, recipient_phone)
  where status in ('pending', 'sent')
  do nothing
  returning *
)
select * from inserted;`,
          options: {},
        },
        id: newId(),
        name: 'Insert pending selection notification',
        type: 'n8n-nodes-base.postgres',
        typeVersion: 2,
        position: [720, 240],
        credentials: {
          postgres: {
            id: 'CKoiBGlPXq82taIc',
            name: 'Postgres account',
          },
        },
      },
      {
        parameters: {
          jsCode: `const input = $json || {};
const payload = input.payload || {};
const text = (value) => {
  const normalized = String(value ?? '').trim();
  return normalized || 'Sin dato';
};

const detail = [
  'Teléfono: ' + text(payload.wa_id),
  'Finca: ' + text(payload.selected_finca_name || payload.selected_finca_id),
  'Fechas: ' + text(payload.fechas),
  'Personas: ' + text(payload.personas),
  'Zona: ' + text(payload.zona),
  'Chatwoot: ' + text(payload.chatwoot_link),
].join(' | ');

const bodyParameters = [
  { type: 'text', parameter_name: 'cliente', text: text(payload.client_name) },
  { type: 'text', parameter_name: 'detalle', text: text(detail) },
];

let responseStatus = null;
let responseBody = null;
let providerMessageId = null;
let errorMessage = null;

try {
  const response = await fetch('${KAPSO_API_BASE_URL}/meta/whatsapp/v24.0/${KAPSO_WHATSAPP_PHONE_NUMBER_ID}/messages', {
    method: 'POST',
    headers: {
      'X-API-Key': '${KAPSO_API_KEY}',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: String(input.recipient_phone || '').trim(),
      type: 'template',
      template: {
        name: String(input.template_name || '${DEFAULT_SELECTION_TEMPLATE_NAME}').trim(),
        language: {
          code: String(input.template_language || '${DEFAULT_SELECTION_TEMPLATE_LANGUAGE}').trim(),
        },
        components: [
          {
            type: 'body',
            parameters: bodyParameters,
          },
        ],
      },
    }),
  });

  responseStatus = response.status;
  const raw = await response.text();
  try {
    responseBody = raw ? JSON.parse(raw) : null;
  } catch {
    responseBody = { raw };
  }

  providerMessageId =
    responseBody?.messages?.[0]?.id ||
    responseBody?.message_id ||
    responseBody?.messages?.[0]?.message_id ||
    null;

  if (!response.ok) {
    errorMessage =
      responseBody?.error?.message ||
      responseBody?.message ||
      raw ||
      'Kapso template send failed';
  }
} catch (error) {
  errorMessage = error.message;
  responseBody = { error: error.message };
}

return [
  {
    json: {
      ...input,
      provider_message_id: providerMessageId,
      response_status: responseStatus,
      response_body: responseBody,
      ok: !errorMessage,
      error_message: errorMessage,
    },
  },
];`,
        },
        id: newId(),
        name: 'Send WhatsApp selection template',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [960, 240],
      },
      {
        parameters: {
          conditions: {
            options: {
              caseSensitive: true,
              leftValue: '',
              typeValidation: 'loose',
              version: 3,
            },
            conditions: [
              {
                id: newId(),
                leftValue: '={{ $json.ok === true }}',
                rightValue: '',
                operator: {
                  type: 'boolean',
                  operation: 'true',
                  singleValue: true,
                },
              },
            ],
            combinator: 'and',
          },
          looseTypeValidation: true,
          options: {},
        },
        id: newId(),
        name: 'Selection delivery ok?',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.3,
        position: [1200, 240],
      },
      {
        parameters: {
          operation: 'executeQuery',
          query: `update public.selection_notifications
set
  status = 'sent',
  provider_message_id = {{ $json.provider_message_id ? "'" + String($json.provider_message_id).replace(/'/g, "''") + "'" : 'null' }},
  sent_at = now(),
  error_message = null
where id = {{ Number($json.id) }}
returning id, status;`,
          options: {},
        },
        id: newId(),
        name: 'Mark selection notification sent',
        type: 'n8n-nodes-base.postgres',
        typeVersion: 2,
        position: [1440, 160],
        credentials: {
          postgres: {
            id: 'CKoiBGlPXq82taIc',
            name: 'Postgres account',
          },
        },
      },
      {
        parameters: {
          operation: 'executeQuery',
          query: `update public.selection_notifications
set
  status = 'failed',
  error_message = {{ $json.error_message ? "'" + String($json.error_message).replace(/'/g, "''") + "'" : "'Unknown error'" }}
where id = {{ Number($json.id) }}
returning id, status;`,
          options: {},
        },
        id: newId(),
        name: 'Mark selection notification failed',
        type: 'n8n-nodes-base.postgres',
        typeVersion: 2,
        position: [1440, 336],
        credentials: {
          postgres: {
            id: 'CKoiBGlPXq82taIc',
            name: 'Postgres account',
          },
        },
      },
    ],
    connections: {
      'When selection sender is called': {
        main: [[{ node: 'Expand selection notification batch', type: 'main', index: 0 }]],
      },
      'Expand selection notification batch': {
        main: [[{ node: 'Insert pending selection notification', type: 'main', index: 0 }]],
      },
      'Insert pending selection notification': {
        main: [[{ node: 'Send WhatsApp selection template', type: 'main', index: 0 }]],
      },
      'Send WhatsApp selection template': {
        main: [[{ node: 'Selection delivery ok?', type: 'main', index: 0 }]],
      },
      'Selection delivery ok?': {
        main: [
          [{ node: 'Mark selection notification sent', type: 'main', index: 0 }],
          [{ node: 'Mark selection notification failed', type: 'main', index: 0 }],
        ],
      },
      'Mark selection notification sent': {
        main: [[]],
      },
      'Mark selection notification failed': {
        main: [[]],
      },
    },
    settings: {
      executionOrder: 'v1',
      timezone: 'America/Bogota',
    },
  };
}

function routeSyncNode() {
  return {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'loose',
          version: 3,
        },
        conditions: [
          {
            id: newId(),
            leftValue: "={{ ['conversation_created', 'conversation_updated'].includes(String($json.event_type || '')) }}",
            rightValue: '',
            operator: {
              type: 'boolean',
              operation: 'true',
              singleValue: true,
            },
          },
        ],
        combinator: 'and',
      },
      looseTypeValidation: true,
      options: {},
    },
    id: newId(),
    name: 'Route sync event?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [4200, 520],
  };
}

function syncStateNode() {
  return {
    parameters: {
      operation: 'executeQuery',
      query: `with incoming as (
  select
    {{ $('Restore inbound payload').item.json.wa_id ? "'" + String($('Restore inbound payload').item.json.wa_id).replace(/'/g, "''") + "'" : 'null' }}::text as wa_id,
    {{ $('Restore inbound payload').item.json.chatwoot_id ? Number($('Restore inbound payload').item.json.chatwoot_id) : 'null' }}::integer as chatwoot_id,
    {{ $('Restore inbound payload').item.json.client_name ? "'" + String($('Restore inbound payload').item.json.client_name).replace(/'/g, "''") + "'" : 'null' }}::text as client_name,
    {{ $('Restore inbound payload').item.json.event_type ? "'" + String($('Restore inbound payload').item.json.event_type).replace(/'/g, "''") + "'" : "'conversation_updated'" }}::text as event_type,
    {{ $('Restore inbound payload').item.json.ia_activa_present === true ? (($('Restore inbound payload').item.json.ia_activa === true) ? 'true' : 'false') : 'null' }}::boolean as ia_activa
),
upserted as (
  insert into public.conversations (
    wa_id,
    chatwoot_id,
    client_name,
    agente_activo,
    last_interaction,
    updated_at
  )
  select
    i.wa_id,
    i.chatwoot_id,
    i.client_name,
    case
      when i.event_type = 'conversation_created' then true
      when i.ia_activa is not null then i.ia_activa
      else true
    end,
    now(),
    now()
  from incoming i
  where i.wa_id is not null
  on conflict (wa_id)
  do update set
    chatwoot_id = coalesce(excluded.chatwoot_id, public.conversations.chatwoot_id),
    client_name = coalesce(excluded.client_name, public.conversations.client_name),
    agente_activo = case
      when (select event_type from incoming) = 'conversation_created' then true
      when (select ia_activa from incoming) is not null then (select ia_activa from incoming)
      else public.conversations.agente_activo
    end,
    last_interaction = now(),
    updated_at = now()
  returning wa_id, chatwoot_id, agente_activo
)
select
  coalesce(u.wa_id, i.wa_id) as wa_id,
  coalesce(u.chatwoot_id, i.chatwoot_id) as chatwoot_id,
  coalesce(
    u.agente_activo,
    case
      when i.event_type = 'conversation_created' then true
      when i.ia_activa is not null then i.ia_activa
      else null
    end
  ) as agente_activo
from incoming i
left join upserted u on true
limit 1;`,
      options: {},
    },
    id: newId(),
    name: 'Upsert Chatwoot ia_activa sync',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2,
    position: [4440, 416],
    credentials: {
      postgres: {
        id: 'CKoiBGlPXq82taIc',
        name: 'Postgres account',
      },
    },
  };
}

function shouldMirrorSyncNode() {
  return {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'loose',
          version: 3,
        },
        conditions: [
          {
            id: newId(),
            leftValue: '={{ Boolean($json.chatwoot_id) && typeof $json.agente_activo === "boolean" }}',
            rightValue: '',
            operator: {
              type: 'boolean',
              operation: 'true',
              singleValue: true,
            },
          },
        ],
        combinator: 'and',
      },
      looseTypeValidation: true,
      options: {},
    },
    id: newId(),
    name: 'Should mirror ia_activa to Chatwoot (sync)?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [4680, 416],
  };
}

function syncIaActivaHttpNode(name, sourceExpression, position) {
  return {
    parameters: {
      method: 'POST',
      url: `={{ '${CHATWOOT_BASE_URL}' + '/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/' + String(${sourceExpression}.chatwoot_id) + '/custom_attributes' }}`,
      sendHeaders: true,
      headerParameters: {
        parameters: [
          {
            name: 'api_access_token',
            value: CHATWOOT_API_TOKEN,
          },
          {
            name: 'content-type',
            value: 'application/json',
          },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ custom_attributes: { ia_activa: ${sourceExpression}.agente_activo === true } }) }}`,
      options: {},
    },
    id: newId(),
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
    onError: 'continueRegularOutput',
  };
}

function webhookSyncAckNode() {
  return {
    parameters: {
      assignments: {
        assignments: [
          { id: newId(), name: 'ok', value: true, type: 'boolean' },
          { id: newId(), name: 'processed', value: true, type: 'boolean' },
          { id: newId(), name: 'sync', value: true, type: 'boolean' },
          { id: newId(), name: 'wa_id', value: "={{ $('Upsert Chatwoot ia_activa sync').item.json.wa_id || $('Restore inbound payload').item.json.wa_id || null }}", type: 'string' },
          { id: newId(), name: 'chatwoot_id', value: "={{ $('Upsert Chatwoot ia_activa sync').item.json.chatwoot_id || $('Restore inbound payload').item.json.chatwoot_id || null }}", type: 'string' },
          { id: newId(), name: 'agente_activo', value: "={{ $('Upsert Chatwoot ia_activa sync').item.json.agente_activo }}", type: 'boolean' },
        ],
      },
      options: {},
    },
    id: newId(),
    name: 'Webhook Sync ACK',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [5160, 416],
  };
}

function shouldSyncIaEngineNode() {
  return {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'loose',
          version: 3,
        },
        conditions: [
          {
            id: newId(),
            leftValue: '={{ Boolean($json.chatwoot_id) && typeof $json.agente_activo === "boolean" }}',
            rightValue: '',
            operator: {
              type: 'boolean',
              operation: 'true',
              singleValue: true,
            },
          },
        ],
        combinator: 'and',
      },
      looseTypeValidation: true,
      options: {},
    },
    id: newId(),
    name: 'Should sync ia_activa to Chatwoot (engine)?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [-5900, 2224],
  };
}

function prepareSelectionNotificationsNode() {
  return {
    parameters: {
      jsCode: `const engine = $('Engine Result').item.json || {};
const settings = $('Get agent settings').item.json || {};
const candidate = engine.selection_notification_candidate || {};
const normalizePhone = (value) => String(value || '').replace(/\\D+/g, '').trim();

const recipients = String(settings.selection_notification_recipients || '')
  .split(',')
  .map((value) => normalizePhone(value))
  .filter(Boolean)
  .filter((value, index, array) => array.indexOf(value) === index);

const selectedFincaId = candidate.selectedFincaId || null;
const selectedFinca = candidate.selectedFinca || {};
const searchCriteria = candidate.searchCriteria || {};
const clientName = String(engine.client_name || engine.wa_id || 'Sin dato').trim() || 'Sin dato';
const waId = String(engine.wa_id || '').trim();
const chatwootId = engine.chatwoot_id ? String(engine.chatwoot_id) : null;
const chatwootLink = chatwootId
  ? '${CHATWOOT_BASE_URL}/app/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/' + chatwootId
  : 'Sin dato';

const fechas =
  searchCriteria.fecha_inicio && searchCriteria.fecha_fin
    ? String(searchCriteria.fecha_inicio) + ' a ' + String(searchCriteria.fecha_fin)
    : 'Sin dato';

const batch =
  settings.selection_notification_enabled === true &&
  candidate.shouldNotify === true &&
  selectedFincaId &&
  recipients.length
    ? recipients.map((recipientPhone) => ({
        conversation_id: String(engine.wa_id || ''),
        selected_finca_id: String(selectedFincaId),
        recipient_phone: recipientPhone,
        template_name:
          String(settings.selection_notification_template_name || '${DEFAULT_SELECTION_TEMPLATE_NAME}').trim() ||
          '${DEFAULT_SELECTION_TEMPLATE_NAME}',
        template_language:
          String(settings.selection_notification_template_language || '${DEFAULT_SELECTION_TEMPLATE_LANGUAGE}').trim() ||
          '${DEFAULT_SELECTION_TEMPLATE_LANGUAGE}',
        payload: {
          client_name: clientName,
          wa_id: waId || 'Sin dato',
          selected_finca_id: String(selectedFincaId),
          selected_finca_name: String(selectedFinca.nombre || selectedFincaId || 'Sin dato').trim() || 'Sin dato',
          fechas,
          personas:
            searchCriteria.personas !== undefined && searchCriteria.personas !== null
              ? String(searchCriteria.personas)
              : 'Sin dato',
          zona: String(searchCriteria.zona || 'Sin dato').trim() || 'Sin dato',
          chatwoot_link: chatwootLink,
        },
      }))
    : [];

return [
  {
    json: {
      ...engine,
      selection_notification_count: batch.length,
      selection_notification_batch: batch,
      selection_notification_batch_json: JSON.stringify(batch),
    },
  },
];`,
    },
    id: newId(),
    name: 'Prepare selection notifications',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2144, 224],
  };
}

function shouldSendSelectionNotificationsNode() {
  return {
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'loose',
          version: 3,
        },
        conditions: [
          {
            id: newId(),
            leftValue: '={{ Number($json.selection_notification_count || 0) > 0 }}',
            rightValue: '',
            operator: {
              type: 'boolean',
              operation: 'true',
              singleValue: true,
            },
          },
        ],
        combinator: 'and',
      },
      looseTypeValidation: true,
      options: {},
    },
    id: newId(),
    name: 'Should send selection notifications?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [2384, 224],
  };
}

function restoreAfterSelectionNode() {
  return {
    parameters: {
      assignments: {
        assignments: [
          { id: newId(), name: 'ok', value: "={{ $('Prepare selection notifications').item.json.ok !== false }}", type: 'boolean' },
          { id: newId(), name: 'processed', value: true, type: 'boolean' },
          { id: newId(), name: 'wa_id', value: "={{ $('Prepare selection notifications').item.json.wa_id || null }}", type: 'string' },
          { id: newId(), name: 'chatwoot_id', value: "={{ $('Prepare selection notifications').item.json.chatwoot_id || null }}", type: 'string' },
          { id: newId(), name: 'replyText', value: "={{ $('Prepare selection notifications').item.json.outbound_message || $('Prepare selection notifications').item.json.final_whatsapp_text || '' }}", type: 'string' },
          { id: newId(), name: 'toolChosen', value: "={{ $('Prepare selection notifications').item.json.tool_chosen || 'NONE' }}", type: 'string' },
          { id: newId(), name: 'action', value: "={{ $('Prepare selection notifications').item.json.action || 'RUN_TOOL' }}", type: 'string' },
          { id: newId(), name: 'stateAfter', value: "={{ $('Prepare selection notifications').item.json.current_state || null }}", type: 'string' },
          { id: newId(), name: 'agenteActivo', value: "={{ $('Prepare selection notifications').item.json.agente_activo }}", type: 'boolean' },
        ],
      },
      options: {},
    },
    id: newId(),
    name: 'Restore outbound payload after selection notifications',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [2864, 144],
  };
}

async function findWorkflowByName(name) {
  const payload = await n8nApi('/api/v1/workflows?limit=200');
  const workflows = Array.isArray(payload?.data) ? payload.data : [];
  return workflows.find((item) => item.name === name) || null;
}

async function upsertWorkflowByName(definition) {
  const found = await findWorkflowByName(definition.name);
  const existing = found ? await n8nApi(`/api/v1/workflows/${found.id}`) : null;

  if (existing) {
    const wasActive = existing.active === true;
    if (wasActive) {
      await n8nApi(`/api/v1/workflows/${existing.id}/deactivate`, { method: 'POST' });
    }
    const updated = await n8nApi(`/api/v1/workflows/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: definition.name,
        nodes: definition.nodes,
        connections: definition.connections,
        settings: sanitizeWorkflowSettings(definition.settings),
      }),
    });
    await n8nApi(`/api/v1/workflows/${existing.id}/activate`, { method: 'POST' });
    return { id: existing.id, versionId: updated.versionId };
  }

  const created = await n8nApi('/api/v1/workflows', {
    method: 'POST',
    body: JSON.stringify({
      name: definition.name,
      nodes: definition.nodes,
      connections: definition.connections,
      settings: sanitizeWorkflowSettings(definition.settings),
    }),
  });
  await n8nApi(`/api/v1/workflows/${created.id}/activate`, { method: 'POST' });
  return { id: created.id, versionId: created.versionId };
}

async function ensureChatwootIaActivaAttribute() {
  const existing = await chatwootApi(
    `/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/custom_attribute_definitions?attribute_model=0`,
  );
  const definitions = Array.isArray(existing) ? existing : Array.isArray(existing?.payload) ? existing.payload : [];
  if (definitions.some((item) => item.attribute_key === 'ia_activa')) {
    return { exists: true };
  }

  await chatwootApi(`/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/custom_attribute_definitions`, {
    method: 'POST',
    body: JSON.stringify({
      attribute_display_name: 'ia_activa',
      attribute_display_type: 'checkbox',
      attribute_description: 'Determina si se activa o no el Agente',
      attribute_key: 'ia_activa',
      attribute_model: 'conversation_attribute',
    }),
  });

  return { created: true };
}

async function ensureKapsoSelectionTemplate() {
  const templates = await kapsoApi(
    `/meta/whatsapp/v24.0/${KAPSO_WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates?limit=100`,
  );
  const existing = Array.isArray(templates?.data) ? templates.data : [];
  if (existing.some((item) => item.name === DEFAULT_SELECTION_TEMPLATE_NAME)) {
    return { exists: true };
  }

  await kapsoApi(`/meta/whatsapp/v24.0/${KAPSO_WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`, {
    method: 'POST',
    body: JSON.stringify({
      name: DEFAULT_SELECTION_TEMPLATE_NAME,
      category: 'UTILITY',
      parameter_format: 'NAMED',
      language: DEFAULT_SELECTION_TEMPLATE_LANGUAGE,
      components: [
        {
          type: 'BODY',
          text: 'Nueva selección de finca para seguimiento interno.\\nEl cliente asignado es {{cliente}} dentro de esta solicitud.\\nEl detalle operativo registrado es {{detalle}} para revisión del equipo.',
          example: {
            body_text_named_params: [
              { param_name: 'cliente', example: 'Juan Pérez' },
              {
                param_name: 'detalle',
                example: `Teléfono: 573001112233 | Finca: Anapoima15 | Fechas: 2026-03-20 a 2026-03-22 | Personas: 12 | Zona: Anapoima | Chatwoot: ${CHATWOOT_BASE_URL}/app/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/123`,
              },
            ],
          },
        },
      ],
    }),
  });

  return { created: true };
}

async function main() {
  await ensureChatwootIaActivaAttribute();

  let templateState = null;
  try {
    templateState = await ensureKapsoSelectionTemplate();
  } catch (error) {
    templateState = {
      error: error.message,
      details: error.payload || null,
    };
  }

  const selectionSender = await upsertWorkflowByName(upsertSelectionSenderWorkflowDefinition());

  const workflow = await n8nApi(`/api/v1/workflows/${MAIN_WORKFLOW_ID}`);
  workflow.settings = {
    ...(workflow.settings || {}),
    timezone: 'America/Bogota',
  };

  const normalizeInbound = findNode(workflow, 'Normalize inbound payload');
  normalizeInbound.parameters.jsCode = normalizeInboundCode();

  const resolveExistingPhoneMapping = findNode(workflow, 'Resolve existing phone mapping');
  resolveExistingPhoneMapping.parameters.query = resolveExistingPhoneMappingQuery();

  const resolveThreadPolicy = findNode(workflow, 'Resolve thread policy');
  resolveThreadPolicy.parameters.jsCode = resolveThreadPolicyCode();

  const getAgentSettings = findNode(workflow, 'Get agent settings');
  getAgentSettings.parameters.query = getAgentSettingsQuery();

  const config = findNode(workflow, 'config');
  setAssignment(
    config,
    'selection_notification_enabled',
    "={{ $('Get agent settings').item.json.selection_notification_enabled === true }}",
    'boolean',
  );
  setAssignment(
    config,
    'selection_notification_recipients',
    "={{ $('Get agent settings').item.json.selection_notification_recipients || '' }}",
  );
  setAssignment(
    config,
    'selection_notification_template_name',
    "={{ $('Get agent settings').item.json.selection_notification_template_name || 'staff_finca_selected_v1' }}",
  );
  setAssignment(
    config,
    'selection_notification_template_language',
    "={{ $('Get agent settings').item.json.selection_notification_template_language || 'es_CO' }}",
  );

  const codeNode = findNode(workflow, 'Code in JavaScript1');
  codeNode.parameters.jsCode = patchCodeNode(String(codeNode.parameters.jsCode || ''));

  const engineResult = findNode(workflow, 'Engine Result');
  setAssignment(
    engineResult,
    'selection_notification_candidate',
    "={{ $('Code in JavaScript1').item.json.selection_notification_candidate || null }}",
    'object',
  );
  setAssignment(
    engineResult,
    'current_state_after',
    "={{ $('Code in JavaScript1').item.json.current_state_after || $('actualizar contexto1').item.json.current_state || null }}",
  );

  const routeSync = ensureNode(workflow, routeSyncNode());
  const syncState = ensureNode(workflow, syncStateNode());
  const shouldMirrorSync = ensureNode(workflow, shouldMirrorSyncNode());
  const syncIaSync = ensureNode(
    workflow,
    syncIaActivaHttpNode('Sync ia_activa to Chatwoot (sync)', '$json', [4920, 336]),
  );
  const webhookSyncAck = ensureNode(workflow, webhookSyncAckNode());
  const shouldSyncEngine = ensureNode(workflow, shouldSyncIaEngineNode());
  const syncIaEngine = ensureNode(
    workflow,
    syncIaActivaHttpNode('Sync ia_activa to Chatwoot (engine)', '$json', [-5640, 2144]),
  );
  const prepareSelection = ensureNode(workflow, prepareSelectionNotificationsNode());
  const shouldSendSelection = ensureNode(workflow, shouldSendSelectionNotificationsNode());
  const restoreAfterSelection = ensureNode(workflow, restoreAfterSelectionNode());

  const sendSelection = ensureNode(workflow, {
    parameters: {
      workflowId: rlWorkflowRef(selectionSender.id, SELECTION_SENDER_NAME),
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {},
        matchingColumns: [],
        schema: [
          {
            id: newId(),
            displayName: 'selection_notification_batch_json',
            required: false,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
            removed: false,
            stringValue: "={{ $json.selection_notification_batch_json || '[]' }}",
          },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: false,
      },
      options: {},
    },
    id: newId(),
    name: 'Send selection notifications',
    type: 'n8n-nodes-base.executeWorkflow',
    typeVersion: 1.2,
    position: [2624, 64],
    onError: 'continueRegularOutput',
  });

  setMainConnections(workflow, 'Restore inbound payload', [['Route sync event?']]);
  setMainConnections(workflow, 'Route sync event?', [
    ['Upsert Chatwoot ia_activa sync'],
    ['Allow automation?'],
  ]);
  setMainConnections(workflow, 'Upsert Chatwoot ia_activa sync', [['Should mirror ia_activa to Chatwoot (sync)?']]);
  setMainConnections(workflow, 'Should mirror ia_activa to Chatwoot (sync)?', [
    ['Sync ia_activa to Chatwoot (sync)'],
    ['Webhook Sync ACK'],
  ]);
  setMainConnections(workflow, 'Sync ia_activa to Chatwoot (sync)', [['Webhook Sync ACK']]);

  setMainConnections(workflow, 'actualizar contexto1', [['Should sync ia_activa to Chatwoot (engine)?']]);
  setMainConnections(workflow, 'Should sync ia_activa to Chatwoot (engine)?', [
    ['Sync ia_activa to Chatwoot (engine)'],
    ['If3'],
  ]);
  setMainConnections(workflow, 'Sync ia_activa to Chatwoot (engine)', [['If3']]);

  setMainConnections(workflow, 'Should send via Chatwoot?', [
    ['Send outbound via Chatwoot'],
    ['Prepare selection notifications'],
  ]);
  setMainConnections(workflow, 'Send outbound via Chatwoot', [['Prepare selection notifications']]);
  setMainConnections(workflow, 'Prepare selection notifications', [['Should send selection notifications?']]);
  setMainConnections(workflow, 'Should send selection notifications?', [
    ['Send selection notifications'],
    ['Webhook Response'],
  ]);
  setMainConnections(workflow, 'Send selection notifications', [['Restore outbound payload after selection notifications']]);
  setMainConnections(workflow, 'Restore outbound payload after selection notifications', [['Webhook Response']]);

  const wasActive = workflow.active === true;
  if (wasActive) {
    await n8nApi(`/api/v1/workflows/${MAIN_WORKFLOW_ID}/deactivate`, { method: 'POST' });
  }

  const updated = await n8nApi(`/api/v1/workflows/${MAIN_WORKFLOW_ID}`, {
    method: 'PUT',
    body: JSON.stringify(sanitizeWorkflowForUpdate(workflow)),
  });

  await n8nApi(`/api/v1/workflows/${MAIN_WORKFLOW_ID}/activate`, { method: 'POST' });

  await fs.writeFile(
    path.resolve('current_workflow.json'),
    JSON.stringify(await n8nApi(`/api/v1/workflows/${MAIN_WORKFLOW_ID}`), null, 2),
  );
  await fs.writeFile(
    path.resolve('selection_notification_sender_workflow.json'),
    JSON.stringify(await n8nApi(`/api/v1/workflows/${selectionSender.id}`), null, 2),
  );

  console.log(
    JSON.stringify(
      {
        workflow: {
          id: MAIN_WORKFLOW_ID,
          versionId: updated.versionId,
        },
        selectionSender,
        templateState,
      },
      null,
      2,
    ),
  );
}

await main();
