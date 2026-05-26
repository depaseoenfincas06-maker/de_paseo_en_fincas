# Feedback call — De Paseo en Fincas (Juan ↔ Andre, 25-may-2026)

Notas tomadas de la transcripción de la llamada de revisión post-Tracks 1+2+4. Documenta:
1. Casos de falla con timestamps específicos que **no habíamos podido mapear antes**
2. Requerimientos pendientes nuevos o ratificados
3. Otros puntos relevantes (reglas de negocio, decisiones de scope, blockers)

---

## 1. Casos de falla con timestamps (data accionable)

> Estos casos vienen del WhatsApp real del cliente (wa_id `573007750712`). La mayoría caen fuera del retention de n8n exec (~3h), así que el dato accionable es la **descripción del comportamiento** + los **patrones que se repiten**. Si la conversación todavía está en Chatwoot se puede recuperar el contexto completo.

### 1.1. Confirmación de reserva no actualiza # de personas
- **Patrón**: cliente arranca con 16 personas, después dice "van 3 niños más" → bot acepta cobro adicional, dice "perfecto, hagamos confirmación", **pero genera el PDF con 16, no 19**.
- **Cliente le insistió varias veces** y nunca corrigió.
- **Causa probable**: en `createReservationDocumentItem`, el `payload.personas` se toma de `search_criteria.personas` que se quedó en 16. Cuando el cliente agrega "3 niños más", la conversación lo incorpora a nivel narrativo pero **no actualiza search_criteria**.
- **Fix sugerido**: en CONFIRMING_RESERVATION, antes de DOCUMENT_READY, validar que `personas` coincida con la última confirmación del cliente. Si el cliente mencionó cambio de huéspedes después del último update de search_criteria, el agente debe emitir un `UPDATE_SEARCH_CRITERIA` intent antes de DOCUMENT_READY.

### 1.2. Confirmación de reserva no actualiza # de noches — caso real
- **Caso**: reserva del **28 dic al 3 ene (6 noches)**, cliente dice "no, solo 5 noches".
- **Bot generó 4 veces el PDF con 6 noches**, ignorando la corrección.
- Texto que terminó dando el bot (rectificación honesta del bot): *"Qué pena contigo Luis, tienes todas las razones. El sistema sigue generando el documento con las 6 noches de forma automática. Entiendo tu molestia. Ya mismo te va a contactar uno de nuestros asesores para corregir la fecha de salida."*
- **Causa misma que 1.1**: `search_criteria.fecha_inicio/fecha_fin` no se actualiza después de la primera confirmación.
- **Fix conjunto con 1.1**: gate determinístico que detecta cambio de dates/personas en los últimos N turnos y fuerza UPDATE_SEARCH_CRITERIA antes de DOCUMENT_READY.

### 1.3. Confirmación enviada SIN VALORES — 15-may-2026 21:31 y 21:34 (PM)
- **Dos pantallazos**: misma conversación, dos confirmaciones consecutivas, **PDF sin tarifas, sin total, sin subtotales**.
- **Causa probable**: el `quote` en `selected_finca` viene en undefined/null cuando el LLM emite DOCUMENT_READY sin haber re-llamado a `inventory_reader_tool` después de un cambio. La rehidratación cross-exec (`Refetch last_inventory_items.selected_finca`) no encontró match.
- **Mitigación**: el validation gate del 2.2 que deployamos hoy ya bloquea DOCUMENT_READY si `tarifa_noche <= 0` o `total <= 0`. Esos casos del 15-may serían **bloqueados ahora** y el bot pediría rehacer. Verificar con caso nuevo.

