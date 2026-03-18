import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import dotenv from 'dotenv';

dotenv.config({ path: path.resolve('.env') });

const MAIN_WORKFLOW_ID = process.env.SIMULATOR_WORKFLOW_ID || 'RrIniaNJCUC72nfI';
const SENDER_WORKFLOW_ID = process.env.CHATWOOT_OUTBOUND_SENDER_WORKFLOW_ID || 'pLyrdDO3mneaCp7m';
const N8N_BASE_URL = process.env.N8N_BASE_URL;
const N8N_API_KEY = process.env.N8N_PUBLIC_API_TOKEN;
const CHATWOOT_BASE_URL = String(process.env.CHATWOOT_BASE_URL || 'https://chatwoot-9qe1j-u48275.vm.elestio.app').replace(/\/$/, '');
const CHATWOOT_ACCOUNT_ID = String(process.env.CHATWOOT_ACCOUNT_ID || '1');
const CHATWOOT_API_TOKEN = process.env.CHATWOOT_API_TOKEN || '7paF3kLsjSEPvXqgHPEgPTEq';
const OPENAI_API_KEY_FALLBACK = process.env.OPENAI_API_KEY || '';
const OPENAI_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe';

if (!N8N_BASE_URL || !N8N_API_KEY) {
  throw new Error('Missing N8N_BASE_URL or N8N_PUBLIC_API_TOKEN in .env');
}

function newId() {
  return crypto.randomUUID();
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

function sanitizeWorkflowForCreate(workflow, name) {
  return {
    name,
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
    const error = new Error(`n8n HTTP ${response.status} ${pathname}`);
    error.payload = payload;
    throw error;
  }

  return payload;
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) throw new Error(`Node not found: ${name}`);
  return node;
}

function findNodeMaybe(workflow, name) {
  return workflow.nodes.find((entry) => entry.name === name) || null;
}

function upsertNode(workflow, name, factory) {
  const existing = findNodeMaybe(workflow, name);
  if (existing) return existing;
  const created = factory();
  workflow.nodes.push(created);
  return created;
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

function replaceExact(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Expected snippet not found while patching ${label}`);
  }
  return source.replace(search, replacement);
}

function buildAudioAttachmentResolverCode() {
  return String.raw`const input = $json || {};
const compact = (value) => String(value || '').trim();
const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return [value];
  return [];
};
const firstNonEmpty = (...values) => values.map((value) => compact(value)).find(Boolean) || null;
const audioPattern = /\.(aac|m4a|mp3|ogg|oga|opus|wav|webm)(\?|$)/i;
const chatwootBaseUrl = ${JSON.stringify(CHATWOOT_BASE_URL)};
const chatwootAccountId = ${JSON.stringify(CHATWOOT_ACCOUNT_ID)};
const chatwootToken = ${JSON.stringify(CHATWOOT_API_TOKEN)};
const openAiApiKey =
  (typeof process !== 'undefined' && process?.env?.OPENAI_API_KEY)
    ? String(process.env.OPENAI_API_KEY).trim()
    : ${JSON.stringify(OPENAI_API_KEY_FALLBACK)};
const openAiModel =
  (typeof process !== 'undefined' && process?.env?.OPENAI_TRANSCRIPTION_MODEL)
    ? String(process.env.OPENAI_TRANSCRIPTION_MODEL).trim()
    : ${JSON.stringify(OPENAI_TRANSCRIPTION_MODEL)};

const attachmentUrl = (attachment) =>
  firstNonEmpty(
    attachment?.data_url,
    attachment?.download_url,
    attachment?.file_url,
    attachment?.external_url,
    attachment?.url,
    attachment?.proxy_url,
    attachment?.blob_url,
    attachment?.content_url,
    attachment?.file?.url,
  );
const attachmentMimeType = (attachment) =>
  firstNonEmpty(
    attachment?.mime_type,
    attachment?.content_type,
    attachment?.file_type,
    attachment?.data_type,
    attachment?.file?.content_type,
    attachment?.file?.mime_type,
  );
const attachmentFilename = (attachment) =>
  firstNonEmpty(
    attachment?.filename,
    attachment?.file_name,
    attachment?.name,
    attachment?.file?.filename,
    attachment?.file?.name,
  );
const attachmentLooksAudio = (attachment) => {
  const mimeType = String(attachmentMimeType(attachment) || '').toLowerCase();
  const filename = String(attachmentFilename(attachment) || '').toLowerCase();
  const url = String(attachmentUrl(attachment) || '').toLowerCase();
  const type = String(
    attachment?.type ||
      attachment?.attachment_type ||
      attachment?.resource_type ||
      attachment?.file?.resource_type ||
      '',
  ).toLowerCase();
  return (
    mimeType.startsWith('audio/') ||
    mimeType === 'audio' ||
    type === 'audio' ||
    audioPattern.test(filename) ||
    audioPattern.test(url)
  );
};
const collectAttachments = (payload) => [
  ...ensureArray(payload?.attachments),
  ...ensureArray(payload?.message?.attachments),
  ...ensureArray(payload?.content_attributes?.attachments),
  ...ensureArray(payload?.message?.content_attributes?.attachments),
  ...ensureArray(payload?.attachment),
  ...ensureArray(payload?.message?.attachment),
];
const ensureAbsoluteUrl = (value) => {
  const url = compact(value);
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (!chatwootBaseUrl) return url;
  return new URL(url, chatwootBaseUrl).toString();
};
const parseJsonSafe = (value) => {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return { raw: value };
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const inferAudioMimeType = (mimeType, filename) => {
  const raw = compact(mimeType).toLowerCase();
  if (raw && raw.includes('/')) return raw;
  const lowerName = compact(filename).toLowerCase();
  if (lowerName.endsWith('.ogg') || lowerName.endsWith('.oga') || lowerName.endsWith('.opus')) return 'audio/ogg';
  if (lowerName.endsWith('.mp3')) return 'audio/mpeg';
  if (lowerName.endsWith('.m4a')) return 'audio/mp4';
  if (lowerName.endsWith('.aac')) return 'audio/aac';
  if (lowerName.endsWith('.wav')) return 'audio/wav';
  if (lowerName.endsWith('.webm')) return 'audio/webm';
  return 'audio/ogg';
};

const helperRequest =
  typeof $httpRequest === 'function'
    ? $httpRequest
    : typeof this !== 'undefined' && this?.helpers?.httpRequest
      ? this.helpers.httpRequest.bind(this.helpers)
      : null;
async function requestRaw(options) {
  if (helperRequest) {
    let response;
    try {
      response = await helperRequest({
        url: options.url,
        method: options.method || 'GET',
        headers: { ...(options.headers || {}) },
        body: options.body,
        json: false,
        encoding: 'arraybuffer',
        timeout: Number(options.timeout || 120000),
        ignoreHttpStatusErrors: true,
        returnFullResponse: true,
      });
    } catch (error) {
      const fallbackResponse = error?.response || error?.context?.response || null;
      if (!fallbackResponse) throw error;
      response = fallbackResponse;
    }
    const responseBody = response.body ?? response.data ?? null;
    const body =
      responseBody == null
        ? Buffer.from('', 'utf8')
        : Buffer.isBuffer(responseBody)
          ? responseBody
          : responseBody instanceof Uint8Array
            ? Buffer.from(responseBody)
            : responseBody instanceof ArrayBuffer
              ? Buffer.from(new Uint8Array(responseBody))
              : typeof responseBody === 'string'
                ? Buffer.from(responseBody, 'utf8')
                : Buffer.from(JSON.stringify(responseBody), 'utf8');
    return {
      statusCode: Number(response.statusCode || response.status || 0),
      headers: response.headers || {},
      body,
    };
  }

  throw new Error('$httpRequest helper is not available in this n8n Code node');
}

async function requestWithRetry(options, label, maxAttempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await requestRaw(options);
      if (response.statusCode >= 200 && response.statusCode < 300) return response;
      lastError = new Error(label + '_http_' + response.statusCode + ': ' + response.body.toString('utf8').slice(0, 500));
    } catch (error) {
      lastError = error;
    }
    if (attempt < maxAttempts) {
      await sleep(750 * attempt);
    }
  }
  throw lastError || new Error(label + '_failed');
}

