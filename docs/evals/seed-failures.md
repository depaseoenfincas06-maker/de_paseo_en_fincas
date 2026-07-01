# Seed failures — semilla de scenarios para evals

Lista de fallos del agente observados en uso real, usados como semilla para
los scenarios YAML en [`evals/scenarios/`](../../evals/scenarios/). Cada
entrada tiene: causa, screenshot/historial, scenario YAML correspondiente, y
estado del fix (si aplica).

> ⚠️ **Estado actual del DB para `573112407139`** (30-jun-2026): solo hay 1
> conversación capturada (9-jun-2026, 20 msgs, todos OFFERING normal). El
> resto de fallos reportados (Anapoima 04 por nombre, SOPETRAN_#20, request
> emojis) no aparecen en DB — fueron observados en WhatsApp client y
> reportados por screenshot por JD. La producción estuvo down ~30-jun por
> Hetzner IP block (factura impaga), lo cual explica la ausencia de actividad
> reciente. Cuando vuelva el tráfico real, ampliaremos este doc.

---

## Fallo 1 — Finca por nombre no reconocida

**Reportado**: 30-jun-2026 (screenshot)  
**Síntoma**: Cliente escribe *"Hola quiero preguntar por la finca Anapoima 04, 8-10 Julio, 32 personas"*. Bot pasa a OFFERING pero al confirmar *"Anapoima04 es la q busco"* responde con handoff fijo *"Dame un momento, te paso con mi compañero…"*. El agente no reconoció la finca cuando el cliente la nombró directo, sin código.

**Patrón**: usuarios escriben fincas como `Anapoima 4` / `Anapoima 04` / `la Anapoima 4` en vez del `ANAPOIMA_#04` canónico. El matcher por código no las captura → fallback a HITL.

**Scenario**: [`2026-06-anapoima04-por-nombre.yaml`](../../evals/scenarios/2026-06-anapoima04-por-nombre.yaml)

**Estado del fix**: pendiente. Posiblemente requiere normalizar el input del cliente con un regex `(zona)\s*0?(\d+)` → `ZONA_#NN` antes del matcher BIT.

---

## Fallo 2 — Falso positivo de no-existencia (SOPETRAN_#20)

