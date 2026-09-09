#!/usr/bin/env python3
"""Fase 1 (informe cliente, 8-sep-2026): el tool de inventario nunca falla en silencio.

Diagnóstico (reproducido el 8-sep sobre 32 turnos con agente: 6 fallos):
  * 2× error duro "Received tool input did not match expected schema — Required at
    operation": Gemini omite `operation` → el agente aborta → bot MUDO.
  * 4× la salida final del agente es literalmente
    "Calling inventory_reader_tool with input: {...}" (llamada narrada, sin ejecutar
    el tool) → outbound vacío → stall-fallback "se me enredaron los mensajes".
  Todos en turnos de SEGUNDA búsqueda ("más opciones", "otras cercanas a Medellín",
  "cuánto vale", "cambiamos de opinión").

P1.1  inventory_reader_tool: todo `$fromAI` con default → el schema nunca rechaza.
P1.2  Ruta determinística para la llamada narrada (aditiva, sin tocar Wraps):
        Wrap offering/qa → [IF Narrated tool call?]
          true  → Build deterministic tool input → Execute inventory tool (sub-exec
                  del mismo workflow, trigger "When inventory tool is called")
                  → Synthesize offering from tool → Refetch last_inventory_items
          false → Refetch last_inventory_items (idéntico a hoy)
      Contrato preservado: Refetch sigue recibiendo `{ output: string }` (el mismo
      shape que emiten los Wraps) y CodeJS1 sigue leyendo `$input.first().json.upstream`.
P1.3  CodeJS1: "más opciones" determinístico desde el cache (last_inventory_items)
      cuando el LLM no emite fincas_mostradas o dice "ya te mostré todas".
P1.4  BIT devuelve `remaining_count`; el prompt de offering lo usa para NUNCA
      declarar el inventario agotado si quedan fincas.

Idempotente: cada pieza detecta si ya está aplicada.
"""
import json, os, re, sys, uuid

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from n8n_patch_lib import get_workflow, put_workflow, backup, node, replace_once  # noqa: E402

CA = '2NV08zRFKENUsQVC'
applied = []

wf = get_workflow(CA)
backup(CA)
names = {n['name']: n for n in wf['nodes']}
conns = wf['connections']

# ------------------------------------------------------------------ P1.1
tool = node(wf, 'inventory_reader_tool')
DEFAULTS = {'operation': 'list_matching_fincas'}
changed = 0
for field in tool['parameters']['workflowInputs']['schema']:
    sv = field.get('stringValue') or ''
    m = re.search(r"\$fromAI\('(\w+)',\s*`([^`]*)`,\s*'(\w+)'\s*\)", sv)
    if not m:
        continue
    key, desc, typ = m.groups()
    default = DEFAULTS.get(key, '')
    new = f"$fromAI('{key}', `{desc}`, '{typ}', '{default}')"
    field['stringValue'] = sv.replace(m.group(0), new, 1)
    changed += 1
applied.append(f'P1.1 inventory_reader_tool: {changed} campos $fromAI con default' if changed else 'P1.1: already')

# ------------------------------------------------------------------ P1.2
IF_NAME = 'Narrated tool call?'
BUILD_NAME = 'Build deterministic tool input'
EXEC_NAME = 'Execute inventory tool (deterministic)'
SYNTH_NAME = 'Synthesize offering from tool'