### 1.4. ⚠️ CRÍTICO — PDF de propiedades 2026 LEAK explicado — 15-may 01:22-01:29 AM
- **Caso encontrado al fin**: la conversación de origen del leak.
- Flujo: cliente pide finca para 29-dic a 1-ene (3 noches). Bot dice "mínimo 5 noches para fin de año". Cliente extiende a 28-dic a 3-ene. Bot manda 3 fincas. Cliente pregunta si tiene opciones en **Villavicencio, Arbeláez, Fusa**. Bot responde: *"En las zonas solicitadas no encontré disponibilidad. Pero estas fincas en Villavicencio y Alpergades son medidas para ti"* → **manda la base Excel/PDF "base de datos fincas actualizados 2026"**.
- **Causa raíz**: el LLM cuando no encuentra match en BIT, "como recurso desesperado" recurrió a mandar el archivo interno (que estaba probablemente como `company_documents` en agent_settings). Andre dijo: *"de pronto él no es capaz como encontré una finca y lo que hace es que recurre a pasar la mayor cantidad de información"*.
- **Status del fix**:
  - ✅ El **whitelist sanitizer de T4.1** que deployamos hoy bloquea esto. URLs fuera de la whitelist se degradan a texto.
  - ✅ También: el fix de **departamentos en zoneAliasDefinitions (T4.3)** evita el trigger — ahora "Cundinamarca" + "Arbeláez" SÍ devuelven resultados, así que el LLM no entra en pánico.
- **Acción pendiente del cliente**: depurar las `company_documents` activas — confirmar que NO está marcada con `send_when_asked=true` la base completa "propiedades 2026" (debe ser interno solamente).

### 1.5. ⚠️ ARBELAEZ_01 falso "no disponible" para 50px — 15-may 01:22 AM
- **Conversación**: cliente busca finca para **50 personas en Arbeláez**. Bot inicialmente responde tarifa de **Villavicencio_65** (no era lo pedido). Cliente aclara: "te estoy preguntando por Arbeláez". Bot dice: *"Te confirmo que para la propiedad de Arbeda no tenemos disponibilidad en esas fechas de fin de año. ¿Te gustaría que continuemos con Villavicencio?"*
- **Causa**: explicada por T4.3. El usuario dijo "Cundinamarca" en algún momento de la conversación inicial. `zoneAliasDefinitions` NO tenía `cundinamarca` en keys → BIT devolvía solo lo que la fuzzy match incidental encontraba (Villavicencio por capacidad alta). El bot infirió mal disponibilidad de Arbeláez.
- **Status**: ✅ FIX deployed en T4.3. Ahora "Cundinamarca" expande a los municipios reales incluyendo Arbeláez. Próxima conversación similar debería mostrar ARBELAEZ_#01 correctamente.

### 1.6. Confirmación → pago parcial → bot deja de contestar — viernes 06:40 AM (probable 16-may)
- **Caso**: cliente envió confirmación de reserva la noche anterior (23:30 PM jueves). A las 06:40 AM viernes, cliente escribe: *"Hola, buenos días. Quería preguntarte si podemos hacer el bloqueo de la propiedad por un valor menor al 50%?"*. 
- **Bot no responde**. Cliente insiste varias veces. Sin respuesta. Cliente termina haciendo `RESET` para empezar de cero.
- **Causa probable**: una vez DOCUMENT_READY se emite, el `confirming_reservation_agent` espera el pago. La pregunta sobre pago parcial cae en un edge donde el agente no tiene rule clara. Combinado con HITL soft (que asume que la pregunta es para el humano) → silencio.
- **Requerimiento del cliente** (Juan dictó): el bot DEBE responder a estos casos con flexibilidad de pago. Ejemplo textual: *"Wanda, yo pienso que para generar el bloqueo podemos hacerlo con un millón de pesos y en los siguientes cinco días completar el 50%. ¿Crees que te funcionaría así?"*
- **Fix pendiente**: agregar regla en `confirming_reservation_agent` para manejar negociación de pago parcial sin ir a HITL.

### 1.7. CONFIRMING → preguntas sobre carretera/conjunto → HITL prematuro — miércoles 11:07 AM
- **Caso**: en CONFIRMING (post-DOCUMENT_READY) cliente preguntó:
  - "¿Cuánto tiempo está el pueblo?"
  - "¿Cómo es la carretera?"  
  - "¿Es conjunto o cerrado? Por seguridad queremos que sea en conjunto"
