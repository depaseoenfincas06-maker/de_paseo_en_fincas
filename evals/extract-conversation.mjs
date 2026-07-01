#!/usr/bin/env node
// Extract the FULL message history for a wa_id from the prod DB, plus the
// conversation row (state, criteria, last_inventory_items). Output goes to
// docs/evals/conversations/<wa_id>.{json,md} so we can mine it for failure
// patterns when seeding eval scenarios.
//
// Usage:
//   node evals/extract-conversation.mjs <wa_id>
//   node evals/extract-conversation.mjs 573112407139

import fs from 'node:fs';
import path from 'node:path';
import { query, close } from './lib/db.mjs';

const waId = String(process.argv[2] || '').trim();
if (!waId) {
  console.error('usage: node evals/extract-conversation.mjs <wa_id>');
  process.exit(1);
}

async function main() {
  const convRes = await query(
    `select * from public.conversations where wa_id = $1`,
    [waId],
  );
  const conv = convRes.rows[0] || null;

  const msgRes = await query(
    `select id, conversation_id, direction, message_type, content, media_url,
            state_at_time, agent_used, extracted_data, created_at
       from public.messages
      where conversation_id = $1
      order by created_at asc`,
    [waId],
  );
  const messages = msgRes.rows;

  const outDir = path.resolve('docs/evals/conversations');
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, `${waId}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ wa_id: waId, conversation: conv, messages }, null, 2));

  const mdLines = [];
  mdLines.push(`# Conversation history — ${waId}`);
  mdLines.push('');
  if (conv) {
    mdLines.push(`**State:** ${conv.current_state || '(null)'} | **agente_activo:** ${conv.agente_activo} | **waiting_for:** ${conv.waiting_for || '(null)'}`);
    mdLines.push(`**funnel_status:** ${conv.funnel_status || '(null)'} | **hitl_reason:** ${conv.hitl_reason || '(null)'}`);
    mdLines.push(`**selected_finca_id:** ${conv.selected_finca_id || '(null)'}`);
    mdLines.push(`**search_criteria:** \`${JSON.stringify(conv.search_criteria || {})}\``);
    mdLines.push(`**created_at:** ${conv.created_at} — **updated_at:** ${conv.updated_at}`);
    mdLines.push('');
  } else {
    mdLines.push('_(no conversation row found)_');
    mdLines.push('');
  }
  mdLines.push(`**Total messages:** ${messages.length}`);
  mdLines.push('');
  mdLines.push('---');
  mdLines.push('');

  for (const m of messages) {
    const ts = (m.created_at instanceof Date) ? m.created_at.toISOString() : String(m.created_at);
    const dir = String(m.direction || '').toUpperCase();
    const agent = m.agent_used ? ` _(${m.agent_used})_` : '';
    const stateTag = m.state_at_time ? ` _[${m.state_at_time}]_` : '';
    const arrow = dir === 'INBOUND' ? '◀ USER' : '▶ BOT';
    mdLines.push(`### ${ts} — ${arrow}${agent}${stateTag}`);
    if (m.message_type && m.message_type !== 'text') mdLines.push(`_(message_type: ${m.message_type})_`);
    if (m.media_url) mdLines.push(`_(media: ${m.media_url})_`);
    const body = String(m.content || '').trim();
    if (body) {
      mdLines.push('');
      mdLines.push('```');
      mdLines.push(body);
      mdLines.push('```');
    }
    mdLines.push('');
  }

  const mdPath = path.join(outDir, `${waId}.md`);
  fs.writeFileSync(mdPath, mdLines.join('\n'));

  console.log(`✓ wrote ${jsonPath}`);
  console.log(`✓ wrote ${mdPath}`);
  console.log(`  conversation row: ${conv ? 'found' : 'NONE'}`);
  console.log(`  messages: ${messages.length}`);
  if (messages.length) {
    const inb = messages.filter((m) => String(m.direction).toUpperCase() === 'INBOUND').length;
    const outb = messages.filter((m) => String(m.direction).toUpperCase() === 'OUTBOUND').length;
    console.log(`  inbound: ${inb}, outbound: ${outb}`);
  }
}

main()
  .then(close)
  .catch((e) => {
    console.error('!! extract failed:', e.message);
    close().catch(() => {});
    process.exit(2);
  });
