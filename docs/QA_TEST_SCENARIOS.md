# QA Test Scenarios — De Paseo en Fincas

## Metodología

- Cada test usa un **número de teléfono nuevo** sin historial previo
- La conversación inicia siempre desde cero ("Hola")
- Se valida cada paso del flujo, no solo el resultado final
- Los mensajes de entrada son fijos para reproducibilidad

## Cómo ejecutar

```bash
# Desde la raíz del proyecto:
node scripts/qa_test_scenarios.mjs --scenario 1   # Un escenario específico
node scripts/qa_test_scenarios.mjs --all           # Todos
```

---

## Escenario 1: El cliente perfecto

**Descripción:** Cliente que da toda la información correcta y elige rápido.

| # | Usuario dice | Esperado |
|---|-------------|----------|
| 1 | "Hola buenas tardes" | qualifying: saludo + pide datos |
| 2 | "Para 4 personas en Villeta este fin de semana" | qualifying→offering (loop). Offering muestra 2-3 fincas con fichas + fotos |
| 3 | "Me gusta la primera" | verifying: confirma selección, pide datos de contacto |

**Criterio de éxito:**
- [x] Paso 1: qualifying responde, no ofrece fincas
- [x] Paso 2: `should_immediate_loop=true`, offering corre 1 vez, `intent=SHOW_OPTIONS`, fincas > 0
- [x] Paso 3: verifying con finca seleccionada
- [x] Sin loop infinito (max 2 iteraciones de Should loop)
- [x] Textos de fichas de fincas generados en outbound_sequence

---

## Escenario 2: El preguntón (5 preguntas antes de decidir)

**Descripción:** Cliente que hace muchas preguntas sobre las fincas antes de elegir.

| # | Usuario dice | Esperado |
|---|-------------|----------|
| 1 | "Hola" | qualifying: saludo |
| 2 | "Quiero algo en Anapoima para 6 personas el próximo viernes y sábado" | qualifying→offering, muestra fincas |
| 3 | "La segunda tiene piscina?" | QA: responde sobre la finca, NO sale de offering |
| 4 | "Y esa tiene BBQ?" | QA: responde |
| 5 | "Cuántas habitaciones tiene?" | QA: responde |
| 6 | "Tiene wifi?" | QA: responde |
| 7 | "Tiene servicio de empleada?" | QA: responde |
| 8 | "Ok me quedo con esa" | verifying: confirma selección |

**Criterio de éxito:**
- [x] Pasos 3-7: `route_mode=QA` (no cambia de estado)
- [x] QA responde sin preguntas de cierre ("¿en qué más puedo ayudarte?")
- [x] Paso 8: transición a verifying
- [x] El contexto de la finca seleccionada se mantiene

---

## Escenario 3: El indeciso de zona (cambia 3 veces)

**Descripción:** Cliente que cambia de zona 3 veces antes de decidirse.

| # | Usuario dice | Esperado |
|---|-------------|----------|
| 1 | "Hola" | qualifying: saludo |
| 2 | "Para 5 personas en Girardot este fin de semana" | qualifying→offering, muestra fincas en Girardot |
| 3 | "No, mejor en Villeta" | offering: nueva búsqueda en Villeta |
| 4 | "Pensándolo bien, mejor en Anapoima" | offering: nueva búsqueda en Anapoima |
| 5 | "Esa primera me gusta" | verifying: selecciona finca |

**Criterio de éxito:**
- [x] Paso 3: offering detecta cambio de zona, busca en Villeta
- [x] Paso 4: offering detecta cambio de zona, busca en Anapoima
- [x] Cada búsqueda muestra fincas de la zona correcta
- [x] Sin loop infinito
- [x] El inventory_reader_tool se llama con la zona actualizada

---

## Escenario 4: El que nunca se decide

**Descripción:** Cliente que pide opciones pero nunca elige ninguna.

| # | Usuario dice | Esperado |
|---|-------------|----------|
| 1 | "Hola" | qualifying: saludo |
| 2 | "6 personas en tierra caliente este viernes" | qualifying→offering, muestra fincas |
| 3 | "No me convence ninguna, tienes otras?" | offering: busca más opciones |
| 4 | "Tampoco me gustan, alguna más económica?" | offering: busca con criterio de precio |
| 5 | "Voy a pensarlo, gracias" | Agente responde cordialmente, no fuerza venta |

**Criterio de éxito:**
- [x] Pasos 3-4: offering muestra nuevas opciones sin repetir las anteriores
- [x] Paso 5: el agente no insiste, responde amablemente
- [x] Sin loop infinito
- [x] El estado permanece en OFFERING (no regresa a qualifying)

---

## Escenario 5: El que nunca da información correcta

**Descripción:** Cliente que da datos vagos o incorrectos.

| # | Usuario dice | Esperado |
|---|-------------|----------|
| 1 | "Hola" | qualifying: saludo |
| 2 | "Quiero una finca bonita" | qualifying: pide zona, fechas, personas |
| 3 | "Para hartas personas" | qualifying: pide número específico |
| 4 | "No sé, en algún lado con piscina" | qualifying: pide zona específica |
| 5 | "Algún fin de semana" | qualifying: pide fecha exacta |