- **Bot respondió**: "Te voy a pasar a ser humano" → salto inmediato a HITL.
- **Comportamiento esperado**: estas son **preguntas sobre la finca**, debe responderlas el `qa_pass` con datos del inventario (`tiempo_en_vehiculo`, `privada o condominio`, descripcion_corta). No es trigger de HITL.
- **Causa**: el QA validator probablemente clasificó como "pregunta fuera de scope" porque está en CONFIRMING. Hay que reforzar que en CONFIRMING SÍ se atienden preguntas factuales sobre la finca.
- **Relacionado**: caso similar — "le pregunto por San Jerónimo 02 estamos hablando de Santa Fe 9, le pregunto por San Jerónimo 06 y me sigue hablando de Santa Fe 9". → El agente se queda anclado en la finca anterior.

### 1.8. Reply context bug — 15-may 12:48-12:50 AM
- **Caso**: cliente hizo `reply` (citando un mensaje previo) sobre la imagen/card de **ANAPOIMA_17** preguntando "¿cómo es la acomodación de esta?".
- Bot respondió con la acomodación de la **propiedad anterior** (la que vino antes de ANAPOIMA_17 — ANAPOIMA_43).
- **Patrón confirmado por Juan**: *"la primera vez que hago reply tira bien, la segunda vez no responde bien, responde con la anterior"*.
- **Causa probable**: `Resolve replied finca` + `Merge reply context` cachea la referencia del primer reply y no la actualiza en el segundo reply consecutivo.
- **Status**: era item 2.5 que dejamos pendiente esperando caso concreto. **ESTE ES EL CASO**. Hay que investigar específicamente: dos replies consecutivos a fincas distintas.

### 1.9. Pricing temporada — corrección post-pregunta — 20-may 08:05 AM
- **Caso**: cliente pide tarifa para 28-dic a 3-ene (temporada alta). Bot **inicialmente envía tarifas de temporada baja**. Cliente le pregunta si esas son las tarifas reales. Bot rectifica: *"Quiero aclararte que al ser semana de año nuevo aplica la tarifa de temporada alta. Los precios que te envíe corresponden a temporada baja. Para la fecha de tu grupo, que es 22 personas, las tarifas quedan así..."*
- **Patrón crítico que Juan resaltó**: **"En ocasiones, sobre todo cuando se genera CAMBIO DE PROPIEDADES, inicia brindando tarifa de temporada baja independiente de que se le solicite festivo o año nuevo."**
- **Causa probable**: durante CHANGE_FINCA, el `quote` se re-calcula contra fechas nuevas o stale. Si el agente usa `precio_base_noche` directo en lugar del `quote.line_items[].per_night_total`, pierde la categorización.
- **Fix sugerido**: reforzar el prompt para que en cualquier respuesta de precio post-CHANGE_FINCA, el agente vuelva a citar `quote` del item rehidratado (no precio_base). Validar adicionalmente con un test específico.

### 1.10. Teléfonos nuevos no contestados — limitación de WhatsApp sandbox
- Juan reportó: *"si se hace un teléfono nuevo, pasa muy a menudo y hay muchos teléfonos nuevos que no contestan literalmente desde el principio"*.
- Andre explicó: el bot está en **sandbox de Meta**, solo recibe mensajes de teléfonos pre-aprobados.
- **Acción pendiente**: graduación del sandbox de Meta a producción (cuenta WhatsApp Business verificada con plantillas aprobadas y app review completo).

### 1.11. Fotos trocadas — pista clave para reproducir
- **Patrón de detección** que Juan reveló: *"cuando envía las propiedades, a veces envía dos descripciones seguidas. Cuando pasan esas dos descripciones seguidas, de una es porque vienen las fotos ya trocadas."*
- **Cómo replicar**: forzar a que el LLM emita la misma finca dos veces en `fincas_mostradas`. La duplicación causa que `buildPropertySequence` arme un media_group orphan o pegado a la finca siguiente.
- **Fix sugerido**: dedup en `fincas_mostradas` antes de iterar `buildFincaCard + buildMediaMessages` — si el LLM emite el mismo finca_id dos veces, mantener solo el primero, log a stderr.

