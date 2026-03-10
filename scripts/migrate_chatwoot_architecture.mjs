import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';

dotenv.config({ path: path.resolve('.env') });

const MAIN_WORKFLOW_ID = process.argv[2] || process.env.SIMULATOR_WORKFLOW_ID || 'RrIniaNJCUC72nfI';
const N8N_BASE_URL = process.env.N8N_BASE_URL;
const N8N_API_KEY = process.env.N8N_PUBLIC_API_TOKEN;
const CHATWOOT_BASE_URL = (process.env.CHATWOOT_BASE_URL || 'https://chatwoot-9qe1j-u48275.vm.elestio.app').replace(/\/$/, '');
const CHATWOOT_ACCOUNT_ID = String(process.env.CHATWOOT_ACCOUNT_ID || '1');
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN || 'MISSING_CHATWOOT_API_TOKEN';
const CHATWOOT_INBOUND_WEBHOOK_PATH = process.env.CHATWOOT_INBOUND_WEBHOOK_PATH || 'chatwoot/de-paseo-en-fincas/inbound';
const SIMULATOR_WEBHOOK_PATH = process.env.SIMULATOR_WEBHOOK_PATH || 'simulator/de-paseo-en-fincas/inbound';

const ENGINE_WORKFLOW_NAME = 'De paseo en fincas engine';
const CHATWOOT_INBOUND_NAME = 'Chatwoot Inbound - De Paseo en Fincas';
const CHATWOOT_OUTBOUND_NAME = 'Chatwoot Outbound Sender - De Paseo en Fincas';
const SIMULATOR_ADAPTER_NAME = 'Simulator Adapter - De Paseo en Fincas';
const SCHEDULER_NAME = 'Follow on scheduler';