function buildFailure(message, metadata = {}) {
  return [
    {
      json: {
        ...input,
        message_type: 'AUDIO',
        original_message_type: 'AUDIO',
        chatInput: '',
        audio_transcript: null,
        audio_transcription_failed: true,
        audio_error_message: message,
        audio_metadata: {
          ...(input.audio_metadata && typeof input.audio_metadata === 'object' ? input.audio_metadata : {}),
          ...metadata,
        },
      },
    },
  ];
}

const resolvedFromWebhook = collectAttachments(input.raw || {}).find(attachmentLooksAudio) || null;

async function fetchAttachmentFromChatwootApi() {
  try {
    if (!chatwootBaseUrl || !chatwootToken || !input.chatwoot_id || !input.chatwoot_message_id) return null;
    const response = await requestWithRetry(
      {
        method: 'GET',
        url:
          chatwootBaseUrl +
          '/api/v1/accounts/' +
          String(chatwootAccountId) +
          '/conversations/' +
          String(input.chatwoot_id) +
          '/messages',
        headers: {
          api_access_token: chatwootToken,
          Accept: 'application/json',
        },
        timeout: 120000,
      },
      'chatwoot_message_lookup',
    );

    const payload = parseJsonSafe(response.body.toString('utf8')) || {};
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.payload)
        ? payload.payload
        : Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload?.messages)
            ? payload.messages
            : [];

    const matched = items.find(
      (message) => String(message?.id || message?.message_id || '') === String(input.chatwoot_message_id || ''),
    );
    if (!matched) return null;
    return collectAttachments(matched).find(attachmentLooksAudio) || null;
  } catch {
    return null;
  }
}

function pushCandidateAttachment(list, attachment, source) {
  if (!attachment || typeof attachment !== 'object') return;
  const url = ensureAbsoluteUrl(attachmentUrl(attachment));
  if (!url) return;
  const key = source + '::' + url;
  if (list.some((entry) => entry.key === key)) return;
  list.push({
    key,
    source,
    attachment,
    audioUrl: url,
    audioFilename:
      attachmentFilename(attachment) ||
      input.audio_filename ||
      ('audio-' + String(input.chatwoot_message_id || Date.now()) + '.ogg'),
    audioMimeType: inferAudioMimeType(
      attachmentMimeType(attachment) || input.audio_mime_type || 'audio/ogg',
      attachmentFilename(attachment) || input.audio_filename || '',
    ),
  });
}