---

## 2. Requerimientos pendientes (nuevos o ratificados)

### 2.1. ⭐ Brief de conversación al asesor humano (HITL hand-off)
**Prioridad**: alta, Juan lo pidió explícitamente y lo considera crítico para la próxima ronda de pruebas.

Cuando el cliente termina DOCUMENT_READY y se pasa a un asesor humano para gestionar pago, el asesor debe recibir un **resumen estructurado de toda la conversación**. Ejemplo dictado por Juan:

> *"Juan David estaba buscando una finca para 20 personas, después se subió a 25 o se bajó a 16. Inicialmente le gustaba Carmen 01 porque tenía jacuzzi climatizado, pero se decantó por Anapol 95 por el número de habitaciones. En momento está listo para pagar."*

**Por qué**: el humano necesita contexto rápido para no enredar la negociación final. "La gente está lista para pagar pero ya necesitamos no dejarlos ir."

**Implementación sugerida** (Andre dijo "lo miramos para esta o próxima etapa"):
- Nuevo nodo después de DOCUMENT_READY: llamada a Gemini con prompt "Resume esta conversación en 3-5 bullets focales en: # personas que llegó a pedir, fincas que vio + por qué descartó cada una, finca final elegida + razón, estado de pago".
- Envía el resumen a la conversación de Chatwoot como `private_note` (visible solo al asesor, no al cliente).

### 2.2. Visitas — restringir días sugeridos
**Texto exacto dictado por Juan** para reemplazar el current visit_offer_message:

> *"Claro que sí. ¿Qué día quieres ir y a qué hora? Preferiblemente te sugeriría que fuéramos entre martes y jueves, puesto que los fines de semana normalmente están ocupadas las propiedades y lunes y viernes están en mantenimiento."*

**Acción**: actualizar `agent_settings.visit_offer_message_template` (o el campo equivalente).

### 2.3. Follow-ups — templates aprobados por Juan

Tres mensajes con momentos distintos:

**FU#1 — 3 horas (intra-24h, generado por LLM, personalizable):**
> *"Querido Juan, maravillosa tarde. Quería preguntarte cómo va tu proceso de reservación para la finca [tal] [fecha]."*
> 
> Si NO ha elegido finca: *"Querido Juan, maravillosa tarde. Quería preguntarte cómo va tu proceso de decisión para tus vacaciones en [zona]."*

**FU#2 — 24h (template Meta, predefinido):**
> *"Ya sabes si ya seleccionaron alguna de nuestras propiedades, estamos súper pendientes para iniciar el proceso de reservación."*

**FU#3 — 36h o despedida (cuando desisten):**
> *"Juan, agradezco muchísimo tu atención y esperamos que en una próxima oportunidad pienses en depaseoenfincas.com para visitar para elegirnos a la hora de tus vacaciones junto a tu familia. Un fuerte abrazo. — depaseoenfincas.com"*

**Lógica de elegibilidad** (Juan fue claro):
- Solo aplicar follow-up a clientes "potenciales reales" — definidos como: el presupuesto del cliente es **realista** para alguna finca del inventario.
- Cliente con $600k para 15-20 personas → NO sigue (presupuesto fuera de mercado).
- Cliente con $1.5M para 10-12 personas → SÍ sigue (presupuesto realista para Anapoima/La Mesa).
- Implementación: comparar `search_criteria.presupuesto_max` contra `min(quote.total / noches)` del inventario relevante. Si presupuesto < 60% del menor disponible → marcar como `funnel_status=unrealistic`, no programar follow-up.

**Status**: Track 3 está delegado a otro agente. **Pasarle estos textos y la lógica de elegibilidad a ese agente.**

