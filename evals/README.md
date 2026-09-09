# De Paseo en Fincas — Evals & Observability

Test harness for the customer-agent n8n workflow `2NV08zRFKENUsQVC`.

## Goals

1. **Catch regressions before clients do.** Every real-world bug becomes a
   scenario; the suite runs against the live agent and fails if the regression
   reappears.
2. **Observe production traffic.** Heuristic scanners flag conversations where
   the bot likely failed (handoff loop, "no existe" with inventory available,
   missing IG link, etc.) so we can promote them to scenarios.
3. **Be the single source of truth for "does the agent still behave right?"**
   No more re-running ad-hoc 50-conv scripts to verify a fix.

## Layout

```
evals/
  scenarios/             one YAML per scenario
  lib/
    db.mjs               pg pool (mirrors simulator/server.mjs)
    assertions.mjs       assertion functions used by scenarios
    runner.mjs           drives a single scenario end-to-end
  observability/
    scan.mjs             read-only scan over recent prod conversations
  runs/                  JSON+MD reports per run
  run.mjs                CLI entry point
  extract-conversation.mjs   pull a wa_id's history to docs/evals/conversations/
```

## Scenario format (preview)

```yaml
id: 2026-07-anapoima-by-name
title: Cliente pide "Anapoima 04" por nombre — el agente debe reconocerla
seed_failure:
  wa_id: '573112407139'
  observed_at: '2026-06-30'
  symptom: 'Bot respondió con handoff fijo en vez de reconocer ANAPOIMA_#04'
turns:
  - user: 'Hola quiero preguntar por la finca Anapoima 04 del 8 al 10 julio 32 personas'
    assert:
      - state_equals: OFFERING
      - not_contains: 'te paso con mi compañero'
      - bot_recognized_finca: ANAPOIMA_#04
  - user: 'Anapoima04 es la q busco'
    assert:
      - not_contains: 'te paso con mi compañero'
      - shown_fincas_includes: ANAPOIMA_#04
```

Assertion types (initial set):

| name | meaning |
|---|---|
| `contains` | last bot turn contains substring (case-insensitive) |
| `not_contains` | last bot turn does NOT contain substring |
| `state_equals` | conversation.current_state after this turn |
| `agent_used` | agent that produced the response (offering_agent, qa_agent, …) |
| `shown_fincas_includes` | shown_fincas in context contains finca_id |
| `no_handoff_loop` | handoff text appears at most once across all bot turns so far |
| `quote_total_equals` | quote.total of selected_finca equals given value (±50 COP) |
| `bot_recognized_finca` | bot's text or selected_finca references the named finca |

More will be added as scenarios demand. Each assertion is one function in
`evals/lib/assertions.mjs` returning `{ ok: bool, detail: string }`.

## Running

```bash
# 1. Start the simulator (needs to be up so run.mjs can POST + poll)
npm run simulator &

# 2. All scenarios (workers=1 default — respects simulator rate limit)
node evals/run.mjs

# 3. One scenario
node evals/run.mjs evals/scenarios/2026-06-anapoima04-por-nombre.yaml

# 4. Higher concurrency (⚠️ risk of HTTP 429 from simulator's rate limit)
node evals/run.mjs --workers 2
```

Reports land in `evals/runs/<UTC-timestamp>/{report.json,report.md}` and are
gitignored (regenerable). Exit code = 0 iff all scenarios pass — CI-friendly.

## Suite del informe del cliente (sep-2026)

`evals/scenarios-informe/` reproduce los 7 casos del "Informe de fallas" del cliente (8-sep-2026)
y es la definición de "resuelto": debe pasar 7/7 después de cualquier cambio al customer agent,
y la `g100` no puede bajar.

```bash
node evals/run.mjs evals/scenarios-informe/*.yaml --workers 3
node evals/run.mjs evals/scenarios100/*.yaml --workers 3     # regresión (fechas: oct-2026; regenerar con generate-100-scenarios.py cuando pasen)
```

Aserciones agregadas (`evals/lib/assertions.mjs`):

| Aserción | Qué verifica |
|---|---|
| `bot_replied: true` | hubo al menos un mensaje del bot en el turno |
| `no_stall_fallback: true` | no apareció "se me enredaron los mensajes" (stall del LLM) |
| `criteria_equals: {fecha_inicio, fecha_fin, personas}` | `conversations.search_criteria` tiene esos valores |
| `docx_payload: {property_code, huespedes, noches, total, servicio_empleada_count, …}` | el ÚLTIMO documento de confirmación enviado en el turno (decodificado del `payload=` de `media_url`) trae esos campos |

Turnos en ráfaga: `user: ['Si esa', 'Para cuántas personas es', 'Cuánto vale']` envía los mensajes
con 1,5 s de separación y ancla el turno en el último. Ojo: el simulador NO pasa por
`Is latest inbound?` (agregación de Chatwoot), así que la ráfaga real de WhatsApp se prueba
además con un solo mensaje multilínea (`inf-07`).

Historias completas aunque el bot haya recibido "Reset":

```bash
node evals/extract-chatwoot.mjs +573112407139 --since 2026-08-27   # Chatwoot conserva todo
node evals/extract-conversation.mjs 573112407139 --archived         # snapshots de public.conversations_archive
```

## Gotchas

- **`SIMULATOR_WEBHOOK_PATH` in `.env` must be `customer-agent-direct/de-paseo-en-fincas/inbound`**, not the chatwoot one. The Chatwoot relay workflow (`oLikVnoYAIw2qReE`) expects the Chatwoot payload shape (nested `body.account`, `body.conversation`, etc); the simulator sends `{wa_id, text, ...}` which only the customer agent direct webhook understands. If you see "Workflow was started" from the webhook but no execution appears in the customer agent (`2NV08zRFKENUsQVC`), you're hitting the wrong workflow.
- **Simulator rate limit**: `apiLimiter` in `simulator/server.mjs:1575` is 60 req/min per IP. With `POLL_INTERVAL_MS=1800`, a single scenario ≈ 12-22 req/turn. `--workers 3` easily exceeds 60/min in the first burst → 429s. Default `--workers 1` is safe. If you want more concurrency, bump the limiter or lower `POLL_INTERVAL_MS`.
- **Synthetic wa_ids**: the simulator creates conversations with ids like `573008XXX0000000`. These are written to `public.conversations` + `public.messages` alongside real ones. Identify them via prefix or by joining on `public.simulator_conversations`.

## Observability

```bash
# Scan the last 7 days of prod conversations for failure heuristics
node evals/observability/scan.mjs --days 7
# Writes evals/runs/observability-<date>.{json,md}
```

The scanner does NOT execute anything in n8n; it only reads `messages` +
`conversations` and applies regex/rule detectors. Detected patterns are
candidates to promote to scenarios.

## Credentials

Reads the repo `.env` (loaded by `dotenv`). Needs:

- `SUPABASE_DB_URL` OR (`SUPABASE_DB_HOST` + `SUPABASE_DB_PORT` +
  `SUPABASE_DB_NAME` + `SUPABASE_DB_USER` + `SUPABASE_DB_PASSWORD`)
- `N8N_BASE_URL` (already present; used by simulator + n8n investigators)
- `N8N_PUBLIC_API_TOKEN` (optional; only for execution introspection)

## Status

- ✅ Scaffold + DB lib + conversation extractor (blocked on fresh DB creds)
- 🚧 Assertion lib + scenario format
- 🚧 Runner
- 📋 Author 15 seed scenarios from JD's test conversations
- 📋 Observability scanner
- 📋 Nightly CI loop