BUILD_CODE = r"""// P1.2 (8-sep-2026): el agente "narró" la llamada al tool en vez de ejecutarla
// ("Calling inventory_reader_tool with input: {...}"). Extraemos el JSON y armamos
// el mismo item que recibiría el trigger "When inventory tool is called".
const wrap = $json || {};
let parsed = {};
try { parsed = JSON.parse(wrap.output || '{}'); } catch (e) { parsed = {}; }
const to = (parsed.tool_output && typeof parsed.tool_output === 'object') ? parsed.tool_output : {};
// Dos formas posibles: (a) Wrap no pudo parsear nada → { _raw: "Calling ... {json}" };
// (b) Wrap extrajo el primer JSON del texto → tool_output ES el input del tool
//     (trae `operation` y NO trae `intent`/`respuesta`).
const raw = String(to._raw || '');
const m = raw.match(/Calling\s+inventory_reader_tool\s+with\s+input:\s*(\{[\s\S]*\})\s*$/i);
let input = {};
let mode = 'narrated';
if (m) {
  try { input = JSON.parse(m[1]); } catch (e) { input = {}; }
} else if (to.operation !== undefined && to.intent === undefined && to.respuesta === undefined) {
  input = Object.assign({}, to);
} else if (to.intent === 'CLIENT_CHOSE') {
  // Modo HYDRATE (rev 3): el cliente eligió una finca; nos aseguramos de que su ficha
  // COMPLETA (con quote) quede en el cache aunque no estuviera en la última búsqueda
  // (p.ej. la vio en una búsqueda anterior de otra zona). La salida del LLM se respeta.
  mode = 'hydrate';
  input = { operation: 'get_finca_details', finca_id: to.finca_elegida_id || (to.selected_finca && to.selected_finca.finca_id) || '' };
}
// rev 3: si el LLM nombró una finca concreta, la operación correcta es get_finca_details
// (una lista con finca_id la excluye por capacidad y termina en "no disponible").
if (mode === 'narrated' && input.finca_id && String(input.finca_id).trim() && String(input.operation || '') !== 'get_owner_contact') {
  input.operation = 'get_finca_details';
}

let ctx = {};
try { ctx = $('Get Context-conversations1').first().json || {}; } catch (e) { ctx = {}; }
let waId = '';
try { waId = String($('Merge Sets1').first().json.conversation_key || '').trim(); } catch (e) { waId = ''; }
const sc = ctx.search_criteria || (ctx.context && ctx.context.search_criteria) || {};
const shown = (ctx.context && ctx.context.shown_fincas) || ctx.shown_fincas || [];

const ALLOWED = ['operation', 'finca_id', 'nombre', 'query', 'zona', 'personas', 'presupuesto_max', 'limit',
  'selected_finca_id', 'selected_finca_nombre', 'shown_fincas_json', 'context_zona', 'context_personas',
  'context_presupuesto_max', 'context_fecha_inicio', 'context_fecha_fin'];
const item = {
  wa_id: waId,
  _deterministic_tool_call: true,
  _mode: mode,
  _wrap_output: wrap.output,
  _tool_chosen: parsed.tool_chosen || 'offering_agent',
  _narrated_input: input,
};
for (const k of ALLOWED) {
  const v = input[k];
  if (v === undefined || v === null || String(v).trim() === '') continue;
  item[k] = v;
}
if (!item.operation) item.operation = 'list_matching_fincas';
if (!item.shown_fincas_json && item.operation === 'list_matching_fincas') item.shown_fincas_json = JSON.stringify(shown);
if (!item.context_fecha_inicio && sc.fecha_inicio) item.context_fecha_inicio = sc.fecha_inicio;
if (!item.context_fecha_fin && sc.fecha_fin) item.context_fecha_fin = sc.fecha_fin;
if (!item.zona && !item.context_zona && sc.zona) item.context_zona = sc.zona;
if (!item.personas && !item.context_personas && sc.personas) item.context_personas = sc.personas;
console.log('[P1.2] deterministic tool call: ' + JSON.stringify(item).slice(0, 300));
return [{ json: item }];
"""