### 2.4. Videos de calificaciones por finca (Track 5.1 ratificado)

**Confirmaciones**:
- Storage actual: en Instagram + en una carpeta de Drive separada (distinta de la carpeta de fotos de la finca).
- Inventario: "tenemos de muchísimas, 500 calificaciones en videos". No todas las fincas, pero la mayoría.
- Trigger de envío: **cuando el cliente está a punto de decidir** entre 2-3 fincas — Juan lo describe como "cuando van de 50 para adelante" (i.e., último estirón del funnel).
- NO confundir con los videos editados de celebridades (Pipe, Jessi Uribe, Melina) que van al primer contacto.

**Implementación sugerida**:
- Nueva columna en Google Sheets `finca_review_video_urls` (CSV de URLs Drive por finca).
- Nuevo intent en `qa_pass` y `confirming_reservation_pass`: `SHOW_REVIEW`. Triggers explícitos:
  - "¿qué dicen los que han ido?"
  - "muéstrame opiniones / reseñas / calificaciones"
  - "tienes videos de gente que haya ido?"
- Cuando el intent dispara, mandar 1-2 videos de la finca relevante con caption del cliente: *"Mira lo que dijo la familia X después de su estadía"*.

### 2.5. QR de Google Maps post-stay (Track 5.2 ratificado)

**Confirmaciones**:
- Va en **segunda etapa** (después de validar el pago efectivo y la estadía completada).
- Dos mensajes:
  1. **Nota de bienvenida** con ubicación de la propiedad para todos los integrantes (el día del check-in)
  2. **Solicitud de calificación** después del check-out exitoso → "direccionarlos a generar su calificación por Google"

**Inspiración del cliente**: *"En estos días estoy en un restaurante bacano, nos pusieron a hacer el QR para la carta desde el WhatsApp y al final le pide la calificación, es bacán."*

**Dependencias**:
- Nueva columna `agent_settings.maps_review_url_per_finca` o columna en sheet de fincas.
- Cron post-stay que se dispare cuando `reserva.fecha_fin < now() - interval '6 hours'` y `reserva.estado='confirmada'`.
- Templates de Meta aprobados (out-of-24h window).

### 2.6. Estado online (Track 5.3) — NO IMPLEMENTABLE
- WhatsApp Cloud API no expone `is_online` para business accounts.
- Ya implementado el máximo posible: typing indicator (nodo `Typing ON`).
- **Decisión**: cerrar item 16 (parte "online") como "feature no soportada por la plataforma". Documentar al stakeholder.
- Greeting personalizado con nombre del cliente (la otra parte de item 16) ✅ ya implementado en T1.5.

### 2.7. Instagram link DESDE EL PRIMER MENSAJE
**Cambio de scope**: en T1.3 pusimos el Instagram URL en `company_knowledge`. **Pero Juan quiere el call-to-action EN el saludo de bienvenida**, no solo en respuesta a "dame Instagram".

**Texto que Juan dictó** (parte del primer mensaje):
> *"Maravilloso día. Mi nombre es Luis Arrete Fajardo, depaseoenfincas.com.  
> Por favor, elige a uno de los siguientes asesores dependiendo de tu necesidad:  
> - Anapoima → tal persona  
> - Eje Cafetero → tal persona  
> [...]  
> Para cotizar dime: fechas exactas, número de huéspedes, ubicación y tarifa aproximada por noche.  
> Te invito a que conozcas más de nosotros y todas las maravillosas propiedades que tenemos para ofrecerte a través de nuestras redes sociales. Síguenos, dale like: [Instagram_URL]"*

**Acción**: actualizar `agent_settings.greeting_message` o `qualifying_agent` initial template para incluir el Instagram URL en el primer mensaje.

### 2.8. Texto exacto de oficinas físicas (refinar T1.2)
Juan dictó la versión definitiva:

