# Textos sugeridos + dónde se aplican — De Paseo en Fincas
**Companion del** `feedback-call-2026-05-25.md`

Cada entrada lista: **texto exacto**, **target técnico** (nodo/campo/prompt), **método de aplicación**, **owner** y **status**.

Convenciones:
- 🟢 = ya deployed
- 🟡 = parcial / pendiente de afinar
- 🔴 = pendiente de implementar
- ⚪ = acción del cliente / no técnica

---

## A. Mensajes conversacionales (textos que el bot dice)

### A.1. 🟢 Cierre del offering (deployed, validado por Juan)
**Texto aprobado:**
> *"Y me cuentas cuál te llamó más la atención y avanzamos con esa. O si quieres que veamos otras alternativas, también te las muestro."*

| Target | Valor |
|---|---|
| Workflow | `2NV08zRFKENUsQVC` De paseo en fincas customer agent |
| Nodo | `Code in JavaScript1` → función `buildPropertySequence` |
| Fallback en código | la línea `'Qué te parecen? 🤩\\n\\nTengo más opciones...'` |
| Fuente primaria | `agent_settings.offering_closing_message` |
| Método aplicado | DB `UPDATE agent_settings SET offering_closing_message = '...'` |
| Verificación | T1 E2E test ✅ |

---

### A.2. 🔴 Mensaje de oferta de visita (refinar — Juan dictó texto definitivo)
**Texto exacto dictado por Juan:**
> *"Claro que sí. ¿Qué día quieres ir y a qué hora? Preferiblemente te sugeriría que fuéramos entre martes y jueves, puesto que los fines de semana normalmente están ocupadas las propiedades y lunes y viernes están en mantenimiento."*

| Target | Valor |
|---|---|
| Workflow | `2NV08zRFKENUsQVC` customer agent |
| Campo DB | `agent_settings.visit_offer_message_template` (si existe; si no, crear) |
| Consumido por | `qa_validator` cuando intent=`VISIT_REQUEST` (via §2.9 del memory) |
| Método | SQL `UPDATE agent_settings SET visit_offer_message_template='...'`; si la columna no existe → migration ADD COLUMN + populate |
| Verificación | E2E test: cliente dice "quiero visitar la finca antes de pagar" → bot debe responder ese texto exacto |

**Nota técnica**: el texto actual probablemente dice "entre martes y viernes" — Juan se autocorrigió a **martes y jueves**. Confirmar antes de pisarlo.

---

### A.3. 🟡 Oficinas físicas (refinar — Juan dictó versión definitiva)
**Texto exacto:**
> *"Sí, tenemos una oficina en Anapoima, que es la finca Villa Paola en Alto del Cobre, y tenemos una oficina en Pereira, que es la finca El Paraíso, pertenecen a la empresa. Adicionalmente, si tú quieres conocer alguna de las propiedades, podemos agendar una visita, y si no tienen el tiempo de ir hasta la población podemos generar una videollamada desde cualquiera de ellas con uno de nuestros agentes."*

| Target | Valor |
|---|---|
| Campo DB | `agent_settings.company_knowledge` (clave `oficinas_fisicas` o append a bloque existente) |
| Consumido por | Todos los agents via inyección del `company_knowledge` en system prompt |
| Método | SQL UPDATE; reemplazar el bloque "Oficinas físicas" actual (deployed en T1.2) por este texto |
| Verificación | "¿Dónde queda la oficina?" → bot responde con este texto exacto |

---

### A.4. 🔴 Saludo inicial (mover Instagram al primer mensaje)
**Estructura del primer mensaje** (Juan dictó):
> *"Maravilloso día. Mi nombre es Luis Arrete Fajardo, depaseoenfincas.com.*
> *Por favor, elige a uno de los siguientes asesores dependiendo de tu necesidad:*
> *— Anapoima: [asesor]*
> *— Eje Cafetero: [asesor]*
> *— Girardot: [asesor]*
> *— Carmen de Apicalá: [asesor]*
>
> *Para cotizar dime: fechas exactas, número de huéspedes, ubicación y tarifa aproximada por noche.*
>
> *Te invito a que conozcas más de nosotros y todas las maravillosas propiedades que tenemos para ofrecerte a través de nuestras redes sociales. Síguenos, dale like: https://www.instagram.com/depaseoenfincascol"*

