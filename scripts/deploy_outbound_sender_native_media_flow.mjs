import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';

import { patchWorkflowDefinition } from './patch_outbound_sender_native_media_flow.mjs';

dotenv.config({ path: path.resolve('.env') });

const WORKFLOW_ID = 'pLyrdDO3mneaCp7m';
const N8N_BASE_URL = String(process.env.N8N_BASE_URL || '').replace(/\/$/, '');
const N8N_API_KEY = String(process.env.N8N_PUBLIC_API_TOKEN || '').trim();
const BACKUP_DIR = path.join(process.cwd(), 'backups', 'workflows');
const CURRENT_WORKFLOW_FILE = path.join(process.cwd(), 'current_workflow.json');

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

function validatePatchedWorkflow(workflow) {
  const nodeNames = new Set((workflow.nodes || []).map((node) => node.name));
  const required = [
    'Normalize input',
    'Expand outbound items',
    'Loop outbound items',
    'Download media asset',
    'Upload media to Chatwoot',
    'Summarize outbound results',
  ];
  const missing = required.filter((name) => !nodeNames.has(name));
  if (missing.length) {
    throw new Error(`Patched workflow is missing required nodes: ${missing.join(', ')}`);
  }

  if (nodeNames.has('Process outbound queue')) {
    throw new Error('Patched workflow still contains legacy node: Process outbound queue');
  }
}

async function main() {
  const currentTemplateRaw = await fs.readFile(CURRENT_WORKFLOW_FILE, 'utf8');
  const currentTemplate = JSON.parse(currentTemplateRaw);

  const workflow = await api(`/api/v1/workflows/${WORKFLOW_ID}`);
  const wasActive = workflow.active === true;

  const beforeBackup = await writeBackup(workflow, 'before-native-media-flow');

  patchWorkflowDefinition(workflow, currentTemplate);
  validatePatchedWorkflow(workflow);

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
  validatePatchedWorkflow(refreshed);
  const afterBackup = await writeBackup(refreshed, 'after-native-media-flow');

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