try {
  const candidateAttachments = [];
  pushCandidateAttachment(candidateAttachments, resolvedFromWebhook, 'webhook');
  pushCandidateAttachment(candidateAttachments, await fetchAttachmentFromChatwootApi(), 'chatwoot_api');
  if (input.audio_url) {
    candidateAttachments.push({
      key: 'input::' + String(input.audio_url),
      source: 'input',
      attachment: null,
      audioUrl: ensureAbsoluteUrl(input.audio_url),
      audioFilename:
        input.audio_filename ||
        ('audio-' + String(input.chatwoot_message_id || Date.now()) + '.ogg'),
      audioMimeType: inferAudioMimeType(input.audio_mime_type || 'audio/ogg', input.audio_filename || ''),
    });
  }

  if (!candidateAttachments.length) {
    return buildFailure('audio_attachment_url_not_found', {
      audio_url: input.audio_url || null,
      audio_mime_type: input.audio_mime_type || null,
      audio_filename: input.audio_filename || null,
    });
  }

  const chosenCandidate = candidateAttachments[0];
  const audioUrl = chosenCandidate.audioUrl;
  const audioFilename = chosenCandidate.audioFilename;
  const audioMimeType = chosenCandidate.audioMimeType;

  return [
    {
      json: {
        ...input,
        message_type: 'AUDIO',
        original_message_type: 'AUDIO',
        chatInput: '',
        audio_url: audioUrl,
        audio_mime_type: audioMimeType,
        audio_filename: audioFilename,
        audio_transcript: null,
        audio_transcription_failed: false,
        audio_error_message: null,
        audio_metadata: {
          audio_url: audioUrl,
          audio_mime_type: audioMimeType,
          audio_filename: audioFilename,
          chatwoot_message_id: input.chatwoot_message_id || null,
        },
        openai_api_key_present: Boolean(openAiApiKey),
        openai_transcription_model: openAiModel || 'gpt-4o-mini-transcribe',
      },
    },
  ];
} catch (error) {
  return buildFailure(error.message || 'audio_transcription_failed', {
    audio_url: input.audio_url || null,
    audio_mime_type: input.audio_mime_type || null,
    audio_filename: input.audio_filename || null,
    chatwoot_message_id: input.chatwoot_message_id || null,
  });
}`;
}

function buildNormalizeAudioTranscriptionCode() {
  return String.raw`const source = $('Transcribe inbound audio').item.json || {};
const items = $input.all();
const first = items[0] || {};
const payload = first.json || {};
const compact = (value) => String(value || '').trim();

function buildFailure(message, metadata = {}) {
  return [
    {
      json: {
        ...source,
        message_type: 'AUDIO',
        original_message_type: 'AUDIO',
        chatInput: '',
        audio_transcript: null,
        audio_transcription_failed: true,
        audio_error_message: message,
        audio_metadata: {
          ...(source.audio_metadata && typeof source.audio_metadata === 'object' ? source.audio_metadata : {}),
          ...metadata,
        },
      },
    },
  ];
}

const topLevelError =
  first?.error?.message ||
  (typeof payload?.error === 'string' ? payload.error : null) ||
  payload?.errorMessage ||
  payload?.message ||
  payload?.error?.message ||
  payload?.error_description ||
  null;

if (topLevelError) {
  return buildFailure(String(topLevelError), {
    audio_url: source.audio_url || null,
    audio_mime_type: source.audio_mime_type || null,
    audio_filename: source.audio_filename || null,
  });
}

const transcript = compact(
  payload?.text ||
    payload?.transcript ||
    payload?.data?.text ||
    payload?.output_text ||
    '',
);

if (!transcript) {
  return buildFailure('openai_transcription_empty', {
    audio_url: source.audio_url || null,
    audio_mime_type: source.audio_mime_type || null,
    audio_filename: source.audio_filename || null,
    openai_response: payload && typeof payload === 'object' ? payload : null,
  });
}

return [
  {
    json: {
      ...source,
      message_type: 'AUDIO',
      original_message_type: 'AUDIO',
      chatInput: transcript,
      audio_transcript: transcript,
      audio_transcription_failed: false,
      audio_error_message: null,
      audio_metadata: {
        ...(source.audio_metadata && typeof source.audio_metadata === 'object' ? source.audio_metadata : {}),
        openai_model: source.openai_transcription_model || null,
      },
    },
  },
];`;
}

function patchPropertySequenceCode(code) {
  if (code.includes(`type: 'media_group'`) && code.includes(`property_title: title`)) {
    return code;
  }

  const oldBlock = String.raw`function buildMediaMessages(finca) {
  const urls = parseUrls(finca?.foto_url);
  if (!urls.length) return [];
  const title = finca?.nombre || finca?.finca_id || 'la finca';
  return urls.map((url) => ({
    type: 'text',
    content: 'Fotos y/o video de ' + title + ':\n' + url,
    media_url: url,
  }));
}

function createTextMessage(content, extra = {}) {
  const text = String(content || '').trim();
  if (!text) return null;
  return {
    type: 'text',
    content: text,
    media_url: extra.media_url || null,
  };
}

function buildPropertySequence(tool, toolOutputParsed, finalWhatsappText) {
  const intent = toolOutputParsed?.intent || null;
  const selectedFinca = toolOutputParsed?.selected_finca && typeof toolOutputParsed.selected_finca === 'object'
    ? toolOutputParsed.selected_finca
    : null;
  const fincasMostradas = Array.isArray(toolOutputParsed?.fincas_mostradas)
    ? toolOutputParsed.fincas_mostradas.filter((item) => item && typeof item === 'object')
    : [];

  const sequence = [];

  if (tool === 'offering_agent' && intent === 'SHOW_OPTIONS' && fincasMostradas.length) {
    const intro = createTextMessage(finalWhatsappText);
    if (intro) sequence.push(intro);
    for (const finca of fincasMostradas) {
      sequence.push(...buildMediaMessages(finca));
      const card = buildFincaCard(finca);
      const cardMessage = createTextMessage(card);
      if (cardMessage) sequence.push(cardMessage);
    }
    return sequence;
  }

  if (selectedFinca && ['offering_agent', 'verifying_availability_agent', 'qa_agent'].includes(tool)) {
    const intro = createTextMessage(finalWhatsappText);
    if (intro) sequence.push(intro);
    sequence.push(...buildMediaMessages(selectedFinca));
    const card = buildFincaCard(selectedFinca);
    const cardMessage = createTextMessage(card);
    if (cardMessage) sequence.push(cardMessage);
    return sequence;
  }

  return [];
}`;

  const newBlock = String.raw`function buildMediaMessages(finca) {
  const urls = parseUrls(finca?.foto_url);
  if (!urls.length) return [];
  const title = finca?.nombre || finca?.finca_id || 'la finca';
  return [
    {
      type: 'media_group',
      content: 'Fotos y/o video de ' + title,
      media_url: urls[0],
      media_urls: urls,
      property_title: title,
      property_id: finca?.finca_id || null,
    },
  ];
}