**Nota de Juan**: *"Año nuevo mínimo 5 noches, no había mínimo 3 noches"* — agregar como nota al final del greeting si la fecha actual está cerca de fin de año.

| Target | Valor |
|---|---|
| Campo DB | `agent_settings.greeting_message` (o equivalente) + posible regla en `qualifying_agent` prompt |
| Consumido por | Primer turno del `qualifying_agent` cuando state=`QUALIFYING` y no hay mensajes outbound previos |
| Método | (a) UPDATE agent_settings con greeting nuevo; (b) modificar `qualifying_agent` system message para que en el primer turno emita este saludo en lugar del genérico |
| Decisión pendiente | ¿Los asesores por zona son nombres reales o un placeholder genérico? Pedir lista a Juan |
| Verificación | wa_id nuevo manda primer mensaje → bot responde con greeting + IG link + lista de zonas |

---

### A.5. 🔴 Despedida cuando el cliente desiste (también es FU#3)
**Texto:**
> *"Juan, agradezco muchísimo tu atención y esperamos que en una próxima oportunidad pienses en depaseoenfincas.com para visitar para elegirnos a la hora de tus vacaciones junto a tu familia. Un fuerte abrazo. — depaseoenfincas.com 🌳"*

| Target | Valor |
|---|---|
| Doble función | (a) FU#3 después de 36h sin respuesta; (b) cierre cuando cliente dice "ya reservé en otra parte" |
| Campo DB | `agent_settings.farewell_message_template` |
| Como FU#3 | Plantilla aprobada de Meta (nombre TBD, debe registrarse en Business Manager) |
| Como cierre in-conversation | Lo emite confirming/qa cuando intent=`CUSTOMER_DECLINED` |
| Método | SQL UPDATE + nuevo intent `CUSTOMER_DECLINED` en qa_validator + Meta template registration |

---

### A.6. 🔴 Follow-up #1 (3 horas, intra-24h, LLM-personalizable)
**Variantes según estado de la conversación:**

**A6.a — Cliente ya eligió finca:**
> *"Querido [nombre], maravillosa tarde. Quería preguntarte cómo va tu proceso de reservación para la finca [nombre/código] para las fechas [fecha_inicio - fecha_fin]."*

**A6.b — Cliente NO eligió finca aún:**
> *"Querido [nombre], maravillosa tarde. Quería preguntarte cómo va tu proceso de decisión para tus vacaciones en [zona]."*

| Target | Valor |
|---|---|
| Workflow | `xxK2FfX6QMPxKaZw` Follow-up Sender (DELEGADO a otro agente) |
| Cron | Cada N min, scan `follow_on` table con `scheduled_for <= now() AND status='pendiente'` |
| Mensaje generado | LLM con system prompt que conoce contexto + estas dos plantillas como base |
| Trigger | `last_message_from='AGENT'` + tiempo desde último mensaje > 3h (configurable via `agent_settings.followup_first_offset_minutes`) |
| Status | Pasar este texto al agente que está desarrollando Track 3 |

---

### A.7. 🔴 Follow-up #2 (24h, Meta template — pre-aprobado obligatorio)
**Texto (debe registrarse como template Meta tal cual):**
> *"Ya sabes si ya seleccionaron alguna de nuestras propiedades, estamos súper pendientes para iniciar el proceso de reservación."*

| Target | Valor |
|---|---|
| Plataforma | Meta Business Manager → WhatsApp Manager → Message Templates |
| Categoría sugerida | `MARKETING` o `UTILITY` (consultar con cliente) |
| Idioma | `es` (español neutral) |
| Nombre sugerido | `followup_24h_check_in_es` |
| Campo DB | `agent_settings.followup_template_24h_name` (apunta al template_name registrado en Meta) |
| Status | (1) registrar en Meta y esperar aprobación, (2) guardar nombre en agent_settings, (3) Follow-up Sender lo usa cuando timestamp > 24h |