SYNTH_CODE = r"""// P1.2 (8-sep-2026): convierte la respuesta del tool (ejecutado determinísticamente)
// en el MISMO shape que emite "Wrap offering result" para que CodeJS1 la consuma
// sin cambios. Sin LLM: cards + texto fijo.
const resp = $json || {};
let meta = {};
try { meta = $('Build deterministic tool input').first().json || {}; } catch (e) { meta = {}; }
if (meta._mode === 'hydrate') {
  // rev 3: solo hidratamos el cache; la salida original del LLM sigue intacta.
  console.log('[P1.2] hydrate: cache actualizado para ' + String((meta._narrated_input || {}).finca_id || ''));
  return [{ json: { output: meta._wrap_output || '{}' } }];
}
const narrated = meta._narrated_input || {};
let toolChosen = meta._tool_chosen || 'offering_agent';
let ctxSC = {};
try {
  const c = $('Get Context-conversations1').first().json || {};
  ctxSC = c.search_criteria || (c.context && c.context.search_criteria) || {};
} catch (e) { ctxSC = {}; }

const fmt = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('es-CO');
const personasReq = Number(narrated.personas || narrated.context_personas || ctxSC.personas || 0) || null;
const zona = String(narrated.zona || narrated.context_zona || narrated.query || ctxSC.zona || '').trim();
const op = String(resp.operation || narrated.operation || 'list_matching_fincas');

let intent = 'QUESTION';
let respuesta = '';
let fincas = [];
const scUpdate = {};
if (personasReq && Number(ctxSC.personas) !== personasReq) scUpdate.personas = personasReq;

if (op === 'list_matching_fincas') {
  const items = Array.isArray(resp.items) && resp.items.length
    ? resp.items
    : (Array.isArray(resp.similar_items) ? resp.similar_items : []);
  if (items.length) {
    intent = 'SHOW_OPTIONS';
    fincas = items;
    toolChosen = 'offering_agent';
    respuesta = 'Aquí tienes ' + (items.length === 1 ? 'esta opción' : 'estas opciones') +
      (zona ? ' en ' + zona : '') + (personasReq ? ' para ' + personasReq + ' personas' : '') + ':';
  } else {
    respuesta = 'Por ahora no encontré más opciones' + (zona ? ' en ' + zona : '') +
      (personasReq ? ' para ' + personasReq + ' personas' : '') +
      ' con esas fechas. Si quieres, buscamos en una zona cercana o ajustamos fechas o número de personas. Qué prefieres?';
  }
} else if (op === 'get_finca_details') {
  const it = resp.selected_finca || (Array.isArray(resp.items) && resp.items[0]) || null;
  const q = it && it.quote;
  const id = it && (it.codigo_original || it.finca_id);
  if (it && q && Number(q.total) > 0) {
    const capMax = Number(it.capacidad_max) || null;
    if (personasReq && capMax && personasReq > capMax) {
      respuesta = id + ' tiene capacidad máxima para ' + capMax + ' personas, así que no alcanza para ' + personasReq +
        '. Buscamos una opción con más cupo o ajustamos el grupo?';
    } else if (q.below_minimum) {
      respuesta = 'Para esas fechas el mínimo de estadía en ' + id + ' es ' + q.effective_min_noches +
        ' noches. Te sirve extender la estadía? Si me confirmas las fechas te paso el valor exacto.';
    } else {
      const n = Number(q.total_nights) || 0;
      const noches = n === 1 ? 'noche' : 'noches';
      const lines = [
        'Para ' + (q.personas || personasReq) + ' personas, ' + n + ' ' + noches + ' en ' + id + ' sería ' + fmt(q.total) + '.',
        '',
        'Incluye:',
        '• Alojamiento (' + n + ' ' + noches + '): ' + fmt(q.subtotal_noches),
        '• Depósito (100% reembolsable): ' + fmt(q.deposito_seguridad),
        '• Limpieza final: ' + fmt(q.limpieza_final),
      ];
      if (Number(q.servicio_empleada_total) > 0) {
        const c = Number(q.servicio_empleada_count) || 1;
        lines.push('• Servicio empleada (' + c + (c > 1 ? ' personas, ' : ' persona, ') + n + (n === 1 ? ' día' : ' días') + '): ' + fmt(q.servicio_empleada_total));
      }
      lines.push('', 'Querés avanzar con esta finca?');
      respuesta = lines.join('\n');
    }
  } else if (it) {
    intent = 'SHOW_OPTIONS';
    fincas = [it];
    toolChosen = 'offering_agent';
    respuesta = 'Te comparto la información de ' + id + ':';
  } else {
    respuesta = 'No encontré esa finca en el inventario. Me confirmas el código o el nombre exacto?';
  }
} else {
  respuesta = 'Dame un momento, ya te confirmo ese dato.';
}

const toolOutput = {
  intent,
  respuesta,
  fincas_mostradas: fincas,
  finca_elegida_id: null,
  selected_finca: null,
  deterministic_tool_execution: true,
  narrated_tool_input: narrated,
};
if (Object.keys(scUpdate).length) toolOutput.search_criteria_update = scUpdate;
console.log('[P1.2] synthesized ' + intent + ' with ' + fincas.length + ' fincas (op=' + op + ')');
return [{
  json: {
    output: JSON.stringify({
      action: 'RUN_TOOL',
      tool_chosen: toolChosen,
      tool_output: toolOutput,
      post_actions: {},
      final_whatsapp_text: respuesta,
      current_state_changed: false,
      deterministic_tool_execution: true,
    }),
  },
}];
"""

