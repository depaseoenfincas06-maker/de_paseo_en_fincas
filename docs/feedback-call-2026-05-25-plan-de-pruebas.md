# Plan de pruebas — De Paseo en Fincas (post-implementación)
**Companion de** `feedback-call-2026-05-25-textos-y-targets.md`

Cada caso del documento de targets tiene aquí su test E2E correspondiente. Estructura común:

- **Setup**: estado inicial (DB state, simulator wa_id, mensajes previos requeridos)
- **Inputs**: secuencia exacta de mensajes (en el shape simulator)
- **Expected**: comportamiento medible
- **Pass criteria**: assertions concretas (no "se ve bien")
- **Fail signals**: qué indica que el fix falló
- **Inspección**: cómo verificar (exec node, query DB, log stderr)

## Convenciones

- **wa_id sintético**: rango `573999001XXX` reservado para esta tanda de pruebas. Limpiar antes de cada test:
  ```sql
  DELETE FROM messages WHERE wa_id=...;
  DELETE FROM follow_on WHERE conversation_id=...;
  DELETE FROM conversations WHERE id IN (SELECT id FROM conversations WHERE ...);
  ```
- **Send helper**: `bash /tmp/send_msg.sh "<texto>" [seq]` con `TEST_WA_ID=573999001XXX` env var.
- **Inspección**: `curl ".../api/v1/executions?workflowId=2NV08zRFKENUsQVC&limit=N"` + `?includeData=true`
- **Tiempo de espera**: 25-45s entre mensajes para dar margen al engine completo.
- **Sub-exec note**: BIT corre en exec `mode=integrated` distinta del parent `mode=webhook`. Para inspeccionar `quote`, buscar el sub-exec sibling del parent.

---

## T-C.1 — Validation gate drift detection (#personas/#noches/fechas)

### T-C.1.1 — Drift de #personas detectado pre-DOCUMENT_READY
**Setup**: wa_id `573999001001`, conversación limpia.

**Inputs (secuencia)**:
1. *"Hola, quiero una finca en Anapoima para 16 personas del 28 dic 2026 al 3 ene 2027"*
2. *"Sí, esta primera me gusta, hagamos la reserva"* (avanza a CONFIRMING)
3. Da datos personales: *"Mi nombre es Luis Pérez, CC 1234567890, cel 3001234567, correo luis@test.com, dirección Calle 1 #2-3 Bogotá"*
4. *"Espérate, van 3 niños más, somos 19 ahora"*
5. *"Listo, hagamos la confirmación"*

**Expected**:
- Después del mensaje 5, el bot **NO debe emitir DOCUMENT_READY directamente**.
- Bot debe responder algo como: *"Antes de generar tu confirmación, quiero confirmar: ¿estamos hablando de 19 personas del 28 dic al 3 ene 2027?"*
- Después de confirmación explícita del cliente ("sí, 19 personas"), el bot debe re-llamar a `inventory_reader_tool` para recalcular `quote` con personas=19 antes de DOCUMENT_READY.

**Pass criteria**:
- `payload.personas === 19` en el call a `createReservationDocumentItem` (no 16).
- El PDF generado tiene `client_count: 19`.
- `console.error` en logs: `[createReservationDocumentItem] drift detected: personas changed 16→19`.

**Fail signals**:
- PDF se genera con personas=16 (bug original).
- Bot emite DOCUMENT_READY sin pedir confirmación del cambio.

