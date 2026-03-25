import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';

import { patchWorkflowDefinition } from './patch_interleaved_property_delivery_main_workflow.mjs';

dotenv.config({ path: path.resolve('.env') });

const WORKFLOW_ID = 'RrIniaNJCUC72nfI';
const N8N_BASE_URL = String(process.env.N8N_BASE_URL || '').replace(/\/$/, '');
const N8N_API_KEY = String(process.env.N8N_PUBLIC_API_TOKEN || '').trim();
const BACKUP_DIR = path.join(process.cwd(), 'backups', 'workflows');

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

function timestampKey() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function writeBackup(workflow, suffix) {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const filename = `${WORKFLOW_ID}-${suffix}-${timestampKey()}.json`;
  const filePath = path.join(BACKUP_DIR, filename);
  await fs.writeFile(filePath, JSON.stringify(workflow, null, 2) + '\n');
  return filePath;
}

function validateWorkflow(workflow) {
  const codeNode = (workflow.nodes || []).find((node) => node.name === 'Code in JavaScript1');
  const sendNode = (workflow.nodes || []).find((node) => node.name === 'Send outbound messages');
  const fireNode = (workflow.nodes || []).find((node) => node.name === 'Fire media sender');
  const hasMediaNode = (workflow.nodes || []).find((node) => node.name === 'Has media to send?');

  if (!codeNode || !sendNode || !fireNode || !hasMediaNode) {
    throw new Error('Patched workflow is missing one or more required nodes');
  }

  const code = String(codeNode.parameters?.jsCode || '');
  const sendCode = String(sendNode.parameters?.jsCode || '');
  const fireBody = String(fireNode.parameters?.jsonBody || '');
  const condition = hasMediaNode.parameters?.conditions?.conditions?.[0]?.leftValue || '';

  if (!code.includes("content: ''")) {
    throw new Error('Code in JavaScript1 was not patched to remove media caption');
  }
  if (!code.includes('const cardMessage = createTextMessage(card, {')) {
    throw new Error('Code in JavaScript1 was not patched to send card before media');
  }
  if (code.includes('buildMediaMessages(selectedFinca)')) {
    throw new Error('Code in JavaScript1 still sends selected finca media outside SHOW_OPTIONS');
  }
  if (code.includes('buildFincaCard(selectedFinca)')) {
    throw new Error('Code in JavaScript1 still sends selected finca card outside SHOW_OPTIONS');
  }
  if (!code.includes("const trailingText = createTextMessage(finalWhatsappText);")) {
    throw new Error('Code in JavaScript1 was not patched to keep selected finca outbound text-only');
  }
  if (!sendCode.includes('sender_sequence_json')) {
    throw new Error('Send outbound messages was not patched to forward full sender sequence');
  }
  if (!fireBody.includes('sender_sequence_json')) {
    throw new Error('Fire media sender is not using sender_sequence_json');
  }
  if (!String(condition).includes('should_fire_outbound_sender')) {
    throw new Error('Has media to send? is not checking should_fire_outbound_sender');
  }
}

async function main() {
  const workflow = await api(`/api/v1/workflows/${WORKFLOW_ID}`);
  const wasActive = workflow.active === true;

  const beforeBackup = await writeBackup(workflow, 'before-interleaved-property-delivery');

  patchWorkflowDefinition(workflow);
  validateWorkflow(workflow);

  if (wasActive) {
    await api(`/api/v1/workflows/${WORKFLOW_ID}/deactivate`, { method: 'POST' });
  }

  await api(`/api/v1/workflows/${WORKFLOW_ID}`, {
    method: 'PUT',
    body: JSON.stringify(sanitizeWorkflowForUpdate(workflow)),
  });

  if (wasActive) {
    await api(`/api/v1/workflows/${WORKFLOW_ID}/activate`, { method: 'POST' });
  }

  const refreshed = await api(`/api/v1/workflows/${WORKFLOW_ID}`);
  validateWorkflow(refreshed);
  const afterBackup = await writeBackup(refreshed, 'after-interleaved-property-delivery');

  console.log(
    JSON.stringify(
      {
        workflowId: refreshed.id,
        name: refreshed.name,
        activeBefore: wasActive,
        activeAfter: refreshed.active === true,
        updatedAt: refreshed.updatedAt || null,
        versionId: refreshed.versionId || null,
        beforeBackup,
        afterBackup,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  if (error?.payload) {
    console.error(JSON.stringify(error.payload, null, 2));
  }
  process.exit(1);
});
