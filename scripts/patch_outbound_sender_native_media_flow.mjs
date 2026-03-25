import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT_DIR = process.cwd();
const CURRENT_WORKFLOW_FILE = path.join(ROOT_DIR, 'current_workflow.json');
const OUTBOUND_SENDER_WORKFLOW_FILE = path.join(ROOT_DIR, 'chatwoot_outbound_sender_workflow.json');

const NODE_POSITIONS = Object.freeze({
  'When outbound sender is called': [160, 160],
  'Async media webhook': [160, 420],
  'Normalize input': [420, 280],
  'Expand outbound items': [700, 280],
  'Loop outbound items': [980, 280],
  'Is media outbound item?': [1220, 280],
  'Download media asset': [1460, 80],
  'Media download ok?': [1700, 80],
  'Upload media to Chatwoot': [1940, 80],
  'Media upload ok?': [2180, 80],
  'Record media success': [2420, -20],
  'Send media fallback text': [1940, 280],
  'Record media fallback result': [2180, 280],
  'Is text outbound item?': [1460, 480],
  'Send Chatwoot text direct': [1940, 480],
  'Record text result': [2180, 480],
  'Pause outbound item': [2660, 280],
  'Summarize outbound results': [1220, 680],
  'Outbound send result': [1480, 680],
});