---

### A.8. 🔴 Follow-up #3 (36h o despedida) — ver A.5

---

### A.9. 🔴 Negociación de pago parcial (caso 1.6 del feedback)
**Caso**: cliente post-DOCUMENT_READY pide bloquear con menos del 50%. Bot NO debe ir a HITL — debe responder con flexibilidad.

**Template aprobado por Juan:**
> *"[nombre], yo pienso que para generar el bloqueo podemos hacerlo con un millón de pesos y en los siguientes cinco días completar el 50%. ¿Crees que te funcionaría así?"*

| Target | Valor |
|---|---|
| Agente | `Run confirming_reservation pass` (system message) |
| Nuevo intent | `PARTIAL_PAYMENT_NEGOTIATION` |
| Trigger phrases | "bloqueo con menos de", "no tengo el 50", "puedo pagar parcial", "tengo X pesos para separar" |
| Comportamiento | Bot responde con plantilla parametrizada (monto inicial sugerido = 30% del total, redondeado a millón); NO va a HITL |
| Método | Agregar bloque al system message del confirming_reservation pass:
```
PARTIAL_PAYMENT_NEGOTIATION (nuevo intent):
- Trigger: cliente pide bloquear con monto inferior al 50% post-DOCUMENT_READY.
- NO derivar a HITL. NO ser radical con el 50%.
- Sugerir: bloqueo inicial ≈ 30% redondeado a millón, completar 50% en 5 días.
- Template: "[nombre], yo pienso que para generar el bloqueo podemos hacerlo con [monto] pesos y en los siguientes cinco días completar el 50%. ¿Crees que te funcionaría así?"
``` |
| Verificación | E2E con: dar todos los datos, recibir PDF, decir "puedo bloquear con un millón?" → bot debe responder con la plantilla, no con HITL |

---

### A.10. 🔴 Pricing breakdown ya verbalizado (Juan validó la estructura actual)
**Estructura validada**:
> *"$1.200.000 para 8 personas. Persona adicional a partir de la #9: $180.000."*

Para grupos >8 personas el bot debe siempre mencionar el adicional por persona. Esto ya está en la REGLA DE PRECIOS expandida de T2.4 — verificar que aplique para fincas con `capacidad_minima > 8`.

| Target | Valor |
|---|---|
| Agentes afectados | `Run qa pass`, `Run verifying_availability pass`, `Run confirming_reservation pass`, `Run offering pass` |
| Status actual | T2.4 expandió REGLA DE PRECIOS con breakdown — verificar caso específico de >8 personas |
| Test | Pedir cotización para 15 personas → bot debe decir "valor base hasta X + persona adicional Y" |

---

## B. Reglas de negocio para `company_knowledge` / `global_prompt_addendum`

### B.1. 🔴 Niños y cobro
> *"Los niños hacen parte de la reserva y se cobran como tal cuando su edad es superior a 4 años. Niños de 4 años o menos no cuentan en el conteo de huéspedes."*

| Target | Valor |
|---|---|
| Campo DB | `agent_settings.global_prompt_addendum` (sección "Reglas de cobro") |
| Aplicación | Todos los agentes (inyectado vía `{{ $('config').item.json.global_prompt_addendum }}`) |
| Caso de uso | Cliente: "vamos 16 + 3 niños pequeños, no me los cobran ¿cierto?" → bot: "Si son mayores de 4 años, sí entran en el cobro" |

---

### B.2. 🔴 Servicio de empleada
> *"Las señoras de servicio trabajan durante 8 horas y se encargan de la preparación de alimentos y mantenimiento de la casa durante la estadía. Su sazón es maravillosa."*

| Target | Valor |
|---|---|
| Campo DB | `agent_settings.company_knowledge` (clave `servicio_empleada` o append) |
| Aplicación | qa_pass / verifying / confirming cuando preguntan sobre empleada |
| Trigger | "qué hace la empleada?", "incluye comida?", "cocinan?" |