if (!N8N_BASE_URL || !N8N_API_KEY) {
  throw new Error('Missing N8N_BASE_URL or N8N_PUBLIC_API_TOKEN in .env');
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

function findNode(workflow, name) {
  return workflow.nodes.find((node) => node.name === name);
}

function removeNode(workflow, name) {
  workflow.nodes = workflow.nodes.filter((node) => node.name !== name);
  delete workflow.connections[name];

  for (const key of Object.keys(workflow.connections)) {
    const bucket = workflow.connections[key];
    for (const type of Object.keys(bucket || {})) {
      bucket[type] = (bucket[type] || []).map((group) =>
        (group || []).filter((edge) => edge.node !== name),
      );
    }
  }
}

function replaceMainConnection(connections, sourceNodeName, targetNodeName) {
  connections[sourceNodeName] = {
    ...(connections[sourceNodeName] || {}),
    main: [[{ node: targetNodeName, type: 'main', index: 0 }]],
  };
}

function ensureMainConnection(connections, sourceNodeName, targetNodeName) {
  if (!connections[sourceNodeName]) {
    replaceMainConnection(connections, sourceNodeName, targetNodeName);
    return;
  }

  const group = (((connections[sourceNodeName] || {}).main || [[]])[0] || []);
  if (!group.some((edge) => edge.node === targetNodeName)) {
    group.push({ node: targetNodeName, type: 'main', index: 0 });
  }
  connections[sourceNodeName].main = [group];
}

function setAssignment(node, name, value, type = 'string') {
  const assignments = node.parameters.assignments.assignments;
  const existing = assignments.find((item) => item.name === name);
  if (existing) {
    existing.value = value;
    existing.type = type;
    return;
  }
  assignments.push({ id: newId(), name, value, type });
}

function engineResultNode() {
  return {
    parameters: {
      assignments: {
        assignments: [
          {
            id: newId(),
            name: 'conversation_key',
            value: "={{ $('Merge Sets1').item.json.conversation_key }}",
            type: 'string',
          },
          {
            id: newId(),
            name: 'wa_id',
            value: "={{ $('Merge Sets1').item.json.conversation_key }}",
            type: 'string',
          },
          {
            id: newId(),
            name: 'chatwoot_id',
            value:
              "={{ $('Get Context-conversations1').item.json.chatwoot_id || $('Merge Sets1').item.json.chatwoot_id || null }}",
            type: 'string',
          },
          {
            id: newId(),
            name: 'client_name',
            value:
              "={{ $('actualizar contexto1').item.json.client_name || $('Merge Sets1').item.json.client_name || null }}",
            type: 'string',
          },
          {
            id: newId(),
            name: 'outbound_message',
            value:
              "={{ $('Code in JavaScript1').item.json.outbound_message || $('Code in JavaScript1').item.json.final_whatsapp_text || '' }}",
            type: 'string',
          },
          {
            id: newId(),
            name: 'final_whatsapp_text',
            value:
              "={{ $('Code in JavaScript1').item.json.final_whatsapp_text || $('Code in JavaScript1').item.json.outbound_message || '' }}",
            type: 'string',
          },
          {
            id: newId(),
            name: 'tool_chosen',
            value: "={{ $('Code in JavaScript1').item.json.tool_chosen || 'NONE' }}",
            type: 'string',
          },
          {
            id: newId(),
            name: 'action',
            value: "={{ $('Code in JavaScript1').item.json.action || 'RUN_TOOL' }}",
            type: 'string',
          },
          {
            id: newId(),
            name: 'current_state',
            value: "={{ $('actualizar contexto1').item.json.current_state || $('Get Context-conversations1').item.json.current_state || null }}",
            type: 'string',
          },
          {
            id: newId(),
            name: 'agente_activo',
            value: "={{ $('actualizar contexto1').item.json.agente_activo }}",
            type: 'boolean',
          },
          {
            id: newId(),
            name: 'current_state_changed',
            value: "={{ $('Code in JavaScript1').item.json.current_state_changed === true }}",
            type: 'boolean',
          },
          {
            id: newId(),
            name: 'send_to_customer',
            value:
              "={{ Boolean(String($('Code in JavaScript1').item.json.outbound_message || $('Code in JavaScript1').item.json.final_whatsapp_text || '').trim()) }}",
            type: 'boolean',
          },
        ],
      },
      options: {},
    },
    id: newId(),
    name: 'Engine Result',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [928, 336],
  };
}

function patchGetContextQuery(query) {
  let next = String(query || '');

  next = next.replace(
    "chatwoot_id = coalesce(excluded.chatwoot_id, public.conversations.chatwoot_id),",
    `chatwoot_id = case
    when excluded.chatwoot_id is null then public.conversations.chatwoot_id
    when public.conversations.chatwoot_id is null then excluded.chatwoot_id
    when public.conversations.chatwoot_id = excluded.chatwoot_id then public.conversations.chatwoot_id
    when public.conversations.agente_activo = false then excluded.chatwoot_id
    else public.conversations.chatwoot_id
  end,`,
  );

  next = next.replace("'channel', 'CHAT'", "'channel', 'WHATSAPP'");
  return next;
}

function patchCodeNode(node) {
  const code = String(node.parameters.jsCode || '');
  if (code.includes("name: 'chatwoot_id'")) return;

  node.parameters.jsCode = code.replace(
    /conversation_key:\s*parsed\?\.tool_input\?\.context\?\.conversation\?\.id\s*\|\|\s*\$\('Merge Sets1'\)\.item\.json\.conversation_key,/,
    `chatwoot_id:
        $('Get Context-conversations1').item.json.chatwoot_id || $('Merge Sets1').item.json.chatwoot_id || null,
      conversation_key:
        parsed?.tool_input?.context?.conversation?.id || $('Merge Sets1').item.json.conversation_key,`,
  );
}

function patchEngineWorkflow(workflow) {
  workflow.name = ENGINE_WORKFLOW_NAME;
  workflow.settings = {
    ...(workflow.settings || {}),
    timezone: 'America/Bogota',
  };

  removeNode(workflow, 'When chat message received');
  removeNode(workflow, 'Chat');

  const engineTrigger = {
    parameters: {
      inputSource: 'passthrough',
    },
    id: newId(),
    name: 'When engine is called',
    type: 'n8n-nodes-base.executeWorkflowTrigger',
    typeVersion: 1.1,
    position: [-4096, 160],
  };

  if (!findNode(workflow, 'When engine is called')) {
    workflow.nodes.push(engineTrigger);
  }

  const engineResult = findNode(workflow, 'Engine Result') || engineResultNode();
  if (!findNode(workflow, 'Engine Result')) {
    workflow.nodes.push(engineResult);
  }

  const config = findNode(workflow, 'config');
  setAssignment(
    config,
    'current_message',
    "={{ String($json.chatInput || $json.current_message || $json.text || '').trim() }}",
  );
  setAssignment(
    config,
    'conversation_key',
    "={{ String($json.wa_id || $json.phone || $json.sessionId || $json.conversationId || $json.metadata?.conversationKey || $json.metadata?.conversation_id || $json.metadata?.wa_id || $json.metadata?.chatId || $execution.id) }}",
  );
  setAssignment(
    config,
    'client_name',
    "={{ $json.client_name || $json.metadata?.client_name || $json.metadata?.name || $json.metadata?.user?.name || null }}",
  );
  setAssignment(
    config,
    'chatwoot_id',
    "={{ $json.chatwoot_id || $json.metadata?.chatwoot_id || null }}",
  );
  setAssignment(config, 'message_type', "={{ $json.message_type || 'TEXT' }}");

  const getContext = findNode(workflow, 'Get Context-conversations1');
  getContext.parameters.query = patchGetContextQuery(getContext.parameters.query);

  const codeNode = findNode(workflow, 'Code in JavaScript1');
  patchCodeNode(codeNode);

  replaceMainConnection(workflow.connections, 'When engine is called', 'Filtro Mensajes');
  replaceMainConnection(workflow.connections, 'actualizar contexto1', 'If3');
  replaceMainConnection(workflow.connections, 'Agregar follow on', 'Engine Result');

  return workflow;
}

function normalizeChatwootCode() {
  return `const payload = $json.body && typeof $json.body === 'object' ? $json.body : ($json || {});

const digitsOnly = (value) => String(value || '').replace(/\\D+/g, '').trim();
const compact = (value) => String(value || '').trim();

const content =
  compact(payload.content) ||
  compact(payload.message?.content) ||
  compact(payload.message_content);

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
];

const waId = phoneCandidates.map(digitsOnly).find(Boolean) || '';
const senderType = String(
  payload.sender?.type ||
    payload.sender_type ||
    payload.conversation?.meta?.sender?.type ||
    '',
).toLowerCase();
const messageType = String(payload.message_type || '').toLowerCase();
const event = String(payload.event || '').toLowerCase();
const privateMessage = payload.private === true;

const incoming =
  messageType === 'incoming' ||
  messageType === '0' ||
  senderType === 'contact' ||
  payload.incoming === true;

let ignoreReason = null;

if (event && event !== 'message_created') {
  ignoreReason = 'unsupported_event';
} else if (privateMessage) {
  ignoreReason = 'private_message';
} else if (!incoming) {
  ignoreReason = 'not_incoming_customer_message';
} else if (!content) {
  ignoreReason = 'empty_content';
} else if (!waId) {
  ignoreReason = 'missing_phone_number';
} else if (!conversationId) {
  ignoreReason = 'missing_chatwoot_conversation_id';
}

return [
  {
    json: {
      eligible: ignoreReason === null,
      ignore_reason: ignoreReason,
      event: event || 'message_created',
      chatInput: content,
      chatwoot_id: conversationId ? String(conversationId) : null,
      chatwoot_status: conversationStatus ? String(conversationStatus) : null,
      wa_id: waId,
      client_name:
        payload.contact?.name ||
        payload.sender?.name ||
        payload.conversation?.meta?.sender?.name ||
        null,
      private: privateMessage,
      sender_type: senderType || null,
      raw: payload,
      message_type: 'TEXT',
    },
  },
];`;
}

function resolveThreadPolicyQuery() {
  return `with incoming as (
  select {{ "'" + String($('Normalize Chatwoot Event').item.json.wa_id || '').replace(/'/g, "''") + "'" }}::text as wa_id
)
select
  i.wa_id as incoming_wa_id,
  c.wa_id,
  c.chatwoot_id,
  c.agente_activo,
  c.current_state
from incoming i
left join public.conversations c on c.wa_id = i.wa_id
limit 1;`;
}

function resolveThreadPolicyCode() {
  return `const normalized = $('Normalize Chatwoot Event').item.json;
const existing = $json || {};

const incomingChatwootId = String(normalized.chatwoot_id || '');
const storedChatwootId = existing.chatwoot_id ? String(existing.chatwoot_id) : null;
let allow = false;
let ignoreReason = normalized.ignore_reason || null;

if (!ignoreReason) {
  if (!incomingChatwootId) {
    ignoreReason = 'missing_chatwoot_id';
  } else if (!storedChatwootId) {
    allow = true;
  } else if (storedChatwootId === incomingChatwootId) {
    allow = true;
  } else if (existing.agente_activo === false) {
    allow = true;
  } else {
    ignoreReason = 'thread_conflict_active_chatwoot_conversation';
  }
}

return [
  {
    json: {
      ...normalized,
      allow_automation: allow,
      ignore_reason: ignoreReason,
      stored_chatwoot_id: storedChatwootId,
    },
  },
];`;
}

function outboundSenderWorkflowDefinition() {
  return {
    name: CHATWOOT_OUTBOUND_NAME,
    nodes: [
      {
        parameters: {
          inputSource: 'passthrough',
        },
        id: newId(),
        name: 'When outbound sender is called',
        type: 'n8n-nodes-base.executeWorkflowTrigger',
        typeVersion: 1.1,
        position: [240, 240],
      },
      {
        parameters: {
          method: 'POST',
          url:
            `={{ (${JSON.stringify(CHATWOOT_BASE_URL)}).replace(/\\/$/, '') + '/api/v1/accounts/' + String($json.chatwoot_account_id || ${JSON.stringify(CHATWOOT_ACCOUNT_ID)}) + '/conversations/' + String($json.chatwoot_id) + '/messages' }}`,
          sendHeaders: true,
          headerParameters: {
            parameters: [
              {
                name: 'api_access_token',
                value: `={{ $json.chatwoot_api_token || ${JSON.stringify(CHATWOOT_API_TOKEN)} }}`,
              },
              {
                name: 'content-type',
                value: 'application/json',
              },
            ],
          },
          sendBody: true,
          specifyBody: 'json',
          jsonBody:
            `={{ JSON.stringify({ content: String($json.message || $json.outbound_message || $json.final_whatsapp_text || '').trim(), message_type: 'outgoing', private: $json.private === true }) }}`,
          options: {},
        },
        id: newId(),
        name: 'Send Chatwoot message',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [528, 240],
      },
      {
        parameters: {
          assignments: {
            assignments: [
              {
                id: newId(),
                name: 'ok',
                value: true,
                type: 'boolean',
              },
              {
                id: newId(),
                name: 'chatwoot_id',
                value: "={{ $('When outbound sender is called').item.json.chatwoot_id }}",
                type: 'string',
              },
              {
                id: newId(),
                name: 'message',
                value:
                  "={{ $('When outbound sender is called').item.json.message || $('When outbound sender is called').item.json.outbound_message || $('When outbound sender is called').item.json.final_whatsapp_text || '' }}",
                type: 'string',
              },
              {
                id: newId(),
                name: 'response',
                value: '={{ $json }}',
                type: 'object',
              },
            ],
          },
          options: {},
        },
        id: newId(),
        name: 'Outbound send result',
        type: 'n8n-nodes-base.set',
        typeVersion: 3.4,
        position: [768, 240],
      },
    ],
    connections: {
      'When outbound sender is called': {
        main: [[{ node: 'Send Chatwoot message', type: 'main', index: 0 }]],
      },
      'Send Chatwoot message': {
        main: [[{ node: 'Outbound send result', type: 'main', index: 0 }]],
      },
      'Outbound send result': {
        main: [[]],
      },
    },
    settings: {
      executionOrder: 'v1',
      timezone: 'America/Bogota',
    },
  };
}

function chatwootInboundWorkflowDefinition(engineWorkflowId, outboundWorkflowId) {
  return {
    name: CHATWOOT_INBOUND_NAME,
    nodes: [
      {
        parameters: {
          httpMethod: 'POST',
          path: CHATWOOT_INBOUND_WEBHOOK_PATH,
          responseMode: 'onReceived',
          responseData: 'noData',
          options: {},
        },
        id: newId(),
        name: 'Chatwoot Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2.1,
        position: [208, 240],
        webhookId: newId(),
      },
      {
        parameters: {
          jsCode: normalizeChatwootCode(),
        },
        id: newId(),
        name: 'Normalize Chatwoot Event',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [464, 240],
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
                leftValue: "={{ $json.eligible === true }}",
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
        name: 'Eligible inbound event?',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.3,
        position: [704, 240],
      },
      {
        parameters: {
          operation: 'executeQuery',
          query: resolveThreadPolicyQuery(),
          options: {},
        },
        id: newId(),
        name: 'Resolve existing phone mapping',
        type: 'n8n-nodes-base.postgres',
        typeVersion: 2,
        position: [944, 128],
        credentials: {
          postgres: {
            id: 'CKoiBGlPXq82taIc',
            name: 'Postgres account',
          },
        },
      },
      {
        parameters: {
          jsCode: resolveThreadPolicyCode(),
        },
        id: newId(),
        name: 'Resolve thread policy',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [1184, 128],
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
                leftValue: "={{ $json.allow_automation === true }}",
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
        name: 'Allow automation?',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.3,
        position: [1424, 128],
      },
      {
        parameters: {
          workflowId: rlWorkflowRef(engineWorkflowId, ENGINE_WORKFLOW_NAME),
          workflowInputs: {
            mappingMode: 'defineBelow',
            value: {},
            matchingColumns: [],
            schema: [
              {
                id: newId(),
                displayName: 'chatInput',
                required: false,
                defaultMatch: false,
                display: true,
                canBeUsedToMatch: true,
                type: 'string',
                removed: false,
                stringValue: "={{ $('Resolve thread policy').item.json.chatInput }}",
              },
              {
                id: newId(),
                displayName: 'wa_id',
                required: false,
                defaultMatch: false,
                display: true,
                canBeUsedToMatch: true,
                type: 'string',
                removed: false,
                stringValue: "={{ $('Resolve thread policy').item.json.wa_id }}",
              },
              {
                id: newId(),
                displayName: 'chatwoot_id',
                required: false,
                defaultMatch: false,
                display: true,
                canBeUsedToMatch: true,
                type: 'string',
                removed: false,
                stringValue: "={{ $('Resolve thread policy').item.json.chatwoot_id }}",
              },
              {
                id: newId(),
                displayName: 'client_name',
                required: false,
                defaultMatch: false,
                display: true,
                canBeUsedToMatch: true,
                type: 'string',
                removed: false,
                stringValue: "={{ $('Resolve thread policy').item.json.client_name }}",
              },
              {
                id: newId(),
                displayName: 'message_type',
                required: false,
                defaultMatch: false,
                display: true,
                canBeUsedToMatch: true,
                type: 'string',
                removed: false,
                stringValue: 'TEXT',
              },
            ],
            attemptToConvertTypes: false,
            convertFieldsToString: false,
          },
          options: {},
        },
        id: newId(),
        name: 'Run sales engine',
        type: 'n8n-nodes-base.executeWorkflow',
        typeVersion: 1.2,
        position: [1664, 128],
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
                leftValue: "={{ $json.send_to_customer === true }}",
                rightValue: '',
                operator: {
                  type: 'boolean',
                  operation: 'true',
                  singleValue: true,
                },
              },
              {
                id: newId(),
                leftValue: "={{ Boolean($json.chatwoot_id) }}",
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
        name: 'Should send outbound?',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.3,
        position: [1904, 128],
      },
      {
        parameters: {
          workflowId: rlWorkflowRef(outboundWorkflowId, CHATWOOT_OUTBOUND_NAME),
          workflowInputs: {
            mappingMode: 'defineBelow',
            value: {},
            matchingColumns: [],
            schema: [
              {
                id: newId(),
                displayName: 'chatwoot_id',
                required: false,
                defaultMatch: false,
                display: true,
                canBeUsedToMatch: true,
                type: 'string',
                removed: false,
                stringValue: '={{ $json.chatwoot_id }}',
              },
              {
                id: newId(),
                displayName: 'message',
                required: false,
                defaultMatch: false,
                display: true,
                canBeUsedToMatch: true,
                type: 'string',
                removed: false,
                stringValue: '={{ $json.outbound_message }}',
              },
              {
                id: newId(),
                displayName: 'private',
                required: false,
                defaultMatch: false,
                display: true,
                canBeUsedToMatch: true,
                type: 'boolean',
                removed: false,
                boolValue: false,
              },
            ],
            attemptToConvertTypes: false,
            convertFieldsToString: false,
          },
          options: {},
        },
        id: newId(),
        name: 'Send outbound via Chatwoot',
        type: 'n8n-nodes-base.executeWorkflow',
        typeVersion: 1.2,
        position: [2144, 48],
      },
      {
        parameters: {
          assignments: {
            assignments: [
              {
                id: newId(),
                name: 'ok',
                value: true,
                type: 'boolean',
              },
              {
                id: newId(),
                name: 'processed',
                value: true,
                type: 'boolean',
              },
              {
                id: newId(),
                name: 'wa_id',
                value: "={{ $('Resolve thread policy').item.json.wa_id }}",
                type: 'string',
              },
              {
                id: newId(),
                name: 'chatwoot_id',
                value: "={{ $('Resolve thread policy').item.json.chatwoot_id }}",
                type: 'string',
              },
              {
                id: newId(),
                name: 'sent',
                value: "={{ $('Should send outbound?').item.json.send_to_customer === true && Boolean($('Should send outbound?').item.json.chatwoot_id) }}",
                type: 'boolean',
              },
            ],
          },
          options: {},
        },
        id: newId(),
        name: 'Webhook ACK',
        type: 'n8n-nodes-base.set',
        typeVersion: 3.4,
        position: [2384, 128],
      },
      {
        parameters: {
          assignments: {
            assignments: [
              {
                id: newId(),
                name: 'ok',
                value: true,
                type: 'boolean',
              },
              {
                id: newId(),
                name: 'processed',
                value: false,
                type: 'boolean',
              },
              {
                id: newId(),
                name: 'reason',
                value: "={{ $json.ignore_reason || 'ignored' }}",
                type: 'string',
              },
              {
                id: newId(),
                name: 'wa_id',
                value: "={{ $json.wa_id || null }}",
                type: 'string',
              },
              {
                id: newId(),
                name: 'chatwoot_id',
                value: "={{ $json.chatwoot_id || null }}",
                type: 'string',
              },
            ],
          },
          options: {},
        },
        id: newId(),
        name: 'Webhook Ignored',
        type: 'n8n-nodes-base.set',
        typeVersion: 3.4,
        position: [944, 416],
      },
    ],
    connections: {
      'Chatwoot Webhook': {
        main: [[{ node: 'Normalize Chatwoot Event', type: 'main', index: 0 }]],
      },
      'Normalize Chatwoot Event': {
        main: [[{ node: 'Eligible inbound event?', type: 'main', index: 0 }]],
      },
      'Eligible inbound event?': {
        main: [
          [{ node: 'Resolve existing phone mapping', type: 'main', index: 0 }],
          [{ node: 'Webhook Ignored', type: 'main', index: 0 }],
        ],
      },
      'Resolve existing phone mapping': {
        main: [[{ node: 'Resolve thread policy', type: 'main', index: 0 }]],
      },
      'Resolve thread policy': {
        main: [[{ node: 'Allow automation?', type: 'main', index: 0 }]],
      },
      'Allow automation?': {
        main: [
          [{ node: 'Run sales engine', type: 'main', index: 0 }],
          [{ node: 'Webhook Ignored', type: 'main', index: 0 }],
        ],
      },
      'Run sales engine': {
        main: [[{ node: 'Should send outbound?', type: 'main', index: 0 }]],
      },
      'Should send outbound?': {
        main: [
          [{ node: 'Send outbound via Chatwoot', type: 'main', index: 0 }],
          [{ node: 'Webhook ACK', type: 'main', index: 0 }],
        ],
      },
      'Send outbound via Chatwoot': {
        main: [[{ node: 'Webhook ACK', type: 'main', index: 0 }]],
      },
      'Webhook ACK': {
        main: [[]],
      },
      'Webhook Ignored': {
        main: [[]],
      },
    },
    settings: {
      executionOrder: 'v1',
      timezone: 'America/Bogota',
    },
  };
}

function simulatorAdapterWorkflowDefinition(engineWorkflowId) {
  return {
    name: SIMULATOR_ADAPTER_NAME,
    nodes: [
      {
        parameters: {
          httpMethod: 'POST',
          path: SIMULATOR_WEBHOOK_PATH,
          responseMode: 'lastNode',
          responseData: 'firstEntryJson',
          options: {},
        },
        id: newId(),
        name: 'Simulator Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2.1,
        position: [208, 240],
        webhookId: newId(),
      },
      {
        parameters: {
          jsCode: `const payload = $json.body && typeof $json.body === 'object' ? $json.body : ($json || {});
const digitsOnly = (value) => String(value || '').replace(/\\D+/g, '').trim();
const waId = digitsOnly(payload.wa_id || payload.phone || payload.conversationId || payload.sessionId);
const chatInput = String(payload.chatInput || payload.text || '').trim();
const clientName = String(payload.client_name || payload.clientName || waId || '').trim() || null;

if (!waId || !chatInput) {
  return [
    {
      json: {
        valid: false,
        error: 'wa_id and text are required',
        wa_id: waId || null,
      },
    },
  ];
}

return [
  {
    json: {
      valid: true,
      wa_id: waId,
      chatInput,
      client_name: clientName,
      message_type: 'TEXT',
      chatwoot_id: payload.chatwoot_id || null,
    },
  },
];`,
        },
        id: newId(),
        name: 'Normalize simulator payload',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [464, 240],
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
                leftValue: '={{ $json.valid === true }}',
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
        name: 'Valid simulator request?',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.3,
        position: [704, 240],
      },
      {
        parameters: {
          workflowId: rlWorkflowRef(engineWorkflowId, ENGINE_WORKFLOW_NAME),
          workflowInputs: {
            mappingMode: 'defineBelow',
            value: {},
            matchingColumns: [],
            schema: [
              {
                id: newId(),
                displayName: 'chatInput',
                required: false,
                defaultMatch: false,
                display: true,
                canBeUsedToMatch: true,
                type: 'string',
                removed: false,
                stringValue: '={{ $json.chatInput }}',
              },
              {
                id: newId(),
                displayName: 'wa_id',
                required: false,
                defaultMatch: false,
                display: true,
                canBeUsedToMatch: true,
                type: 'string',
                removed: false,
                stringValue: '={{ $json.wa_id }}',
              },
              {
                id: newId(),
                displayName: 'chatwoot_id',
                required: false,
                defaultMatch: false,
                display: true,
                canBeUsedToMatch: true,
                type: 'string',
                removed: false,
                stringValue: '={{ $json.chatwoot_id }}',
              },
              {
                id: newId(),
                displayName: 'client_name',
                required: false,
                defaultMatch: false,
                display: true,
                canBeUsedToMatch: true,
                type: 'string',
                removed: false,
                stringValue: '={{ $json.client_name }}',
              },
              {
                id: newId(),
                displayName: 'message_type',
                required: false,
                defaultMatch: false,
                display: true,
                canBeUsedToMatch: true,
                type: 'string',
                removed: false,
                stringValue: 'TEXT',
              },
            ],
            attemptToConvertTypes: false,
            convertFieldsToString: false,
          },
          options: {},
        },
        id: newId(),
        name: 'Run sales engine',
        type: 'n8n-nodes-base.executeWorkflow',
        typeVersion: 1.2,
        position: [944, 160],
      },
      {
        parameters: {
          assignments: {
            assignments: [
              {
                id: newId(),
                name: 'ok',
                value: true,
                type: 'boolean',
              },
              {
                id: newId(),
                name: 'wa_id',
                value: '={{ $json.wa_id }}',
                type: 'string',
              },
              {
                id: newId(),
                name: 'replyText',
                value: "={{ $json.outbound_message || $json.final_whatsapp_text || '' }}",
                type: 'string',
              },
              {
                id: newId(),
                name: 'toolChosen',
                value: "={{ $json.tool_chosen || 'NONE' }}",
                type: 'string',
              },
              {
                id: newId(),
                name: 'action',
                value: "={{ $json.action || 'RUN_TOOL' }}",
                type: 'string',
              },
              {
                id: newId(),
                name: 'stateAfter',
                value: "={{ $json.current_state || null }}",
                type: 'string',
              },
              {
                id: newId(),
                name: 'agenteActivo',
                value: '={{ $json.agente_activo }}',
                type: 'boolean',
              },
            ],
          },
          options: {},
        },
        id: newId(),
        name: 'Simulator response',
        type: 'n8n-nodes-base.set',
        typeVersion: 3.4,
        position: [1184, 160],
      },
      {
        parameters: {
          assignments: {
            assignments: [
              {
                id: newId(),
                name: 'ok',
                value: false,
                type: 'boolean',
              },
              {
                id: newId(),
                name: 'error',
                value: "={{ $json.error || 'invalid_request' }}",
                type: 'string',
              },
            ],
          },
          options: {},
        },
        id: newId(),
        name: 'Simulator error',
        type: 'n8n-nodes-base.set',
        typeVersion: 3.4,
        position: [944, 416],
      },
    ],
    connections: {
      'Simulator Webhook': {
        main: [[{ node: 'Normalize simulator payload', type: 'main', index: 0 }]],
      },
      'Normalize simulator payload': {
        main: [[{ node: 'Valid simulator request?', type: 'main', index: 0 }]],
      },
      'Valid simulator request?': {
        main: [
          [{ node: 'Run sales engine', type: 'main', index: 0 }],
          [{ node: 'Simulator error', type: 'main', index: 0 }],
        ],
      },
      'Run sales engine': {
        main: [[{ node: 'Simulator response', type: 'main', index: 0 }]],
      },
      'Simulator response': {
        main: [[]],
      },
      'Simulator error': {
        main: [[]],
      },
    },
    settings: {
      executionOrder: 'v1',
      timezone: 'America/Bogota',
    },
  };
}

function schedulerWorkflowDefinition(outboundWorkflowId) {
  return {
    name: SCHEDULER_NAME,
    nodes: [
      {
        parameters: {
          rule: {
            interval: [
              {
                field: 'minutes',
                minutesInterval: 30,
              },
            ],
          },
        },
        id: newId(),
        name: 'Every 30 minutes',
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2,
        position: [208, 240],
      },
      {
        parameters: {
          operation: 'executeQuery',
          query: `update public.follow_on f
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
returning f.id;`,
          options: {},
        },
        id: newId(),
        name: 'Cancel ineligible follow on',
        type: 'n8n-nodes-base.postgres',
        typeVersion: 2,
        position: [464, 240],
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
          query: `select
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
order by f.scheduled_for asc;`,
          options: {},
        },
        id: newId(),
        name: 'Select due follow on',
        type: 'n8n-nodes-base.postgres',
        typeVersion: 2,
        position: [704, 240],
        credentials: {
          postgres: {
            id: 'CKoiBGlPXq82taIc',
            name: 'Postgres account',
          },
        },
      },
      {
        parameters: {
          options: {},
        },
        id: newId(),
        name: 'Loop due follow on',
        type: 'n8n-nodes-base.splitInBatches',
        typeVersion: 3,
        position: [944, 240],
      },
      {
        parameters: {
          workflowId: rlWorkflowRef(outboundWorkflowId, CHATWOOT_OUTBOUND_NAME),
          workflowInputs: {
            mappingMode: 'defineBelow',
            value: {},
            matchingColumns: [],
            schema: [
              {
                id: newId(),
                displayName: 'chatwoot_id',
                required: false,
                defaultMatch: false,
                display: true,
                canBeUsedToMatch: true,
                type: 'string',
                removed: false,
                stringValue: '={{ $json.chatwoot_id }}',
              },
              {
                id: newId(),
                displayName: 'message',
                required: false,
                defaultMatch: false,
                display: true,
                canBeUsedToMatch: true,
                type: 'string',
                removed: false,
                stringValue: '={{ $json.message }}',
              },
              {
                id: newId(),
                displayName: 'private',
                required: false,
                defaultMatch: false,
                display: true,
                canBeUsedToMatch: true,
                type: 'boolean',
                removed: false,
                boolValue: false,
              },
            ],
            attemptToConvertTypes: false,
            convertFieldsToString: false,
          },
          options: {},
        },
        id: newId(),
        name: 'Send follow on via Chatwoot',
        type: 'n8n-nodes-base.executeWorkflow',
        typeVersion: 1.2,
        position: [1184, 240],
      },
      {
        parameters: {
          operation: 'executeQuery',
          query: `with marked as (
  update public.follow_on
  set
    status = 'enviada',
    sent_at = now(),
    updated_at = now()
  where id = {{ Number($('Loop due follow on').item.json.id) }}
    and status = 'pendiente'
  returning id, conversation_id
),
inserted_message as (
  insert into public.messages (
    conversation_id,
    direction,
    message_type,
    content,
    media_url,
    state_at_time,
    agent_used,
    extracted_data
  )
  select
    m.conversation_id,
    'OUTBOUND',
    'TEXT',
    {{ "'" + String($('Loop due follow on').item.json.message).replace(/'/g, "''") + "'" }},
    null,
    {{ "'" + String($('Loop due follow on').item.json.current_state || 'QUALIFYING').replace(/'/g, "''") + "'" }},
    'follow_on_scheduler',
    '{}'::jsonb
  from marked m
  returning conversation_id
)
update public.conversations
set
  last_interaction = now(),
  last_message_from = 'AGENT',
  updated_at = now(),
  next_followup_at = null,
  followup_count = coalesce(followup_count, 0) + 1
where wa_id = (
  select conversation_id
  from marked
  limit 1
)
returning wa_id;`,
          options: {},
        },
        id: newId(),
        name: 'Mark follow on sent',
        type: 'n8n-nodes-base.postgres',
        typeVersion: 2,
        position: [1424, 240],
        credentials: {
          postgres: {
            id: 'CKoiBGlPXq82taIc',
            name: 'Postgres account',
          },
        },
      },
    ],
    connections: {
      'Every 30 minutes': {
        main: [[{ node: 'Cancel ineligible follow on', type: 'main', index: 0 }]],
      },
      'Cancel ineligible follow on': {
        main: [[{ node: 'Select due follow on', type: 'main', index: 0 }]],
      },
      'Select due follow on': {
        main: [[{ node: 'Loop due follow on', type: 'main', index: 0 }]],
      },
      'Loop due follow on': {
        main: [
          [{ node: 'Send follow on via Chatwoot', type: 'main', index: 0 }],
          [],
        ],
      },
      'Send follow on via Chatwoot': {
        main: [[{ node: 'Mark follow on sent', type: 'main', index: 0 }]],
      },
      'Mark follow on sent': {
        main: [[{ node: 'Loop due follow on', type: 'main', index: 0 }]],
      },
    },
    settings: {
      executionOrder: 'v1',
      timezone: 'America/Bogota',
    },
  };
}

