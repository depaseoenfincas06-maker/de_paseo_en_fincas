#!/usr/bin/env node
// Observability scanner — read-only sobre conversaciones de prod.
//
// Escanea los últimos N días de public.messages/conversations y flagea
// patrones de fallo conocidos. Cada flag es candidato a scenario de eval.
//
//   node evals/observability/scan.mjs --days 7
//   node evals/observability/scan.mjs --days 7 --include-synthetic
//
// Output: evals/runs/observability-<date>.{json,md}
//
// NO escribe nada en prod. Solo SELECT.

import fs from 'node:fs';
import path from 'node:path';
import { query, close } from '../lib/db.mjs';

const args = process.argv.slice(2);
const days = Number(args[args.indexOf('--days') + 1] || 7) || 7;
const includeSynthetic = args.includes('--include-synthetic');

const HANDOFF_RE = /te paso con mi compa/i;
const NO_EXISTE_RE = /(no (la )?tenemos registrada|no existe|no aparece en (el|nuestro) (sistema|inventario)|no (la )?reconozco|no (la )?manejamos)/i;
const IG_HANDLE_RE = /@depaseoenfincas(?:col)?\b/i;
const IG_LINK_RE = /instagram\.com\/depaseoenfincascol/i;
const PRICE_ASK_RE = /(cu[aá]nto|precio|total|cotiza|vale|cuesta)/i;
const TEMPLATE_LEAK_RE = /\{\{[^}]+\}\}/;

// Un wa_id sintético del simulador: 573 00X + timestamp-ish (13-15 dígitos
// arrancando con 5730). Los reales colombianos: 57 3XX XXXXXXX (12 dígitos).
const isSynthetic = (waId) => /^5730\d{11,}$/.test(String(waId));

function detectors(messages) {
  // messages: [{direction, content, agent_used, created_at}] orden asc
  const flags = [];
  const outbound = messages.filter((m) => m.direction === 'OUTBOUND');
  const inbound = messages.filter((m) => m.direction === 'INBOUND');

  // D1: handoff repetido
  const handoffs = outbound.filter((m) => HANDOFF_RE.test(m.content || ''));
  if (handoffs.length > 1) {
    flags.push({ type: 'handoff_repetido', detail: `${handoffs.length} veces`, sample: handoffs[1].content?.slice(0, 120) });
  }

  // D2: "no existe / no tenemos registrada" (posible falso negativo de inventario)
  for (const m of outbound) {
    if (NO_EXISTE_RE.test(m.content || '')) {
      flags.push({ type: 'afirmacion_no_existe', detail: 'verificar contra inventario', sample: m.content.slice(0, 160) });
      break;
    }
  }

  // D3: IG handle sin link
  for (const m of outbound) {
    const c = m.content || '';
    if (IG_HANDLE_RE.test(c) && !IG_LINK_RE.test(c)) {
      flags.push({ type: 'ig_sin_link', sample: c.slice(0, 140) });
      break;
    }
  }

  // D4: cliente pregunta precio y el siguiente outbound no trae $
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (m.direction !== 'INBOUND' || !PRICE_ASK_RE.test(m.content || '')) continue;
    const next = messages.slice(i + 1).filter((x) => x.direction === 'OUTBOUND').slice(0, 3);
    if (next.length && !next.some((x) => (x.content || '').includes('$'))) {
      flags.push({ type: 'precio_sin_monto', detail: `pregunta: ${m.content?.slice(0, 80)}`, sample: next[0]?.content?.slice(0, 120) });
      break;
    }
  }

  // D5: inbound sin NINGÚN outbound después (bot silencioso al final)
  if (messages.length) {
    const last = messages[messages.length - 1];
    if (last.direction === 'INBOUND') {
      const ageMin = (Date.now() - new Date(last.created_at).getTime()) / 60000;
      if (ageMin > 10) {
        flags.push({ type: 'bot_silencioso', detail: `último inbound sin respuesta hace ${Math.round(ageMin)} min`, sample: last.content?.slice(0, 120) });
      }
    }
  }

  // D6: template literal {{ }} leak
  for (const m of outbound) {
    if (TEMPLATE_LEAK_RE.test(m.content || '')) {
      flags.push({ type: 'template_leak', sample: m.content.slice(0, 160) });
      break;
    }
  }

  // D7: outbound vacío consecutivo (>2 mensajes vacíos seguidos fuera de media)
  let emptyRun = 0; let maxEmptyRun = 0;
  for (const m of outbound) {
    if (!String(m.content || '').trim() && !m.media_url) { emptyRun += 1; maxEmptyRun = Math.max(maxEmptyRun, emptyRun); }
    else emptyRun = 0;
  }
  if (maxEmptyRun > 2) flags.push({ type: 'outbound_vacios', detail: `${maxEmptyRun} seguidos` });

  return flags;
}

async function main() {
  const convs = await query(
    `select wa_id, current_state, agente_activo, funnel_status, updated_at
       from public.conversations
      where updated_at > now() - ($1 || ' days')::interval
      order by updated_at desc
      limit 300`,
    [String(days)],
  );

  const results = [];
  let scanned = 0;
  for (const conv of convs.rows) {
    if (!includeSynthetic && isSynthetic(conv.wa_id)) continue;
    const msgs = await query(
      `select direction, message_type, content, media_url, agent_used, created_at
         from public.messages
        where conversation_id = $1
        order by created_at asc`,
      [conv.wa_id],
    );
    scanned += 1;
    const flags = detectors(msgs.rows);
    if (flags.length) {
      results.push({
        wa_id: conv.wa_id,
        current_state: conv.current_state,
        agente_activo: conv.agente_activo,
        updated_at: conv.updated_at,
        msg_count: msgs.rows.length,
        flags,
      });
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve('evals/runs');
  fs.mkdirSync(outDir, { recursive: true });
  const report = { generated_at: new Date().toISOString(), days, scanned, flagged: results.length, conversations: results };
  fs.writeFileSync(path.join(outDir, `observability-${stamp}.json`), JSON.stringify(report, null, 2));

  const md = [`# Observability scan — ${stamp} (últimos ${days} días)`, '', `Conversaciones escaneadas: ${scanned} — flagged: ${results.length}`, ''];
  for (const r of results) {
    md.push(`## ${r.wa_id} — ${r.current_state} (${r.msg_count} msgs)`);
    for (const f of r.flags) {
      md.push(`- **${f.type}**${f.detail ? ` — ${f.detail}` : ''}${f.sample ? `\n  > ${f.sample}` : ''}`);
    }
    md.push('');
  }
  fs.writeFileSync(path.join(outDir, `observability-${stamp}.md`), md.join('\n'));

  console.log(`scanned=${scanned} flagged=${results.length}`);
  for (const r of results) {
    console.log(`  ${r.wa_id} [${r.current_state}]: ${r.flags.map((f) => f.type).join(', ')}`);
  }
  console.log(`report: evals/runs/observability-${stamp}.{json,md}`);
}

main().then(close).catch((e) => { console.error('fatal:', e.message); close().catch(() => {}); process.exit(1); });