---

### B.3. 🔴 Jacuzzi climatizado de pago
> *"Las propiedades que tienen jacuzzi climatizado de pago: la tarifa adicional es de $120.000 y corresponde al recargo de gas para usarlo durante 2 días."*

**Detección**: cuando la descripción de la finca dice "tarifa adicional" cerca de "jacuzzi" → aplica el cobro.

| Target | Valor |
|---|---|
| Campo DB | `agent_settings.company_knowledge` (clave `jacuzzi_climatizado`) |
| Aplicación | qa_pass cuando preguntan por jacuzzi en una finca específica |
| ⚠️ Decisión de scope | ¿Se suma automáticamente al `quote.total` o es informativo? Juan: *"es un tema informativo cuando eligen la propiedad"* → **NO suma automático, solo informativo**. El bot menciona el costo cuando el cliente pregunta o cuando elige una finca con jacuzzi climatizado. |
| Verificación | Pedir cotización de finca con jacuzzi climatizado → bot debe informar el $120k extra como nota |

---

### B.4. 🔴 Flexibilidad de pago (regla transversal)
> *"NUNCA seas radical con el 50% de anticipo. Si el cliente pide flexibilidad, sugiere un bloqueo parcial inicial y completar el 50% en los siguientes 5 días."*

| Target | Valor |
|---|---|
| Campo DB | `agent_settings.global_prompt_addendum` |
| Aplicación | confirming_reservation_pass + qa_validator (para no clasificar como HITL) |
| Acompañado de | el template de A.9 |

---

## C. Cambios en flujo / lógica determinística (no son textos)

### C.1. 🔴 Validation gate ampliado pre-DOCUMENT_READY (caso 1.1 + 1.2)
**Problema**: bot genera PDF con #personas o #noches del search_criteria original aunque el cliente haya pedido cambio en los últimos turnos.

**Fix sugerido**: en `createReservationDocumentItem`, después del validation gate de T2.2, agregar **drift detection**:

```js
// Drift detection: comparar payload contra el último mensaje del cliente
// que mencione personas/fechas/noches. Si hay discrepancia, NO emitir PDF.
function _detectConversationalDrift(payload, lastInboundMessages) {
  const recentMsgs = lastInboundMessages.slice(-5).map(m => String(m).toLowerCase());
  const drift = [];
  // Personas: buscar patrones "ahora somos X", "van X niños más", "X personas"
  // Si el último número mencionado != payload.personas → drift
  // Fechas/noches: patrones "X noches", "del [date] al [date]"
  // Si difiere → drift
  return drift;
}
```

Si hay drift detectado → return text item: *"Antes de generar tu confirmación, quiero asegurarme: ¿confirmas que son [N] personas del [date] al [date]?"*

| Target | Valor |
|---|---|
| Nodo | `Code in JavaScript1` → `createReservationDocumentItem` |
| Inputs | `payload` (lo que va al PDF) + últimos 5 mensajes inbound de `Fetch messages1` |
| Salida | Si drift → text item pidiendo confirmación; si no → continuar con PDF |
| Verificación | Test: arranco confirmación con 16px, digo "van 3 niños más", pido confirmación → bot debe preguntar antes de generar PDF |

---

### C.2. 🔴 Brief de conversación al asesor humano en HITL hand-off
**Implementación sugerida**: nuevo nodo después de DOCUMENT_READY que llama a Gemini con prompt de resumen + lo envía como `private_note` a Chatwoot.

**Prompt de resumen** (sugerido):
> *"Resume esta conversación de WhatsApp en máximo 5 bullets, focales en:*
> *• # de personas y cómo varió (si varió)*
> *• Fincas que vio el cliente, en orden, con razón de descarte de cada una*
> *• Finca final elegida y razón principal de la decisión*
> *• Fechas y noches confirmadas*
> *• Estado de pago / cualquier negociación pendiente*
>
> *Tono: parte interna entre asesores, directo, sin saludos."*