async function findWorkflowByName(name) {
  const payload = await api('/api/v1/workflows?limit=200');
  const workflows = Array.isArray(payload?.data) ? payload.data : [];
  return workflows.find((item) => item.name === name) || null;
}

async function upsertWorkflowByName(definition, existingId = null) {
  let existing = null;
  if (existingId) {
    existing = await api(`/api/v1/workflows/${existingId}`);
  } else {
    const found = await findWorkflowByName(definition.name);
    if (found) existing = await api(`/api/v1/workflows/${found.id}`);
  }

  if (existing) {
    const wasActive = existing.active === true;
    if (wasActive) {
      await api(`/api/v1/workflows/${existing.id}/deactivate`, { method: 'POST' });
    }
    const updated = await api(`/api/v1/workflows/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: definition.name,
        nodes: definition.nodes,
        connections: definition.connections,
        settings: sanitizeWorkflowSettings(definition.settings),
      }),
    });
    if (wasActive || definition.activate === true) {
      await api(`/api/v1/workflows/${existing.id}/activate`, { method: 'POST' });
    }
    return { id: existing.id, versionId: updated.versionId, created: false };
  }

  const created = await api('/api/v1/workflows', {
    method: 'POST',
    body: JSON.stringify({
      name: definition.name,
      nodes: definition.nodes,
      connections: definition.connections,
      settings: sanitizeWorkflowSettings(definition.settings),
    }),
  });
  await api(`/api/v1/workflows/${created.id}/activate`, { method: 'POST' });
  return { id: created.id, versionId: created.versionId, created: true };
}

async function main() {
  const mainWorkflow = await api(`/api/v1/workflows/${MAIN_WORKFLOW_ID}`);
  const engineWasActive = mainWorkflow.active === true;
  patchEngineWorkflow(mainWorkflow);

  if (engineWasActive) {
    await api(`/api/v1/workflows/${MAIN_WORKFLOW_ID}/deactivate`, { method: 'POST' });
  }

  const updatedEngine = await api(`/api/v1/workflows/${MAIN_WORKFLOW_ID}`, {
    method: 'PUT',
    body: JSON.stringify(sanitizeWorkflowForUpdate(mainWorkflow)),
  });

  await api(`/api/v1/workflows/${MAIN_WORKFLOW_ID}/activate`, { method: 'POST' });

  const outbound = await upsertWorkflowByName(outboundSenderWorkflowDefinition());
  const inbound = await upsertWorkflowByName(chatwootInboundWorkflowDefinition(MAIN_WORKFLOW_ID, outbound.id));
  const simulatorAdapter = await upsertWorkflowByName(simulatorAdapterWorkflowDefinition(MAIN_WORKFLOW_ID));
  const scheduler = await upsertWorkflowByName(schedulerWorkflowDefinition(outbound.id));

  await fs.writeFile(path.resolve('current_workflow.json'), JSON.stringify(await api(`/api/v1/workflows/${MAIN_WORKFLOW_ID}`), null, 2));
  await fs.writeFile(path.resolve('chatwoot_inbound_workflow.json'), JSON.stringify(await api(`/api/v1/workflows/${inbound.id}`), null, 2));
  await fs.writeFile(path.resolve('chatwoot_outbound_sender_workflow.json'), JSON.stringify(await api(`/api/v1/workflows/${outbound.id}`), null, 2));
  await fs.writeFile(path.resolve('simulator_adapter_workflow.json'), JSON.stringify(await api(`/api/v1/workflows/${simulatorAdapter.id}`), null, 2));
  await fs.writeFile(path.resolve('follow_on_scheduler_workflow.json'), JSON.stringify(await api(`/api/v1/workflows/${scheduler.id}`), null, 2));

  console.log(
    JSON.stringify(
      {
        engine: {
          id: MAIN_WORKFLOW_ID,
          versionId: updatedEngine.versionId,
          name: ENGINE_WORKFLOW_NAME,
        },
        chatwootInbound: {
          id: inbound.id,
          webhook: `${CHATWOOT_BASE_URL.replace('chatwoot-9qe1j-u48275.vm.elestio.app', 'rh-n8n-u48275.vm.elestio.app')}/webhook/${CHATWOOT_INBOUND_WEBHOOK_PATH}`,
        },
        chatwootOutbound: {
          id: outbound.id,
        },
        simulatorAdapter: {
          id: simulatorAdapter.id,
          webhook: `${N8N_BASE_URL}/webhook/${SIMULATOR_WEBHOOK_PATH}`,
        },
        scheduler: {
          id: scheduler.id,
        },
      },
      null,
      2,
    ),
  );
}

await main();