**Criterio de éxito:**
- [x] Todos los pasos: qualifying, NO pasa a offering
- [x] El agente pide datos específicos sin frustración
- [x] No inventa datos que el cliente no proporcionó
- [x] `should_immediate_loop=false` en todos los pasos

---

## Escenario 6: El que rechaza 9 fincas y elige la primera

**Descripción:** Cliente que pide ver muchas opciones y al final elige la primera que le mostraron.

| # | Usuario dice | Esperado |
|---|-------------|----------|
| 1 | "Hola" | qualifying: saludo |
| 2 | "3 personas en Anapoima viernes a domingo" | qualifying→offering, muestra fincas |
| 3 | "No me gustan, muéstrame otras" | offering: más opciones |
| 4 | "Esas tampoco, otras por favor" | offering: más opciones |
| 5 | "Ninguna me convence, hay más?" | offering: más opciones (o informa que no hay más) |
| 6 | "Bueno, me quedo con la primera que me mostraste" | verifying: selecciona la primera finca original |

**Criterio de éxito:**
- [x] Pasos 3-5: offering muestra diferentes fincas cada vez
- [x] Paso 6: el agente identifica "la primera" del historial de conversación
- [x] Transición correcta a verifying con la finca correcta
- [x] Sin loop infinito

---

## Escenario 7: El que pide una zona sin cobertura

**Descripción:** Cliente que pide una zona donde no hay fincas disponibles.

| # | Usuario dice | Esperado |
|---|-------------|----------|
| 1 | "Hola" | qualifying: saludo |
| 2 | "Necesito finca en Cartagena para 8 personas este fin de semana" | qualifying→offering. Offering informa que no hay en Cartagena y sugiere zonas disponibles |

**Criterio de éxito:**
- [x] qualifying recopila datos y transiciona a offering
- [x] offering busca en inventario, no encuentra nada
- [x] Agente informa que no hay cobertura en esa zona
- [x] Agente sugiere zonas alternativas donde SÍ hay fincas
- [x] El flujo NO se queda en loop buscando infinitamente

---

## Escenario 8: El que envía todo en un solo mensaje

**Descripción:** Cliente eficiente que da toda la info en el primer mensaje.

| # | Usuario dice | Esperado |
|---|-------------|----------|
| 1 | "Hola necesito una finca en Villeta para 4 personas este viernes y sábado, presupuesto 500 mil por noche" | qualifying→offering directo. Muestra fincas filtradas por presupuesto |

**Criterio de éxito:**
- [x] qualifying extrae TODOS los datos en un solo paso
- [x] `should_immediate_loop=true` → offering corre automáticamente
- [x] offering filtra por presupuesto
- [x] Max 2 iteraciones del loop (qualifying + offering)

---

## Escenario 9: El que envía audio (simulado como texto)

**Descripción:** Cliente que usa mensajes cortos e informales, como si fueran audios transcritos.

| # | Usuario dice | Esperado |
|---|-------------|----------|
| 1 | "ey" | qualifying: saludo |
| 2 | "pues mira necesito una finca pa como unas 10 personas por allá cerca a villeta o la vega algo así pa este finde" | qualifying→offering con datos extraídos |

**Criterio de éxito:**
- [x] El agente entiende lenguaje informal/coloquial
- [x] Extrae: personas=10, zona=Villeta o La Vega, fechas=este fin de semana
- [x] Transiciona a offering correctamente
- [x] No pide re-confirmar datos que ya dio

---

## Escenario 10: El que vuelve después de un rato

**Descripción:** Cliente que inicia conversación, desaparece, y vuelve después.

| # | Usuario dice | Esperado |
|---|-------------|----------|
| 1 | "Hola" | qualifying: saludo |
| 2 | "Para 3 personas en Melgar el próximo fin de semana" | qualifying→offering, muestra fincas (o informa que no hay en Melgar) |
| 3 | *(pasan 2 horas)* | follow-up automático si está configurado |
| 4 | "Perdón estaba ocupado, sí me interesa la primera" | verifying: retoma conversación con contexto |

**Criterio de éxito:**
- [x] El contexto se mantiene después de la pausa
- [x] El agente retoma sin pedir datos de nuevo
- [x] Si la finca ya no está disponible, lo informa

---

## Resumen de validaciones transversales

Estas validaciones aplican a TODOS los escenarios:

| Validación | Descripción |
|------------|-------------|
| Sin loop infinito | `Should loop to next state?` max 2 iteraciones por ejecución |
| safeParse funciona | Wrap nodes devuelven `_raw=false` (JSON parseado correctamente) |
| Textos generados | `outbound_sequence_json` tiene items cuando hay respuesta |
| Estado correcto | `current_state_after` refleja la transición esperada |
| Sin zombies | Ejecuciones completan en < 120s (sin media) o < 300s (con media) |
| QA no cierra con preguntas | Respuestas QA no terminan con "¿en qué más puedo ayudarte?" |