| Target | Valor |
|---|---|
| Nuevo nodo | Después de `Insert OUTBOUND message (messages)` cuando intent=DOCUMENT_READY |
| LLM | Gemini Flash (más barato, suficiente para resumen) |
| Input | Todos los mensajes del wa_id (Postgres SELECT desde `messages` WHERE conversation_id=...) |
| Output | POST a Chatwoot API `/api/v1/accounts/{account_id}/conversations/{id}/messages` con `private: true` |
| Decisión scope | Andre dijo *"se sale del alcance de esta etapa"*; Juan lo pidió como crítico → **incluir en esta tanda** |

---

### C.3. 🔴 Reply context bug (caso 1.8)
**Bug**: segundo reply consecutivo a finca distinta → bot responde con datos de la primera.

| Target | Valor |
|---|---|
| Nodos involucrados | `Resolve replied finca`, `Fetch chatwoot messages for reply`, `Merge reply context` |
| Hipótesis de causa | Cache del `replied_finca_id` no se invalida entre turnos consecutivos |
| Debug pendiente | Reproducir con simulator: enviar reply a finca A, luego reply a finca B → inspeccionar exec data del segundo turn |
| Fix tentativo | Asegurar que `replied_to_chatwoot_message_id` viene siempre del INBOUND actual, no de uno previo |

---

### C.4. 🔴 Preguntas factuales en CONFIRMING no van a HITL (caso 1.7)
**Reforzar `qa_validator`** con ejemplos explícitos:

```
EJEMPLOS de preguntas factuales que SE RESPONDEN en CONFIRMING (no van a HITL):
- "¿Cómo es la carretera?" → qa_pass usa tiempo_en_vehiculo + descripción
- "¿Es conjunto cerrado o privada?" → campo "privada o condominio" del item
- "¿Cuánto tiempo está el pueblo?" → tiempo_en_vehiculo
- "¿Tiene aire?" → amenidades
- "¿Permiten mascotas?" → pet_friendly
- Cualquier pregunta sobre las características de la finca seleccionada → STATE (no HITL)
```

| Target | Valor |
|---|---|
| Agente | `QA validator` system message |
| Método | Agregar bloque de ejemplos al system message |
| Test | En CONFIRMING preguntar "¿es conjunto cerrado?" → bot responde con dato, no HITL |

---

### C.5. 🔴 Pricing post-CHANGE_FINCA (caso 1.9)
**Refuerzo de prompt**:

```
REGLA CRÍTICA — pricing post-CHANGE_FINCA:
Si emites CHANGE_FINCA, o el cliente cambia fechas / personas en cualquier
estado, ANTES de citar cualquier precio para la finca/configuración nueva:
1. Espera a la próxima respuesta de inventory_reader_tool.
2. NUNCA cites precio_base_noche o precio_festivo_base crudos.
3. Usa SIEMPRE quote.line_items[].per_night_total y quote.total del item
   rehidratado.
4. Si la temporada es alta/festivo/semana santa, el quote ya viene con
   la categorización correcta — confiá en él, no hagas la cuenta tú.
```

| Target | Valor |
|---|---|
| Agentes | `Run offering pass`, `Run verifying_availability pass`, `Run confirming_reservation pass` |
| Método | Agregar bloque al system message de cada uno |
| Test | Cliente cambia de finca A a finca B en CONFIRMING → bot debe usar quote.total de B, no precio_base de B |

---

### C.6. 🔴 Fotos trocadas — dedup en `fincas_mostradas` (caso 1.11)
**Pista de Juan**: descripciones duplicadas son síntoma de fotos trocadas.

**Fix determinístico**:

```js
// En buildPropertySequence, antes de iterar fincas:
const seen = new Set();
fincasMostradas = fincasMostradas.filter(f => {
  const id = f.finca_id || f.codigo_original;
  if (!id || seen.has(id)) {
    console.error('[buildPropertySequence] DEDUP: removing duplicate', id);
    return false;
  }
  seen.add(id);
  return true;
});
```

