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

function findNode(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) throw new Error(`Missing node ${name}`);
  return node;
}

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Could not find ${label}`);
  }
  return source.replace(search, replacement);
}

function patchCodeNode(node) {
  let jsCode = String(node.parameters?.jsCode || '');

  jsCode = jsCode.replace(
    /const nextStateAgentMap = \{[\s\S]*?const shouldImmediateLoop =\n  currentStateChanged &&\n  Boolean\(targetAgentForNextState\) &&\n  toolChosen !== targetAgentForNextState;\n/g,
    '',
  );

  jsCode = jsCode.replace(
    "const hasCustomerFacingMessage = Boolean(String(finalWhatsappText || '').trim());\nconst shouldImmediateLoop = currentStateChanged && !hasCustomerFacingMessage;\n",
    '',
  );

  jsCode = jsCode.replace(
    "      chatwoot_id:\n        $('Get Context-conversations1').item.json.chatwoot_id || $('Merge Sets1').item.json.chatwoot_id || null,\n      chatwoot_id:\n        $('Get Context-conversations1').item.json.chatwoot_id || $('Merge Sets1').item.json.chatwoot_id || null,\n      chatwoot_id:\n        $('Get Context-conversations1').item.json.chatwoot_id || $('Merge Sets1').item.json.chatwoot_id || null,\n",
    "      chatwoot_id:\n        $('Get Context-conversations1').item.json.chatwoot_id || $('Merge Sets1').item.json.chatwoot_id || null,\n",
  );

  jsCode = replaceOnce(
    jsCode,
    "const handoffText = 'Te voy a pasar con un asesor humano para continuar con tu solicitud.';\nconst finalWhatsappText =\n  parsed?.final_whatsapp_text ||\n  toolOutputParsed?.respuesta ||\n  (action === 'HITL' ? handoffText : null);\n",
    "const handoffText = 'Te voy a pasar con un asesor humano para continuar con tu solicitud.';\nconst finalWhatsappText =\n  parsed?.final_whatsapp_text ||\n  toolOutputParsed?.respuesta ||\n  (action === 'HITL' ? handoffText : null);\nconst nextStateAgentMap = {\n  QUALIFYING: 'qualifying_agent',\n  OFFERING: 'offering_agent',\n  VERIFYING_AVAILABILITY: 'verifying_availability_agent',\n};\nconst targetAgentForNextState = nextStateAgentMap[requestedStateTransition] || null;\nconst shouldImmediateLoop =\n  currentStateChanged &&\n  Boolean(targetAgentForNextState) &&\n  toolChosen !== targetAgentForNextState;\n",
    'finalWhatsappText block',
  );

  if (!jsCode.includes('should_immediate_loop: shouldImmediateLoop')) {
    jsCode = replaceOnce(
      jsCode,
      "      current_state_changed: currentStateChanged,\n",
      "      current_state_changed: currentStateChanged,\n      should_immediate_loop: shouldImmediateLoop,\n",
      'current_state_changed return field',
    );
  }

  node.parameters.jsCode = jsCode;
}

function upsertAssignment(setNode, name, value, type) {
  const assignments = setNode.parameters?.assignments?.assignments || [];
  const existing = assignments.find((item) => item.name === name);
  if (existing) {
    existing.value = value;
    existing.type = type;
    return;
  }
  assignments.push({
    id: crypto.randomUUID(),
    name,
    value,
    type,
  });
  setNode.parameters.assignments.assignments = assignments;
}

function patchEngineResult(node) {
  upsertAssignment(
    node,
    'should_immediate_loop',
    "={{ $('Code in JavaScript1').item.json.should_immediate_loop === true }}",
    'boolean',
  );
}

function patchIfNode(node) {
  node.parameters.conditions = {
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
  };
}

const workflow = await api(`/api/v1/workflows/${WORKFLOW_ID}`);
const codeNode = findNode(workflow, 'Code in JavaScript1');
const engineResultNode = findNode(workflow, 'Engine Result');
const ifNode = findNode(workflow, 'If2');

patchCodeNode(codeNode);
patchEngineResult(engineResultNode);
patchIfNode(ifNode);

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
      ifCondition:
        findNode(updated, 'If2').parameters?.conditions?.conditions?.[0]?.leftValue || null,
      hasShouldImmediateLoop: String(findNode(updated, 'Code in JavaScript1').parameters?.jsCode || '').includes(
        'should_immediate_loop: shouldImmediateLoop',
      ),
    },
    null,
    2,
  ),
);
