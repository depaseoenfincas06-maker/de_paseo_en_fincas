#!/usr/bin/env node
// Extrae el historial COMPLETO de una conversación de Chatwoot (sobrevive a los
// "Reset" del bot, que solo borran la DB de Supabase). Salida en hora Bogotá:
//   docs/evals/conversations/chatwoot-<phone>.{json,md}
//
// Uso:
//   node evals/extract-chatwoot.mjs +573112407139        (por teléfono)
//   node evals/extract-chatwoot.mjs conv:2                (por id de conversación)
//   node evals/extract-chatwoot.mjs +573112407139 --since 2026-08-27
//
// Credenciales: CHATWOOT_BASE_URL, CHATWOOT_ACCOUNT_ID, CHATWOOT_API_TOKEN (.env).
import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  const out = {};
  const p = path.resolve('.env');
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('='); out[t.slice(0, i)] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}
const env = { ...loadEnv(), ...process.env };
const BASE = String(env.CHATWOOT_BASE_URL || '').replace(/\/$/, '');
const ACCOUNT = env.CHATWOOT_ACCOUNT_ID || '2';
const TOKEN = env.CHATWOOT_API_TOKEN;
if (!BASE || !TOKEN) { console.error('faltan CHATWOOT_BASE_URL / CHATWOOT_API_TOKEN'); process.exit(1); }

const arg = String(process.argv[2] || '').trim();
const sinceIdx = process.argv.indexOf('--since');
const since = sinceIdx > 0 ? new Date(process.argv[sinceIdx + 1] + 'T00:00:00-05:00') : null;
if (!arg) { console.error('uso: node evals/extract-chatwoot.mjs <+phone|conv:ID> [--since YYYY-MM-DD]'); process.exit(1); }

const api = async (p) => {
  const r = await fetch(`${BASE}/api/v1/accounts/${ACCOUNT}${p}`, { headers: { api_access_token: TOKEN } });
  if (!r.ok) throw new Error(`chatwoot ${p} → HTTP ${r.status}`);
  return r.json();
};
const bogota = (ts) => new Date(ts * 1000).toLocaleString('sv-SE', { timeZone: 'America/Bogota' }).slice(0, 16);

async function resolveConversation() {
  if (arg.startsWith('conv:')) return { id: Number(arg.slice(5)), phone: null, name: null };
  const phone = arg.startsWith('+') ? arg : `+${arg.replace(/\D/g, '')}`;
  const list = await api('/conversations?status=all&sort_by=last_activity_at');
  const rows = list?.data?.payload || [];
  const hit = rows.find((c) => (c.meta?.sender?.phone_number || '') === phone);
  if (!hit) throw new Error(`no hay conversación en Chatwoot para ${phone} (revisa /conversations?status=all)`);
  return { id: hit.id, phone, name: hit.meta?.sender?.name || null };
}

async function fetchAll(convId) {
  let all = []; let before = null;
  for (let i = 0; i < 200; i += 1) {
    const d = await api(`/conversations/${convId}/messages${before ? `?before=${before}` : ''}`);
    const page = d.payload || [];
    if (!page.length) break;
    all = page.concat(all);
    before = page[0].id;
    if (page.length < 20) break;
  }
  all.sort((a, b) => a.created_at - b.created_at);
  return all;
}

const conv = await resolveConversation();
let msgs = await fetchAll(conv.id);
if (since) msgs = msgs.filter((m) => m.created_at * 1000 >= since.getTime());
const who = { 0: 'CLIENTE', 1: 'BOT/ASESOR', 2: 'ACTIVIDAD', 3: 'TEMPLATE' };
const rows = msgs.map((m) => ({
  id: m.id,
  hora_bogota: bogota(m.created_at),
  quien: who[m.message_type] || String(m.message_type),
  sender: m.sender?.name || null,
  private: Boolean(m.private),
  content: m.content || '',
  attachments: (m.attachments || []).map((a) => a.file_type),
}));
const key = (conv.phone || `conv-${conv.id}`).replace(/^\+/, '');
const outDir = path.resolve('docs/evals/conversations'); fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `chatwoot-${key}.json`), JSON.stringify({ conversation: conv, extracted_at: new Date().toISOString(), since: since ? since.toISOString() : null, messages: rows }, null, 2));
const md = [`# Chatwoot conv ${conv.id} — ${conv.phone || ''} ${conv.name || ''}`, '', `_${rows.length} mensajes, hora Bogotá${since ? `, desde ${process.argv[sinceIdx + 1]}` : ''}_`, ''];
for (const r of rows) {
  const att = r.attachments.length ? ` [${r.attachments.join(',')}]` : '';
  md.push(`- **${r.hora_bogota}** ${r.quien === 'CLIENTE' ? '◀' : '▶'} ${r.quien}${r.private ? ' (nota privada)' : ''}: ${r.content.replace(/\n/g, ' | ')}${att}`);
}
fs.writeFileSync(path.join(outDir, `chatwoot-${key}.md`), md.join('\n') + '\n');
console.log(`ok: conv ${conv.id} (${conv.phone || ''}) → ${rows.length} mensajes → docs/evals/conversations/chatwoot-${key}.{json,md}`);
