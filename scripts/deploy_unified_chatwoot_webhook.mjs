import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';

dotenv.config({ path: path.resolve('.env') });

const MAIN_WORKFLOW_ID = process.argv[2] || process.env.SIMULATOR_WORKFLOW_ID || 'RrIniaNJCUC72nfI';
const OUTBOUND_WORKFLOW_ID = process.argv[3] || 'pLyrdDO3mneaCp7m';
const CHATWOOT_INBOUND_WORKFLOW_ID = process.argv[4] || '6q5tiU8ifk9N0whF';
const SIMULATOR_ADAPTER_WORKFLOW_ID = process.argv[5] || 'xxMqwcxLFXkcFpDx';

const N8N_BASE_URL = process.env.N8N_BASE_URL;
const N8N_API_KEY = process.env.N8N_PUBLIC_API_TOKEN;
const CHATWOOT_INBOUND_WEBHOOK_PATH = process.env.CHATWOOT_INBOUND_WEBHOOK_PATH || 'chatwoot/de-paseo-en-fincas/inbound';

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

function patchIfLoopNode(node) {
  if (!node) return;
  node.parameters = {
    ...(node.parameters || {}),
    conditions: {
      options: {
        caseSensitive: true,
        leftValue: '',
        typeValidation: 'loose',
        version: 3,
      },
      conditions: [
        {
          id:
            node.parameters?.conditions?.conditions?.[0]?.id ||
            '21eae4b3-b997-4c6a-aa4a-343ef68ead51',
          leftValue: "={{ $('Code in JavaScript1').item.json.should_immediate_loop === true }}",
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
  };
}

function inboundWebhookNode(existing) {
  return {
    parameters: {
      httpMethod: 'POST',
      path: CHATWOOT_INBOUND_WEBHOOK_PATH,
      responseMode: 'lastNode',
      responseData: 'firstEntryJson',
      options: {},
    },
    id: existing?.id || '9dcb7d3e-9b19-4fe5-a4e9-ff60f9f90e26',
    name: 'Inbound Webhook',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2.1,
    position: [-4096, 160],
    webhookId: existing?.webhookId || '5e58f6d7-df3c-4d65-b442-a557f1221884',
  };
}

function normalizeInboundNode(existing) {
  return {
    parameters: {
      jsCode: `const payload = $json.body && typeof $json.body === 'object' ? $json.body : ($json || {});
const digitsOnly = (value) => String(value || '').replace(/\\D+/g, '').trim();
const compact = (value) => String(value || '').trim();

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
        eligible: Boolean(waId && chatInput),
        ignore_reason: waId && chatInput ? null : 'missing_wa_id_or_text',
        chatInput,
        chatwoot_id: payload.chatwoot_id || null,
        chatwoot_status: null,
        wa_id: waId,
        client_name: compact(payload.client_name || payload.clientName || waId) || null,
        message_type: 'TEXT',
      },
    },
  ];
}

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
      source: 'chatwoot',
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
    },
  },
];`,
    },
    id: existing?.id || 'dc55b447-c09b-4da6-907b-e80a61c6ae7b',
    name: 'Normalize inbound payload',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-3856, 160],
  };
}

function resolveMappingNode(existing) {
  return {
    parameters: {
      operation: 'executeQuery',
      query: `with incoming as (
  select {{ "'" + String($('Normalize inbound payload').item.json.wa_id || '').replace(/'/g, "''") + "'" }}::text as wa_id
)
select
  i.wa_id as incoming_wa_id,
  c.wa_id,
  c.chatwoot_id,
  c.agente_activo,
  c.current_state
from incoming i
left join public.conversations c on c.wa_id = i.wa_id
limit 1;`,
      options: {},
    },
    id: existing?.id || '9eb2d43f-97bb-461b-a6f4-4f6dc4f105f1',
    name: 'Resolve existing phone mapping',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2,
    position: [-3616, 160],
    credentials: {
      postgres: {
        id: 'CKoiBGlPXq82taIc',
        name: 'Postgres account',
      },
    },
  };
}

function resolveThreadPolicyNode(existing) {
  return {
    parameters: {
      jsCode: `const normalized = $('Normalize inbound payload').item.json;
const existing = $json || {};

let allow = false;
let ignoreReason = normalized.ignore_reason || null;

if (normalized.source === 'simulator') {
  allow = normalized.eligible === true;
} else {
  const incomingChatwootId = String(normalized.chatwoot_id || '');
  const storedChatwootId = existing.chatwoot_id ? String(existing.chatwoot_id) : null;

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
}

return [
  {
    json: {
      ...normalized,
      allow_automation: allow,
      ignore_reason: ignoreReason,
      stored_chatwoot_id: existing.chatwoot_id ? String(existing.chatwoot_id) : null,
    },
  },
];`,
    },
    id: existing?.id || 'b6e8ece8-d0cd-426b-a149-da4b490f205a',
    name: 'Resolve thread policy',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-3376, 160],
  };
}

function allowAutomationNode(existing) {
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
            id: '6ad6db74-d151-4538-a730-17cdb2040cb8',
            leftValue: "={{ $json.allow_automation === true }}",
            rightValue: '',
            operator: {
              type: 'boolean',
              operation: 'true',
              singleValue: true,
            },
          },
          {
            id: '9ca48d54-62f6-4f5b-ae45-1a4c472db7cb',
            leftValue: "={{ String($json.chatInput || '').trim().length > 0 }}",
            rightValue: '',
            operator: {
              type: 'boolean',
              operation: 'true',
              singleValue: true,
            },
          },
          {
            id: 'd2323e1f-2115-4909-bb13-7ec3d82fb5d8',
            leftValue: "={{ /^\\/(disponible|no-disponible)\\b/i.test(String($json.chatInput || '').trim()) }}",
            rightValue: '',
            operator: {
              type: 'boolean',
              operation: 'false',
              singleValue: true,
            },
          },
        ],
        combinator: 'and',
      },
      looseTypeValidation: true,
      options: {},
    },
    id: existing?.id || '690f9ebe-8bc0-4b35-bad6-0fc1dfac5c7f',
    name: 'Allow automation?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [-3136, 160],
  };
}