IF_EXPR = ("={{ (function(){ try { var o = JSON.parse($json.output || '{}'); var t = (o && o.tool_output && typeof o.tool_output === 'object') ? o.tool_output : {}; "
           "if (/^\\s*Calling\\s+inventory_reader_tool\\s+with\\s+input:/i.test(String(t._raw || ''))) return true; "
           "if (t.intent === 'CLIENT_CHOSE' && (t.finca_elegida_id || (t.selected_finca && t.selected_finca.finca_id))) return true; "
           "return t.operation !== undefined && t.intent === undefined && t.respuesta === undefined; } "
           "catch (e) { return false; } })() }}")

if IF_NAME in names:
    # Ya existe: actualizar código/condición (rev 2: detecta también la forma parseada del input)
    node(wf, IF_NAME)['parameters']['conditions']['conditions'][0]['leftValue'] = IF_EXPR
    node(wf, BUILD_NAME)['parameters']['jsCode'] = BUILD_CODE
    node(wf, SYNTH_NAME)['parameters']['jsCode'] = SYNTH_CODE
    applied.append('P1.2: nodos existentes actualizados (rev 3: input parseado + hydrate en CLIENT_CHOSE + finca_id→details)')
else:
    wrap_off = node(wf, 'Wrap offering result')
    wrap_qa = node(wf, 'Wrap qa result')
    refetch = node(wf, 'Refetch last_inventory_items')
    px, py = wrap_off['position']
    code_v = node(wf, 'Build RESET response payload')['typeVersion']
    if_v = node(wf, 'Is RESET command?')['typeVersion']
    exec_node = node(wf, 'Send selection notifications')
    new_nodes = [
        {
            'parameters': {
                'conditions': {
                    'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'loose', 'version': 3},
                    'conditions': [{'id': str(uuid.uuid4()), 'leftValue': IF_EXPR, 'rightValue': '',
                                    'operator': {'type': 'boolean', 'operation': 'true', 'singleValue': True}}],
                    'combinator': 'and',
                },
                'looseTypeValidation': True,
                'options': {},
            },
            'id': str(uuid.uuid4()), 'name': IF_NAME, 'type': 'n8n-nodes-base.if', 'typeVersion': if_v,
            'position': [px + 220, py - 220],
        },
        {
            'parameters': {'jsCode': BUILD_CODE},
            'id': str(uuid.uuid4()), 'name': BUILD_NAME, 'type': 'n8n-nodes-base.code', 'typeVersion': code_v,
            'position': [px + 440, py - 380],
        },
        {
            'parameters': {
                'workflowId': {'__rl': True, 'mode': 'id', 'value': CA},
                'workflowInputs': {'mappingMode': 'defineBelow', 'value': {}, 'matchingColumns': [], 'schema': []},
                'options': {},
            },
            'id': str(uuid.uuid4()), 'name': EXEC_NAME, 'type': exec_node['type'], 'typeVersion': exec_node['typeVersion'],
            'position': [px + 660, py - 380],
            'onError': 'continueRegularOutput',
        },
        {
            'parameters': {'jsCode': SYNTH_CODE},
            'id': str(uuid.uuid4()), 'name': SYNTH_NAME, 'type': 'n8n-nodes-base.code', 'typeVersion': code_v,
            'position': [px + 880, py - 380],
        },
    ]
    wf['nodes'].extend(new_nodes)
    # Rewire: Wrap offering/qa → IF (antes iban directo a Refetch)
    for wrap_name in ('Wrap offering result', 'Wrap qa result'):
        outs = conns[wrap_name]['main']
        assert outs[0] and outs[0][0]['node'] == 'Refetch last_inventory_items', (wrap_name, outs)
        outs[0][0]['node'] = IF_NAME
    conns[IF_NAME] = {'main': [
        [{'node': BUILD_NAME, 'type': 'main', 'index': 0}],
        [{'node': 'Refetch last_inventory_items', 'type': 'main', 'index': 0}],
    ]}
    conns[BUILD_NAME] = {'main': [[{'node': EXEC_NAME, 'type': 'main', 'index': 0}]]}
    conns[EXEC_NAME] = {'main': [[{'node': SYNTH_NAME, 'type': 'main', 'index': 0}]]}
    conns[SYNTH_NAME] = {'main': [[{'node': 'Refetch last_inventory_items', 'type': 'main', 'index': 0}]]}
    applied.append('P1.2: IF + Build + Execute + Synthesize (Wrap offering/qa → IF → Refetch)')