| Target | Valor |
|---|---|
| Nodo | `Code in JavaScript1` → función que arma el outbound sequence |
| Anchor | antes del loop que itera `fincas_mostradas` |
| Logging | `console.error` para diagnóstico (visible en n8n exec logs) |
| Verificación | Forzar al LLM a emitir mismo finca_id 2 veces → dedup interno + envío 1 sola vez |

---

### C.7. 🔴 Sub-bug: bot ancla en finca anterior (caso 1.7 también)
**Comportamiento**: cliente pregunta por San Jerónimo 02, bot responde sobre Santa Fe 9. Pregunta por San Jerónimo 06, bot sigue respondiendo de Santa Fe 9.

| Target | Valor |
|---|---|
| Hipótesis | `selected_finca` en conversations no se resetea cuando el cliente pregunta por una finca distinta |
| Investigación pendiente | Reproducir con simulator + inspeccionar `selected_finca` por turno |
| Posible fix | Cuando el LLM detecta una mención explícita de finca diferente a la `selected_finca`, emitir intent `INSPECT_OTHER_FINCA` que limpia el selected sin cambiar de estado |

---

## D. Items de Track 5 (features futuras — confirmados con Juan)

### D.1. 🔴 Videos de calificaciones por finca (Track 5.1)
**Nueva columna en Google Sheets de fincas**: `review_video_urls` (CSV de URLs Drive).

**Intent nuevo**: `SHOW_REVIEW`

**Trigger phrases**:
- "¿qué dicen los que han ido?"
- "muéstrame opiniones / reseñas / calificaciones"
- "¿tienes videos de gente que haya ido?"
- "¿hay testimonios?"

**Mensaje template** (cuando el intent dispara):
> *"Mira lo que nos contaron las familias que disfrutaron en [finca]:"* + envío de 1-2 videos del CSV.

**Momento de envío automático** (Juan): *"cuando van de 50 para adelante"* — i.e., último estirón del funnel. Específicamente: cuando `current_state in ('VERIFYING_AVAILABILITY', 'CONFIRMING_RESERVATION')` y el cliente NO ha pagado aún.

| Target | Valor |
|---|---|
| Sheet | Agregar columna `review_video_urls` en el sheet de fincas |
| BIT | Pasar `review_video_urls` en el item output |
| qa_pass + confirming | Agregar intent `SHOW_REVIEW` + template |
| Owner data | ⚪ Cliente debe poblar el sheet con URLs de Drive |

---

### D.2. 🔴 QR Maps post-stay (Track 5.2)
**Dos mensajes nuevos** (segunda etapa después de validar pago):

**D.2.a — Bienvenida (day-of-checkin):**
> *"¡Bienvenidos a [finca]! 🌳 Para llegar te dejamos la ubicación: [maps_url]. Cualquier cosa que necesites durante tu estadía, escríbenos. Que tengas vacaciones maravillosas. — depaseoenfincas.com"*

**D.2.b — Solicitud de calificación (day-after-checkout):**
> *"[nombre], esperamos que hayan disfrutado la estadía en [finca]. Si tuvieron una buena experiencia, nos ayudaría muchísimo una reseña en Google: [google_maps_review_url]. ¡Un fuerte abrazo!"*

| Target | Valor |
|---|---|
| Schema | Nueva columna `google_maps_review_url` en sheet de fincas |
| Cron | Workflow nuevo `Post-Stay Sender` que corre cada hora y dispara según `reserva.fecha_inicio = today` (welcome) y `reserva.fecha_fin < today - 1 day` (review request) |
| Meta templates | Ambos mensajes requieren template approval Meta (out-of-24h) |
| Owner data | ⚪ Cliente debe llenar `google_maps_review_url` por finca |

---

### D.3. ✅ Estado online (Track 5.3) — CERRADO
No es implementable. WhatsApp Cloud API no expone `is_online`. Lo único posible es typing indicator (ya implementado en `Typing ON`).

Cerrar item con Juan.

---

## E. Acciones del cliente (no técnicas) — ⚪

### E.1. Depurar carpetas Drive
Eliminar archivos no-imagen y JPGs corruptos de las carpetas de fotos de cada finca (causa de los "Download*" como adjuntos).