function createTextMessage(content, extra = {}) {
  const text = String(content || '').trim();
  if (!text) return null;
  return {
    type: extra.type || 'text',
    content: text,
    media_url: extra.media_url || null,
    media_urls: Array.isArray(extra.media_urls) ? extra.media_urls : undefined,
  };
}

function buildPropertySequence(tool, toolOutputParsed, finalWhatsappText) {
  const intent = toolOutputParsed?.intent || null;
  const selectedFinca = toolOutputParsed?.selected_finca && typeof toolOutputParsed.selected_finca === 'object'
    ? toolOutputParsed.selected_finca
    : null;
  const fincasMostradas = Array.isArray(toolOutputParsed?.fincas_mostradas)
    ? toolOutputParsed.fincas_mostradas.filter((item) => item && typeof item === 'object')
    : [];

  const sequence = [];

  if (tool === 'offering_agent' && intent === 'SHOW_OPTIONS' && fincasMostradas.length) {
    for (const finca of fincasMostradas) {
      sequence.push(...buildMediaMessages(finca));
      const card = buildFincaCard(finca);
      const cardMessage = createTextMessage(card);
      if (cardMessage) sequence.push(cardMessage);
    }
    return sequence;
  }

  if (selectedFinca && ['offering_agent', 'verifying_availability_agent', 'qa_agent'].includes(tool)) {
    sequence.push(...buildMediaMessages(selectedFinca));
    const card = buildFincaCard(selectedFinca);
    const cardMessage = createTextMessage(card);
    if (cardMessage) sequence.push(cardMessage);
    const trailingText =
      finalWhatsappText && String(finalWhatsappText).trim() !== String(card || '').trim()
        ? createTextMessage(finalWhatsappText)
        : null;
    if (trailingText) sequence.push(trailingText);
    return sequence;
  }

  return [];
}`;

  return replaceExact(code, oldBlock, newBlock, 'Code in JavaScript1 property sequence');
}

function patchInsertOutboundQuery(query) {
  let patched = query;

  patched = patched.replace(
    String.raw`    case
      when coalesce(message.value->>'type', '') in ('media', 'media_group') then 'MEDIA'
      else 'TEXT'
    end,`,
    String.raw`    'TEXT',`,
  );

  if (!patched.includes(`nullif(trim(coalesce(message.value->>'media_url', '')), '') is not null`)) {
    patched = replaceExact(
      patched,
      String.raw`  where nullif(trim(coalesce(message.value->>'content', '')), '') is not null`,
      String.raw`  where
    nullif(trim(coalesce(message.value->>'content', '')), '') is not null
    or nullif(trim(coalesce(message.value->>'media_url', '')), '') is not null`,
      'Insert OUTBOUND media filter',
    );
  }

  return patched;
}

function patchInsertInboundQuery(query) {
  return query.replace(
    /\n\s*\{\{\s*"'"\s*\+\s*String\(\$\('Merge Sets1'\)\.item\.json\.message_type \|\| 'TEXT'\)\.replace\(\/'\/g,\s*"''"\)\s*\+\s*"'" \}\},/g,
    "\n  'TEXT',",
  );
}

function buildSenderQueueCode() {
  return String.raw`const input = $('When outbound sender is called').item.json || {};

const CHATWOOT_BASE_URL = ${JSON.stringify(CHATWOOT_BASE_URL)};
const CHATWOOT_ACCOUNT_ID = String(input.chatwoot_account_id || ${JSON.stringify(CHATWOOT_ACCOUNT_ID)});
const CHATWOOT_API_TOKEN = String(input.chatwoot_api_token || ${JSON.stringify(CHATWOOT_API_TOKEN)});
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 900;

const compact = (value) => String(value || '').trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const helperRequest =
  typeof $httpRequest === 'function'
    ? $httpRequest
    : typeof this !== 'undefined' && this?.helpers?.httpRequest
      ? this.helpers.httpRequest.bind(this.helpers)
      : null;

