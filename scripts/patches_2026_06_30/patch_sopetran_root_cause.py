#!/usr/bin/env python3
"""Fix root-cause SOPETRAN_#20 bug (Jun 30 2026).

Bug: cuando cliente nombra una finca por código específico que existe pero está
marcada activa=FALSE (o filtrada por otro motivo del pipeline de matching),
el bot la IGNORA silenciosamente y solo muestra alternativas. Concretamente:
'Sopetrán 20 tiene 30/70 px, pruebo con esa' → bot ofrece otras opciones sin
siquiera mencionar SOPETRAN_#20.

Root cause en 3 capas coordinadas:

1) `Normalize Inventory` filtra activa && review_status hard antes de pasar
   downstream (línea 251). El filtro es global: mata también las búsquedas
   por código específico vía get_finca_details.

2) `Build Inventory Tool Response` (BIT) usa el mismo `inventory` filtrado
   para AMBAS operaciones (list_matching_fincas Y get_finca_details). El
   segundo endpoint debería poder buscar cualquier finca — el cliente ya la
   conoce y quiere respuesta clara.

3) Prompt del `offering_agent` (línea 173-180) tiene regla para "finca
   mencionada por código" pero asume que está en last_inventory_items. Sin
   fallback cuando no está.

Fix estructural (3 cambios coordinados):

A) Normalize Inventory: expone `full_inventory` (todas, incluidas inactivas)
   junto con `inventory` (solo activas READY_FOR_OFFERING) para downstream.

B) BIT: get_finca_details busca en full_inventory (fallback si no está en
   activeInventory). Incluye `activa` en el selected_finca de la respuesta.

C) Prompt offering_agent: nueva regla "FINCA POR CÓDIGO NO EN CONTEXTO"
   con branches para activa=false / not_found / activa fuera de filtro.

JD confirmó (2026-06-30) que SOPETRAN_#20 debe permanecer activa=FALSE
(deshabilitada intencionalmente). El bot ahora la reconocerá y le dirá al
cliente "existe pero no disponible" + sugerirá similares.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
BASE = 'https://n8n.depaseoenfincas.raaamp.co'
WID = '2NV08zRFKENUsQVC'
URL = f'{BASE}/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# =============================================================================
# A) Normalize Inventory — expose full_inventory alongside active
# =============================================================================
NI_OLD = """const activeInventory = inventory.filter((item) => item.activa && item.review_status === 'READY_FOR_OFFERING');

return [
  {
    json: {
      inventory: activeInventory,
      inventory_meta: {
        access_ok: true,
        error_message: null,
        count: activeInventory.length,
        total_rows: inventory.length,
      },
    },
  },
];"""

NI_NEW = """const activeInventory = inventory.filter((item) => item.activa && item.review_status === 'READY_FOR_OFFERING');