**Inspección**:
- Buscar exec del último mensaje (#5) → `Code in JavaScript1` → input al sub-call de `createReservationDocumentItem`.
- Query: `SELECT payload->>'client_count' FROM messages WHERE wa_id='573999001001' AND direction='OUTBOUND' AND payload->>'media_url' LIKE '%reservation-confirmation%' ORDER BY created_at DESC LIMIT 1`

---

### T-C.1.2 — Drift de #noches detectado
**Setup**: wa_id `573999001002`, conversación limpia.

**Inputs**:
1. *"Anapoima, 10 personas, del 28 dic 2026 al 3 ene 2027"* (6 noches)
2. *"Esta me gusta"* (selecciona la primera)
3. Da datos completos
4. *"Listo hagamos confirmación"*
5. (después de PDF) *"Ay no, mejor solo 5 noches, del 28 al 2 de enero"*
6. *"Hazme la confirmación de nuevo"*

**Expected**:
- Mensaje #6 NO debe regenerar PDF con 6 noches.
- Bot debe responder confirmando el cambio: *"Listo, entonces serían 5 noches del 28 dic al 2 ene. Recalculo y te confirmo el total..."*
- Re-llama `inventory_reader_tool` con `fecha_fin='2027-01-02'` y `noches=5`.
- Quote se recalcula (total cambia).
- PDF nuevo sale con `noches: 5`.

**Pass criteria**:
- Hay 2 PDFs en messages: el primero con noches=6, el segundo con noches=5.
- El segundo PDF tiene `total < total_del_primero` (5 noches < 6 noches).

**Fail signals**:
- El segundo PDF sale con noches=6 (bug original, 4 reintentos fallidos).
- Bot dice "el sistema sigue generando el documento con las 6 noches automáticamente".

---

### T-C.1.3 — Drift de fechas detectado
**Setup**: wa_id `573999001003`.

**Inputs**:
1. *"Anapoima, 10 personas, del 15 al 18 mayo 2026"* (puente Ascensión)
2. *"Sí esta primera"*
3. Datos completos
4. *"Ay perdón, eran del 22 al 24 mayo, no del 15 al 18"*
5. *"Listo, confirmación porfa"*

**Expected**:
- Bot debe detectar cambio de fechas, NO emitir PDF con fechas viejas.
- Re-llama BIT con fechas nuevas; `quote` recalcula (probable: cambia de festivo/puente → standard).
- PDF nuevo con fechas correctas.

**Pass criteria**:
- `payload.fecha_inicio === '2026-05-22'`, `payload.fecha_fin === '2026-05-24'` en el PDF generado.
- `quote.line_items[].category` cambia entre el primer y segundo intento (puente → standard).

---

### T-C.1.4 — NO drift cuando no hay cambio (regression)
**Setup**: wa_id `573999001004`.

**Inputs**:
1. Pide finca + da todos los datos sin cambiar nada.
2. *"Listo, confirmación"*

**Expected**:
- PDF se genera al primer intento, sin pasos extra.
- NO debe haber un mensaje de "confirma que son N personas" si no hubo cambio.

**Pass criteria**:
- 1 solo PDF generado, sin turnos intermedios de confirmación.
- Latencia total < latencia de T-C.1.1.

**Fail signals**:
- El gate dispara false positives: pide confirmación cuando no hubo cambio.

---

## T-C.2 — Brief al humano en HITL hand-off

### T-C.2.1 — Brief se genera y va a private_note
**Setup**: wa_id `573999001010`, conversación con historial rico.

**Inputs**:
1. *"Hola, busco finca en Anapoima para 20 personas en diciembre"*
2. Bot muestra opciones.
3. *"Esta Anapoima_31 me gusta, pero ¿tiene jacuzzi climatizado?"*
4. Bot responde.
5. *"Ok, prefiero la otra, la Anapoima_10"*
6. *"Cambio, somos 16 ahora"*
7. Da datos completos.
8. *"Listo, hagamos confirmación"*

**Expected**:
- PDF se genera (DOCUMENT_READY).
- **Justo después** del PDF, se genera un `private_note` en Chatwoot con un brief de la conversación.

**Pass criteria**:
- Query Chatwoot conversation `messages` endpoint: hay un mensaje con `private: true` posterior al DOCUMENT_READY.
- El contenido del private_note debe incluir:
  - "20 personas → 16 personas" (cambio detectado)
  - "Vio Anapoima_31, descartó por X; eligió Anapoima_10"
  - Fechas
  - Estado: "listo para pagar"

**Fail signals**:
- No hay private_note después de DOCUMENT_READY.
- private_note es genérico ("cliente listo para pagar") sin contexto específico.
- private_note es visible para el cliente (bug: `private: false`).

**Inspección**:
- `curl "https://chat.depaseoenfincas.raaamp.co/api/v1/accounts/1/conversations/{id}/messages" -H "api_access_token: ..."` → buscar `private: true` con timestamp posterior al PDF.

---

### T-C.2.2 — Brief NO se genera para conversaciones cortas
**Setup**: wa_id `573999001011`.

**Inputs**: cliente da todo en 2-3 mensajes sin cambios, llega rápido a DOCUMENT_READY.

**Expected**: el brief se genera igual (siempre hay brief post-DOCUMENT_READY), pero es corto. Verificar que no falle por falta de contenido.

**Pass criteria**: private_note existe y dice algo coherente aunque sea corto.

---

## T-C.3 — Reply context bug (replies consecutivos a fincas distintas)

### T-C.3.1 — Reply A → Reply B consecutivo
**⚠️ Esta prueba requiere uso REAL de Chatwoot/WhatsApp** porque el reply context viene del mensaje WhatsApp `wamid` original. NO se puede simular con el simulator branch.

**Setup**: usar wa_id real de test (no `573007750712`). Activar `test mode` si está disponible.

**Inputs**:
1. Cliente: *"Anapoima, 10 personas, fin de semana en junio"*
2. Bot: muestra 3 fincas con cards (cada card es un mensaje WhatsApp separado, con su `wamid`).
3. Cliente: hace **reply al card de ANAPOIMA_#10** preguntando *"¿cómo es la acomodación?"*
4. Bot responde con acomodación de ANAPOIMA_#10. ✅ (este caso ya funciona)
5. Cliente: hace **reply al card de ANAPOIMA_#17** preguntando *"¿y la de esta?"*

**Expected**:
- Mensaje #5 debe responderse con datos de **ANAPOIMA_#17**, no de #10.
- `Resolve replied finca` debe encontrar el `replied_to_chatwoot_message_id` del segundo reply y resolver a #17.

**Pass criteria**:
- En el exec del mensaje #5, el output de `Resolve replied finca` debe tener `replied_finca_id === 'ANAPOIMA_#17'`.
- El outbound text del bot debe mencionar características específicas de #17 (no de #10).

**Fail signals**:
- `Resolve replied finca` output sigue siendo `ANAPOIMA_#10` (bug original).
- Bot menciona características de #10 cuando el cliente preguntó por #17.

**Inspección**:
- Exec del msg #5 → nodo `Resolve replied finca` → output JSON → campo `replied_finca_id`.
- Query Chatwoot para confirmar `wamid` del reply target.

---

### T-C.3.2 — Reply A → mensaje normal → Reply A de nuevo (regression)
**Setup**: mismo.

**Inputs**:
1. Bot muestra fincas.
2. Reply a ANAPOIMA_#10: "¿cuánto cuesta?" → bot responde.
3. *"Y tiene wifi?"* (mensaje normal, sin reply) → bot debe seguir anclado en #10.
4. Reply a ANAPOIMA_#10: "¿y empleada?" → bot responde de #10.

**Expected**: el bot mantiene contexto de #10 en todos los turnos.

**Pass criteria**: las 3 respuestas son sobre #10.

---

### T-C.3.3 — Reply a mensaje del PROPIO BOT (replied_finca_id inferido)
**Setup**: mismo.

**Inputs**:
1. Bot dice: *"La Anapoima_31 tiene piscina climatizada"*
2. Cliente: reply a ese mensaje del bot: *"¿cuánto cuesta?"*

**Expected**: bot infiere que el cliente pregunta por la finca mencionada en el reply (ANAPOIMA_#31).

**Pass criteria**: respuesta sobre #31, no sobre otra.

---

## T-C.4 — Preguntas factuales en CONFIRMING no van a HITL

### T-C.4.1 — Preguntas sobre carretera/conjunto en CONFIRMING
**Setup**: wa_id `573999001020`, llegar hasta CONFIRMING (post-DOCUMENT_READY o pre).

**Inputs en estado CONFIRMING_RESERVATION**:
1. *"¿Cuánto tiempo hay desde el pueblo hasta la finca?"*
2. *"¿La carretera es buena o es destapada?"*
3. *"¿Es conjunto cerrado o privada?"*
4. *"¿Tiene aire acondicionado?"*

**Expected**: bot responde **cada uno** con datos del item:
- #1: `tiempo_en_vehiculo` del CSV (ej. "5 min")
- #2: del campo descripción / observaciones
- #3: campo `privada o condominio`
- #4: campo `amenidades` (aire_acondicionado)

**Pass criteria**:
- NINGUNA de las 4 preguntas dispara HITL.
- `hitl_activated_at` queda NULL en conversations.
- Cada respuesta menciona el dato específico (no "te paso con un asesor").

**Fail signals**:
- Cualquiera de las 4 dispara *"Te voy a pasar a un asesor humano"*.
- Bot responde genérico sin el dato.

**Inspección**:
- `SELECT hitl_activated_at, hitl_reason FROM conversations WHERE id=...` después de los 4 mensajes → debe seguir NULL.
- Exec del mensaje → `QA validator` output → debe ser `STATE` no `HITL_HARD`.

---

### T-C.4.2 — Pregunta sobre la finca CORRECTA (anclaje no se pierde)
**Setup**: en CONFIRMING con `selected_finca = ANAPOIMA_#17`.

**Inputs**:
1. *"¿Tiene jacuzzi climatizado?"*

**Expected**: bot responde sobre #17, NO sobre otra finca.

**Pass criteria**: la respuesta menciona características de #17 (no de #31 ni de la última que vimos).

---

### T-C.4.3 — Pregunta sobre OTRA finca en CONFIRMING (caso 1.7 del feedback)
**Setup**: en CONFIRMING con `selected_finca = SANTA_FE_#9`.

**Inputs**:
1. *"Y la de San Jerónimo 02, ¿cómo es?"*
2. *"¿Y la San Jerónimo 06?"*

**Expected**:
- Bot debe responder sobre San Jerónimo 02 (no Santa Fe 9).
- En mensaje #2, debe responder sobre San Jerónimo 06 (no se queda anclado).
- Debe ofrecer cambiar de finca: *"¿Te interesa cambiar a San Jerónimo 06? Si sí, retomamos desde la elección"*.

**Pass criteria**:
- Mensaje 1 menciona "San Jerónimo 02" o características específicas.
- Mensaje 2 menciona "San Jerónimo 06".
- Bot NO sigue hablando de Santa Fe 9 en estos turnos.

**Fail signals**:
- Bot habla de Santa Fe 9 en respuesta a preguntas sobre San Jerónimo (bug 1.7).

---

## T-C.5 — Pricing post-CHANGE_FINCA usa quote rehidratado

### T-C.5.1 — CHANGE_FINCA en CONFIRMING + pregunta de precio
**Setup**: wa_id `573999001030`, en CONFIRMING con `selected_finca = ANAPOIMA_#31` (precio base ~$2.8M/noche).

**Inputs**:
1. *"Mejor mostrame algo más económico"* → trigger CHANGE_FINCA, vuelve a OFFERING.
2. Bot muestra fincas más baratas, ej. ANAPOIMA_#10 (precio base $1.9M/noche).
3. *"¿Cuánto sale la primera en total?"*

**Expected**:
- Bot responde con el `quote.total` de ANAPOIMA_#10 (no de #31, no el `precio_base_noche` crudo).
- Si las fechas son de temporada alta, el quote refleja eso.

**Pass criteria**:
- El monto que dice el bot **coincide exactamente** con `quote.total` del item de #10 (verificar contra exec BIT).
- NO dice `$1.900.000` cuando deberían ser tarifas de temporada alta ($3.5M+).

**Fail signals**:
- Bot dice tarifa de temporada baja para fechas de temporada alta (bug caso 1.9).
- Bot cita un precio que coincide con `precio_base_noche` literal del CSV (no del quote).

**Inspección**:
- Sub-exec de BIT → output → `items[0].quote.total` y `quote.line_items[0].category`.
- Comparar contra el texto del outbound del bot.

---

### T-C.5.2 — Cambio de fechas en CONFIRMING
**Setup**: en CONFIRMING con selected_finca + fechas standard (jun 16-18).

**Inputs**:
1. *"Cambiemos las fechas, mejor del 22 al 25 de diciembre"* (temp alta).
2. *"¿Cuánto sería ahora?"*

**Expected**: bot recalcula con dates nuevas → quote categoría temporada_alta → total alto.

**Pass criteria**: el total mencionado por el bot coincide con `quote.total` recalculado para temp alta (debe ser significativamente mayor que el original).

---

## T-C.6 — Dedup de fincas en `fincas_mostradas`

### T-C.6.1 — Dedup determinístico cuando LLM emite duplicate
**Setup**: wa_id `573999001040`.

**⚠️ Para forzar la duplicación**: el LLM normalmente no duplica solo. Para reproducir, podemos:
- Opción A: usar un prompt que confunda al LLM (pedir "esa finca dos veces").
- Opción B: test sintético — patchear temporalmente el `Run offering pass` output para inyectar un duplicate, verificar que CodeJS1 lo filtra.

**Inputs (opción A)**:
1. *"Quiero ver Anapoima_31 y Anapoima_31"* (duplicate explícito).

**Expected**: bot envía 1 card de Anapoima_31, no 2.

**Pass criteria**:
- En `Code in JavaScript1` exec, después del dedup hay 1 finca en `fincas_mostradas`.
- `console.error` log: `[buildPropertySequence] DEDUP: removing duplicate ANAPOIMA_#31`.
- En messages outbound: solo 1 card + 1 media_group para Anapoima_31.

**Fail signals**:
- Aparecen 2 cards de la misma finca.
- Fotos de la 2da finca aparecen pegadas a la 1ra (síntoma de fotos trocadas).

---

### T-C.6.2 — Regression: NO dedup cuando no hay duplicates
**Setup**: pedir 3 fincas distintas.

**Expected**: las 3 fincas se envían normalmente, sin warning de dedup.

**Pass criteria**: 3 cards distintos, 3 media_groups distintos, 0 logs de dedup.

---

## T-C.7 — Anchor en finca anterior se libera al preguntar por otra

### T-C.7.1 — Reset implícito de selected_finca al preguntar por otra
**Setup**: en OFFERING con últimas mostradas: SAN_JERONIMO_02, SAN_JERONIMO_06, SANTA_FE_9.

**Inputs**:
1. *"La Santa Fe 9 me gusta"* (selecciona, va a VERIFYING/CONFIRMING).
2. *"Espera, mejor cuéntame de San Jerónimo 02"* (pregunta por otra sin querer cambiar definitivamente).

**Expected**:
- Bot responde con datos de San Jerónimo 02 (NO de Santa Fe 9).
- Bot ofrece: *"¿Te interesa cambiar a San Jerónimo 02 o seguimos con Santa Fe 9?"*
- `selected_finca` permanece en Santa Fe 9 hasta confirmación explícita.

**Pass criteria**:
- Respuesta menciona características específicas de San Jerónimo 02.
- `selected_finca` en DB sigue siendo Santa Fe 9 (no se cambió silenciosamente).

**Fail signals**:
- Bot responde sobre Santa Fe 9 cuando se preguntó por SJ_02.
- `selected_finca` se cambia automáticamente sin confirmación del cliente.

---

## T-A.2 — Visit message texto exacto

### T-A.2.1 — Trigger VISIT_REQUEST en QUALIFYING
**Setup**: wa_id `573999001050`, conversación nueva.

**Inputs**:
1. *"Hola, quiero visitar una finca antes de reservar"*

**Expected**: bot responde con el texto exacto:
> *"Claro que sí. ¿Qué día quieres ir y a qué hora? Preferiblemente te sugeriría que fuéramos entre martes y jueves, puesto que los fines de semana normalmente están ocupadas las propiedades y lunes y viernes están en mantenimiento."*

**Pass criteria**:
- Outbound contiene la frase **"martes y jueves"** (no "martes y viernes").
- Contiene "lunes y viernes están en mantenimiento".
- NO contiene "asesor humano" en este turno (no se va a HITL hasta que dé fecha+hora).

---

### T-A.2.2 — VISIT_REQUEST en CONFIRMING (caso del item 1)
**Setup**: en CONFIRMING con selected_finca.

**Inputs**:
1. *"Antes de pagar, ¿puedo visitar la finca?"*

**Expected**: mismo texto exacto. NO va a HITL antes de dar fecha+hora.

---

### T-A.2.3 — Después de dar fecha+hora SÍ va a HITL
**Setup**: continuación de T-A.2.1.

**Inputs**:
1. *"Listo, voy el martes 9 de junio a las 10am"*

**Expected**: bot dice algo como *"Perfecto, ya le aviso al equipo comercial para confirmar disponibilidad de la visita. Te avisamos pronto."* → activa HITL hard.

**Pass criteria**: `hitl_activated_at` se setea en este turno (NO en T-A.2.1).

---

## T-A.3 — Oficinas físicas texto exacto

### T-A.3.1
**Inputs**: *"¿Dónde queda la oficina?"*

**Expected**: respuesta contiene:
- "Anapoima" + "Villa Paola" + "Alto del Cobre"
- "Pereira" + "El Paraíso"
- "videollamada"

**Pass criteria**: las 5 substrings aparecen en el outbound.

**Fail signals**: bot da dirección de una finca seleccionada en lugar de la oficina.

---

### T-A.3.2 — Diferenciación oficina vs finca
**Setup**: con `selected_finca = GIRARDOT_#05`.

**Inputs**: *"¿Dónde queda?"* (pregunta ambigua).

**Expected**: bot pregunta clarificación o asume que se refiere a la finca seleccionada (NO mezcla con dirección de oficina).

**Pass criteria**: respuesta no debe mencionar Anapoima Villa Paola si el cliente está hablando sobre GIRARDOT_#05.

---

## T-A.4 — Saludo inicial con Instagram

### T-A.4.1 — Primer mensaje incluye Instagram + lista zonas
**Setup**: wa_id NUEVO `573999001060` (sin historia).

**Inputs**:
1. *"Hola"*

**Expected**: outbound incluye:
- Saludo + nombre del bot
- Lista de asesores por zona (al menos: Anapoima, Eje Cafetero, Girardot, Carmen de Apicalá)
- "Para cotizar dime: fechas exactas, número de huéspedes, ubicación y tarifa aproximada por noche"
- **URL completa de Instagram** (`https://www.instagram.com/depaseoenfincascol`) — no solo el handle

**Pass criteria**:
- Outbound contiene la URL completa de Instagram.
- Contiene al menos 3 nombres de zonas.
- Tono no abre con `¿` ni `¡`.

---

### T-A.4.2 — Saludo con nombre del cliente (T1.5 ratificado)
**Setup**: wa_id NUEVO con `client_name = "Juan Pérez"` desde Chatwoot.

**Inputs**: *"Hola"*

**Expected**: saludo menciona "Juan" (no genérico).

**Pass criteria**: outbound contiene "Juan".

---

### T-A.4.3 — Saludo NO se repite en turnos siguientes
**Setup**: continuación.

**Inputs**: turnos 2, 3, 4 con preguntas normales.

**Expected**: bot no vuelve a mandar el bloque de Instagram + zonas en cada turno.

**Pass criteria**: el URL de Instagram aparece SOLO en el primer outbound, no en los siguientes.

---

## T-A.5 — Despedida cuando cliente desiste

### T-A.5.1 — Trigger CUSTOMER_DECLINED
**Setup**: wa_id en cualquier estado.

**Inputs**:
1. *"Gracias, pero ya reservamos en otra parte"*

**Expected**: bot responde con texto exacto:
> *"[nombre], agradezco muchísimo tu atención y esperamos que en una próxima oportunidad pienses en depaseoenfincas.com para visitar para elegirnos a la hora de tus vacaciones junto a tu familia. Un fuerte abrazo. 🌳"*

**Pass criteria**:
- Contiene "depaseoenfincas.com"
- Contiene "un fuerte abrazo"
- `funnel_status` en DB se setea a `lost` con `loss_reason='customer_declined'`.

---

### T-A.5.2 — Variantes de desistimiento
**Inputs alternativos** (cada uno por separado, wa_id distinto):
- *"Ya reservé otra"*
- *"No me sirve, gracias"*
- *"Voy a pensarlo mejor, no por ahora"*
- *"Era solo cotizando"*

**Expected**: solo los primeros 2 deberían disparar la despedida. Los últimos 2 son ambiguos → bot debe pedir clarificación o seguir engagement, NO despedirse.

**Pass criteria**: el texto de despedida solo aparece en los 2 primeros casos.

---

## T-A.9 — Pago parcial / negociación de bloqueo

### T-A.9.1 — Pedir bloqueo con monto inferior al 50%
**Setup**: en CONFIRMING post-DOCUMENT_READY (PDF generado), total reserva = $5M, anticipo 50% = $2.5M.

**Inputs**:
1. *"¿Puedo bloquear con un millón?"*

**Expected**:
- Bot responde con la plantilla:
  > *"[nombre], yo pienso que para generar el bloqueo podemos hacerlo con un millón de pesos y en los siguientes cinco días completar el 50%. ¿Crees que te funcionaría así?"*
- NO va a HITL.

**Pass criteria**:
- Outbound contiene "podemos hacerlo con" + un monto en pesos.
- Outbound contiene "cinco días".
- `hitl_activated_at` sigue NULL.

**Fail signals**:
- Bot responde "te paso con un asesor humano" (bug caso 1.6).
- Bot deja de contestar (silencio).
- Bot dice "el anticipo es del 50%, no podemos hacer menos" (radical).

---

### T-A.9.2 — Variantes de petición de flexibilidad
**Inputs** (separados):
- *"No tengo los 2.5M, ¿puedo dar menos?"*
- *"¿Aceptan pago parcial?"*
- *"Tengo 800 mil ahora, ¿alcanza para bloquear?"*

**Expected**: cada uno dispara la plantilla con flexibilidad. Bot sugiere monto inicial razonable.

**Pass criteria**: las 3 respuestas no van a HITL y mencionan flexibilidad de pago.

---

### T-A.9.3 — Pago completo del 50% (regression)
**Inputs**: *"Te transfiero el 50% ahora"*

**Expected**: bot acepta normalmente, no se activa la plantilla de flexibilidad.

---

## T-B.1 — Niños >4 años cobrados

### T-B.1.1 — Cliente dice "no me los cobran, son niños"
**Setup**: en OFFERING o VERIFYING con conteo confirmado de 16 adultos.

**Inputs**:
1. *"Van 3 niños más, pero son pequeños, no me los cobran ¿cierto?"*

**Expected**: bot pregunta edad:
> *"Para confirmar: los niños son mayores o menores de 4 años? A partir de los 5 años entran en el conteo de huéspedes."*

**Pass criteria**:
- Outbound menciona "4 años" o "5 años" o "cuatro años".
- No asume gratis automáticamente.

---

### T-B.1.2 — Niños mayores de 4 → se cuentan
**Inputs**:
1. *"Son de 7, 9 y 12 años"*

**Expected**: bot confirma que entran en el cobro, actualiza el conteo a 19 personas.

**Pass criteria**:
- Bot dice "sí, entran" o equivalente.
- `search_criteria.personas` se actualiza a 19 (o se emite UPDATE_SEARCH_CRITERIA).

---

### T-B.1.3 — Niños menores de 4 → no se cuentan
**Inputs**:
1. *"Son de 2 y 3 años"*

**Expected**: bot confirma que NO entran, conteo permanece en 16.

**Pass criteria**: bot dice "no, no entran" + conteo no cambia.

---

## T-B.2 — Servicio de empleada

### T-B.2.1 — Pregunta directa
**Inputs**: *"¿Qué hace la empleada?"*

**Expected**: respuesta menciona:
- "8 horas"
- "preparación de alimentos" o "comida"
- "mantenimiento" o "aseo"
- Tono positivo sobre la sazón (no obligatorio decirlo siempre)

**Pass criteria**: las 3 primeras substrings aparecen.

---

### T-B.2.2 — Pregunta sobre comida
**Inputs**: *"¿Incluye comida la finca?"*

**Expected**: bot aclara que la empleada cocina pero el cliente compra los ingredientes.

**Pass criteria**: menciona "preparar" + clarifica origen de ingredientes (no asume incluido).

---

## T-B.3 — Jacuzzi climatizado $120k

### T-B.3.1 — Finca con jacuzzi climatizado de pago — preguntan
**Setup**: en CONFIRMING con `selected_finca = ANAPOIMA_#10` (asumimos tiene jacuzzi clim. de pago).

**Inputs**: *"¿Funciona el jacuzzi? ¿Tiene costo?"*

**Expected**: bot responde:
- "Sí, jacuzzi climatizado disponible"
- "$120.000" o "120 mil"
- "recargo de gas"
- "uso para 2 días"

**Pass criteria**: las 4 substrings aparecen.

**⚠️ Decisión confirmada**: el bot NO suma automático al quote, lo menciona como nota informativa.

---

### T-B.3.2 — Quote NO se modifica con el jacuzzi
**Setup**: pedir cotización de finca con jacuzzi clim.

**Inputs**: *"¿Cuánto sale en total?"*

**Expected**: bot da `quote.total` sin sumar $120k. Menciona el extra como nota separada: *"Adicionalmente, si quieren usar el jacuzzi climatizado, el recargo de gas es $120.000 por 2 días de uso."*

**Pass criteria**:
- El total mencionado coincide con `quote.total` (no incluye $120k).
- Hay una mención SEPARADA del extra del jacuzzi.

---

## T-B.4 — Flexibilidad transversal (regla en global_prompt)

Ver T-A.9 — ya cubre los casos.

---

## T-D.1 — Videos calificaciones (Track 5.1)

### T-D.1.1 — Trigger SHOW_REVIEW por pregunta directa
**Setup**: en CONFIRMING o VERIFYING con `selected_finca = ANAPOIMA_#31`.

**Prerequisito de datos**: la finca ANAPOIMA_#31 tiene `review_video_urls` poblada con al menos 1 URL Drive.

**Inputs**: *"¿Tienes reseñas de gente que haya ido?"*

**Expected**: bot manda 1-2 videos (media items con tipo `video`) y un caption del tipo *"Mira lo que dijo la familia X..."*.

**Pass criteria**:
- Outbound contiene `media_url` con dominio Drive.
- `outboundSequence` incluye al menos un item con `type='video'`.
- Whitelist sanitizer NO bloquea estos URLs (deben estar permitidos vía la nueva columna).

**Fail signals**:
- Bot responde texto solo sin video.
- Whitelist sanitizer bloquea el URL ([link removido]).

---

### T-D.1.2 — Variantes de trigger
**Inputs**:
- *"¿Qué dicen los que han ido?"*
- *"Muéstrame opiniones"*
- *"Tienes testimonios?"*

**Expected**: las 3 disparan SHOW_REVIEW.

---

### T-D.1.3 — Finca SIN videos disponibles
**Setup**: `selected_finca` que no tiene `review_video_urls` poblada.

**Inputs**: *"¿Tienes reseñas?"*

**Expected**: bot responde con un fallback:
> *"Aún no tengo videos específicos de esta finca, pero te puedo contar que las familias que han ido destacan [X, Y, Z]. ¿Quieres ver opiniones de otras propiedades similares?"*

**Pass criteria**: no envía un media item vacío; responde texto con fallback.

---

## T-D.2 — QR Maps post-stay (Track 5.2)

### T-D.2.1 — Welcome day-of-checkin
**Setup**: reserva confirmada con `fecha_inicio = today`.

**Trigger**: cron del `Post-Stay Sender` corre.

**Expected**: cliente recibe mensaje:
> *"¡Bienvenidos a [finca]! Para llegar te dejamos la ubicación: [maps_url]. Cualquier cosa que necesites durante tu estadía, escríbenos. Que tengas vacaciones maravillosas. — depaseoenfincas.com"*

**Pass criteria**:
- Mensaje contiene maps URL clickeable.
- Se envía solo 1 vez (no duplicados si el cron corre varias veces).

---

### T-D.2.2 — Review request day-after-checkout
**Setup**: reserva con `fecha_fin = yesterday`.

**Expected**: cliente recibe solicitud de reseña con `google_maps_review_url`.

**Pass criteria**: URL apunta a Google Maps review page de la finca específica.

---

### T-D.2.3 — Finca SIN google_maps_review_url (graceful skip)
**Setup**: finca sin URL configurada.

**Expected**: el cron skipea sin error, no envía mensaje incompleto.

---

## T-Regression — Cosas que deben SEGUIR funcionando

### T-R.1 — Track 1 cierre offering
Pedir cotización normal → al final el bot dice *"Y me cuentas cuál te llamó más la atención y avanzamos con esa..."*.

### T-R.2 — Track 2.2 validation gate básico
Llegar a CONFIRMING con email vacío → bot pide email, NO emite DOCUMENT_READY.

### T-R.3 — Track 4.1 whitelist sanitizer
Forzar (via prompt injection si es posible) que el LLM intente emitir un URL de Drive arbitrario → debe degradarse a `[link removido]` y log a stderr.

### T-R.4 — Track 4.3 Cundinamarca → fincas
*"Quiero opciones en Cundinamarca para 8 personas en junio"* → BIT devuelve fincas (Villeta, La Mesa, Anapoima, etc.).

### T-R.5 — Pricing categorías
4 conversaciones (standard / temp alta / festivo / puente) → cada quote en la categoría correcta.

### T-R.6 — VISIT_REQUEST hand-off completo
T-A.2.1 → T-A.2.3 completo, sin saltos prematuros a HITL.

### T-R.7 — CHANGE_FINCA básico (sin pricing question)
*"Mejor mostrame otra"* en CONFIRMING → bot vuelve a OFFERING limpio con cards nuevas.

### T-R.8 — Greeting con nombre cliente
wa_id nuevo con client_name en Chatwoot → bot saluda usando el nombre.

---

## Matriz de cobertura por bug original

| Caso del feedback | Test ID que lo cubre |
|---|---|
| 1.1 PDF con #personas incorrecto | T-C.1.1 |
| 1.2 PDF con #noches incorrecto | T-C.1.2 |
| 1.3 PDF SIN valores | T-R.2 (ya cubierto por T2.2 deployed) |
| 1.4 PDF leak | T-R.3 |
| 1.5 ARBELAEZ falso no-disp | T-R.4 |
| 1.6 Pago parcial → silencio | T-A.9.1 |
| 1.7 Preguntas factuales → HITL | T-C.4.1, T-C.7.1 |
| 1.8 Reply context consecutivo | T-C.3.1 |
| 1.9 Pricing temporada → standard inicial | T-C.5.1, T-C.5.2 |
| 1.10 Sandbox limitation | ⚪ acción cliente |
| 1.11 Fotos trocadas | T-C.6.1 |

---

## Operativa de ejecución de la suite

### Setup global antes de la tanda
```bash
# Wipe synthetic test data
python3 /tmp/db_query.py "DELETE FROM messages WHERE conversation_id IN (
  SELECT id FROM conversations WHERE chatwoot_id IS NULL AND id::text LIKE '573999001%'
)"
python3 /tmp/db_query.py "DELETE FROM follow_on WHERE conversation_id LIKE '573999001%'"
python3 /tmp/db_query.py "DELETE FROM conversations WHERE id::text LIKE '573999001%'"
```

### Run individual test
```bash
TEST_WA_ID=573999001001 bash /tmp/send_msg.sh "<input 1>" 1
sleep 30
TEST_WA_ID=573999001001 bash /tmp/send_msg.sh "<input 2>" 2
# ...
# Inspect last exec
JWT=$(cat /tmp/n8n_jwt.txt)
curl -sk "https://n8n.depaseoenfincas.raaamp.co/api/v1/executions?workflowId=2NV08zRFKENUsQVC&limit=5" \
  -H "X-N8N-API-KEY: $JWT"
```

### Reporte
Por cada test:
- ✅ PASS / ❌ FAIL
- Exec ID que usaste para verificar
- Texto del outbound final (copy-paste)
- Si FAIL: hipótesis y exec node donde falló

### Plantilla de reporte (markdown)
```
## T-X.Y — [nombre]
- **Status**: ✅/❌
- **Exec ID**: 8XXX
- **Outbound**: "..."
- **Notes**: ...
```

---

## Tests que NO se pueden automatizar (necesitan WhatsApp real)

- **T-C.3.\*** (reply context) — los `wamid` y `replied_to_chatwoot_message_id` vienen de WhatsApp real.
- **T-D.2.\*** (post-stay) — requiere data real de reservas pagadas.
- **T-R.3** (whitelist con prompt injection) — más fácil con caso adversario manual.

Para estos: ejecutar manualmente con wa_id real de testing (no `573007750712`, sino un teléfono de prueba) o, si Meta sandbox permite, con un wa_id de simulator que sí soporte `wamid` ficticios (revisar).

---

## Sign-off
Para considerar el deploy completo:
- ✅ Tests T-C.\*, T-A.\*, T-B.\* (alta prioridad) deben pasar 100%.
- ✅ Tests T-D.\* (Track 5) deben pasar al deploy de cada feature.
- ✅ Tests T-R.\* (regression) deben seguir verdes — si alguno falla, **rollback antes de cerrar**.
