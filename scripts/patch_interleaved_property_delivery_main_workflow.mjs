import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT_DIR = process.cwd();
const MAIN_WORKFLOW_FILE = path.join(ROOT_DIR, 'current_workflow.json');

function findNode(nodes, name) {
  const node = (nodes || []).find((item) => item.name === name);
  if (!node) {
    throw new Error(`Node not found: ${name}`);
  }
  return node;
}

function replaceExact(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Patch anchor not found for ${label}`);
  }
  return source.replace(before, after);
}

function replaceExactOrSame(source, before, after, label) {
  if (source.includes(after)) {
    return source;
  }
  return replaceExact(source, before, after, label);
}

function replaceOneOfOrSame(source, beforeList, after, label) {
  if (source.includes(after)) {
    return source;
  }
  for (const before of beforeList) {
    if (source.includes(before)) {
      return source.replace(before, after);
    }
  }
  throw new Error(`Patch anchor not found for ${label}`);
}

const SEND_OUTBOUND_MESSAGES_CODE = String.raw`const prevData = $input.first().json || {};

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

const compact = (value) => String(value ?? '').trim();
const rawSequence = parseSequence(prevData.outbound_sequence_json || prevData.outbound_sequence || '[]');
const fallbackMessage = compact(prevData.outbound_message || prevData.final_whatsapp_text || '');
const senderSequence = rawSequence.length
  ? rawSequence
  : fallbackMessage
    ? [{ type: 'text', content: fallbackMessage, private: false }]
    : [];

return [
  {
    json: {
      ...prevData,
      texts_sent: 0,
      texts_ok: true,
      has_media: senderSequence.length > 0,
      media_groups_json: JSON.stringify(senderSequence),
      media_groups_count: senderSequence.length,
      outbound_results: [],
      should_fire_outbound_sender: senderSequence.length > 0,
      sender_sequence_json: JSON.stringify(senderSequence),
      sender_items_count: senderSequence.length,
    },
  },
];`;

const CREATE_TEXT_MESSAGE_BEFORE = String.raw`function createTextMessage(content, extra = {}) {
  const text = String(content || '').trim();
  if (!text) return null;
  return {
    type: extra.type || 'text',
    content: text,
    media_url: extra.media_url || null,
    media_urls: Array.isArray(extra.media_urls) ? extra.media_urls : undefined,
  };
}`;

const CREATE_TEXT_MESSAGE_AFTER = String.raw`function createTextMessage(content, extra = {}) {
  const text = String(content || '').trim();
  if (!text) return null;
  return {
    type: extra.type || 'text',
    content: text,
    media_url: extra.media_url || null,
    media_urls: Array.isArray(extra.media_urls) ? extra.media_urls : undefined,
    property_title: extra.property_title || null,
    property_id: extra.property_id || null,
  };
}`;

const SHOW_OPTIONS_BEFORE = String.raw`  if (tool === 'offering_agent' && intent === 'SHOW_OPTIONS' && fincasMostradas.length) {
    for (const finca of fincasMostradas) {
      sequence.push(...buildMediaMessages(finca));
      const card = buildFincaCard(finca);
      const cardMessage = createTextMessage(card);
      if (cardMessage) sequence.push(cardMessage);
    }
    return sequence;
  }`;

const SHOW_OPTIONS_AFTER = String.raw`  if (tool === 'offering_agent' && intent === 'SHOW_OPTIONS' && fincasMostradas.length) {
    for (const finca of fincasMostradas) {
      const card = buildFincaCard(finca);
      const cardMessage = createTextMessage(card, {
        property_title: finca?.nombre || finca?.finca_id || null,
        property_id: finca?.finca_id || null,
      });
      if (cardMessage) sequence.push(cardMessage);
      sequence.push(...buildMediaMessages(finca));
    }
    return sequence;
  }`;

const SELECTED_FINCA_BEFORE = String.raw`  if (selectedFinca && ['offering_agent', 'verifying_availability_agent', 'qa_agent'].includes(tool)) {
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
  }`;

const SELECTED_FINCA_INTERLEAVED_BEFORE = String.raw`  if (selectedFinca && ['offering_agent', 'verifying_availability_agent', 'qa_agent'].includes(tool)) {
    const card = buildFincaCard(selectedFinca);
    const cardMessage = createTextMessage(card, {
      property_title: selectedFinca?.nombre || selectedFinca?.finca_id || null,
      property_id: selectedFinca?.finca_id || null,
    });
    if (cardMessage) sequence.push(cardMessage);
    sequence.push(...buildMediaMessages(selectedFinca));
    const trailingText =
      finalWhatsappText && String(finalWhatsappText).trim() !== String(card || '').trim()
        ? createTextMessage(finalWhatsappText)
        : null;
    if (trailingText) sequence.push(trailingText);
    return sequence;
  }`;

const SELECTED_FINCA_AFTER = String.raw`  if (selectedFinca && ['offering_agent', 'verifying_availability_agent', 'qa_agent'].includes(tool)) {
    const trailingText = createTextMessage(finalWhatsappText);
    if (trailingText) sequence.push(trailingText);
    return sequence;
  }`;

const PRIMARY_OUTBOUND_MESSAGE_BEFORE =
  "const primaryOutboundMessage = outboundSequence.at(-1)?.content || rawFinalWhatsappText || null;";
const PRIMARY_OUTBOUND_MESSAGE_AFTER = String.raw`const primaryOutboundMessage =
  [...outboundSequence]
    .reverse()
    .map((item) => String(item?.content || '').trim())
    .find(Boolean) || rawFinalWhatsappText || null;`;

function patchCodeNode(node) {
  let code = String(node.parameters?.jsCode || '');

  code = replaceExactOrSame(code, "content: 'Fotos y/o video de ' + title,", "content: '',", 'empty media caption');
  code = replaceExactOrSame(code, CREATE_TEXT_MESSAGE_BEFORE, CREATE_TEXT_MESSAGE_AFTER, 'createTextMessage');
  code = replaceExactOrSame(code, SHOW_OPTIONS_BEFORE, SHOW_OPTIONS_AFTER, 'show options order');
  code = replaceOneOfOrSame(
    code,
    [SELECTED_FINCA_BEFORE, SELECTED_FINCA_INTERLEAVED_BEFORE],
    SELECTED_FINCA_AFTER,
    'selected finca order',
  );
  code = replaceExactOrSame(
    code,
    PRIMARY_OUTBOUND_MESSAGE_BEFORE,
    PRIMARY_OUTBOUND_MESSAGE_AFTER,
    'primary outbound message selection',
  );

  node.parameters.jsCode = code;
}

function patchSendOutboundMessagesNode(node) {
  node.parameters = node.parameters || {};
  node.parameters.jsCode = SEND_OUTBOUND_MESSAGES_CODE;
}

function patchHasMediaNode(node) {
  const condition = node.parameters?.conditions?.conditions?.[0];
  if (!condition) {
    throw new Error('Unexpected Has media to send? node shape');
  }
  condition.leftValue = '={{ $json.should_fire_outbound_sender === true }}';
}

function patchFireMediaSenderNode(node) {
  node.parameters = node.parameters || {};
  node.parameters.jsonBody =
    "={{ JSON.stringify({ chatwoot_id: $json.chatwoot_id, outbound_sequence_json: $json.sender_sequence_json || $json.outbound_sequence_json || '[]', private: false, chatwoot_account_id: $json.chatwoot_account_id || '1', chatwoot_api_token: $json.chatwoot_api_token || '7paF3kLsjSEPvXqgHPEgPTEq' }) }}";
}

function patchNodes(nodes) {
  patchCodeNode(findNode(nodes, 'Code in JavaScript1'));
  patchSendOutboundMessagesNode(findNode(nodes, 'Send outbound messages'));
  patchHasMediaNode(findNode(nodes, 'Has media to send?'));
  patchFireMediaSenderNode(findNode(nodes, 'Fire media sender'));
}

export function patchWorkflowDefinition(workflow) {
  patchNodes(workflow.nodes || []);
  if (workflow.activeVersion?.nodes) {
    patchNodes(workflow.activeVersion.nodes);
  }
  return workflow;
}

async function writePatchedWorkflowFile() {
  const raw = await fs.readFile(MAIN_WORKFLOW_FILE, 'utf8');
  const workflow = JSON.parse(raw);
  patchWorkflowDefinition(workflow);
  await fs.writeFile(MAIN_WORKFLOW_FILE, JSON.stringify(workflow, null, 2) + '\n');
}

const entryHref = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';

if (import.meta.url === entryHref) {
  writePatchedWorkflowFile().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