# ------------------------------------------------------------------ P1.3
cjs = node(wf, 'Code in JavaScript1')
code = cjs['parameters']['jsCode']
P13_ANCHOR = "const toolOutputParsed = parseToolOutput(parsed);\nconst normalizedPostActions = normalizePostActions(parsed, toolOutputParsed);"
P13_BLOCK = r"""const toolOutputParsed = parseToolOutput(parsed);
// === P1.3 (8-sep-2026): "más opciones" determinístico desde el cache ===
// Si el cliente pide más opciones y el LLM no emitió fincas (o declaró el
// inventario agotado), servimos las siguientes 3 del cache de la última
// búsqueda (last_inventory_items incluye ranked 4-20) sin volver al LLM.
(function () {
  try {
    if ((parsed && parsed.tool_chosen) !== 'offering_agent') return;
    if (!toolOutputParsed || typeof toolOutputParsed !== 'object') return;
    if (Array.isArray(toolOutputParsed.fincas_mostradas) && toolOutputParsed.fincas_mostradas.length) return;
    var msg = '';
    try { msg = String($('Merge Sets1').first().json['last-message'] || ''); } catch (e) {}
    var MORE_RE = /(m[áa]s opciones|otras opciones|otras alternativas|tienes (algo )?m[áa]s|hay (alguna )?otra|alguna m[áa]s|mu[ée]strame otras|ens[ée][ñn]ame otras|env[ií]ame (m[áa]s|otras)|no me gustan|solo (hay|tienes) es[ao]s|qu[ée] otras|otras cercanas)/i;
    var EXHAUSTED_RE = /ya te mostr[ée] todas|no (tengo|hay|contamos con) m[áa]s opciones|esas son (todas|las [úu]nicas)/i;
    var resp = String(toolOutputParsed.respuesta || '');
    if (!MORE_RE.test(msg) && !EXHAUSTED_RE.test(resp)) return;
    var ctx = {};
    try { ctx = $('Get Context-conversations1').first().json || {}; } catch (e) {}
    var sc = ctx.search_criteria || (ctx.context && ctx.context.search_criteria) || {};
    var shownRaw = (ctx.context && ctx.context.shown_fincas) || ctx.shown_fincas || [];
    var shown = new Set((Array.isArray(shownRaw) ? shownRaw : []).map(function (s) {
      return String(typeof s === 'string' ? s : (s && (s.finca_id || s.codigo_original)) || '').toUpperCase();
    }));
    var idx = _bitFincaIndex();
    var norm = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); };
    var zona = norm(sc.zona);
    var aliasZone = /bogot|cundinamarca|antioquia|medell|eje cafetero|tolima|cerca/.test(zona);
    var personas = Number(sc.personas) || null;
    var picked = [];
    var keys = Object.keys(idx);
    for (var i = 0; i < keys.length && picked.length < 3; i++) {
      var it = idx[keys[i]];
      if (!it || !it.finca_id) continue;
      if (shown.has(String(it.finca_id).toUpperCase())) continue;
      if (personas && it.capacidad_max && Number(it.capacidad_max) < personas) continue;
      if (zona && zona.length > 2 && !aliasZone) {
        var iz = norm(it.zona) + ' ' + norm(it.municipio);
        if (!(iz.includes(zona) || (norm(it.zona) && zona.includes(norm(it.zona))))) continue;
      }
      picked.push(it);
    }
    if (!picked.length) return;
    toolOutputParsed.intent = 'SHOW_OPTIONS';
    toolOutputParsed.fincas_mostradas = picked;
    toolOutputParsed.finca_elegida_id = null;
    toolOutputParsed.selected_finca = null;
    toolOutputParsed.respuesta = 'Aquí tienes otras opciones' + (sc.zona ? ' en ' + sc.zona : '') + ':';
    toolOutputParsed.more_options_from_cache = true;
    if (parsed && typeof parsed === 'object') parsed.final_whatsapp_text = toolOutputParsed.respuesta;
    console.log('[P1.3] more options from cache: ' + picked.map(function (p) { return p.finca_id; }).join(','));
  } catch (e) { console.error('[P1.3] ' + (e && e.message)); }
})();
// === /P1.3 ===
const normalizedPostActions = normalizePostActions(parsed, toolOutputParsed);"""
if '[P1.3] more options from cache' in code:
    applied.append('P1.3: already')
