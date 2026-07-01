// Runs a single eval scenario against a simulator instance.
//
// Flow:
//   1. POST /api/conversations         → create synthetic wa_id
//   2. for each turn in scenario:
//        a. POST /api/conversations/:id/messages with text=user_text
//        b. poll GET /api/conversations/:id until quiet window
//           (no new OUTBOUND for QUIET_MS or hard timeout TURN_TIMEOUT_MS)
//        c. build assertion context, run each assert
//   3. return scenario result
//
// The simulator must already be running and reachable at baseUrl.
// `npm run simulator` (port 3101) is the default for local runs.

import { runAssertion } from './assertions.mjs';

const POLL_INTERVAL_MS = 2500;
// 30s de quiet window — el agente frecuentemente manda un mensaje bridge
// ("Dame un momento mientras consulto...") y luego 20-30s después las cards
// completas del offering pass. Búsquedas complejas ("cerca de Bogotá",
// filtros con múltiples zonas) tardan hasta 30s. Un quiet más corto
// atribuiría las cards al siguiente turn y perdería la respuesta real.
const QUIET_WINDOW_MS = 30_000;
const TURN_TIMEOUT_MS = 180_000;

async function http(baseUrl, method, path, body) {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const init = {
    method,
    headers: { 'content-type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const r = await fetch(url, init);
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) {
    const msg = data?.message || `HTTP ${r.status}`;
    throw new Error(`${method} ${path} failed: ${msg}`);
  }
  return data;
}

async function createConversation(baseUrl) {
  return http(baseUrl, 'POST', '/api/conversations');
}

async function getSnapshot(baseUrl, id) {
  return http(baseUrl, 'GET', `/api/conversations/${encodeURIComponent(id)}`);
}

async function sendMessage(baseUrl, id, text) {
  const clientMessageId = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return http(baseUrl, 'POST', `/api/conversations/${encodeURIComponent(id)}/messages`, {
    text,
    clientMessageId,
    localSequence: Date.now(),
  });
}

function buildAssertionContext({ snapshot, turnIndex, userText, baselineMsgCount, allBotTextSoFar }) {
  const messages = snapshot?.messages || [];
  const newMessages = messages.slice(baselineMsgCount);
  const botMessages = newMessages.filter((m) => String(m.direction || '').toUpperCase() === 'OUTBOUND');
  const botText = botMessages.map((m) => String(m.content || '')).join('\n');

  const conv = snapshot?.conversationRow || {};
  const context = snapshot?.context || {};
  const conversationForAssertions = {
    current_state: conv.current_state || snapshot.stage,
    waiting_for: conv.waiting_for || snapshot.waitingFor,
    agente_activo: conv.agente_activo ?? snapshot.agenteActivo,
    selected_finca_id: conv.selected_finca_id,
    selected_finca: conv.selected_finca,
    search_criteria: conv.search_criteria,
    hitl_reason: conv.hitl_reason,
    funnel_status: conv.funnel_status,
    context,
    shown_fincas: context?.shown_fincas || conv.shown_fincas,
    last_inventory_items: conv.last_inventory_items,
  };

  return {
    turn_index: turnIndex,
    user_text: userText,
    bot_messages: botMessages,
    bot_text: botText,
    all_bot_text: `${allBotTextSoFar}\n${botText}`,
    conversation: conversationForAssertions,
    raw_snapshot: snapshot,
  };
}

// Wait for the current turn's INBOUND record to appear in DB, then wait for
// the bot's OUTBOUND response to stabilize (20s of quiet + waitingFor=CLIENT).
// Returns the outboundBaseline — the index from which turn responses start —
// so assertions only see messages that belong to THIS turn.
//
// Why the two-phase wait: sendMessage to the simulator returns 202 immediately
// but the async webhook to n8n has ~2-25s of variable delay before the INBOUND
// hits the DB. Meanwhile, LATE messages from the PREVIOUS turn (async offering
// cards) may still be arriving. Anchoring on the current turn's INBOUND is the
// only reliable way to separate "response to me" from "response to previous".
async function waitForTurnResponse(baseUrl, id, userText, baselineMsgCount) {
  const started = Date.now();
  const cleanUser = String(userText).trim();
  let inboundIdx = -1;
  let snap = null;

  // Phase 1: wait for the INBOUND that matches this turn's user text
  while (Date.now() - started < TURN_TIMEOUT_MS && inboundIdx === -1) {
    await new Promise((r) => setTimeout(r, 1500));
    snap = await getSnapshot(baseUrl, id);
    const msgs = snap.messages || [];
    for (let i = msgs.length - 1; i >= baselineMsgCount; i -= 1) {
      const m = msgs[i];
      if (String(m.direction || '').toUpperCase() !== 'INBOUND') continue;
      const c = String(m.content || '').trim();
      // Prefix match is enough — server may lightly transform text.
      if (c === cleanUser || c.slice(0, 80) === cleanUser.slice(0, 80)) {
        inboundIdx = i;
        break;
      }
    }
  }
  if (inboundIdx === -1) {
    return {
      snapshot: snap || (await getSnapshot(baseUrl, id)),
      timedOut: true,
      outboundBaseline: baselineMsgCount,
    };
  }

  // Phase 2: from AFTER the matched INBOUND, wait for outbound to stabilize.
  const outboundBaseline = inboundIdx + 1;
  let lastOutboundTs = 0;
  let seenOutbound = false;

  // Bridge patterns: mensajes tipo "Dame un momento mientras consulto
  // disponibilidad" son placeholders del qualifying antes de que corra el
  // offering async. Si el ÚLTIMO outbound es solo un bridge, extendemos el
  // wait — sabemos que viene más contenido en 15-40s.
  const BRIDGE_RE = /(dame un momento|dame un instante|consulto disponibilidad|te env[ií]o (las )?mejores|mientras (te )?consulto)/i;

  while (Date.now() - started < TURN_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    snap = await getSnapshot(baseUrl, id);
    const msgs = snap.messages || [];
    const newOutbound = msgs
      .slice(outboundBaseline)
      .filter((m) => String(m.direction || '').toUpperCase() === 'OUTBOUND');
    if (newOutbound.length > 0) {
      seenOutbound = true;
      const latestTs = new Date(newOutbound.at(-1).createdAt).getTime();
      if (latestTs > lastOutboundTs) lastOutboundTs = latestTs;
    }
    const waitingForClient = String(snap.waitingFor || '').toUpperCase() === 'CLIENT';
    // Suprimir el "quiet done" si el último outbound sigue siendo un bridge:
    // significa que el bot marcó waitingFor=CLIENT prematuramente y el
    // offering async aún no ha llegado.
    const lastIsBridge = newOutbound.length > 0 && BRIDGE_RE.test(String(newOutbound.at(-1).content || ''));
    if (seenOutbound && waitingForClient && !lastIsBridge && Date.now() - lastOutboundTs >= QUIET_WINDOW_MS) {
      return { snapshot: snap, timedOut: false, outboundBaseline };
    }
  }
  return {
    snapshot: snap || (await getSnapshot(baseUrl, id)),
    timedOut: true,
    outboundBaseline,
  };
}

export async function runScenario(scenario, { baseUrl }) {
  if (!scenario || !Array.isArray(scenario.turns) || scenario.turns.length === 0) {
    throw new Error(`scenario ${scenario?.id || '(unknown)'} has no turns`);
  }

  const startedAt = new Date().toISOString();
  const conv = await createConversation(baseUrl);
  const conversationId = conv.id;
  let baselineMsgCount = (conv.messages || []).length;
  let allBotTextSoFar = '';
  const turnResults = [];
  let scenarioOk = true;

  for (let i = 0; i < scenario.turns.length; i += 1) {
    const turn = scenario.turns[i];
    const userText = String(turn.user || '');
    const turnStarted = Date.now();

    await sendMessage(baseUrl, conversationId, userText);
    const { snapshot, timedOut, outboundBaseline } = await waitForTurnResponse(
      baseUrl,
      conversationId,
      userText,
      baselineMsgCount,
    );

    const ctx = buildAssertionContext({
      snapshot,
      turnIndex: i,
      userText,
      baselineMsgCount: outboundBaseline,  // <- anchor on THIS turn's inbound
      allBotTextSoFar,
    });
    allBotTextSoFar = ctx.all_bot_text;
    baselineMsgCount = (snapshot.messages || []).length;

    const asserts = Array.isArray(turn.assert) ? turn.assert : [];
    const assertResults = [];
    for (const a of asserts) {
      // each assertion is { <name>: <arg> } (single-key object)
      const [name, arg] = Object.entries(a)[0] || [];
      const result = runAssertion(name, ctx, arg);
      assertResults.push({ name, arg, ok: result.ok, detail: result.detail });
      if (!result.ok) scenarioOk = false;
    }

    turnResults.push({
      turn_index: i,
      user_text: userText,
      elapsed_ms: Date.now() - turnStarted,
      timed_out: timedOut,
      new_bot_messages: ctx.bot_messages.map((m) => ({
        content: m.content,
        agent_used: m.agentUsed || m.agent_used,
        created_at: m.createdAt || m.created_at,
        message_type: m.messageType || m.message_type,
      })),
      state_after: ctx.conversation.current_state,
      assertions: assertResults,
    });
  }

  return {
    id: scenario.id,
    title: scenario.title,
    category: scenario.category,
    conversation_id: conversationId,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    ok: scenarioOk,
    turns: turnResults,
  };
}