function parseSequence(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = compact(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function inferFilenameFromUrl(url, fallback = 'asset.bin') {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || '';
    const candidate = decodeURIComponent(pathname.split('/').pop() || '').trim();
    return candidate || fallback;
  } catch {
    return fallback;
  }
}

function inferExtensionFromContentType(contentType) {
  const normalized = compact(contentType).toLowerCase();
  const map = new Map([
    ['image/jpeg', '.jpg'],
    ['image/jpg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp'],
    ['image/gif', '.gif'],
    ['video/mp4', '.mp4'],
    ['video/quicktime', '.mov'],
    ['video/webm', '.webm'],
    ['video/x-msvideo', '.avi'],
    ['application/pdf', '.pdf'],
  ]);
  return map.get(normalized) || '';
}

function inferContentTypeFromFilename(filename, fallback = 'application/octet-stream') {
  const lower = compact(filename).toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.avi')) return 'video/x-msvideo';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return fallback;
}

function normalizeBinaryBody(value) {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
  if (Array.isArray(value)) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (typeof value === 'object') {
    if (value.type === 'Buffer' && Array.isArray(value.data)) {
      return Buffer.from(value.data);
    }
    try {
      return Buffer.from(JSON.stringify(value), 'utf8');
    } catch {
      return Buffer.from(String(value), 'utf8');
    }
  }
  return Buffer.from(String(value), 'utf8');
}

async function requestRaw(options) {
  let headers = { ...(options.headers || {}) };
  let requestBody = options.body;
  if (Array.isArray(options.multipartParts) && options.multipartParts.length) {
    const multipart = buildMultipartBody(options.multipartParts);
    headers = {
      ...headers,
      'Content-Type': 'multipart/form-data; boundary=' + multipart.boundary,
      'Content-Length': String(multipart.body.length),
    };
    requestBody = multipart.body;
  }
  if (helperRequest) {
    let response;
    try {
      response = await helperRequest({
        url: options.url,
        method: options.method || 'GET',
        headers,
        body: requestBody,
        formData: options.formData,
        json: false,
        encoding: null,
        timeout: Number(options.timeout || 120000),
        ignoreHttpStatusErrors: true,
        returnFullResponse: true,
      });
    } catch (error) {
      const fallbackResponse = error?.response || error?.context?.response || null;
      if (!fallbackResponse) throw error;
      response = fallbackResponse;
    }

    return {
      statusCode: Number(response.statusCode || response.status || 0),
      headers: response.headers || {},
      body: normalizeBinaryBody(response.body ?? response.data) || Buffer.from(''),
    };
  }

  throw new Error('$httpRequest helper is not available in this n8n Code node');
}

async function requestWithRetry(options, label, maxAttempts = MAX_RETRIES) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await requestRaw(options);
      if (response.statusCode >= 200 && response.statusCode < 300) return response;
      lastError = new Error(label + '_http_' + response.statusCode + ': ' + response.body.toString('utf8').slice(0, 500));
    } catch (error) {
      lastError = error;
    }

    if (attempt < maxAttempts) {
      await sleep(RETRY_BASE_MS * attempt);
    }
  }

  throw lastError || new Error(label + '_failed');
}

