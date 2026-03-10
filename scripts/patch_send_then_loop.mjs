import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';

dotenv.config({ path: path.resolve('.env') });

const WORKFLOW_ID = process.argv[2] || process.env.SIMULATOR_WORKFLOW_ID || 'RrIniaNJCUC72nfI';
const N8N_BASE_URL = process.env.N8N_BASE_URL;
const N8N_API_KEY = process.env.N8N_PUBLIC_API_TOKEN;

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

function replaceMainConnection(connections, sourceNodeName, targetNodeName) {
  connections[sourceNodeName] = {
    ...(connections[sourceNodeName] || {}),
    main: [[{ node: targetNodeName, type: 'main', index: 0 }]],
  };
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Missing node ${name}`);
  return node;
}

const workflow = await api(`/api/v1/workflows/${WORKFLOW_ID}`);
const ifNode = findNode(workflow, 'If2');

replaceMainConnection(workflow.connections, 'Insert OUTBOUND message (messages)', 'Agregar follow on');
replaceMainConnection(workflow.connections, 'Agregar follow on', 'Engine Result');
replaceMainConnection(workflow.connections, 'Engine Result', 'Should send via Chatwoot?');
ifNode.parameters = {
  ...(ifNode.parameters || {}),
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
          ifNode.parameters?.conditions?.conditions?.[0]?.id ||
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

const isActive = Boolean(workflow.active);
if (isActive) {
  await api(`/api/v1/workflows/${WORKFLOW_ID}/deactivate`, { method: 'POST' });
}

await api(`/api/v1/workflows/${WORKFLOW_ID}`, {
  method: 'PUT',
  body: JSON.stringify(sanitizeWorkflowForUpdate(workflow)),
});

if (isActive) {
  await api(`/api/v1/workflows/${WORKFLOW_ID}/activate`, { method: 'POST' });
}

const updated = await api(`/api/v1/workflows/${WORKFLOW_ID}`);
await fs.writeFile(path.resolve('current_workflow.json'), JSON.stringify(updated, null, 2));
await fs.writeFile(path.resolve('updated_main_workflow.json'), JSON.stringify(updated, null, 2));

console.log(
  JSON.stringify(
    {
      workflowId: updated.id,
      versionId: updated.versionId,
      active: updated.active,
      ifCondition: findNode(updated, 'If2').parameters?.conditions?.conditions?.[0]?.leftValue || null,
      insertOutboundNext: updated.connections['Insert OUTBOUND message (messages)']?.main?.[0]?.[0]?.node || null,
      shouldSendFalseNext: updated.connections['Should send via Chatwoot?']?.main?.[1]?.[0]?.node || null,
      sendOutboundNext: updated.connections['Send outbound via Chatwoot']?.main?.[0]?.[0]?.node || null,
      ifFalseNext: updated.connections.If2?.main?.[1]?.[0]?.node || null,
    },
    null,
    2,
  ),
);
