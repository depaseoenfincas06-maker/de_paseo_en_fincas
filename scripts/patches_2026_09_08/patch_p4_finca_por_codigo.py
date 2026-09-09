#!/usr/bin/env python3
"""P4 (9-sep-2026): finca nombrada por código que NO está en la última búsqueda.

Caso (inf-07): "Dice la mesa 11, esa me gusta" con grupo de 15 → la búsqueda de La Mesa
para 15 excluye LA_MESA_#11 (cap 12) → el guardrail de Finalize no la encuentra en el cache
y dice "MESA_#11 por ahora no está disponible" (FALSO: existe, solo no tiene cupo).

P4.1  BIT `findBestMatch`: si no hay id exacto, acepta match por SUFIJO único
      ("MESA_#11" → LA_MESA_#11; "APICALA 1" → CARMEN_DE_APICALA_#01).
P4.2  Finalize guardrail: (a) finca en cache con quote pero personas > capacidad_max → texto
      de capacidad (no cotiza); (b) finca NO encontrada → texto neutro ("la reviso y te
      confirmo"), NUNCA "no está disponible".
(P1 rev 5, en patch_p1: hydrate por código nombrado en el mensaje → la finca entra al cache.)
Idempotente.
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from n8n_patch_lib import get_workflow, put_workflow, backup, node, replace_once  # noqa: E402

CA = '2NV08zRFKENUsQVC'
applied = []
wf = get_workflow(CA)
backup(CA)

# ------------------------------------------------------------------ P4.1 BIT suffix match
bit = node(wf, 'Build Inventory Tool Response')
bc = bit['parameters']['jsCode']
FBM_OLD = """  if (explicitFincaId && fullInventory.length) {
    const exactAny = fullInventory.find((item) => normalizeText(item.finca_id) === normalizeText(explicitFincaId));
    if (exactAny) return exactAny;
  }"""
FBM_NEW = """  if (explicitFincaId && fullInventory.length) {
    const exactAny = fullInventory.find((item) => normalizeText(item.finca_id) === normalizeText(explicitFincaId));
    if (exactAny) return exactAny;
  }
  // P4.1 (9-sep-2026): match por SUFIJO único ("MESA_#11" → LA_MESA_#11, "APICALA 1" →
  // CARMEN_DE_APICALA_#01). Normaliza letras + número sin ceros a la izquierda.
  if (explicitFincaId) {
    const _keyOf = (s) => {
      const t = normalizeText(s).replace(/[^a-z0-9]/g, '');
      const m = t.match(/^([a-z]+)(\\d{1,3})$/);
      return m ? m[1] + String(parseInt(m[2], 10)) : t;
    };
    const _k = _keyOf(explicitFincaId);
    if (_k.length >= 4 && /\\d$/.test(_k)) {
      const _pool = inventory.length ? inventory : fullInventory;
      const _cands = _pool.filter((item) => { const ik = _keyOf(item.finca_id); return ik === _k || ik.endsWith(_k); });
      if (_cands.length === 1) return _cands[0];
    }
  }"""
if 'P4.1 (9-sep-2026): match por SUFIJO' in bc:
    applied.append('P4.1 BIT: already')
else:
    bit['parameters']['jsCode'] = replace_once(bc, FBM_OLD, FBM_NEW, 'P4.1 findBestMatch')
    applied.append('P4.1 BIT findBestMatch: sufijo único')

# ------------------------------------------------------------------ P4.2 Finalize guardrail
fin = node(wf, 'Finalize offering outbound')
fc = fin['parameters']['jsCode']
# P4.3: el lookup del cache también mira selected_finca y similar_items (el hydrate por
# get_finca_details persiste la finca en selected_finca, no en items).
LK_OLD = """      const _cachedList = _cache && Array.isArray(_cache.items) ? _cache.items : [];"""
LK_NEW = """      // P4.3 (9-sep-2026): incluir selected_finca (hydrate por get_finca_details) y similar_items
      const _cachedList = []
        .concat(_cache && Array.isArray(_cache.items) ? _cache.items : [])
        .concat(_cache && Array.isArray(_cache.similar_items) ? _cache.similar_items : [])
        .concat(_cache && _cache.selected_finca && typeof _cache.selected_finca === 'object' ? [_cache.selected_finca] : []);"""
if 'P4.3 (9-sep-2026): incluir selected_finca' in fc:
    applied.append('P4.3 Finalize lookup: already')
else:
    fc = replace_once(fc, LK_OLD, LK_NEW, 'P4.3 Finalize lookup')
    fin['parameters']['jsCode'] = fc
    applied.append('P4.3 Finalize lookup: selected_finca + similar_items')
    fc = fin['parameters']['jsCode']

G_OLD = """    if (_cachedItem && _cachedItem.quote && _cachedItem.quote.human_summary) {
      // Precio determinístico desde el quote precalculado — cero LLM math.
      contextMessage = `Sobre la finca ${targetFincaId}, para tus fechas queda así: ${_cachedItem.quote.human_summary}. Y estas otras opciones también están disponibles:`;
    } else if (_cachedItem) {
      contextMessage = `La finca ${targetFincaId} sí está disponible en nuestro inventario. Dame un momento y te comparto el detalle completo con precios para tus fechas.`;
    } else {
      contextMessage = `La finca ${targetFincaId} por ahora no está disponible para tus fechas en nuestra plataforma. Te comparto las alternativas que sí están disponibles:`;
    }"""
G_NEW = """    // P4.2 (9-sep-2026): capacidad antes que precio; y si no está en el cache NO se
    // afirma "no disponible" (puede existir y solo no tener cupo o no estar en la búsqueda).
    let _personasCtx = 0;
    try { _personasCtx = Number(($('Get Context-conversations1').first().json.search_criteria || {}).personas) || 0; } catch (e) { _personasCtx = 0; }
    const _cachedCode = _cachedItem ? (_cachedItem.codigo_original || _cachedItem.finca_id || targetFincaId) : targetFincaId;
    const _cachedCap = _cachedItem ? Number(_cachedItem.capacidad_max) || 0 : 0;
    if (_cachedItem && _cachedCap > 0 && _personasCtx > _cachedCap) {
      contextMessage = `${_cachedCode} tiene capacidad máxima para ${_cachedCap} personas, así que no alcanza para tu grupo de ${_personasCtx}. Estas opciones sí aplican para ustedes:`;
    } else if (_cachedItem && _cachedItem.quote && _cachedItem.quote.below_minimum && Number(_cachedItem.quote.effective_min_noches) > 0) {
      contextMessage = `Para esas fechas el mínimo de estadía en ${_cachedCode} es ${_cachedItem.quote.effective_min_noches} noches. Si me confirmas fechas con ese mínimo te paso el valor; mientras tanto, estas opciones sí aplican:`;
    } else if (_cachedItem && _cachedItem.quote && _cachedItem.quote.human_summary) {
      // Precio determinístico desde el quote precalculado — cero LLM math.
      contextMessage = `Sobre la finca ${_cachedCode}, para tus fechas queda así: ${_cachedItem.quote.human_summary}. Y estas otras opciones también están disponibles:`;
    } else if (_cachedItem) {
      contextMessage = `La finca ${_cachedCode} sí está en nuestro inventario. Dame un momento y te comparto el detalle completo con precios para tus fechas.`;
    } else {
      contextMessage = `Sobre ${targetFincaId}: no me aparece en esta búsqueda, la reviso y te confirmo. Mientras tanto, estas opciones sí aplican para tu grupo:`;
    }"""
if 'P4.2 (9-sep-2026): capacidad antes que precio' in fc:
    applied.append('P4.2 Finalize: already')
else:
    fin['parameters']['jsCode'] = replace_once(fc, G_OLD, G_NEW, 'P4.2 Finalize guardrail')
    applied.append('P4.2 Finalize guardrail: capacidad / sin "no disponible" falso')

print('CA active:', put_workflow(CA, wf))
print('\n'.join(applied))
