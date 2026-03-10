import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';

dotenv.config({ path: path.resolve('.env') });

const WORKFLOW_ID = process.argv[2] || 'RrIniaNJCUC72nfI';
const N8N_BASE_URL = process.env.N8N_BASE_URL;
const N8N_API_KEY = process.env.N8N_PUBLIC_API_TOKEN;

if (!N8N_BASE_URL || !N8N_API_KEY) {
  throw new Error('Missing N8N_BASE_URL or N8N_PUBLIC_API_TOKEN in .env');
}

const headers = {
  'X-N8N-API-KEY': N8N_API_KEY,
  Accept: 'application/json',
};

async function api(pathname, options = {}) {
  const response = await fetch(`${N8N_BASE_URL}${pathname}`, {
    ...options,
    headers: {
      ...headers,
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

function ensureConnectionBucket(connections, nodeName, type) {
  if (!connections[nodeName]) connections[nodeName] = {};
  if (!connections[nodeName][type]) connections[nodeName][type] = [[]];
  if (!Array.isArray(connections[nodeName][type][0])) {
    connections[nodeName][type] = [[]];
  }
  return connections[nodeName][type][0];
}

function addUniqueConnection(targets, node, type = 'ai_tool', index = 0) {
  if (!targets.some((item) => item.node === node && item.type === type && item.index === index)) {
    targets.push({ node, type, index });
  }
}

function patchPrompt(text, snippets) {
  let next = String(text || '');
  for (const { anchor, insert } of snippets) {
    if (next.includes(insert.trim())) continue;
    if (next.includes(anchor)) {
      next = next.replace(anchor, `${anchor}\n${insert}`);
    } else {
      next = `${next}\n${insert}`;
    }
  }
  return next;
}

function upsertNode(nodes, node) {
  const index = nodes.findIndex((item) => item.name === node.name);
  if (index === -1) {
    nodes.push(node);
  } else {
    nodes[index] = node;
  }
}

function buildDatetimeTriggerNode() {
  return {
    parameters: {
      inputSource: 'passthrough',
    },
    id: 'd8ac5ac3-1e17-460b-bb13-99be7d318aae',
    name: 'When current datetime tool is called',
    type: 'n8n-nodes-base.executeWorkflowTrigger',
    typeVersion: 1.1,
    position: [-2960, -160],
  };
}

function buildDatetimeResponseNode() {
  return {
    parameters: {
      assignments: {
        assignments: [
          {
            id: 'c73e550f-4d20-4d79-aef4-7468375bfca0',
            name: 'now_iso',
            value: '={{ $now.toISO() }}',
            type: 'string',
          },
          {
            id: '653755ac-f9dc-4052-b76c-93b6082a5610',
            name: 'today_iso_date',
            value: '={{ $today.toISODate() }}',
            type: 'string',
          },
          {
            id: '8ea47adb-0cc7-4979-b5b0-59e3f9e90fc4',
            name: 'current_time_24h',
            value: "={{ $now.toFormat('HH:mm:ss') }}",
            type: 'string',
          },
          {
            id: '40d004db-dc61-4d78-b22d-a3bac4103f56',
            name: 'timezone',
            value: '={{ $now.zoneName }}',
            type: 'string',
          },
          {
            id: 'f40861ab-7c6f-4d89-a6ec-a31d411e11b1',
            name: 'weekday_es',
            value: "={{ $now.setLocale('es').toFormat('cccc') }}",
            type: 'string',
          },
          {
            id: '8f2e09f0-f1b1-48ee-86c0-4593db9cd7ff',
            name: 'human_readable_es',
            value: "={{ $now.setLocale('es').toFormat(\"cccc d 'de' LLLL 'de' yyyy, HH:mm\") }}",
            type: 'string',
          },
          {
            id: 'f7e680a3-1efe-40a4-8821-a169683adaf9',
            name: 'request_context',
            value: '={{ $json.reason || "" }}',
            type: 'string',
          },
          {
            id: '525d46be-e26e-43f6-b4aa-d1b1e3f121fc',
            name: 'notes',
            value: 'Usa estos valores como referencia única de fecha y hora actual en esta ejecución.',
            type: 'string',
          },
        ],
      },
      options: {},
    },
    id: '14e2fc7a-2ae8-4200-8be6-3099b1b41bb0',
    name: 'Build Current Datetime Tool Response',
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [-2736, -160],
  };
}

function buildDatetimeToolNode() {
  return {
    parameters: {
      description:
        'Devuelve la fecha y hora actual de n8n usando sus variables nativas ($now y $today). Usa este tool cuando necesites saber hoy, ahora, mañana, este fin de semana o cualquier referencia temporal actual.',
      workflowId: {
        __rl: true,
        mode: 'id',
        value: '={{ $workflow.id }}',
      },
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: {},
        matchingColumns: [],
        schema: [
          {
            id: 'b79906fc-6d23-4f47-b93b-1a2211d01b53',
            displayName: 'reason',
            required: false,
            defaultMatch: false,
            display: true,
            canBeUsedToMatch: true,
            type: 'string',
            removed: false,
            stringValue:
              "={{ $fromAI('reason', `Motivo por el que necesitas la fecha y hora actual`, 'string') }}",
          },
        ],
        attemptToConvertTypes: false,
        convertFieldsToString: false,
      },
    },
    id: '6e6ef2d2-8b67-4028-97b1-c4fae378f42f',
    name: 'current_datetime_tool',
    type: '@n8n/n8n-nodes-langchain.toolWorkflow',
    typeVersion: 2.2,
    position: [-1648, 704],
  };
}

function sanitizeWorkflowForUpdate(workflow) {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: {
      executionOrder: workflow.settings?.executionOrder,
      callerPolicy: workflow.settings?.callerPolicy,
      availableInMCP: workflow.settings?.availableInMCP,
    },
  };
}

const workflow = await api(`/api/v1/workflows/${WORKFLOW_ID}`);
const wasActive = workflow.active === true;

upsertNode(workflow.nodes, buildDatetimeTriggerNode());
upsertNode(workflow.nodes, buildDatetimeResponseNode());
upsertNode(workflow.nodes, buildDatetimeToolNode());

workflow.connections['When current datetime tool is called'] = {
  main: [[{ node: 'Build Current Datetime Tool Response', type: 'main', index: 0 }]],
};
workflow.connections['Build Current Datetime Tool Response'] = {
  main: [[]],
};

const datetimeTargets = ensureConnectionBucket(workflow.connections, 'current_datetime_tool', 'ai_tool');
for (const nodeName of [
  'Orquestador AI1',
  'qualifying_agent',
  'offering_agent',
  'verifying_availability_agent',
  'qa_agent',
]) {
  addUniqueConnection(datetimeTargets, nodeName);
}

const orquestador = workflow.nodes.find((node) => node.name === 'Orquestador AI1');
if (orquestador?.parameters?.options?.systemMessage) {
  orquestador.parameters.options.systemMessage = patchPrompt(orquestador.parameters.options.systemMessage, [
    {
      anchor: 'TOOLS DISPONIBLES',
      insert: '- current_datetime_tool',
    },
    {
      anchor: 'REGLAS ABSOLUTAS',
      insert: '- Si necesitas fecha u hora actual para decidir o interpretar referencias temporales, consulta current_datetime_tool.',
    },
  ]);
}

const qualifyingAgent = workflow.nodes.find((node) => node.name === 'qualifying_agent');
if (qualifyingAgent?.parameters?.options?.systemMessage) {
  qualifyingAgent.parameters.options.systemMessage = patchPrompt(
    qualifyingAgent.parameters.options.systemMessage,
    [
      {
        anchor: 'REGLAS',
        insert:
          '- Si necesitas validar la fecha u hora actual para interpretar referencias como "hoy", "mañana", "este fin de semana" o similares, usa current_datetime_tool.',
      },
    ],
  );
}

const offeringAgent = workflow.nodes.find((node) => node.name === 'offering_agent');
if (offeringAgent?.parameters?.options?.systemMessage) {
  offeringAgent.parameters.options.systemMessage = patchPrompt(
    offeringAgent.parameters.options.systemMessage,
    [
      {
        anchor: 'REGLAS',
        insert:
          '- Si necesitas confirmar la fecha actual o interpretar referencias temporales del cliente, usa current_datetime_tool.',
      },
    ],
  );
}

const verifyingAgent = workflow.nodes.find((node) => node.name === 'verifying_availability_agent');
if (verifyingAgent?.parameters?.options?.systemMessage) {
  verifyingAgent.parameters.options.systemMessage = patchPrompt(
    verifyingAgent.parameters.options.systemMessage,
    [
      {
        anchor: 'REGLAS',
        insert:
          '- Si necesitas saber la fecha u hora actual para contextualizar tu respuesta, usa current_datetime_tool.',
      },
    ],
  );
}

const qaAgent = workflow.nodes.find((node) => node.name === 'qa_agent');
if (qaAgent?.parameters?.options?.systemMessage) {
  qaAgent.parameters.options.systemMessage = patchPrompt(qaAgent.parameters.options.systemMessage, [
    {
      anchor: 'REGLAS',
      insert:
        '- Si la respuesta depende de la fecha u hora actual, consulta current_datetime_tool en vez de asumirla.',
    },
  ]);
}

if (wasActive) {
  await api(`/api/v1/workflows/${WORKFLOW_ID}/deactivate`, { method: 'POST' });
}

const payload = sanitizeWorkflowForUpdate(workflow);
const updated = await api(`/api/v1/workflows/${WORKFLOW_ID}`, {
  method: 'PUT',
  body: JSON.stringify(payload),
});

if (wasActive) {
  await api(`/api/v1/workflows/${WORKFLOW_ID}/activate`, { method: 'POST' });
}

await fs.writeFile(
  path.resolve('current_workflow.json'),
  JSON.stringify(updated, null, 2),
);

console.log(
  JSON.stringify(
    {
      workflowId: updated.id,
      active: wasActive,
      versionId: updated.versionId,
      addedNodes: [
        'When current datetime tool is called',
        'Build Current Datetime Tool Response',
        'current_datetime_tool',
      ],
    },
    null,
    2,
  ),
);
