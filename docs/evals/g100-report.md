# Suite g100 — Reporte final (2026-07-01/02)

**Resultado: 100/100 scenarios PASSED** (goal: ≥95%).

## Composición de la suite (`evals/scenarios100/`, generada por `evals/generate-100-scenarios.py`)

| Bloque | # | Pass | Qué valida |
|---|---|---|---|
| Pricing data-driven | 40 | 40/40 | Total EXACTO por finca calculado desde el Google Sheet espejando `_computeQuoteBIRP` (incl. empleada obligatoria). Cliente busca zona+px+fechas, pide el total de una finca por código, el bot debe responder el número correcto. |
| Availability / zonas | 20 | 20/20 | Cada zona del inventario (Anapoima, Villeta, Girardot, La Mesa, La Vega, Villavicencio, Melgar, Carmen de Apicalá, Eje Cafetero, Pereira, Quindío, Antioquia, Santa Fe, San Jerónimo, "cerca de Bogotá") + edges de capacidad (4 px, 60 px). |
| Preguntas factuales | 15 | 15/15 | Piscina, jacuzzi, mascotas, wifi, habitaciones, distancia al pueblo, privada/condominio, empleada, fiestas, acomodación, BBQ, juegos niños, comparativa cercanía, piscina infantil, qué incluye el precio. |
| Flujos | 15 | 15/15 | HITL explícito, HITL no-loop, visita sin/con fecha, desiste, pago parcial, descuento, cambio de finca, presupuesto, confianza+IG link, oficinas, RUT empresa, cancelación, proceso de reserva, multi-tema. |
| Edge / regression | 10 | 10/10 | Niños <5, finca inactiva (SOPETRAN_#20), finca inexistente, burst de mensajes, zona sin cobertura (Cartagena), 5 noches, 1 noche, filtro pet-friendly, filtro jacuzzi, más opciones. |

Fechas de test: 25-27 ago 2026 (estándar puro, verificado contra `pricing_seasons`).
Solo se eligieron combos finca+px con total entero (sin ambigüedad de rounding).

## Bugs de agente encontrados y corregidos durante el proceso

1. **`coverage_zones_text` desactualizado** (agent_settings, DB): omitía La Mesa,
   Melgar y Arbeláez → el qualifying decía "no disponemos de propiedades en La
   Mesa" con 6 fincas activas ahí. **Fix**: UPDATE autorizado por JD. La lista
   ahora cubre las 11 zonas del inventario. ⚠️ Si se agregan zonas nuevas al
   sheet, hay que actualizar también este campo (o automatizarlo — pendiente).

2. **LLM stall en tool calls** (maxIterations=6): el offering se quedaba sin
   iteraciones tras llamar `inventory_reader_tool` → output vacío → bot
   silencioso. **Fix**: maxIterations→10 en los 4 agent passes + fallback
   determinístico en `Finalize offering outbound`.

3. **Cache de quotes estrecho** (solo top-3 mostrado): al pedir una finca
   ranked 4+ por código, no había quote para responder. **Fix**: BIT ahora
   persiste `cache_extra` (ranked 4-20 + top similares) en
   `last_inventory_items`; el guardrail responde el precio determinístico con
   `quote.human_summary` sin pasar por el LLM.

4. **Guardrail decía "no disponible" para fincas activas**: **Fix**: primero
   consulta el cache; solo dice "no disponible" si realmente no está.

5. **"quiero ir en persona" (a la oficina) → HITL**: el QA validator lo leía
   como pedido de humano. **Fix**: regla explícita oficinas→QA.

6. **Total no sumado**: el bot daba desglose sin el número final. **Fix**:
   regla total-first en prompts de offering y qa.

## Infra de evals endurecida en el camino

- Runner con retry+backoff (4 intentos) para timeouts transitorios.
- `SIMULATOR_RATE_LIMIT` y `SIMULATOR_PG_POOL_MAX` env-driven (defaults de
  prod intactos); con pool 10 + rate 600 la suite corre con workers=3-4.
- Runner "bridge-aware": no cierra el turn si el último outbound es "Dame un
  momento mientras consulto…".

## Cómo re-correr

```bash
# simulador con capacidad para workers
SIMULATOR_RATE_LIMIT=600 SIMULATOR_PG_POOL_MAX=10 node simulator/server.mjs &

# suite completa
node evals/run.mjs evals/scenarios100/*.yaml --workers 3
```

Runs de referencia: `evals/runs/` (gitignored, regenerables).
