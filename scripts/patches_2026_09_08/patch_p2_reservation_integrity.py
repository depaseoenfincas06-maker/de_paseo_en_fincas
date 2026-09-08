#!/usr/bin/env python3
"""Fase 2 (informe cliente, 8-sep-2026): objeto de reserva único y validado.

Casos que cubre (reproducidos el 8-sep):
  * Luis 28-ago: "mínimo 5 noches" y luego cotiza 2 noches (below_minimum ignorado).
  * Luis 30-ago: cambio a 12 px / 23-26 dic nunca se persistió → docx con datos viejos ×3.
  * Luis 2-sep: 2 empleadas cotizadas en chat, docx sin empleada ×4 ("ya lo dejo anotado").
  * Santiago 2-sep: cotizó "15 personas" en finca de máximo 12 (cobrando 12) y eligió finca sin cupo.

P2.1  Extractor determinístico de fechas y personas del mensaje del cliente. Si detecta
      un valor, se persiste en search_criteria aunque el LLM no emita search_criteria_update.
      Además: offering y QA ahora MERGEAN search_criteria_update sobre el actual (antes lo
      reemplazaban → se perdían fechas/zona cuando el LLM emitía solo un delta).
P2.2  Invariantes en código: CLIENT_CHOSE sobre finca sin cupo → no entra a CONFIRMING;
      una "cotización" textual sobre finca sin cupo o bajo el mínimo de noches se reemplaza
      por el texto correcto; el docx se bloquea si personas > capacidad_max o below_minimum.
      computeQuote expone `exceeds_capacity`.
P2.3  Extras opcionales como estado: extras.servicio_empleada {cantidad, cantidad_adicional,
      costo_dia, dias, subtotal, solicitado}. Lo emite el LLM (extras_update) o lo detecta el
      código; el docx y el total lo incluyen.
P2.4  Docx: se arma desde los criterios YA actualizados del turno (no del contexto viejo) y
      no se reenvía un documento idéntico al anterior (hash en extras.confirming_reservation).

Idempotente: cada pieza detecta si ya está aplicada.
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from n8n_patch_lib import get_workflow, put_workflow, backup, node, replace_once  # noqa: E402

CA = '2NV08zRFKENUsQVC'
applied = []
wf = get_workflow(CA)
backup(CA)

cjs = node(wf, 'Code in JavaScript1')
code = cjs['parameters']['jsCode']

# ------------------------------------------------------------------ helpers (P2.1 / P2.3)
HELPERS_ANCHOR = "function normalizePostActions(parsed, toolOutput) {"
HELPERS = r"""// === P2 helpers (8-sep-2026): extracción determinística desde el mensaje del cliente ===
function _lastClientMessage() {
  try { return String($('Merge Sets1').first().json['last-message'] || ''); } catch (e) { return ''; }
}
function _todayIsoBogota() {
  try { return new Date().toLocaleString('sv-SE', { timeZone: 'America/Bogota' }).slice(0, 10); } catch (e) { return new Date().toISOString().slice(0, 10); }
}
function _stripAccentsLower(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function _extractCriteriaFromMessage(text) {
  // Devuelve solo lo que encuentra con certeza: { fecha_inicio?, fecha_fin?, personas? }.
  // Fechas: rangos explícitos con mes ("23-26 dic", "del 12 al 18 de octubre", "31 dic-2 ene",
  // "14 y 16 noviembre", "del 30 de diciembre al 4 de enero de 2026"). Nunca fechas relativas.
  // Personas: "somos N", "N personas/px/pax/adultos", "para N personas" (sin frases delta).
  var out = {};
  var s = _stripAccentsLower(text).replace(/\s+/g, ' ').trim();
  if (!s || s === 'reset') return out;
  var MONTHS = { ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, may: 5, mayo: 5, jun: 6, junio: 6,
    jul: 7, julio: 7, ago: 8, agosto: 8, sep: 9, sept: 9, set: 9, septiembre: 9, setiembre: 9, oct: 10, octubre: 10,
    nov: 11, noviembre: 11, dic: 12, diciembre: 12 };
  var re = /(?:del?\s+)?(\d{1,2})(?:\s+de)?(?:\s+([a-z]{3,10}))?\s*(?:-|–|al\s+|a\s+|y\s+|hasta\s+el\s+|hasta\s+)\s*(\d{1,2})(?:\s+de)?\s+([a-z]{3,10})\.?(?:\s+(?:de\s+|del\s+)?(\d{4}))?/g;
  var m; var best = null;
  while ((m = re.exec(s)) !== null) {
    var d1 = Number(m[1]); var d2 = Number(m[3]);
    var mon2 = MONTHS[m[4]]; var mon1 = m[2] ? MONTHS[m[2]] : mon2;
    if (!mon2 || (m[2] && !mon1)) continue;
    if (!(d1 >= 1 && d1 <= 31 && d2 >= 1 && d2 <= 31)) continue;
    var today = _todayIsoBogota();
    var year = m[5] ? Number(m[5]) : Number(today.slice(0, 4));
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var start = year + '-' + pad(mon1) + '-' + pad(d1);
    var endYear = mon2 < mon1 ? year + 1 : year;
    var end = endYear + '-' + pad(mon2) + '-' + pad(d2);
    if (!m[5] && start < today) { start = (year + 1) + start.slice(4); end = (endYear + 1) + end.slice(4); }
    var nights = daysBetweenIsoDates(start, end);
    if (!Number.isFinite(nights) || nights < 1 || nights > 30) continue;
    best = { fecha_inicio: start, fecha_fin: end };
  }
  if (best) { out.fecha_inicio = best.fecha_inicio; out.fecha_fin = best.fecha_fin; }
  var deltaPat = /\b(?:mas|menos|adicionales?|extra)\s+\d+\b|\b\d+\s*(?:mas|menos|adicionales?|extra)\b/;
  var personas = null;
  var nm = s.match(/\b(?:ahora\s+somos|ya\s+somos|somos\s+ahora|seremos|seriamos|somos)\s+(\d{1,3})\b/);
  if (nm) personas = Number(nm[1]);
  if (personas === null && !deltaPat.test(s)) {
    var pats = [/\bpara\s+(\d{1,3})\s*(?:personas?|adultos?|huespedes?|pax|px)\b/g, /\b(\d{1,3})\s*(?:personas?|adultos?|huespedes?|pax|px)\b/g];
    var found = [];
    for (var p = 0; p < pats.length; p++) { var mm; while ((mm = pats[p].exec(s)) !== null) { var n = Number(mm[1]); if (n >= 1 && n <= 200) found.push(n); } }
    if (found.length) personas = found[found.length - 1];
  }
  if (personas !== null && personas >= 1 && personas <= 200) out.personas = personas;
  return out;
}
function _extractEmpleadaRequest(text) {
  // { cantidad, source:'message' } | null. "quiero señora de servicio", "dos empleadas",
  // "sin empleada" → 0. No dispara con preguntas de precio ("cuánto vale la empleada").
  var s = _stripAccentsLower(text);
  if (!s) return null;
  if (!/(senora|senoras|empleada|empleadas|servicio domestico|cocinera)/.test(s)) return null;
  if (/\b(sin|no quiero|no necesito|no queremos)\s+(la\s+|las\s+|una\s+)?(senora|empleada|servicio)/.test(s)) return { cantidad: 0, source: 'message' };
  if (/(cuanto (vale|cuesta)|que valor|precio de|valor de|se puede reservar sin|es obligatori|tiene un valor)/.test(s) && !/(quiero|incluye|incluir|inclu|agrega|agregar|suma|con dos|con una|con 2|con 1|dos senoras|dos empleadas)/.test(s)) return null;
  var WORDS = { una: 1, un: 1, dos: 2, tres: 3, cuatro: 4 };
  var m = s.match(/\b(\d|una|un|dos|tres|cuatro)\s+(senoras?|empleadas?)/);
  var cantidad = m ? (WORDS[m[1]] !== undefined ? WORDS[m[1]] : Number(m[1])) : 1;
  if (!/(quiero|queremos|incluye|incluir|inclu|agrega|agregar|suma|con\s+(una|dos|tres|\d)?\s*(senora|empleada)|necesito|me gustaria|quisiera|si por favor|por favor)/.test(s)) return null;
  return { cantidad: Math.max(0, Math.min(6, cantidad)), source: 'message' };
}
function _resolveFincaForExtras(raw, toolOutput) {
  var idx = {};
  try { idx = _bitFincaIndex(); } catch (e) { idx = {}; }
  var cand = null;
  if (raw && raw.selected_finca && typeof raw.selected_finca === 'object') cand = raw.selected_finca;
  else if (toolOutput && toolOutput.selected_finca && typeof toolOutput.selected_finca === 'object') cand = toolOutput.selected_finca;
  else { try { var c = $('Get Context-conversations1').first().json; cand = (c.selected_finca && typeof c.selected_finca === 'object') ? c.selected_finca : (c.selected_finca_id ? { finca_id: c.selected_finca_id } : null); } catch (e) { cand = null; } }
  if (!cand) return null;
  var id = String(cand.finca_id || cand.codigo_original || '').trim();
  if (id && idx[id]) return Object.assign({}, cand, idx[id]);
  var up = id.toUpperCase();
  for (var k in idx) { if (String(k).toUpperCase() === up) return Object.assign({}, cand, idx[k]); }
  return cand;
}
// === /P2 helpers ===

function normalizePostActions(parsed, toolOutput) {"""
if '_extractCriteriaFromMessage' in code:
    applied.append('P2 helpers: already')
else:
    code = replace_once(code, HELPERS_ANCHOR, HELPERS, 'P2 helpers')
    applied.append('P2 helpers: extractor fechas/personas + empleada')

# ------------------------------------------------------------------ P2.1 merge en offering / qa
OFF_OLD = "    if (toolOutput?.search_criteria_update && !raw.search_criteria) raw.search_criteria = compactCriteria(toolOutput.search_criteria_update);\n    if (toolOutput?.intent === 'CLIENT_CHOSE') {"
OFF_NEW = """    // P2.1 (8-sep-2026): MERGE sobre el criterio actual (antes reemplazaba → se
    // perdían zona/fechas cuando el LLM emitía solo el delta).
    if (toolOutput?.search_criteria_update && typeof toolOutput.search_criteria_update === 'object' && !raw.search_criteria) {
      raw.search_criteria = compactCriteria(Object.assign({}, _safeSearchCriteria(), compactCriteria(toolOutput.search_criteria_update)));
    }
    if (toolOutput?.intent === 'CLIENT_CHOSE') {"""
QA_OLD = "  if (tool === 'qa_agent') {\n    if (toolOutput?.search_criteria_update && !raw.search_criteria) {\n      raw.search_criteria = compactCriteria(toolOutput.search_criteria_update);\n    }"
QA_NEW = "  if (tool === 'qa_agent') {\n    if (toolOutput?.search_criteria_update && typeof toolOutput.search_criteria_update === 'object' && !raw.search_criteria) {\n      raw.search_criteria = compactCriteria(Object.assign({}, _safeSearchCriteria(), compactCriteria(toolOutput.search_criteria_update)));\n    }"
if 'P2.1 (8-sep-2026): MERGE' in code:
    applied.append('P2.1 merge offering/qa: already')
else:
    code = replace_once(code, OFF_OLD, OFF_NEW, 'P2.1 offering merge')
    code = replace_once(code, QA_OLD, QA_NEW, 'P2.1 qa merge')
    applied.append('P2.1 offering/qa: search_criteria_update mergea sobre el actual')

# ------------------------------------------------------------------ P2.1 + P2.3 en normalizePostActions
NORM_ANCHOR = "  const normalized = {\n    state_transition:"
NORM_BLOCK = r"""  // === P2.1 (8-sep-2026): criterios determinísticos desde el mensaje ===
  // Si el cliente escribió fechas o número de personas explícitos, se persisten
  // AUNQUE el LLM no haya emitido search_criteria_update. Lo determinístico gana.
  if (['qualifying_agent', 'offering_agent', 'qa_agent', 'confirming_reservation_agent'].includes(tool)) {
    try {
      const _det = _extractCriteriaFromMessage(_lastClientMessage());
      if (Object.keys(_det).length) {
        const _base = Object.assign({}, _safeSearchCriteria(), (raw.search_criteria && typeof raw.search_criteria === 'object') ? raw.search_criteria : {});
        raw.search_criteria = compactCriteria(Object.assign({}, _base, _det));
        console.log('[P2.1] criteria from message: ' + JSON.stringify(_det));
      }
    } catch (e) { console.error('[P2.1] ' + (e && e.message)); }
    // === P2.3: extras opcionales (empleada) como estado ===
    try {
      const _llmEmp = toolOutput && toolOutput.extras_update && toolOutput.extras_update.servicio_empleada;
      const _empReq = (_llmEmp && Number.isFinite(Number(_llmEmp.cantidad)))
        ? { cantidad: Math.max(0, Math.min(6, Math.trunc(Number(_llmEmp.cantidad)))), source: 'llm' }
        : _extractEmpleadaRequest(_lastClientMessage());
      if (_empReq) {
        const _finca = _resolveFincaForExtras(raw, toolOutput);
        const _sc = (raw.search_criteria && typeof raw.search_criteria === 'object') ? raw.search_criteria : _safeSearchCriteria();
        const _noches = Number(daysBetweenIsoDates(_sc.fecha_inicio, _sc.fecha_fin)) || 0;
        const _valor = _finca ? Number(String(_finca.servicio_empleada_valor_8h || 0).replace(/[^\d.]/g, '')) || 0 : 0;
        const _oblig = _finca ? resolveEmpleadaCount(parseEmpleadaObligatoria(_finca.empleada_obligatorio), Number(_sc.personas) || 0) : 0;
        const _extraCount = Math.max(0, _empReq.cantidad - _oblig);
        const _servicio = {
          cantidad: _empReq.cantidad,
          cantidad_adicional: _extraCount,
          obligatorias: _oblig,
          costo_dia: _valor * _extraCount,
          costo_dia_unitario: _valor,
          dias: _noches,
          subtotal: _valor * _extraCount * _noches,
          solicitado: _empReq.cantidad > 0,
          source: _empReq.source,
          finca_id: _finca ? (_finca.finca_id || _finca.codigo_original || null) : null,
          updated_at: new Date().toISOString(),
        };
        const _curExtras = (raw.extras && typeof raw.extras === 'object') ? raw.extras : (currentExtras || {});
        raw.extras = Object.assign({}, _curExtras, { servicio_empleada: _servicio });
        console.log('[P2.3] servicio_empleada: ' + JSON.stringify(_servicio));
      }
    } catch (e) { console.error('[P2.3] ' + (e && e.message)); }
  }
  // === /P2.1 + P2.3 ===

  const normalized = {
    state_transition:"""
if '[P2.1] criteria from message' in code:
    applied.append('P2.1/P2.3 normalizePostActions: already')
else:
    code = replace_once(code, NORM_ANCHOR, NORM_BLOCK, 'P2.1/P2.3 normalizePostActions')
    applied.append('P2.1/P2.3 normalizePostActions: criterios determinísticos + servicio_empleada')

# ------------------------------------------------------------------ P2.2 guard pre-normalizePostActions
P22_ANCHOR = "// === /P1.3 ===\nconst normalizedPostActions = normalizePostActions(parsed, toolOutputParsed);"
P22_BLOCK = r"""// === /P1.3 ===
// === P2.2 (8-sep-2026): invariantes de capacidad y mínimo de noches (código, no prompt) ===
(function () {
  try {
    if (!toolOutputParsed || typeof toolOutputParsed !== 'object') return;
    var _tool = parsed && parsed.tool_chosen;
    if (!['offering_agent', 'qa_agent', 'confirming_reservation_agent'].includes(_tool)) return;
    var _idx = _bitFincaIndex();
    var _sc = _safeSearchCriteria();
    var _det = _extractCriteriaFromMessage(_lastClientMessage());
    var _personas = Number(_det.personas || _sc.personas) || null;
    var _find = function (id) {
      if (!id) return null;
      var k = String(id).trim();
      if (_idx[k]) return _idx[k];
      var up = k.toUpperCase().replace(/\s+/g, '_');
      var keys = Object.keys(_idx);
      for (var i = 0; i < keys.length; i++) {
        var kk = String(keys[i]).toUpperCase().replace(/\s+/g, '_');
        if (kk === up || kk.replace(/_#0*/, '_#') === up.replace(/_#0*/, '_#')) return _idx[keys[i]];
      }
      return null;
    };
    // (a) CLIENT_CHOSE sobre una finca sin cupo → no entra a CONFIRMING
    if (toolOutputParsed.intent === 'CLIENT_CHOSE' && _personas) {
      var _id = toolOutputParsed.finca_elegida_id || (toolOutputParsed.selected_finca && toolOutputParsed.selected_finca.finca_id);
      var _f = _find(_id) || toolOutputParsed.selected_finca || null;
      var _cap = _f ? Number(_f.capacidad_max) || 0 : 0;
      if (_f && _cap > 0 && _personas > _cap) {
        var _code = _f.codigo_original || _f.finca_id || _id;
        toolOutputParsed.intent = 'QUESTION';
        toolOutputParsed.finca_elegida_id = null;
        toolOutputParsed.selected_finca = null;
        toolOutputParsed.respuesta = _code + ' tiene capacidad máxima para ' + _cap + ' personas y ustedes son ' + _personas + ', así que no la puedo reservar para tu grupo. Te busco una opción con cupo para ' + _personas + ' o prefieres ajustar el número de personas?';
        toolOutputParsed.capacity_block = { finca_id: _code, capacidad_max: _cap, personas: _personas };
        if (parsed && typeof parsed === 'object') { parsed.final_whatsapp_text = toolOutputParsed.respuesta; parsed.post_actions = {}; }
        console.log('[P2.2] CLIENT_CHOSE bloqueado por capacidad: ' + _code + ' cap ' + _cap + ' < ' + _personas);
      }
    }
    // (b) "cotización" textual sobre finca sin cupo o bajo el mínimo de noches
    var _resp = String(toolOutputParsed.respuesta || '');
    var _m = _resp.match(/Para\s+(\d{1,3})\s+personas?,\s*(\d{1,2})\s+noches?\s+en\s+([A-Za-zÁÉÍÓÚÑáéíóúñ_#\d ]+?)\s+ser[íi]a/i);
    if (_m) {
      var _n = Number(_m[1]);
      var _fq = _find(_m[3].trim());
      if (_fq) {
        var _capq = Number(_fq.capacidad_max) || 0;
        var _q = _fq.quote || {};
        var _codeq = _fq.codigo_original || _fq.finca_id;
        if (_capq > 0 && _n > _capq) {
          toolOutputParsed.respuesta = _codeq + ' tiene capacidad máxima para ' + _capq + ' personas, así que no alcanza para ' + _n + '. Quieres que te busque opciones con cupo para ' + _n + ' o ajustamos el grupo?';
          if (toolOutputParsed.intent === 'CLIENT_CHOSE') toolOutputParsed.intent = 'QUESTION';
          if (parsed && typeof parsed === 'object') parsed.final_whatsapp_text = toolOutputParsed.respuesta;
          console.log('[P2.2] cotización bloqueada por capacidad: ' + _codeq);
        } else if (_q.below_minimum && Number(_q.effective_min_noches) > 0) {
          toolOutputParsed.respuesta = 'Para esas fechas el mínimo de estadía en ' + _codeq + ' es ' + _q.effective_min_noches + ' noches, así que no puedo cotizarte ' + Number(_q.total_nights || _m[2]) + '. Si me confirmas fechas con al menos ' + _q.effective_min_noches + ' noches te paso el valor exacto.';
          if (parsed && typeof parsed === 'object') parsed.final_whatsapp_text = toolOutputParsed.respuesta;
          console.log('[P2.2] cotización bloqueada por mínimo de noches: ' + _codeq);
        }
      }
    }
  } catch (e) { console.error('[P2.2] ' + (e && e.message)); }
})();
// === /P2.2 ===
const normalizedPostActions = normalizePostActions(parsed, toolOutputParsed);"""
if '[P2.2] CLIENT_CHOSE bloqueado' in code:
    applied.append('P2.2 guard: already')
else:
    code = replace_once(code, P22_ANCHOR, P22_BLOCK, 'P2.2 guard')
    applied.append('P2.2 CJS1: guard capacidad / mínimo de noches')

# computeQuote exceeds_capacity
CQ_OLD = "    effective_min_noches: effectiveMin,\n    below_minimum: belowMinimum,\n    matched_ranges: matchedRanges,\n  };\n}"
CQ_NEW = "    effective_min_noches: effectiveMin,\n    below_minimum: belowMinimum,\n    exceeds_capacity: capMax > 0 && personasN > capMax,\n    matched_ranges: matchedRanges,\n  };\n}"
if 'exceeds_capacity: capMax' in code:
    applied.append('P2.2 computeQuote: already')
else:
    code = replace_once(code, CQ_OLD, CQ_NEW, 'P2.2 computeQuote')
    applied.append('P2.2 computeQuote: exceeds_capacity')

# ------------------------------------------------------------------ P2.4 / P2.3 docx
DOC_CRIT_OLD = "  var criteria = $('Get Context-conversations1').first().json.search_criteria || $('Get Context-conversations1').first().json.context?.search_criteria || {};\n  var confirmData = toolOutputParsed.confirmation_data_update || {};\n  var extras = $('Get Context-conversations1').first().json.extras || {};"
DOC_CRIT_NEW = """  // P2.4 (8-sep-2026): el docx se arma desde los criterios/extras YA actualizados en
  // este turno (normalizedPostActions), no desde el contexto viejo del inicio de la ejecución.
  var criteria = (typeof normalizedPostActions !== 'undefined' && normalizedPostActions && normalizedPostActions.search_criteria && typeof normalizedPostActions.search_criteria === 'object')
    ? normalizedPostActions.search_criteria
    : ($('Get Context-conversations1').first().json.search_criteria || $('Get Context-conversations1').first().json.context?.search_criteria || {});
  var confirmData = toolOutputParsed.confirmation_data_update || {};
  var extras = (typeof normalizedPostActions !== 'undefined' && normalizedPostActions && normalizedPostActions.extras && typeof normalizedPostActions.extras === 'object')
    ? Object.assign({}, $('Get Context-conversations1').first().json.extras || {}, normalizedPostActions.extras)
    : ($('Get Context-conversations1').first().json.extras || {});"""
if 'P2.4 (8-sep-2026): el docx se arma' in code:
    applied.append('P2.4 docx criterios: already')
else:
    code = replace_once(code, DOC_CRIT_OLD, DOC_CRIT_NEW, 'P2.4 docx criteria')
    applied.append('P2.4 docx: criterios y extras del turno actual')

DOC_EMP_ANCHOR = "  var payload = {\n    property_code: finca.codigo_original || finca.finca_id || '',"
DOC_EMP_BLOCK = """  // === P2.3: empleada opcional solicitada por el cliente (extras.servicio_empleada) ===
  var _optEmp = extras && extras.servicio_empleada && typeof extras.servicio_empleada === 'object' ? extras.servicio_empleada : null;
  if (_optEmp && _optEmp.solicitado && Number(_optEmp.cantidad_adicional) > 0) {
    var _optCount = Number(_optEmp.cantidad_adicional);
    var _optValor = Number(String(finca.servicio_empleada_valor_8h || 0).replace(/[^\\d.]/g, '')) || Number(_optEmp.costo_dia_unitario || 0) || 0;
    var _optTotal = _optValor * _optCount * (noches || 0);
    empleadaCount = (Number(empleadaCount) || 0) + _optCount;
    empleadaPerDay = (Number(empleadaPerDay) || 0) + _optValor * _optCount;
    empleadaTotal = (Number(empleadaTotal) || 0) + _optTotal;
    total = (Number(total) || 0) + _optTotal;
    console.log('[P2.3] docx incluye empleada opcional: ' + _optCount + ' × ' + _optValor + ' × ' + noches + ' = ' + _optTotal);
  }
  // === /P2.3 ===

  var payload = {
    property_code: finca.codigo_original || finca.finca_id || '',"""
if '[P2.3] docx incluye empleada opcional' in code:
    applied.append('P2.3 docx empleada: already')
else:
    code = replace_once(code, DOC_EMP_ANCHOR, DOC_EMP_BLOCK, 'P2.3 docx empleada')
    applied.append('P2.3 docx: empleada opcional en el total')

DOC_GATE_ANCHOR = "  if (!__isNonEmpty(payload.property_code)) __missing.push('propiedad seleccionada');\n  if (__missing.length > 0) {"
DOC_GATE_BLOCK = """  if (!__isNonEmpty(payload.property_code)) __missing.push('propiedad seleccionada');
  // === P2.2: invariantes duras antes del documento (capacidad / mínimo de noches) ===
  var __capMaxDoc = Number(finca.capacidad_max || 0) || 0;
  var __huespedesDoc = Number(payload.huespedes) || 0;
  if (__capMaxDoc > 0 && __huespedesDoc > __capMaxDoc) {
    console.error('[createReservationDocumentItem] bloqueado por capacidad: ' + __huespedesDoc + ' > ' + __capMaxDoc);
    return {
      type: 'text',
      content: 'No puedo generar la confirmación todavía: ' + payload.property_code + ' tiene capacidad máxima para ' + __capMaxDoc + ' personas y la reserva está para ' + __huespedesDoc + '. Me confirmas el número de personas o te busco una opción con más cupo?',
      media_url: null, media_urls: undefined, property_title: null, property_id: finca.finca_id || null,
    };
  }
  if (quote && quote.below_minimum && Number(quote.effective_min_noches) > 0) {
    console.error('[createReservationDocumentItem] bloqueado por mínimo de noches: ' + noches + ' < ' + quote.effective_min_noches);
    return {
      type: 'text',
      content: 'No puedo generar la confirmación todavía: para esas fechas el mínimo de estadía en ' + payload.property_code + ' es ' + quote.effective_min_noches + ' noches y la reserva tiene ' + noches + '. Me confirmas fechas con al menos ' + quote.effective_min_noches + ' noches?',
      media_url: null, media_urls: undefined, property_title: null, property_id: finca.finca_id || null,
    };
  }
  // === /P2.2 ===
  if (__missing.length > 0) {"""
if '[createReservationDocumentItem] bloqueado por capacidad' in code:
    applied.append('P2.2 docx gate: already')
else:
    code = replace_once(code, DOC_GATE_ANCHOR, DOC_GATE_BLOCK, 'P2.2 docx gate')
    applied.append('P2.2 docx: gate capacidad / mínimo de noches')

DOC_HASH_ANCHOR = "  var encoded = encodeBase64UrlJson(payload);\n  var pdfUrl = publicBase.replace(/\\/$/, '') + '/api/reservation-confirmation.pdf?payload=' + encoded;"
DOC_HASH_BLOCK = """  // === P2.4: no reenviar un documento idéntico al anterior ===
  var __fmtCOP = function (n) { return '$' + Math.round(Number(n || 0)).toLocaleString('es-CO'); };
  var __hashSrc = JSON.stringify({ p: payload.property_code, fi: payload.fecha_inicio, ff: payload.fecha_fin, h: payload.huespedes, t: payload.total, e: payload.servicio_empleada_total, n: payload.client_name, d: payload.client_document_number, m: payload.client_email, a: payload.client_address, ph: payload.client_phone });
  var __hash = String(__hashSrc.split('').reduce(function (h, ch) { return ((h << 5) - h + ch.charCodeAt(0)) | 0; }, 0));
  var __prevHash = String((prevConfirm && prevConfirm.last_doc_hash) || '');
  if (__prevHash && __prevHash === __hash) {
    console.log('[P2.4] documento idéntico al anterior, no se reenvía');
    return {
      type: 'text',
      content: 'El documento que te envié sigue igual: ' + payload.property_code + ', del ' + payload.fecha_inicio + ' al ' + payload.fecha_fin + ' (' + noches + ' noches), ' + payload.huespedes + ' personas, total ' + __fmtCOP(total) + '. Si algo está mal dime qué ajusto y te genero uno nuevo; si está bien, me confirmas con un OK',
      media_url: null, media_urls: undefined, property_title: null, property_id: finca.finca_id || null,
    };
  }
  try {
    var __exBase = (normalizedPostActions.extras && typeof normalizedPostActions.extras === 'object') ? normalizedPostActions.extras : Object.assign({}, $('Get Context-conversations1').first().json.extras || {});
    var __crBase = (__exBase.confirming_reservation && typeof __exBase.confirming_reservation === 'object') ? __exBase.confirming_reservation : (prevConfirm || {});
    normalizedPostActions.extras = Object.assign({}, __exBase, { confirming_reservation: Object.assign({}, __crBase, { last_doc_hash: __hash, last_doc_total: total, last_doc_at: new Date().toISOString() }) });
  } catch (e) { console.error('[P2.4] no pude guardar last_doc_hash: ' + (e && e.message)); }
  // === /P2.4 ===
  var encoded = encodeBase64UrlJson(payload);
  var pdfUrl = publicBase.replace(/\\/$/, '') + '/api/reservation-confirmation.pdf?payload=' + encoded;"""
if '[P2.4] documento idéntico' in code:
    applied.append('P2.4 docx hash: already')
else:
    code = replace_once(code, DOC_HASH_ANCHOR, DOC_HASH_BLOCK, 'P2.4 docx hash')
    applied.append('P2.4 docx: sin reenvío idéntico (hash)')

cjs['parameters']['jsCode'] = code

# ------------------------------------------------------------------ prompts
conf = node(wf, 'Run confirming_reservation pass')
sm = conf['parameters']['options']['systemMessage']
CONF_SCHEMA_OLD = '  "missing_fields": ["..."]\n}'
CONF_SCHEMA_NEW = '  "missing_fields": ["..."],\n  "extras_update": { "servicio_empleada": { "cantidad": null | number } }\n}'
CONF_RULE_ANCHOR = "\nOUTPUT\nDevuelve EXCLUSIVAMENTE JSON válido:"
CONF_RULE = """
- REGLA EXTRAS OPCIONALES — SERVICIO DE EMPLEADA (8-sep-2026): si el cliente pide señora(s)/empleada(s) de servicio y en la finca NO es obligatoria, emite `extras_update.servicio_empleada.cantidad` = N (número total de empleadas que quiere; 0 si dice que no la quiere). El sistema calcula el costo (servicio_empleada_valor_8h × N × días) y lo incluye en la cotización y en el documento. PROHIBIDO decir "ya lo dejo anotado" sin emitir extras_update. Si CONTEXT.extras.servicio_empleada.solicitado = true, el total que menciones DEBE incluir extras.servicio_empleada.subtotal.
- REGLA DE INTEGRIDAD (8-sep-2026): el sistema NO genera documento si personas > capacidad_max de la finca o si las noches están por debajo del mínimo de temporada; en esos casos responde con lo que el sistema te devuelva y pide el ajuste. Si el cliente da fechas o número de personas explícitos, el sistema ya los persistió: úsalos tal cual, no los contradigas.

OUTPUT
Devuelve EXCLUSIVAMENTE JSON válido:"""
if 'extras_update' in sm:
    applied.append('P2.3 prompt confirming: already')
else:
    sm = replace_once(sm, CONF_SCHEMA_OLD, CONF_SCHEMA_NEW, 'P2.3 confirming schema')
    sm = replace_once(sm, CONF_RULE_ANCHOR, CONF_RULE, 'P2.3 confirming rule')
    conf['parameters']['options']['systemMessage'] = sm
    applied.append('P2.3 prompt confirming: extras_update + integridad')

for pname in ('Run offering pass', 'Run qa pass'):
    p = node(wf, pname)
    s = p['parameters']['options']['systemMessage']
    ANCH = "- REGLA DE PRECIOS — el cliente puede preguntar el precio en cualquier momento. CÓMO responder:"
    RULE = ANCH + """
  • INTEGRIDAD (8-sep-2026): si `quote.exceeds_capacity` es true o personas > capacidad_max, NO des un total: explica la capacidad máxima y ofrece otra opción. Si `quote.below_minimum` es true, NO des un total: explica el mínimo de noches (`quote.effective_min_noches`) y pide fechas. El sistema corrige en código cualquier cotización que viole esto.
  • Si el cliente cambia fechas o número de personas, emite `search_criteria_update` con los campos nuevos (el sistema mergea sobre los actuales y además detecta fechas/personas explícitas del mensaje)."""
    if 'INTEGRIDAD (8-sep-2026)' in s:
        applied.append(f'P2.2 prompt {pname}: already')
    else:
        p['parameters']['options']['systemMessage'] = replace_once(s, ANCH, RULE, f'P2.2 prompt {pname}')
        applied.append(f'P2.2 prompt {pname}: regla integridad')

print('CA active:', put_workflow(CA, wf))
print('\n'.join(applied))