### E.2. Validar `company_documents`
Confirmar que la "base de datos fincas actualizados 2026" **NO** está marcada con `send_when_asked=true`. Solo deben quedar accesibles los documentos que el bot puede compartir legítimamente con clientes.

### E.3. Datos para nuevas features
- Llenar columna `review_video_urls` (Track 5.1)
- Llenar columna `google_maps_review_url` (Track 5.2)
- Lista de asesores por zona (para el greeting de A.4)

### E.4. Meta Business Manager
- Registrar templates aprobados de FU#2 (A.7) y FU#3 (A.5)
- Registrar templates de bienvenida + review request (D.2)
- Graduación de sandbox → producción para que reciba mensajes de cualquier teléfono

---

## F. Resumen de targets por archivo

### F.1. `agent_settings` (Postgres)
Campos a actualizar:
- `offering_closing_message` ✅
- `visit_offer_message_template` → A.2 🔴
- `company_knowledge` → A.3 + B.2 + B.3 🔴
- `global_prompt_addendum` → B.1 + B.4 🔴
- `greeting_message` (o equivalente) → A.4 🔴
- `farewell_message_template` → A.5 🔴
- `followup_template_24h_name` → A.7 🔴 (pendiente nombre Meta)

### F.2. Workflow `2NV08zRFKENUsQVC` (n8n customer agent)
Nodos a modificar:
- `Code in JavaScript1` → C.1 (validation gate ampliado), C.6 (dedup), C.7 (anchor finca)
- `Run confirming_reservation pass` → A.9 (PARTIAL_PAYMENT_NEGOTIATION), C.5 (pricing post-CHANGE_FINCA)
- `Run offering pass` → C.5
- `Run verifying_availability pass` → C.5
- `Run qa pass` → C.5
- `QA validator` → C.4 (preguntas factuales en CONFIRMING)
- `Resolve replied finca` / `Merge reply context` → C.3 (debug reply context)
- Nuevo nodo post-DOCUMENT_READY → C.2 (brief al humano)
- `qa_validator` → A.5 (intent `CUSTOMER_DECLINED`)

### F.3. Workflow `xxK2FfX6QMPxKaZw` (Follow-up Sender — delegado)
- Pasar al agente delegado: A.6, A.7, A.8 + lógica de elegibilidad (sección 2.3 del feedback doc)

### F.4. Workflow nuevo: `Post-Stay Sender`
- Crear para D.2 (welcome + review request)

### F.5. Google Sheets fincas
- Nueva columna `review_video_urls` → D.1
- Nueva columna `google_maps_review_url` → D.2
- Owner: ⚪ cliente

### F.6. Meta Business Manager
- Templates pendientes de registrar: A.5, A.7, D.2.a, D.2.b
- Sandbox → producción

---

## G. Orden de ejecución sugerido

**Tanda inmediata (próxima sesión):**
1. C.1 — Validation gate ampliado (drift detection) 🔴 alta prioridad
2. C.3 — Reply context bug 🔴
3. C.2 — Brief al humano HITL hand-off 🔴
4. A.9 + B.4 — Pago parcial 🔴
5. C.5 — Pricing post-CHANGE_FINCA 🔴
6. C.4 — Preguntas factuales en CONFIRMING 🔴
7. A.2 + A.3 + A.4 — Textos exactos (visit + oficinas + greeting con IG) 🟡🔴
8. B.1 + B.2 + B.3 — Reglas de negocio en company_knowledge 🔴

**Siguiente tanda:**
9. C.6 — Dedup fotos trocadas 🔴
10. C.7 — Anchor finca anterior 🔴
11. D.1 — Videos de calificaciones (Track 5.1) 🔴
12. A.5 + A.6 + A.7 — Pasar al agente de follow-ups 🔴

**Tercera etapa:**
13. D.2 — QR Maps post-stay (Track 5.2) 🔴
14. E.* — Acciones del cliente ⚪

**Cerrar como no-implementable:**
- D.3 — Estado online ✅