**Reportado**: 30-jun-2026 (screenshot)  
**Síntoma**: Cliente busca 52 px en Antioquía. Bot ofrece solo 2 opciones (SAN_JERONIMO_#22, SANTAFE_#02). Cliente pide específicamente SOPETRAN_#20 (que SÍ existe en inventario, capacidad 30/70). Bot responde *"no tenemos registrada ninguna finca con el código Sopetrán #20"* — FALSO POSITIVO de no-existencia.

**Patrón**: el matcher de inventario falla a buscar la finca específicamente nombrada y asume que no existe, en vez de verificar contra el inventario real. Posiblemente la `list_matching_fincas` falla con el filtro de capacidad y el offering_agent no escala a `get_finca_details`.

**Scenario**: [`2026-06-sopetran20-existe.yaml`](../../evals/scenarios/2026-06-sopetran20-existe.yaml)

**Estado del fix**: ✅ **RESUELTO** 2026-06-30 (commit siguiente). Deployado.

**Root cause analysis (6 capas)**:

1. **Data (Google Sheet fila 2153)**: `SOPETRAN_#20` marcada `activa=FALSE`. JD confirmó que la desactivación es **intencional** (finca deshabilitada). Otras 7 fincas también inactivas en el inventario (SANTAFE_#17, GUATAPE_#01, LA_MESA_#06, etc.).

2. **`Normalize Inventory` (línea 251)**: `activeInventory = inventory.filter(item => item.activa && item.review_status === 'READY_FOR_OFFERING')`. Filtro global — mata también las búsquedas por código específico.

3. **`Build Inventory Tool Response`**: `findBestMatch()` (línea 824-831) buscaba solo en el inventory filtrado. `get_finca_details(SOPETRAN_#20)` → `null` → `notes: 'finca_not_found'`.

4. **Prompt `Run offering pass`** (línea 173-180): regla "FINCA MENCIONADA POR CÓDIGO" asumía que la finca estaba en `last_inventory_items.items[]`. Sin fallback cuando no está.

5. **Post-processing (`Run offering context pass`)**: el `respuesta` del offering LLM se descartaba y se reemplazaba con un `context_message` genérico generado por un mini-agent LLM que no tenía visibilidad de la respuesta original.

6. **Runner de evals**: bug propio del harness — atribuía mensajes late-arriving del turn N a turn N+1 por timing incorrecto (no anclaba en el INBOUND del turn actual).

**Fix aplicado (patch `patch_sopetran_root_cause.py`, deploy 2026-06-30)**:

- **Capa 2 fix**: `Normalize Inventory` ahora emite `full_inventory` (todas, incluidas inactivas) junto con `inventory` (solo activas). Backward compatible.
- **Capa 3 fix**: `Build Inventory Tool Response` usa `fullInventory` como fallback cuando la finca no está en `inventory` filtrado. `selected_finca` ahora incluye el campo `activa` explícitamente. `notes: 'finca_inactive'` cuando aplica.
- **Capa 4 fix**: nueva regla "FINCA POR CÓDIGO NO EN CONTEXTO" en `Run offering pass` con branches para `activa=false` / `not_found` / activa fuera de filtro. Instruye al LLM a llamar `get_finca_details` obligatoriamente y responder honestamente.
- **Capa 5 (auto-resuelto)**: el `Run offering context pass` LLM, dado que ahora recibe `offering_result` con el nuevo formato, genera el `context_message` correcto sin cambios adicionales.
- **Capa 6 fix (runner)**: `evals/lib/runner.mjs::waitForTurnResponse` ahora ancla cada turn en su INBOUND antes de contar outbound. Y `bot_recognized_finca` en `evals/lib/assertions.mjs` normaliza acentos.

**Verificación**: eval run `2026-07-01T02-13-44-571Z` — 1/1 passed. Bot response:
> "La finca SOPETRAN_#20 actualmente no está disponible en nuestra plataforma. Te comparto alternativas similares en Antioquia: las opciones que te envié hace un momento, SAN JERONIMO #22 y SANTAFE_#02, están totalmente disponibles para tus fechas..."

---

## Fallo 3 — Mención de Instagram sin link (handle corto)

**Reportado**: 28-may-2026 (conversación previa de `573112407139`)  
**Síntoma**: Bot escribió *"…en Instagram nos encuentras como @depaseoenfincas"* (sin "col") sin link. El normalizador `_ensureInstagramLink` solo matcheaba el handle largo.

**Scenario**: [`2026-05-ig-link-handle-corto.yaml`](../../evals/scenarios/2026-05-ig-link-handle-corto.yaml)

**Estado del fix**: ✅ deployado 29-may-2026 (commit `82556fb`). El regex ahora cubre `@depaseoenfincas(?:col)?\b` → normaliza al handle canónico + link, idempotente.

---

## Fallo 4 — Loop de mensaje fijo HITL

**Reportado**: 28-may-2026 (screenshots `573112407139`)  
**Síntoma**: Tras un primer HITL, el QA validator (LLM router) quedaba enganchado en `route_mode='HITL'` porque el historial mostraba el handoff en curso. Resultado: el bot repetía *"Dame un momento, te paso con mi compañero…"* a TODA pregunta siguiente.

**Scenario sugerido**: aún no escrito — agregar `2026-05-hitl-no-loop.yaml` con turnos:
1. *"quiero hablar con un humano"* → bot envía handoff UNA vez.
2. *"hay que pagar algo adicional?"* → bot debe **contestar como agente** (no repetir handoff).
3. *"tienen wifi?"* → bot responde normal.

**Estado del fix**: ✅ deployado 29-may-2026 (commit `82556fb`). En `Parse QA validator`: si el bot ya entregó el handoff en alguna de sus últimas 3 respuestas, degrada `HITL→STATE` para que el agente normal conteste.

---

## Feature request — Más emojis

**Reportado**: 30-jun-2026 (screenshot)  
**Mensaje literal**: *"Tratemos de que el chat use más Emojis… hace divertida la conversación."*

**Tipo**: tone tuning, no es un fallo funcional.

**Scenario**: lo evaluamos por separado — assertion `emoji_count_at_least` sobre respuestas del bot. Implementación pendiente; primero priorizamos fallos críticos.

---

## Fallos históricos cubiertos en suite de regresión

Para evitar que regresen, vamos a agregar scenarios para cada uno de estos bugs que ya corregimos (lista de tasks completed):

| Bug histórico | Commit fix | Scenario |
|---|---|---|
| PDF deposit/cleaning = 0 | `9305c9e` | `pending: pdf-totals-no-zero.yaml` |
| Template literal `{{...}}` leak | `9305c9e` | `pending: no-template-literal-leak.yaml` |
| Cundinamarca zone matching | `9305c9e` | `pending: cundinamarca-coverage.yaml` |
| Oficinas vs visita disambiguation | `9305c9e` | `pending: oficinas-vs-visita.yaml` |
| Año Nuevo classification | `9305c9e` | `pending: ano-nuevo-festivo.yaml` |
| Notif HITL via Meta directo | `aff797a` | (infra — observabilidad scan) |

Estos están en cola en task #4.