else:
    code = replace_once(code, P13_ANCHOR, P13_BLOCK, 'P1.3 CJS1')
    cjs['parameters']['jsCode'] = code
    applied.append('P1.3 CJS1: más opciones desde cache')

# ------------------------------------------------------------------ P1.4
bit = node(wf, 'Build Inventory Tool Response')
bcode = bit['parameters']['jsCode']
P14_OLD = "        matched_count: exactItems.length,\n        items: exactItems,"
P14_NEW = "        matched_count: exactItems.length,\n        remaining_count: Math.max(0, strictRanked.length - limit),\n        items: exactItems,"
if 'remaining_count:' in bcode:
    applied.append('P1.4 BIT: already')
else:
    bit['parameters']['jsCode'] = replace_once(bcode, P14_OLD, P14_NEW, 'P1.4 BIT')
    applied.append('P1.4 BIT: remaining_count')

off = node(wf, 'Run offering pass')
sm = off['parameters']['options']['systemMessage']
P14_PROMPT_ANCHOR = "(Anapoima tiene 40+ fincas, no 3)."
P14_PROMPT_NEW = P14_PROMPT_ANCHOR + """
  • El tool devuelve `remaining_count` (fincas que quedan sin mostrar en esa zona). Si remaining_count > 0, PROHIBIDO decir "ya te mostré todas" o "esas son las únicas": muestra los items que devolvió y, si el cliente quiere más, vuelve a llamar el tool."""
if 'remaining_count' in sm:
    applied.append('P1.4 prompt: already')
else:
    off['parameters']['options']['systemMessage'] = replace_once(sm, P14_PROMPT_ANCHOR, P14_PROMPT_NEW, 'P1.4 prompt')
    applied.append('P1.4 prompt offering: regla remaining_count')

print('CA active:', put_workflow(CA, wf))
print('\n'.join(applied))