function buildMultipartBody(parts) {
  const boundary = '----codex-' + Date.now().toString(16) + '-' + Math.random().toString(16).slice(2);
  const chunks = [];

  for (const part of parts) {
    if (!part?.name) continue;
    chunks.push(Buffer.from('--' + boundary + '\r\n'));

    if (part.filename) {
      chunks.push(
        Buffer.from(
          'Content-Disposition: form-data; name="' +
            String(part.name).replace(/"/g, '\\"') +
            '"; filename="' +
            String(part.filename).replace(/"/g, '\\"') +
            '"\r\n',
        ),
      );
      chunks.push(Buffer.from('Content-Type: ' + String(part.contentType || 'application/octet-stream') + '\r\n\r\n'));
      chunks.push(normalizeBinaryBody(part.value) || Buffer.from(''));
      chunks.push(Buffer.from('\r\n'));
    } else {
      chunks.push(Buffer.from('Content-Disposition: form-data; name="' + String(part.name).replace(/"/g, '\\"') + '"\r\n\r\n'));
      chunks.push(Buffer.from(String(part.value ?? '')));
      chunks.push(Buffer.from('\r\n'));
    }
  }

  chunks.push(Buffer.from('--' + boundary + '--\r\n'));
  return {
    boundary,
    body: Buffer.concat(chunks),
  };
}

function extractDriveFolderId(url) {
  const match =
    compact(url).match(/drive\.google\.com\/drive\/folders\/([a-zA-Z0-9_-]+)/i) ||
    compact(url).match(/[?&]id=([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

function extractDriveFileId(url) {
  const match =
    compact(url).match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i) ||
    compact(url).match(/[?&]id=([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

function isDriveFolderUrl(url) {
  return /drive\.google\.com\/drive\/folders\//i.test(compact(url));
}

function isDriveFileUrl(url) {
  return /drive\.google\.com\/file\/d\//i.test(compact(url)) || (/drive\.google\.com/i.test(compact(url)) && /[?&]id=/.test(compact(url)));
}

function directDriveDownloadUrl(fileId) {
  return 'https://drive.google.com/uc?export=download&id=' + String(fileId);
}

function inferMediaKind(contentType) {
  const normalized = compact(contentType).toLowerCase();
  if (normalized.startsWith('video/')) return 'video';
  if (normalized.startsWith('image/')) return 'image';
  return 'file';
}

async function resolveFolderAssets(folderUrl) {
  const folderId = extractDriveFolderId(folderUrl);
  if (!folderId) throw new Error('drive_folder_id_not_found');
  const embedUrl = 'https://drive.google.com/embeddedfolderview?id=' + folderId + '#list';
  const response = await requestWithRetry(
    {
      method: 'GET',
      url: embedUrl,
      headers: { Accept: 'text/html,application/xhtml+xml' },
      timeout: 120000,
    },
    'drive_folder_listing',
  );
  const html = response.body.toString('utf8');
  const matches = Array.from(html.matchAll(/https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)\/view/gi));
  return uniqueStrings(matches.map((match) => directDriveDownloadUrl(match[1]))).map((downloadUrl) => ({
    source_url: folderUrl,
    download_url: downloadUrl,
  }));
}

async function resolveSequenceAssets(item) {
  const rawUrls = uniqueStrings([
    ...(Array.isArray(item.media_urls) ? item.media_urls : []),
    item.media_url,
  ]);

  const assets = [];
  for (const url of rawUrls) {
    if (isDriveFolderUrl(url)) {
      const resolved = await resolveFolderAssets(url);
      assets.push(...resolved);
      continue;
    }

    if (isDriveFileUrl(url)) {
      const fileId = extractDriveFileId(url);
      if (fileId) {
        assets.push({
          source_url: url,
          download_url: directDriveDownloadUrl(fileId),
        });
        continue;
      }
    }

    assets.push({
      source_url: url,
      download_url: url,
    });
  }

  return uniqueStrings(assets.map((asset) => asset.download_url)).map((downloadUrl) => ({
    download_url: downloadUrl,
    source_url: assets.find((asset) => asset.download_url === downloadUrl)?.source_url || downloadUrl,
  }));
}

async function downloadAsset(asset) {
  const response = await requestWithRetry(
    {
      method: 'GET',
      url: asset.download_url,
      headers: { Accept: '*/*' },
      timeout: 180000,
    },
    'media_download',
  );

  const contentTypeHeader = Array.isArray(response.headers['content-type'])
    ? response.headers['content-type'][0]
    : response.headers['content-type'] || response.headers['Content-Type'] || '';
  const contentDisposition = Array.isArray(response.headers['content-disposition'])
    ? response.headers['content-disposition'][0]
    : response.headers['content-disposition'] || response.headers['Content-Disposition'] || '';

  let filename =
    (contentDisposition.match(/filename\\*=UTF-8''([^;]+)/i)?.[1] || '').trim() ||
    (contentDisposition.match(/filename=\"?([^\";]+)\"?/i)?.[1] || '').trim() ||
    inferFilenameFromUrl(asset.download_url, '');

  const fallbackName = inferFilenameFromUrl(asset.source_url || asset.download_url, 'asset');
  if (!filename) filename = fallbackName;
  const extension = inferExtensionFromContentType(contentTypeHeader);
  if (extension && !filename.toLowerCase().endsWith(extension)) {
    filename += extension;
  }

  const contentType = compact(contentTypeHeader) || inferContentTypeFromFilename(filename);
  return {
    buffer: response.body,
    filename,
    contentType,
    mediaKind: inferMediaKind(contentType),
    sourceUrl: asset.source_url || asset.download_url,
  };
}

async function sendChatwootTextMessage({ chatwootId, message, privateMessage }) {
  const payload = {
    content: compact(message),
    message_type: 'outgoing',
    private: privateMessage === true,
  };
  return requestWithRetry(
    {
      method: 'POST',
      url:
        CHATWOOT_BASE_URL +
        '/api/v1/accounts/' +
        String(CHATWOOT_ACCOUNT_ID) +
        '/conversations/' +
        String(chatwootId) +
        '/messages',
      headers: {
        api_access_token: CHATWOOT_API_TOKEN,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: Buffer.from(JSON.stringify(payload)),
      timeout: 120000,
    },
    'chatwoot_text_send',
  );
}

async function sendChatwootAttachmentMessage({ chatwootId, file, privateMessage }) {
  return requestWithRetry(
    {
      method: 'POST',
      url:
        CHATWOOT_BASE_URL +
        '/api/v1/accounts/' +
        String(CHATWOOT_ACCOUNT_ID) +
        '/conversations/' +
        String(chatwootId) +
        '/messages',
      headers: {
        api_access_token: CHATWOOT_API_TOKEN,
        Accept: 'application/json',
      },
      multipartParts: [
        { name: 'content', value: '' },
        { name: 'message_type', value: 'outgoing' },
        { name: 'private', value: privateMessage === true ? 'true' : 'false' },
        {
          name: 'attachments[]',
          value: file.buffer,
          filename: file.filename,
          contentType: file.contentType,
        },
      ],
      timeout: 180000,
    },
    'chatwoot_attachment_send',
  );
}

function describeError(error) {
  if (!error) return 'unknown_error';
  if (error instanceof Error && compact(error.message)) return compact(error.message);
  return compact(error) || 'unknown_error';
}

async function safeTextSend({ chatwootId, message, privateMessage }) {
  try {
    await sendChatwootTextMessage({ chatwootId, message, privateMessage });
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}

async function safeAttachmentSend({ chatwootId, file, privateMessage }) {
  try {
    await sendChatwootAttachmentMessage({ chatwootId, file, privateMessage });
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
}

async function sendMediaGroup(item, results) {
  const assets = await resolveSequenceAssets(item);
  if (!assets.length) {
    if (compact(item.content)) {
      const sendResult = await safeTextSend({
        chatwootId: input.chatwoot_id,
        message: compact(item.content) + '\n' + uniqueStrings([item.media_url, ...(item.media_urls || [])]).join('\n'),
        privateMessage: item.private === true || input.private === true,
      });
      results.push({
        ok: sendResult.ok,
        type: 'text_fallback',
        property_title: item.property_title || null,
        error: sendResult.error,
      });
    }
    return;
  }

  for (const asset of assets) {
    try {
      const file = await downloadAsset(asset);
      const sendResult = await safeAttachmentSend({
        chatwootId: input.chatwoot_id,
        file,
        privateMessage: item.private === true || input.private === true,
      });
      results.push({
        ok: sendResult.ok,
        type: 'media',
        media_kind: file.mediaKind,
        filename: file.filename,
        property_title: item.property_title || null,
        source_url: file.sourceUrl,
        error: sendResult.error,
      });
    } catch (error) {
      const fallbackResult = await safeTextSend({
        chatwootId: input.chatwoot_id,
        message:
          'No pude adjuntar uno de los assets de ' +
          String(item.property_title || 'la finca') +
          ' en este momento. Te comparto el enlace:\n' +
          String(asset.source_url || asset.download_url),
        privateMessage: item.private === true || input.private === true,
      });
      results.push({
        ok: false,
        type: 'media_fallback',
        error: describeError(error),
        source_url: asset.source_url || asset.download_url,
        property_title: item.property_title || null,
        fallback_sent: fallbackResult.ok,
        fallback_error: fallbackResult.error,
      });
    }
  }
}

const sequence = parseSequence(input.outbound_sequence_json || input.outbound_sequence);
const queue = sequence.length
  ? sequence
  : [createFallbackMessage()].filter(Boolean);

function createFallbackMessage() {
  const content = compact(input.message || input.outbound_message || input.final_whatsapp_text || '');
  if (!content) return null;
  return {
    type: 'text',
    content,
    private: input.private === true,
  };
}

const results = [];

for (const rawItem of queue) {
  const item = rawItem && typeof rawItem === 'object' ? rawItem : null;
  if (!item) continue;
  const type = compact(item.type || '');
  if (type === 'media_group' || (item.media_url && type !== 'text')) {
    await sendMediaGroup(item, results);
    continue;
  }

  const content = compact(item.content);
  if (!content) continue;
  const sendResult = await safeTextSend({
    chatwootId: input.chatwoot_id,
    message: content,
    privateMessage: item.private === true || input.private === true,
  });
  results.push({
    ok: sendResult.ok,
    type: 'text',
    content,
    error: sendResult.error,
  });
}

return [
  {
    json: {
      ok: results.every((entry) => entry.ok !== false),
      chatwoot_id: input.chatwoot_id,
      sent_count: results.length,
      results,
    },
  },
];`;
}

function patchMainWorkflow(workflow) {
  const transcribeNode = findNode(workflow, 'Transcribe inbound audio');
  transcribeNode.parameters.jsCode = buildAudioAttachmentResolverCode();

  const audioResolvedNode = upsertNode(workflow, 'Audio attachment resolved?', () => ({
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
            leftValue: "={{ $json.audio_transcription_failed !== true && Boolean($json.audio_url) }}",
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
    name: 'Audio attachment resolved?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [2624, 912],
    id: newId(),
  }));

  audioResolvedNode.parameters = {
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
          leftValue: "={{ $json.audio_transcription_failed !== true && Boolean($json.audio_url) }}",
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

  const downloadAudioNode = upsertNode(workflow, 'Download inbound audio', () => ({
    parameters: {
      url: '={{ $json.audio_url }}',
      options: {
        response: {
          response: {
            responseFormat: 'file',
          },
        },
      },
    },
    id: newId(),
    name: 'Download inbound audio',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [2864, 832],
    retryOnFail: true,
    waitBetweenTries: 5000,
    onError: 'continueRegularOutput',
  }));
  downloadAudioNode.parameters = {
    url: '={{ $json.audio_url }}',
    options: {
      response: {
        response: {
          responseFormat: 'file',
        },
      },
    },
  };
  downloadAudioNode.retryOnFail = true;
  downloadAudioNode.waitBetweenTries = 5000;
  downloadAudioNode.onError = 'continueRegularOutput';

  const openAiTranscribeNode = upsertNode(workflow, 'OpenAI transcribe inbound audio', () => ({
    parameters: {
      method: 'POST',
      url: 'https://api.openai.com/v1/audio/transcriptions',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          {
            name: 'Authorization',
            value: `Bearer ${OPENAI_API_KEY_FALLBACK}`,
          },
          {
            name: 'Accept',
            value: 'application/json',
          },
        ],
      },
      sendBody: true,
      contentType: 'multipart-form-data',
      bodyParameters: {
        parameters: [
          {
            parameterType: 'formData',
            name: 'model',
            value: `={{ $json.openai_transcription_model || ${JSON.stringify(OPENAI_TRANSCRIPTION_MODEL)} }}`,
          },
          {
            parameterType: 'formBinaryData',
            name: 'file',
            inputDataFieldName: 'data',
          },
        ],
      },
      options: {
        timeout: 180000,
      },
    },
    id: newId(),
    name: 'OpenAI transcribe inbound audio',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [3104, 832],
    retryOnFail: true,
    waitBetweenTries: 5000,
    onError: 'continueRegularOutput',
  }));
  openAiTranscribeNode.parameters = {
    method: 'POST',
    url: 'https://api.openai.com/v1/audio/transcriptions',
    sendHeaders: true,
    headerParameters: {
      parameters: [
        {
          name: 'Authorization',
          value: `Bearer ${OPENAI_API_KEY_FALLBACK}`,
        },
        {
          name: 'Accept',
          value: 'application/json',
        },
      ],
    },
    sendBody: true,
    contentType: 'multipart-form-data',
    bodyParameters: {
      parameters: [
        {
          parameterType: 'formData',
          name: 'model',
          value: `={{ $json.openai_transcription_model || ${JSON.stringify(OPENAI_TRANSCRIPTION_MODEL)} }}`,
        },
        {
          parameterType: 'formBinaryData',
          name: 'file',
          inputDataFieldName: 'data',
        },
      ],
    },
    options: {
      timeout: 180000,
    },
  };
  openAiTranscribeNode.retryOnFail = true;
  openAiTranscribeNode.waitBetweenTries = 5000;
  openAiTranscribeNode.onError = 'continueRegularOutput';

  const normalizeTranscribedAudioNode = upsertNode(workflow, 'Normalize transcribed audio', () => ({
    parameters: {
      jsCode: buildNormalizeAudioTranscriptionCode(),
    },
    id: newId(),
    name: 'Normalize transcribed audio',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [3344, 832],
  }));
  normalizeTranscribedAudioNode.parameters.jsCode = buildNormalizeAudioTranscriptionCode();

  const codeNode = findNode(workflow, 'Code in JavaScript1');
  codeNode.parameters.jsCode = patchPropertySequenceCode(String(codeNode.parameters.jsCode || ''));

  const outboundNode = findNode(workflow, 'Insert OUTBOUND message (messages)');
  outboundNode.parameters.query = patchInsertOutboundQuery(String(outboundNode.parameters.query || ''));

  const inboundNode = findNode(workflow, 'Insert INBOUND message (messages)1');
  inboundNode.parameters.query = patchInsertInboundQuery(String(inboundNode.parameters.query || ''));

  setMainConnections(workflow, 'Merge Sets1', [['Get Context-conversations1']]);
  setMainConnections(workflow, 'Route audio inbound?', [['Transcribe inbound audio'], ['Execution Data1']]);
  setMainConnections(workflow, 'Transcribe inbound audio', [['Audio attachment resolved?']]);
  setMainConnections(workflow, 'Audio attachment resolved?', [['Download inbound audio'], ['Execution Data1']]);
  setMainConnections(workflow, 'Download inbound audio', [['OpenAI transcribe inbound audio']]);
  setMainConnections(workflow, 'OpenAI transcribe inbound audio', [['Normalize transcribed audio']]);
  setMainConnections(workflow, 'Normalize transcribed audio', [['Execution Data1']]);

  return workflow;
}

function patchSenderWorkflow(workflow) {
  const processNode =
    findNodeMaybe(workflow, 'Process outbound queue') ||
    findNode(workflow, 'Expand outbound sequence');
  processNode.name = 'Process outbound queue';
  processNode.parameters.jsCode = buildSenderQueueCode();

  const resultNode = findNode(workflow, 'Outbound send result');
  resultNode.parameters = {
    assignments: {
      assignments: [
        {
          id: newId(),
          name: 'ok',
          value: '={{ $json.ok === true }}',
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
          name: 'sent_count',
          value: '={{ Number($json.sent_count || 0) }}',
          type: 'number',
        },
        {
          id: newId(),
          name: 'results',
          value: '={{ $json.results || [] }}',
          type: 'array',
        },
      ],
    },
    options: {},
  };

  const legacySendNode = findNodeMaybe(workflow, 'Send Chatwoot message');
  if (legacySendNode) {
    legacySendNode.disabled = true;
  }

  setMainConnections(workflow, 'When outbound sender is called', [['Process outbound queue']]);
  setMainConnections(workflow, 'Process outbound queue', [['Outbound send result']]);
  setMainConnections(workflow, 'Outbound send result', [[]]);

  delete workflow.connections['Send Chatwoot message'];
  delete workflow.connections['Expand outbound sequence'];

  return workflow;
}

async function writeLocalBackup(fileName, workflow) {
  await fs.mkdir(path.resolve('backups/workflows'), { recursive: true });
  await fs.writeFile(path.resolve('backups/workflows', fileName), JSON.stringify(workflow, null, 2));
}

async function updateWorkflow(workflowId, workflow, label) {
  let wasActive = Boolean(workflow.active);
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
  const refreshed = await api(`/api/v1/workflows/${workflowId}`);
  console.log(`[ok] updated ${label}:`, refreshed.id);
  return refreshed;
}

async function backupWorkflow(workflow, name) {
  const created = await api('/api/v1/workflows', {
    method: 'POST',
    body: JSON.stringify(sanitizeWorkflowForCreate(workflow, name)),
  });
  if (workflow.active) {
    await api(`/api/v1/workflows/${created.id}/deactivate`, { method: 'POST' });
  }
  return created;
}

async function main() {
  const mainWorkflow = await api(`/api/v1/workflows/${MAIN_WORKFLOW_ID}`);
  const senderWorkflow = await api(`/api/v1/workflows/${SENDER_WORKFLOW_ID}`);

  await writeLocalBackup(`${MAIN_WORKFLOW_ID}-before-audio-media-followon.json`, mainWorkflow);
  await writeLocalBackup(`${SENDER_WORKFLOW_ID}-before-audio-media-followon.json`, senderWorkflow);

  const remoteBackupMain = await backupWorkflow(
    mainWorkflow,
    `${mainWorkflow.name} BACKUP before audio-media-followon ${new Date().toISOString()}`,
  );
  const remoteBackupSender = await backupWorkflow(
    senderWorkflow,
    `${senderWorkflow.name} BACKUP before audio-media-followon ${new Date().toISOString()}`,
  );

  console.log('[backup] main workflow:', remoteBackupMain.id);
  console.log('[backup] sender workflow:', remoteBackupSender.id);

  patchMainWorkflow(mainWorkflow);
  patchSenderWorkflow(senderWorkflow);

  const updatedMain = await updateWorkflow(MAIN_WORKFLOW_ID, mainWorkflow, 'main workflow');
  const updatedSender = await updateWorkflow(SENDER_WORKFLOW_ID, senderWorkflow, 'sender workflow');

  await fs.writeFile(path.resolve('current_workflow.json'), JSON.stringify(updatedMain, null, 2));
  await fs.writeFile(path.resolve('updated_main_workflow.json'), JSON.stringify(updatedMain, null, 2));
  await fs.writeFile(path.resolve('chatwoot_outbound_sender_workflow.json'), JSON.stringify(updatedSender, null, 2));

  console.log(JSON.stringify({
    mainWorkflowId: updatedMain.id,
    senderWorkflowId: updatedSender.id,
    mainVersionId: updatedMain.versionId || null,
    senderVersionId: updatedSender.versionId || null,
    backups: {
      main: remoteBackupMain.id,
      sender: remoteBackupSender.id,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