function shouldSendNode(existing) {
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
            id: '460e9850-c53e-4ed8-95ca-d8674f103568',
            leftValue: "={{ $('Merge Sets1').item.json.source !== 'simulator' }}",
            rightValue: '',
            operator: {
              type: 'boolean',
              operation: 'true',
              singleValue: true,
            },
          },
          {
            id: '5f2578e8-6386-4d23-beae-c35b2f624fa0',
            leftValue: "={{ $json.send_to_customer === true }}",
            rightValue: '',
            operator: {
              type: 'boolean',
              operation: 'true',
              singleValue: true,
            },
          },
          {
            id: 'f50632cb-50ca-4386-a8ce-b8e1ab7e53b7',
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
    id: existing?.id || 'ab3d8a11-a1d3-4e5e-bdd2-8830e0ba7180',
    name: 'Should send via Chatwoot?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [1184, 336],
  };
}

function sendOutboundNode(existing) {
  return {
    parameters: {
      workflowId: {
        __rl: true,
        mode: 'id',
        value: OUTBOUND_WORKFLOW_ID,
        cachedResultName: 'Chatwoot Outbound Sender - De Paseo en Fincas',
        cachedResultUrl: `/workflow/${OUTBOUND_WORKFLOW_ID}`,
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {},
        matchingColumns: [],
        schema: [
          {
            id: 'aee41546-aa86-4929-870c-758a10ca6b8d',
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
            id: '900962f8-7c1e-4819-b75e-95f353dd17d4',
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
            id: '4ed907af-7db7-41a5-a1de-03f025ffcf48',
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
    id: existing?.id || '62761566-3357-409c-b75e-9d346efc6728',
    name: 'Send outbound via Chatwoot',
    type: 'n8n-nodes-base.executeWorkflow',
    typeVersion: 1.2,
    position: [1424, 240],
  };
}

function webhookResponseNode(existing) {
  return {
    parameters: {
      assignments: {
        assignments: [
          {
            id: 'e397223b-2be4-43e2-bd57-b3088e1166a3',
            name: 'ok',
            value: true,
            type: 'boolean',
          },
          {
            id: 'a63d26f2-3cf4-4c1e-abaa-5fa7b1b799fc',
            name: 'processed',
            value: true,
            type: 'boolean',
          },
          {
            id: 'f255f4db-4ac3-40a9-9d86-9cacd1234726',
            name: 'wa_id',
            value: '={{ $json.wa_id }}',
            type: 'string',
          },
          {
            id: '81db3ecf-b34d-4601-b6d8-50bdd5aa258b',
            name: 'chatwoot_id',
            value: '={{ $json.chatwoot_id || null }}',
            type: 'string',
          },
          {
            id: 'c49a5f53-019c-42d3-86cc-3e9122d76a84',
            name: 'replyText',
            value: "={{ $json.outbound_message || $json.final_whatsapp_text || '' }}",
            type: 'string',
          },
          {
            id: 'd911f921-c6e4-47b1-96a8-2210a08f8545',
            name: 'toolChosen',
            value: "={{ $json.tool_chosen || 'NONE' }}",
            type: 'string',
          },
          {
            id: '36af4e42-f06f-4af5-8856-bb6f1197f87c',
            name: 'action',
            value: "={{ $json.action || 'RUN_TOOL' }}",
            type: 'string',
          },
          {
            id: 'd7ea8cf0-d7ea-4c41-9aa5-b7418ea62e31',
            name: 'stateAfter',
            value: '={{ $json.current_state || null }}',
            type: 'string',
          },
          {
            id: '3bff5a55-18f9-4977-a49f-7b87d9c49d2f',
            name: 'agenteActivo',
            value: '={{ $json.agente_activo }}',
            type: 'boolean',
          },
        ],
      },
      options: {},
    },
    id: existing?.id || 'c7d1f0cc-60d4-48a1-97dd-bc478eb5f1eb',
    name: 'Webhook Response',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [1664, 336],
  };
}

function webhookIgnoredNode(existing) {
  return {
    parameters: {
      assignments: {
        assignments: [
          {
            id: '6a1e2fc4-b312-4123-901c-b469d9a5a271',
            name: 'ok',
            value: true,
            type: 'boolean',
          },
          {
            id: 'e9f81557-e664-4974-832d-6950809f42c1',
            name: 'processed',
            value: false,
            type: 'boolean',
          },
          {
            id: '86fc50b5-53e0-4a68-9df7-ed1f8058dce0',
            name: 'reason',
            value: "={{ $('Resolve thread policy').item.json.ignore_reason || 'ignored' }}",
            type: 'string',
          },
          {
            id: '5fb61c56-5f0d-4cb2-822d-114f78a5e184',
            name: 'wa_id',
            value: "={{ $('Normalize inbound payload').item.json.wa_id || null }}",
            type: 'string',
          },
          {
            id: '53cf8589-ec68-4188-9c8b-e7116aeef949',
            name: 'chatwoot_id',
            value: "={{ $('Normalize inbound payload').item.json.chatwoot_id || null }}",
            type: 'string',
          },
        ],
      },
      options: {},
    },
    id: existing?.id || '99e6792c-cdc7-497d-b22d-c4bf1608ee5b',
    name: 'Webhook Ignored',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [-2896, 432],
  };
}

async function main() {
  const workflow = await api(`/api/v1/workflows/${MAIN_WORKFLOW_ID}`);
  const wasActive = workflow.active === true;

  workflow.name = 'De paseo en fincas customer agent';
  workflow.settings = {
    ...(workflow.settings || {}),
    timezone: 'America/Bogota',
  };

  removeNode(workflow, 'When engine is called');
  removeNode(workflow, 'Filtro Mensajes');

  const nodesToUpsert = [
    inboundWebhookNode(findNode(workflow, 'Inbound Webhook')),
    normalizeInboundNode(findNode(workflow, 'Normalize inbound payload')),
    resolveMappingNode(findNode(workflow, 'Resolve existing phone mapping')),
    resolveThreadPolicyNode(findNode(workflow, 'Resolve thread policy')),
    allowAutomationNode(findNode(workflow, 'Allow automation?')),
    shouldSendNode(findNode(workflow, 'Should send via Chatwoot?')),
    sendOutboundNode(findNode(workflow, 'Send outbound via Chatwoot')),
    webhookResponseNode(findNode(workflow, 'Webhook Response')),
    webhookIgnoredNode(findNode(workflow, 'Webhook Ignored')),
  ];

  for (const node of nodesToUpsert) {
    const idx = workflow.nodes.findIndex((item) => item.name === node.name);
    if (idx === -1) workflow.nodes.push(node);
    else workflow.nodes[idx] = { ...workflow.nodes[idx], ...node };
  }

  replaceMainConnection(workflow.connections, 'Inbound Webhook', 'Normalize inbound payload');
  replaceMainConnection(workflow.connections, 'Normalize inbound payload', 'Resolve existing phone mapping');
  replaceMainConnection(workflow.connections, 'Resolve existing phone mapping', 'Resolve thread policy');
  workflow.connections['Resolve thread policy'] = {
    main: [[{ node: 'Allow automation?', type: 'main', index: 0 }]],
  };
  workflow.connections['Allow automation?'] = {
    main: [
      [{ node: 'Execution Data1', type: 'main', index: 0 }],
      [{ node: 'Webhook Ignored', type: 'main', index: 0 }],
    ],
  };
  replaceMainConnection(workflow.connections, 'Execution Data1', 'config');
  replaceMainConnection(workflow.connections, 'Insert OUTBOUND message (messages)', 'Agregar follow on');
  replaceMainConnection(workflow.connections, 'Agregar follow on', 'Engine Result');
  replaceMainConnection(workflow.connections, 'Engine Result', 'Should send via Chatwoot?');
  patchIfLoopNode(findNode(workflow, 'If2'));
  workflow.connections['Should send via Chatwoot?'] = {
    main: [
      [{ node: 'Send outbound via Chatwoot', type: 'main', index: 0 }],
      [{ node: 'If2', type: 'main', index: 0 }],
    ],
  };
  workflow.connections['Send outbound via Chatwoot'] = {
    main: [[{ node: 'If2', type: 'main', index: 0 }]],
  };
  workflow.connections.If2 = {
    main: [
      [{ node: 'Edit Fields1', type: 'main', index: 0 }],
      [{ node: 'Webhook Response', type: 'main', index: 0 }],
    ],
  };
  workflow.connections['Webhook Response'] = { main: [[]] };
  workflow.connections['Webhook Ignored'] = { main: [[]] };

  if (wasActive) {
    await api(`/api/v1/workflows/${MAIN_WORKFLOW_ID}/deactivate`, { method: 'POST' });
  }

  for (const id of [CHATWOOT_INBOUND_WORKFLOW_ID, SIMULATOR_ADAPTER_WORKFLOW_ID]) {
    try {
      await api(`/api/v1/workflows/${id}/deactivate`, { method: 'POST' });
    } catch {
      // Ignore if already inactive or missing.
    }
  }

  const updated = await api(`/api/v1/workflows/${MAIN_WORKFLOW_ID}`, {
    method: 'PUT',
    body: JSON.stringify(sanitizeWorkflowForUpdate(workflow)),
  });

  await api(`/api/v1/workflows/${MAIN_WORKFLOW_ID}/activate`, { method: 'POST' });

  await fs.writeFile(path.resolve('current_workflow.json'), JSON.stringify(await api(`/api/v1/workflows/${MAIN_WORKFLOW_ID}`), null, 2));

  console.log(
    JSON.stringify(
      {
        workflowId: MAIN_WORKFLOW_ID,
        versionId: updated.versionId,
        webhook: `${N8N_BASE_URL}/webhook/${CHATWOOT_INBOUND_WEBHOOK_PATH}`,
        deactivatedWorkflows: [CHATWOOT_INBOUND_WORKFLOW_ID, SIMULATOR_ADAPTER_WORKFLOW_ID],
      },
      null,
      2,
    ),
  );
}

await main();
