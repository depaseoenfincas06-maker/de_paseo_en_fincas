#!/usr/bin/env python3
"""FASE 2 (Jul 1 2026) — Fixes de raíz tras auditoría completa del inventario
y de los fallos del batch 4 (real-price). Objetivo: minimizar errores de
fincas disponibles / precios / información para la suite de 100 scenarios.

Root causes encontrados:

R1. El offering LLM se ATASCA (maxIterations=6) al llamar tools y su output
    final queda como "Calling inventory_reader_tool with input: ..." →
    tool_output_parsed vacío → bot silencioso o guardrail con info falsa.

R2. El cache last_inventory_items solo guarda el top-3 mostrado → el
    guardrail determinístico no puede cotizar fincas de la zona que
    existen pero no salieron en el top-3 (ej. CARMEN_DE_APICALA_02 ranked
    4to por capacity-fit).

R3. El guardrail dice "no aparece disponible" para fincas que SÍ están
    activas — mensaje factualmente incorrecto.

R4. Cuando el cliente pide "total exacto ya sumado", el bot a veces da solo
    el desglose sin el número final, o pide confirmación antes.

Fixes:

F1. maxIterations 6→10 en los 4 agent passes (reduce stalls de R1).
F2. BIT: nuevo campo `cache_extra` con ranked 4-20 + top-10 similares
    (sanitized con quote). NO va al LLM (Return BIT Output lo strips), pero
    SÍ se persiste en last_inventory_items → cobertura amplia del cache.
F3. Persist last_inventory_items: mergea cache_extra en items (3 sitios).
F4. Return BIT Output: strip cache_extra para no inflar contexto del LLM.
F5. Finalize offering outbound: guardrail quote-from-cache — si la finca
    nombrada está en cache con quote, responde el precio DETERMINÍSTICO
    (quote.human_summary). Si está en cache sin quote → mensaje honesto
    "sí está, dame un momento". Solo si NO está en cache → "no disponible".
F6. Prompt offering: si piden TOTAL, la primera línea es el número final.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
BASE = 'https://n8n.depaseoenfincas.raaamp.co'
WID = '2NV08zRFKENUsQVC'
URL = f'{BASE}/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

applied = []

# ========================= F2: BIT cache_extra =========================
BIT_ANCHOR = """if (operation === 'list_matching_fincas') {
  const exactItems = strictRanked.slice(0, limit).map((item) => sanitizeListItem(item, nights));
  const similarItems = (strictRanked.length ? strictRanked.slice(limit) : similarRanked)
    .slice(0, limit)
    .map((item) => sanitizeListItem(item, nights));"""

BIT_NEW = """if (operation === 'list_matching_fincas') {
  const exactItems = strictRanked.slice(0, limit).map((item) => sanitizeListItem(item, nights));
  const similarItems = (strictRanked.length ? strictRanked.slice(limit) : similarRanked)
    .slice(0, limit)
    .map((item) => sanitizeListItem(item, nights));
  // cache_extra (Jul 1 2026): ranked 4-20 + top similares. NO se muestra al
  // cliente ni va al LLM (Return BIT Output lo quita) — solo se persiste en
  // last_inventory_items para que el guardrail determinístico pueda cotizar
  // CUALQUIER finca de la zona con su quote precalculado.
  const cacheExtra = strictRanked
    .slice(limit, 20)
    .concat(similarRanked.slice(0, 10))
    .map((item) => sanitizeListItem(item, nights));"""

BIT_RET_ANCHOR = """        notes: exactItems.length ? null : similarItems.length ? 'no_exact_match_but_similar' : 'no_match',"""
BIT_RET_NEW = """        cache_extra: cacheExtra,
        notes: exactItems.length ? null : similarItems.length ? 'no_exact_match_but_similar' : 'no_match',"""

# ========================= F5: guardrail quote-from-cache =========================
FIN_OLD = """  if (!isNamedShownAsCard && !respuestaMentionsIt) {
    // Cliente nombró finca por código pero no aparece ni en cards ni en
    // respuesta. Sobrescribimos context_message determinísticamente.
    contextMessage = `La finca ${targetFincaId} no aparece disponible en este momento en nuestra plataforma. Te comparto las alternativas que sí están disponibles para tus fechas:`;
  }"""

FIN_NEW = """  if (!isNamedShownAsCard && !respuestaMentionsIt) {
    // Cliente nombró finca por código pero no aparece ni en cards ni en la
    // respuesta del LLM. Antes de decir "no disponible" (que puede ser
    // FALSO), buscamos en el cache last_inventory_items — con cache_extra
    // (Jul 2026) el cache cubre el top-20 de la zona con quote precalculado.
    let _cachedItem = null;
    try {
      const _cache = $('Refetch last_inventory_items').first().json.last_inventory_items;
      const _cachedList = _cache && Array.isArray(_cache.items) ? _cache.items : [];
      _cachedItem = _cachedList.find((it) => {
        const _id = _stripAccents(String(it?.finca_id || it?.codigo_original || '')).toUpperCase().replace(/[^A-Z0-9]/g, '');
        return _id === targetKey;
      }) || null;
    } catch (e) { _cachedItem = null; }
    if (_cachedItem && _cachedItem.quote && _cachedItem.quote.human_summary) {
      // Precio determinístico desde el quote precalculado — cero LLM math.
      contextMessage = `Sobre la finca ${targetFincaId}, para tus fechas queda así: ${_cachedItem.quote.human_summary}. Y estas otras opciones también están disponibles:`;
    } else if (_cachedItem) {
      contextMessage = `La finca ${targetFincaId} sí está disponible en nuestro inventario. Dame un momento y te comparto el detalle completo con precios para tus fechas.`;
    } else {
      contextMessage = `La finca ${targetFincaId} por ahora no está disponible para tus fechas en nuestra plataforma. Te comparto las alternativas que sí están disponibles:`;
    }
  }"""

# ========================= F6: prompt total-first =========================
PROMPT_ANCHOR = """- REGLA DE PRECIOS — el cliente puede preguntar el precio en cualquier momento. CÓMO responder:
  • NUNCA calcules precio tú mismo."""
PROMPT_NEW = """- REGLA DE PRECIOS — el cliente puede preguntar el precio en cualquier momento. CÓMO responder:
  • Si el cliente pide el TOTAL ("total exacto", "cuánto queda todo", "ya sumado", "con todo incluido"): tu PRIMERA frase DEBE contener el número final: "Para [N] personas, [X] noches en [FINCA] sería $[quote.total]." Después puedes dar el desglose. NUNCA des solo el desglose sin el total. NUNCA pidas confirmación antes de darlo.
  • NUNCA calcules precio tú mismo."""

for n in wf['nodes']:
    name = n['name']

    # F1: maxIterations
    if name in ('Run offering pass', 'Run qualifying pass', 'Run confirming_reservation pass', 'Run qa pass'):
        opts = n['parameters'].setdefault('options', {})
        if opts.get('maxIterations') != 10:
            opts['maxIterations'] = 10
            applied.append(f'F1 {name}: maxIterations→10')

    # F2: BIT cache_extra
    if name == 'Build Inventory Tool Response':
        code = n['parameters']['jsCode']
        if 'cacheExtra' in code:
            applied.append('F2 BIT: already')
        else:
            if BIT_ANCHOR not in code: print('!! F2 anchor1 missing'); sys.exit(2)
            if BIT_RET_ANCHOR not in code: print('!! F2 anchor2 missing'); sys.exit(3)
            code = code.replace(BIT_ANCHOR, BIT_NEW, 1)
            code = code.replace(BIT_RET_ANCHOR, BIT_RET_NEW, 1)
            n['parameters']['jsCode'] = code
            applied.append('F2 BIT: cache_extra añadido')

    # F3: Persist merges cache_extra
    if name == 'Persist last_inventory_items':
        q = n['parameters']['query']
        OLD_OBJ = '{items: $json.items || [], similar_items: $json.similar_items || [], selected_finca: $json.selected_finca || null}'
        NEW_OBJ = '{items: ($json.items || []).concat($json.cache_extra || []), similar_items: $json.similar_items || [], selected_finca: $json.selected_finca || null}'
        if 'cache_extra' in q:
            applied.append('F3 Persist: already')
        else:
            cnt = q.count(OLD_OBJ)
            if cnt < 3: print(f'!! F3 anchor missing (found {cnt}/expected>=3)'); sys.exit(4)
            n['parameters']['query'] = q.replace(OLD_OBJ, NEW_OBJ)
            applied.append(f'F3 Persist: cache_extra merged ({cnt} sitios)')

    # F4: Return BIT Output strips cache_extra
    if name == 'Return BIT Output':
        code = n['parameters']['jsCode']
        if 'cache_extra' in code:
            applied.append('F4 Return: already')
        else:
            NEW_RET = """// Re-emite el output de BIT para que el toolWorkflow devuelva
// al LLM exactamente lo que BIT computó (con quote per-item),
// no el resultado del UPDATE de Postgres.
// cache_extra se QUITA: es solo para Persist (cache amplio), meterlo al
// contexto del LLM lo inflaría con ~17 fincas extra que no debe mostrar.
return $('Build Inventory Tool Response').all().map((i) => {
  const j = Object.assign({}, i.json);
  delete j.cache_extra;
  return { json: j };
});"""
            n['parameters']['jsCode'] = NEW_RET
            applied.append('F4 Return BIT Output: strip cache_extra')

    # F5: guardrail quote-from-cache
    if name == 'Finalize offering outbound':
        code = n['parameters']['jsCode']
        if '_cachedItem' in code:
            applied.append('F5 Finalize: already')
        else:
            if FIN_OLD not in code: print('!! F5 anchor missing'); sys.exit(5)
            n['parameters']['jsCode'] = code.replace(FIN_OLD, FIN_NEW, 1)
            applied.append('F5 Finalize: quote-from-cache guardrail')

    # F6: prompt total-first (offering + qa agents)
    if name in ('Run offering pass', 'Run qa pass'):
        sm = n['parameters'].get('options', {}).get('systemMessage', '')
        if 'tu PRIMERA frase DEBE contener el número final' in sm:
            applied.append(f'F6 {name}: already')
        elif PROMPT_ANCHOR in sm:
            n['parameters']['options']['systemMessage'] = sm.replace(PROMPT_ANCHOR, PROMPT_NEW, 1)
            applied.append(f'F6 {name}: total-first rule')

print('\n'.join(applied))
if not applied:
    print('nothing to apply'); sys.exit(0)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {
    'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED},
}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