> *"Sí, señora. Tenemos una oficina en Anapoima, que es la finca **Villa Paola en Alto del Cobre**, y tenemos una oficina en Pereira, que es la **finca El Paraíso**, pertenecen a la empresa. Adicionalmente, si tú quieres conocer alguna de las propiedades, podemos agendar una visita, y si no tienen el tiempo de ir hasta la población podemos generar una videollamada desde cualquiera de ellas con uno de nuestros agentes."*

**Acción**: actualizar `agent_settings.company_knowledge.oficinas_fisicas` con este texto exacto (reemplazar el actual).

### 2.9. Flexibilidad de pago parcial (regla de negocio nueva)
**Confirmado por Juan**: el bot NO debe ser radical con el 50%. Aceptar negociación de bloqueo parcial.

**Template aprobado**:
> *"Wanda, yo pienso que para generar el bloqueo podemos hacerlo con un millón de pesos y en los siguientes cinco días completar el 50%. ¿Crees que te funcionaría así?"*

**Acción**: agregar regla al `confirming_reservation_agent` prompt y al `qa_validator` para que esta negociación NO dispare HITL.

### 2.10. Pricing post-CHANGE_FINCA
Bug confirmado en sección 1.9. Acción: reforzar prompt de offering/verifying con regla:

> *"Si emites CHANGE_FINCA o el cliente cambia fechas en CONFIRMING, ANTES de citar cualquier precio para la finca nueva, espera a la próxima respuesta de `inventory_reader_tool` con el `quote` re-calculado. Nunca cites precio_base directamente — siempre desde `quote.line_items[].per_night_total`."*

---

## 3. Reglas de negocio nuevas para `company_knowledge`

Juan dictó estas reglas al final de la llamada. Hay que agregarlas al `company_knowledge` o al `global_prompt_addendum`:

### 3.1. Niños y conteo de huéspedes
> *"Los niños hacen parte de la reserva y se cobran como tal cuando su edad es superior a 4 años."*

### 3.2. Servicio de empleada
> *"Las señoras de servicio trabajan durante 8 horas y se encargan de la preparación de alimentos y mantenimiento de la casa durante la estadía. Su sazón es maravillosa."*

### 3.3. Jacuzzi climatizado (costo extra)
> *"Las propiedades que tienen jacuzzi climatizado de pago: la tarifa adicional es de $120.000, que es el valor que se recarga de gas y funciona para usarlo durante 2 días."*

Cuando el campo de la finca dice "tarifa adicional" en la descripción del jacuzzi → cobrar $120k.

### 3.4. Pricing — desglose para >8 personas
Juan validó la estructura actual: el bot da valor base y aclara adicional por persona después de 8. Texto modelo:
> *"$1.200.000 para 8 personas, persona adicional a partir de la #9: $180.000."*

---

## 4. Items que SÍ quedaron cerrados según validación de Juan

| Item | Status según Juan |
|------|---|
| 1 — visita previa → HITL prematuro | ✅ resuelto |
| 2 — tarifas temporada baja siempre | ✅ "ya las está tirando" (post fix anterior) |
| 3 — PDF en lugar de Word | ✅ resuelto |
| 5 — preguntar precio sin pedir datos | ✅ resuelto |
| 6 — "asesor humano" wording | ✅ corregido |
| 8 — no abrir con `¿` `¡` | ✅ resuelto |
| 9 — dirección oficina vs finca | ✅ "lo tratamos de ajustar" (pendiente refinar texto, ver 2.8) |
| 10 — Instagram link, no solo handle | ✅ resuelto (pendiente moverlo al greeting, ver 2.7) |
| 11 — no leak de nombre real de finca | ✅ resuelto (sanitizer determinístico + COMMON_RULES) |
| 14 — PDF leak | ✅ defense-in-depth + causa identificada hoy (ver 1.4) |
| 18 — cierre poco vendedor | ✅ Juan aprobó el texto nuevo |
| 20 — Cundinamarca → 0 resultados | ✅ resuelto (T4.3) |

---