function newId() {
  return crypto.randomUUID();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function findNode(workflow, name) {
  const node = (workflow.nodes || []).find((candidate) => candidate.name === name);
  if (!node) {
    throw new Error(`Missing node template: ${name}`);
  }
  return node;
}

async function loadCurrentWorkflowTemplates() {
  const raw = await fs.readFile(CURRENT_WORKFLOW_FILE, 'utf8');
  return JSON.parse(raw);
}

function buildNormalizeInputNode() {
  return {
    parameters: {
      jsCode: String.raw`const raw = $input.first().json || {};
const input = raw.body || raw;
const compact = (value) => String(value ?? '').trim();

function normalizeSequence(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const normalizedSequence = normalizeSequence(input.outbound_sequence_json || input.outbound_sequence);

return [
  {
    json: {
      chatwoot_id: compact(input.chatwoot_id || '') || null,
      private: input.private === true,
      chatwoot_account_id: compact(input.chatwoot_account_id || '1') || '1',
      chatwoot_api_token: compact(input.chatwoot_api_token || '7paF3kLsjSEPvXqgHPEgPTEq') || '7paF3kLsjSEPvXqgHPEgPTEq',
      outbound_sequence: normalizedSequence,
      outbound_sequence_json: JSON.stringify(normalizedSequence),
      outbound_message: compact(input.outbound_message || input.message || input.final_whatsapp_text || ''),
      final_whatsapp_text: compact(input.final_whatsapp_text || input.outbound_message || input.message || ''),
    },
  },
];`,
    },
    id: newId(),
    name: 'Normalize input',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [...NODE_POSITIONS['Normalize input']],
  };
}

function buildSetNode(name, assignments, positionName) {
  return {
    parameters: {
      assignments: {
        assignments,
      },
      options: {},
    },
    id: newId(),
    name,
    type: 'n8n-nodes-base.set',
    typeVersion: 3.4,
    position: [...NODE_POSITIONS[positionName || name]],
  };
}

function buildSummarizeResultsNode() {
  return {
    parameters: {
      jsCode: String.raw`const compact = (value) => String(value ?? '').trim();
const items = $input.all();
const first = items[0]?.json || {};

const results = items
  .map((item) => item.json || {})
  .filter((json) => compact(json.result_type) && compact(json.result_type) !== 'noop')
  .map((json) => ({
    ok: json.result_ok !== false,
    type: compact(json.result_type),
    filename: compact(json.result_filename) || null,
    property_title: compact(json.result_property_title) || null,
    source_url: compact(json.result_source_url) || null,
    error: compact(json.result_error) || null,
    fallback_sent: json.result_fallback_sent === true,
    content: compact(json.result_content) || null,
  }));

return [
  {
    json: {
      ok: results.every((entry) => entry.ok !== false),
      chatwoot_id: compact(first.chatwoot_id) || null,
      sent_count: results.length,
      results,
    },
  },
];`,
    },
    id: newId(),
    name: 'Summarize outbound results',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [...NODE_POSITIONS['Summarize outbound results']],
  };
}

function cloneTemplateNode(sourceWorkflow, sourceName, targetName = sourceName) {
  const node = clone(findNode(sourceWorkflow, sourceName));
  node.id = newId();
  node.name = targetName;
  node.position = [...NODE_POSITIONS[targetName]];
  return node;
}

function ensureTimeout(node, timeoutMs) {
  node.parameters = node.parameters || {};
  node.parameters.options = node.parameters.options || {};
  node.parameters.options.timeout = timeoutMs;
  return node;
}

function setMainConnections(workflow, from, branches) {
  workflow.connections[from] = {
    main: branches.map((branch) =>
      branch.map((nodeName) => ({
        node: nodeName,
        type: 'main',
        index: 0,
      })),
    ),
  };
}

export function patchWorkflowDefinition(workflow, currentWorkflowTemplates) {
  const templateWorkflow = currentWorkflowTemplates;

  const preservedTrigger = clone(findNode(workflow, 'When outbound sender is called'));
  preservedTrigger.position = [...NODE_POSITIONS[preservedTrigger.name]];

  const preservedWebhook = clone(findNode(workflow, 'Async media webhook'));
  preservedWebhook.position = [...NODE_POSITIONS[preservedWebhook.name]];

  const outboundSendResult = clone(findNode(workflow, 'Outbound send result'));
  outboundSendResult.position = [...NODE_POSITIONS[outboundSendResult.name]];

  const normalizeInput = buildNormalizeInputNode();
  const expandOutboundItems = cloneTemplateNode(templateWorkflow, 'Send texts & extract media', 'Expand outbound items');
  const loopOutboundItems = cloneTemplateNode(templateWorkflow, 'Loop outbound items');
  const isMediaOutboundItem = cloneTemplateNode(templateWorkflow, 'Is media outbound item?');
  const downloadMediaAsset = cloneTemplateNode(templateWorkflow, 'Download media asset');
  const mediaDownloadOk = cloneTemplateNode(templateWorkflow, 'Media download ok?');
  const uploadMediaToChatwoot = cloneTemplateNode(templateWorkflow, 'Upload media to Chatwoot');
  const mediaUploadOk = cloneTemplateNode(templateWorkflow, 'Media upload ok?');
  const sendMediaFallbackText = cloneTemplateNode(templateWorkflow, 'Send media fallback text');
  const isTextOutboundItem = cloneTemplateNode(templateWorkflow, 'Is text outbound item?');
  const sendChatwootTextDirect = cloneTemplateNode(templateWorkflow, 'Send Chatwoot text direct');
  const pauseOutboundItem = cloneTemplateNode(templateWorkflow, 'Pause outbound item');
  const summarizeOutboundResults = buildSummarizeResultsNode();

  ensureTimeout(downloadMediaAsset, 30000);
  ensureTimeout(uploadMediaToChatwoot, 45000);
  ensureTimeout(sendMediaFallbackText, 30000);
  ensureTimeout(sendChatwootTextDirect, 30000);

  const recordMediaSuccess = buildSetNode(
    'Record media success',
    [
      {
        id: newId(),
        name: 'chatwoot_id',
        value: "={{ $('Loop outbound items').item.json.chatwoot_id || '' }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'result_ok',
        value: true,
        type: 'boolean',
      },
      {
        id: newId(),
        name: 'result_type',
        value: 'media',
        type: 'string',
      },
      {
        id: newId(),
        name: 'result_filename',
        value: "={{ $binary?.data?.fileName || '' }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'result_property_title',
        value: "={{ $('Loop outbound items').item.json.property_title || '' }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'result_source_url',
        value: "={{ $('Loop outbound items').item.json.source_url || $('Loop outbound items').item.json.download_url || '' }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'result_error',
        value: '',
        type: 'string',
      },
    ],
    'Record media success',
  );

  const recordMediaFallbackResult = buildSetNode(
    'Record media fallback result',
    [
      {
        id: newId(),
        name: 'chatwoot_id',
        value: "={{ $('Loop outbound items').item.json.chatwoot_id || '' }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'result_ok',
        value: false,
        type: 'boolean',
      },
      {
        id: newId(),
        name: 'result_type',
        value: 'media_fallback',
        type: 'string',
      },
      {
        id: newId(),
        name: 'result_filename',
        value: '',
        type: 'string',
      },
      {
        id: newId(),
        name: 'result_property_title',
        value: "={{ $('Loop outbound items').item.json.property_title || '' }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'result_source_url',
        value: "={{ $('Loop outbound items').item.json.source_url || $('Loop outbound items').item.json.download_url || '' }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'result_error',
        value: 'media_delivery_failed',
        type: 'string',
      },
      {
        id: newId(),
        name: 'result_fallback_sent',
        value: "={{ Boolean($json.id || $json.message?.id || $json.message_id) }}",
        type: 'boolean',
      },
    ],
    'Record media fallback result',
  );

  const recordTextResult = buildSetNode(
    'Record text result',
    [
      {
        id: newId(),
        name: 'chatwoot_id',
        value: "={{ $('Loop outbound items').item.json.chatwoot_id || '' }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'result_ok',
        value: "={{ Boolean($json.id || $json.message?.id || $json.message_id) }}",
        type: 'boolean',
      },
      {
        id: newId(),
        name: 'result_type',
        value: 'text',
        type: 'string',
      },
      {
        id: newId(),
        name: 'result_filename',
        value: '',
        type: 'string',
      },
      {
        id: newId(),
        name: 'result_property_title',
        value: "={{ $('Loop outbound items').item.json.property_title || '' }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'result_source_url',
        value: "={{ $('Loop outbound items').item.json.source_url || '' }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'result_error',
        value: "={{ Boolean($json.id || $json.message?.id || $json.message_id) ? '' : 'text_delivery_failed' }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'result_content',
        value: "={{ $('Loop outbound items').item.json.content || '' }}",
        type: 'string',
      },
    ],
    'Record text result',
  );

  const nodes = [
    preservedTrigger,
    preservedWebhook,
    normalizeInput,
    expandOutboundItems,
    loopOutboundItems,
    isMediaOutboundItem,
    downloadMediaAsset,
    mediaDownloadOk,
    uploadMediaToChatwoot,
    mediaUploadOk,
    recordMediaSuccess,
    sendMediaFallbackText,
    recordMediaFallbackResult,
    isTextOutboundItem,
    sendChatwootTextDirect,
    recordTextResult,
    pauseOutboundItem,
    summarizeOutboundResults,
    outboundSendResult,
  ];

  workflow.description =
    'Outbound sender itemized for media delivery. Expands Drive folders to assets and sends each asset with native HTTP Request nodes.';
  workflow.nodes = nodes;
  workflow.connections = {};

  setMainConnections(workflow, 'When outbound sender is called', [['Normalize input']]);
  setMainConnections(workflow, 'Async media webhook', [['Normalize input']]);
  setMainConnections(workflow, 'Normalize input', [['Expand outbound items']]);
  setMainConnections(workflow, 'Expand outbound items', [['Loop outbound items']]);
  setMainConnections(workflow, 'Loop outbound items', [['Summarize outbound results'], ['Is media outbound item?']]);
  setMainConnections(workflow, 'Is media outbound item?', [['Download media asset'], ['Is text outbound item?']]);
  setMainConnections(workflow, 'Download media asset', [['Media download ok?']]);
  setMainConnections(workflow, 'Media download ok?', [['Upload media to Chatwoot'], ['Send media fallback text']]);
  setMainConnections(workflow, 'Upload media to Chatwoot', [['Media upload ok?']]);
  setMainConnections(workflow, 'Media upload ok?', [['Record media success'], ['Send media fallback text']]);
  setMainConnections(workflow, 'Record media success', [['Pause outbound item']]);
  setMainConnections(workflow, 'Send media fallback text', [['Record media fallback result']]);
  setMainConnections(workflow, 'Record media fallback result', [['Pause outbound item']]);
  setMainConnections(workflow, 'Is text outbound item?', [['Send Chatwoot text direct'], ['Pause outbound item']]);
  setMainConnections(workflow, 'Send Chatwoot text direct', [['Record text result']]);
  setMainConnections(workflow, 'Record text result', [['Pause outbound item']]);
  setMainConnections(workflow, 'Pause outbound item', [['Loop outbound items']]);
  setMainConnections(workflow, 'Summarize outbound results', [['Outbound send result']]);
  setMainConnections(workflow, 'Outbound send result', [[]]);

  if (workflow.activeVersion) {
    workflow.activeVersion.nodes = clone(nodes);
    workflow.activeVersion.connections = clone(workflow.connections);
  }

  return workflow;
}

async function writePatchedWorkflowFile() {
  const sourceWorkflow = await loadCurrentWorkflowTemplates();
  const senderRaw = await fs.readFile(OUTBOUND_SENDER_WORKFLOW_FILE, 'utf8');
  const senderWorkflow = JSON.parse(senderRaw);
  patchWorkflowDefinition(senderWorkflow, sourceWorkflow);
  await fs.writeFile(OUTBOUND_SENDER_WORKFLOW_FILE, JSON.stringify(senderWorkflow, null, 2) + '\n');
}

const entryHref = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';

if (import.meta.url === entryHref) {
  writePatchedWorkflowFile().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