// full_inventory (Jun 30 2026): incluye INACTIVAS. BIT.get_finca_details lo usa
// como fallback para responder preguntas del cliente sobre fincas específicas
// que están deshabilitadas o excluidas — permite decir "existe pero no
// disponible" en vez de silenciar. list_matching_fincas sigue usando el active.
return [
  {
    json: {
      inventory: activeInventory,
      full_inventory: inventory,
      inventory_meta: {
        access_ok: true,
        error_message: null,
        count: activeInventory.length,
        total_rows: inventory.length,
        inactive_count: inventory.length - activeInventory.length,
      },
    },
  },
];"""

# =============================================================================
# B) Build Inventory Tool Response — get_finca_details usa fullInventory
# =============================================================================
BIT_OLD_HEAD = "const inventory = Array.isArray($json.inventory) ? $json.inventory : [];"
BIT_NEW_HEAD = """const inventory = Array.isArray($json.inventory) ? $json.inventory : [];
// full_inventory (Jun 30 2026): superset con inactivas. get_finca_details lo
// usa como fallback si la finca pedida no está en `inventory` filtrado.
const fullInventory = Array.isArray($json.full_inventory) ? $json.full_inventory : inventory;"""

BIT_OLD_FBM = """const findBestMatch = () => {
  if (!inventory.length) return null;
  if (explicitFincaId) {
    const exact = inventory.find((item) => normalizeText(item.finca_id) === normalizeText(explicitFincaId));
    if (exact) return exact;
  }
  return ranked(inventory, false)[0] || null;
};"""

BIT_NEW_FBM = """const findBestMatch = () => {
  // Para get_finca_details, buscamos primero en active; si no aparece y hay
  // finca_id explícito, buscamos en full (incluye inactivas). Esto permite
  // responder honestamente sobre fincas deshabilitadas que el cliente nombra.
  if (inventory.length && explicitFincaId) {
    const exactActive = inventory.find((item) => normalizeText(item.finca_id) === normalizeText(explicitFincaId));
    if (exactActive) return exactActive;
  }
  if (explicitFincaId && fullInventory.length) {
    const exactAny = fullInventory.find((item) => normalizeText(item.finca_id) === normalizeText(explicitFincaId));
    if (exactAny) return exactAny;
  }
  if (!inventory.length) return null;
  return ranked(inventory, false)[0] || null;
};"""

# Sanitize get_finca_details response to expose `activa` field so the LLM can
# reason about availability. We inject it via a wrapper on selected_finca.
BIT_OLD_RETURN = """      selected_finca: bestMatch ? sanitizeDetailItem(bestMatch, nights) : null,
      owner: null,
      search_applied: {
        finca_id: explicitFincaId || null,
        nombre: explicitName || null,
        query,
      },
      notes: bestMatch ? null : 'finca_not_found',"""

BIT_NEW_RETURN = """      selected_finca: bestMatch
        ? { ...sanitizeDetailItem(bestMatch, nights), activa: bestMatch.activa !== false }
        : null,
      owner: null,
      search_applied: {
        finca_id: explicitFincaId || null,
        nombre: explicitName || null,
        query,
      },
      notes: bestMatch
        ? (bestMatch.activa === false ? 'finca_inactive' : null)
        : 'finca_not_found',"""

# =============================================================================
# C) Prompt del offering_agent — regla FINCA POR CÓDIGO NO EN CONTEXTO
# =============================================================================
# Insertamos la nueva regla justo después de la existente (línea 173-180).
# Anclamos por el texto de la última línea de la regla existente.
OFF_ANCHOR = "  Esta regla previene el caso reportado donde el bot seguía hablando de Santa Fe 9 aunque el cliente preguntaba por San Jerónimo 02 y 06."

OFF_INSERT = OFF_ANCHOR + """
- 🎯 REGLA — FINCA POR CÓDIGO NO EN CONTEXTO (Jun 30 2026, bug SOPETRAN_#20):
  Si el cliente menciona una finca por código específico (ej. "Sopetrán 20", "SANTA FE 17", "guatape01") y ESA finca NO está en `last_inventory_items.items[]` NI en `context.shown_fincas`:
  1. Llama OBLIGATORIAMENTE a inventory_reader_tool con operation="get_finca_details" y el finca_id normalizado (ej. "SOPETRAN_#20").
  2. Analiza la respuesta:
     • Si `selected_finca` viene con `activa === false` o `notes === "finca_inactive"`: la finca EXISTE pero está deshabilitada. Responde: "La finca [codigo_original] actualmente no está disponible en nuestra plataforma. Te comparto alternativas similares en [zona/municipio]:" y reofrece las que ya tenías en shown_fincas.
     • Si `notes === "finca_not_found"` (selected_finca null): no existe con ese código. Responde: "No encuentro una finca con el código [X] en nuestro sistema. ¿Podrías verificar el nombre?" (NO ofrezcas alternativas hasta confirmar).
     • Si `selected_finca` viene con `activa === true` pero simplemente no matcheaba filtros previos (ej. capacidad, zona): responde con la ficha normal + explica brevemente por qué no aparecía inicialmente (ej. "queda un poco lejos de la zona que pediste, pero acepta [N] personas").
  3. NUNCA ignores silenciosamente la finca nombrada. Reconocer + explicar > silenciar."""

# =============================================================================
# Aplicar los 3 cambios
# =============================================================================
applied = []
for n in wf['nodes']:
    name = n['name']
    if name == 'Normalize Inventory':
        code = n['parameters']['jsCode']
        if 'full_inventory' in code:
            applied.append(f"[skip] {name}: already deployed")
            continue
        if NI_OLD not in code:
            print(f'!! anchor missing in {name}'); sys.exit(2)
        n['parameters']['jsCode'] = code.replace(NI_OLD, NI_NEW, 1)
        applied.append(f'✓ {name}: full_inventory exposed')

    elif name == 'Build Inventory Tool Response':
        code = n['parameters']['jsCode']
        if 'fullInventory' in code:
            applied.append(f"[skip] {name}: already deployed")
            continue
        if BIT_OLD_HEAD not in code:
            print(f'!! head anchor missing in {name}'); sys.exit(3)
        if BIT_OLD_FBM not in code:
            print(f'!! findBestMatch anchor missing in {name}'); sys.exit(4)
        if BIT_OLD_RETURN not in code:
            print(f'!! return anchor missing in {name}'); sys.exit(5)
        code = code.replace(BIT_OLD_HEAD, BIT_NEW_HEAD, 1)
        code = code.replace(BIT_OLD_FBM, BIT_NEW_FBM, 1)
        code = code.replace(BIT_OLD_RETURN, BIT_NEW_RETURN, 1)
        n['parameters']['jsCode'] = code
        applied.append(f'✓ {name}: get_finca_details fallback + activa field')

    elif name == 'Run offering pass':
        sm = n['parameters'].get('options', {}).get('systemMessage', '')
        if 'FINCA POR CÓDIGO NO EN CONTEXTO' in sm:
            applied.append(f"[skip] {name}: already deployed")
            continue
        if OFF_ANCHOR not in sm:
            print(f'!! offering anchor missing'); sys.exit(6)
        new_sm = sm.replace(OFF_ANCHOR, OFF_INSERT, 1)
        n['parameters']['options']['systemMessage'] = new_sm
        applied.append(f'✓ {name}: FINCA POR CÓDIGO NO EN CONTEXTO rule added')

if len(applied) != 3 or any('[skip]' in a for a in applied) and len([a for a in applied if a.startswith('✓')]) == 0:
    if all('[skip]' in a for a in applied):
        print('all changes already deployed')
        sys.exit(0)
print('\n'.join(applied))

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {
    'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED},
}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
resp = json.loads(r2.stdout)
print(f'PUT ok. active={resp.get("active")}')