## 5. Items que Juan NO mencionó (asumir status anterior)

- **Item 4** — Follow-ups: delegado a otro agente. Pero acabamos de cerrar el contenido textual + la regla de elegibilidad en 2.3 — pasar al agente.
- **Item 13** — Fotos trocadas: pista nueva en 1.11 (descripciones duplicadas son síntoma).
- **Item 15** — QR Maps post-stay: ratificado para "segunda etapa" (ver 2.5).
- **Item 17** — Outage 16-may 23:03: no se mencionó en esta llamada. Sigue marcado como rotado.
- **Item 19** — ARBELAEZ falso no-disponible: causa explicada en 1.5, fix de T4.3 lo cubre.

---

## 6. Tono general de la llamada

- Juan está cómodo con el progreso: *"estamos muy cerquita"*, *"está quedando muy bien, me gusta mucho y se siente muy natural"*.
- Andre validó el reto: *"es el agente más complejo que he hecho... porque imita mucho al humano y es genérico"*.
- Decisión de proceso: pruebas iterativas con pantallazos del cliente. Juan se compromete a mandar pantallazos específicos cuando algo no funciona en lugar de descripciones generales.

---

## 7. Prioridades sugeridas para próxima tanda

**Orden propuesto, alto → bajo:**

1. **🔴 Validation gate de personas/noches/fechas pre-DOCUMENT_READY** (sección 1.1 + 1.2). El validation gate actual (T2.2) bloquea por campos vacíos, pero NO bloquea por discrepancia conversacional entre lo último que dijo el cliente vs lo que está en search_criteria. Es el bug que más le duele al cliente porque PDFs incorrectos llegan al cliente final.

2. **🔴 Reply context bug consecutivo** (sección 1.8). Pista clara ahora — segundo reply consecutivo a finca distinta = falla.

3. **🟡 Brief al humano en HITL hand-off** (sección 2.1). Juan lo pidió como crítico para la próxima ronda.

4. **🟡 Pago parcial / negociación de bloqueo** (sección 2.9 + caso 1.6). Mensaje completo dictado, aplicar.

5. **🟡 Pricing post-CHANGE_FINCA** (sección 2.10). Reforzar prompt.

6. **🟡 Preguntas factuales en CONFIRMING no van a HITL** (sección 1.7). Reforzar qa_validator.

7. **🟢 Textos exactos** dictados:
   - Visit (2.2) → reemplazar `visit_offer_message_template`
   - Oficinas (2.8) → reemplazar `company_knowledge.oficinas_fisicas`
   - Instagram en greeting (2.7) → mover al primer mensaje
   - Reglas de negocio §3 → agregar a `company_knowledge` / `global_prompt_addendum`

8. **🟢 Track 5.1** (videos calificaciones) — schema nueva columna + intent SHOW_REVIEW.

9. **🟢 Track 5.2** (QR Maps post-stay) — segunda etapa, dependiente de pago validado.

10. **🟢 Track 3** (follow-ups) — al agente delegado: pasarle textos + elegibilidad (sección 2.3).

11. **⚪ Sandbox → producción Meta** (sección 1.10). Acción del cliente (KYC + verificación + app review).

---

## 8. Acciones del cliente (no técnicas)

- **Depurar carpetas Drive** de las fincas: hay archivos `Download*` y JPGs corruptos que el bot envía como fotos (sección 42:00 de la llamada). Andre: *"hay como unos archivos que son como esos archivos que dan las cámaras o cuando lo descargaron del celular, no sé por qué también lo guardaron. Lo ideal sería depurar esas carpetas."*
- **Confirmar `company_documents`**: validar que la "base de datos fincas actualizados 2026" NO esté marcada con `send_when_asked=true`. Solo deben quedar visibles los documentos que sí pueden compartirse al cliente.
- **Llenar nueva columna** `finca_review_video_urls` cuando esté creada (Track 5.1).
- **Graduación de WhatsApp Sandbox** (sección 1.10).
