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

**Estado del fix**: pendiente. Crítico — viola la invariante CORE #1 ("siempre mostrar el inventario real"). Hay que asegurar que cuando el cliente nombra una finca concreta, el agente SIEMPRE consulta el inventario antes de afirmar que no existe.

**Eval run 2026-06-30 (post-Hetzner unblock)**: el bug **reproduce parcialmente**. El bot ya no dice "no tenemos registrada" (eso parece arreglado), pero **ignora silenciosamente la finca específica nombrada** y muestra solo las dos alternativas que ya había ofrecido (`SAN_JERONIMO_#22`, `SANTAFE_#02`). Asserts `no_false_unavailable` ✅ + `not_contains: 'no existe'` ✅, pero `bot_recognized_finca: SOPETRAN_#20` ❌. Ver `evals/runs/2026-06-30T23-58-16-434Z/report.md`. Hipótesis del fix: cuando el offering_agent recibe un mensaje que nombra una finca específica por código (regex `(zona)\s*#?\s*\d+`), forzar una llamada a `inventory_reader_tool` con `get_finca_details` para esa finca y añadirla a las opciones mostradas si tiene capacidad.

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
