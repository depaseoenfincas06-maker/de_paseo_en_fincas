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

const POLL_INTERVAL_MS = 1800;
const QUIET_WINDOW_MS = 5000;
const TURN_TIMEOUT_MS = 90_000;

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

async function waitForTurnQuiet(baseUrl, id, baselineMsgCount) {
  const started = Date.now();
  let lastSnapshot = null;
  let lastNewOutboundAt = 0;
  let seenNewOutbound = false;

  while (Date.now() - started < TURN_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const snap = await getSnapshot(baseUrl, id);
    lastSnapshot = snap;
    const total = (snap.messages || []).length;
    if (total > baselineMsgCount) {
      const newest = snap.messages.slice(baselineMsgCount);
      const newOutbound = newest.filter((m) => String(m.direction || '').toUpperCase() === 'OUTBOUND');
      if (newOutbound.length > 0) {
        seenNewOutbound = true;
        const newestOutboundTs = new Date(newOutbound.at(-1).createdAt).getTime();
        if (newestOutboundTs > lastNewOutboundAt) lastNewOutboundAt = newestOutboundTs;
      }
    }
    // quiet window: at least one outbound seen AND last outbound was QUIET_WINDOW_MS ago
    if (seenNewOutbound && Date.now() - lastNewOutboundAt >= QUIET_WINDOW_MS) {
      return { snapshot: lastSnapshot, timedOut: false };
    }
  }
  return { snapshot: lastSnapshot || (await getSnapshot(baseUrl, id)), timedOut: true };
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
    const { snapshot, timedOut } = await waitForTurnQuiet(baseUrl, conversationId, baselineMsgCount);

    const ctx = buildAssertionContext({
      snapshot,
      turnIndex: i,
      userText,
      baselineMsgCount,
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
