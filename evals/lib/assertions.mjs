// Assertion functions for eval scenarios.
//
// Each assertion is registered under a name and receives a context with the
// turn's collected data + conversation snapshot, plus the assertion's argument
// (a string, number, or object). Returns { ok: bool, detail: string }.
//
// Context shape passed to each assertion:
//   {
//     turn_index: number,                 // 0-based
//     user_text: string,                  // the inbound this turn
//     bot_messages: [{ content, agent_used, created_at, message_type, ... }],
//     bot_text: string,                   // joined bot_messages content this turn
//     all_bot_text: string,               // joined bot_messages content ALL turns so far
//     conversation: {
//       current_state, waiting_for, agente_activo, selected_finca_id,
//       selected_finca, search_criteria, hitl_reason, funnel_status,
//       context: { shown_fincas: [...], conversation: {...}, ... },
//       last_inventory_items: [...]
//     }
//   }

const HANDOFF_RE = /te paso con mi compa/i;
const NO_EXISTE_RE = /(no (la )?tengo|no (la )?encontr|no existe|no aparece|no figura|no (la )?reconozco|no (la )?manejamos)/i;
const IG_HANDLE_RE = /@depaseoenfincas(?:col)?\b/i;
const IG_LINK_RE = /instagram\.com\/depaseoenfincascol/i;

function lower(s) { return String(s || '').toLowerCase(); }

function pickFincaId(s) {
  // ANAPOIMA_#04 / Anapoima 04 / Anapoima_04 / anapoima4
  const m = String(s || '').toUpperCase().match(/([A-ZÑ_]{3,})[\s_#-]*?(\d{1,3})/);
  if (!m) return null;
  const zone = m[1].replace(/[\s_]+/g, '_').replace(/_$/, '');
  const num = String(parseInt(m[2], 10)).padStart(2, '0');
  return `${zone}_#${num}`;
}

export const assertions = {
  contains(ctx, arg) {
    const needle = lower(arg);
    const ok = lower(ctx.bot_text).includes(needle);
    return { ok, detail: ok ? '' : `not found: "${arg}"` };
  },

  not_contains(ctx, arg) {
    const needle = lower(arg);
    const ok = !lower(ctx.bot_text).includes(needle);
    return { ok, detail: ok ? '' : `unexpectedly contains: "${arg}"` };
  },

  state_equals(ctx, arg) {
    const expected = String(arg || '').trim().toUpperCase();
    const actual = String(ctx.conversation?.current_state || '').toUpperCase();
    return {
      ok: actual === expected,
      detail: actual === expected ? '' : `expected state ${expected}, got ${actual || '(null)'}`,
    };
  },

  agent_used(ctx, arg) {
    const expected = String(arg || '').trim();
    const actuals = (ctx.bot_messages || []).map((m) => m.agent_used).filter(Boolean);
    const ok = actuals.includes(expected);
    return { ok, detail: ok ? '' : `expected agent_used "${expected}" in this turn, saw: [${actuals.join(', ') || '(none)'}]` };
  },

  shown_fincas_includes(ctx, arg) {
    const target = String(arg || '').trim().toUpperCase();
    const shown = ctx.conversation?.context?.shown_fincas || ctx.conversation?.shown_fincas || [];
    const ids = shown.map((s) => (typeof s === 'string' ? s : s?.finca_id || s?.codigo_original || '')).filter(Boolean).map((s) => s.toUpperCase());
    const ok = ids.includes(target);
    return { ok, detail: ok ? '' : `shown_fincas (${ids.length}) does not include ${target}: [${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ', …' : ''}]` };
  },

  no_handoff_loop(ctx) {
    const all = ctx.all_bot_text || '';
    const matches = all.match(HANDOFF_RE) ? all.match(new RegExp(HANDOFF_RE.source, 'gi')) || [] : [];
    const ok = matches.length <= 1;
    return { ok, detail: ok ? '' : `handoff message appeared ${matches.length}× across the run (expected ≤1)` };
  },

  no_false_unavailable(ctx, arg) {
    // Asserts: if the bot says "no existe / no tenemos" about a finca_id that
    // IS in the inventory (passed via arg as expected finca_id), fail.
    if (!NO_EXISTE_RE.test(ctx.bot_text)) return { ok: true, detail: '' };
    const target = String(arg || '').trim().toUpperCase();
    // bot said unavailable AND the run config claims the finca exists → fail
    return { ok: false, detail: `bot signaled unavailability ("${ctx.bot_text.match(NO_EXISTE_RE)?.[0]}") but ${target} is in inventory` };
  },

  bot_recognized_finca(ctx, arg) {
    const target = pickFincaId(arg) || String(arg).toUpperCase();
    const zoneMatch = target.split('_#')[0];
    const numMatch = target.split('_#')[1] || '';
    const all = ctx.bot_text;
    // recognized if either the finca_id, the zone+number, or selected_finca matches
    const selected = String(ctx.conversation?.selected_finca_id || '').toUpperCase();
    const inBody = new RegExp(`${zoneMatch}\\s*[#_\\s-]*0*${parseInt(numMatch, 10) || ''}`, 'i').test(all);
    const ok = selected === target || inBody;
    return { ok, detail: ok ? '' : `bot did NOT acknowledge finca ${target}; selected=${selected || '(none)'}` };
  },

  quote_total_equals(ctx, arg) {
    // arg can be number or { value: number, tolerance: number }
    const expected = typeof arg === 'object' ? Number(arg.value) : Number(arg);
    const tol = typeof arg === 'object' && arg.tolerance != null ? Number(arg.tolerance) : 50;
    const items = ctx.conversation?.last_inventory_items || [];
    const selected = String(ctx.conversation?.selected_finca_id || '').toUpperCase();
    const it = items.find((x) => String(x?.finca_id || '').toUpperCase() === selected);
    const got = Number(it?.quote?.total);
    const ok = Number.isFinite(got) && Math.abs(got - expected) <= tol;
    return { ok, detail: ok ? '' : `quote.total for ${selected || '(none)'} = ${got}; expected ${expected} ±${tol}` };
  },

  ig_link_present(ctx) {
    if (!IG_HANDLE_RE.test(ctx.bot_text)) return { ok: true, detail: 'handle not mentioned' };
    const ok = IG_LINK_RE.test(ctx.bot_text);
    return { ok, detail: ok ? '' : 'IG handle mentioned without instagram.com/depaseoenfincascol link' };
  },
};

export function runAssertion(name, ctx, arg) {
  const fn = assertions[name];
  if (!fn) return { ok: false, detail: `unknown assertion type: ${name}` };
  try {
    return fn(ctx, arg);
  } catch (e) {
    return { ok: false, detail: `assertion threw: ${e.message}` };
  }
}

export const assertionNames = Object.keys(assertions);
