# De Paseo en Fincas — Plan de Pruebas

## Objetivo
Validar que el agente de WhatsApp responde correctamente en todos los escenarios de conversación, desde el saludo hasta la reserva.

---

## 1. Flujo de Qualifying (Recopilación de datos)

### 1.1 Saludo inicial
- **Input:** "Hola"
- **Esperado:** El agente se presenta como Santiago Gallego de Depaseoenfincas.com y pide: fechas, personas, zona, presupuesto
- **Verificar:** Tono amigable, emojis, no pregunta genérica al final

### 1.2 Datos parciales
- **Input:** "Quiero una finca en Villeta para 4 personas"
- **Esperado:** El agente confirma zona + personas y pide las fechas faltantes
- **Verificar:** No inventa datos, solo pide lo que falta

### 1.3 Datos completos en un solo mensaje
- **Input:** "Quiero finca en Anapoima para 6 personas este fin de semana"
- **Esperado:** El agente confirma todos los datos y pasa automáticamente a offering (buscar fincas)
- **Verificar:** Transición automática qualifying → offering sin mensaje intermedio innecesario

### 1.4 Datos con fecha relativa
- **Input:** "Para mañana 3 personas en Melgar"
- **Esperado:** El agente interpreta "mañana" correctamente y pide duración
- **Verificar:** Fecha correcta en datos_extraidos

### 1.5 Mensajes múltiples rápidos (dedup)
- **Input:** Enviar 3 mensajes seguidos: "hola" "quiero finca" "en villeta"
- **Esperado:** Solo se procesa el último mensaje (dedup descarta los anteriores)
- **Verificar:** No hay 3 respuestas separadas, solo 1 respuesta coherente

---

## 2. Flujo de Offering (Presentación de fincas)

### 2.1 Offering con zona disponible
- **Pre-condición:** Qualifying completo con zona que tiene fincas (Anapoima, Villeta, etc.)
- **Esperado:** El agente muestra 2-3 opciones de fincas con:
  - Nombre de la finca
  - Amenidades (piscina, BBQ, etc.)
  - Capacidad
  - Tarifa
  - Fotos de cada finca (enviadas como attachments)
- **Verificar:** Textos llegan primero (< 5s), fotos llegan después (< 2 min)

### 2.2 Offering con zona sin cobertura
- **Input (qualifying):** "Quiero finca en Melgar para 3 personas este fin de semana"
- **Esperado:** El agente informa que no hay disponibilidad en Melgar y sugiere zonas alternativas
- **Verificar:** No inventa fincas, ofrece alternativas reales

### 2.3 Re-offering (pedir más opciones)
- **Pre-condición:** Ya recibió opciones de fincas
- **Input:** "Tienes alguna más barata?" o "Muéstrame otras opciones"
- **Esperado:**
  1. Mensaje introductorio (ej: "Claro, aquí tienes más opciones:")
  2. Nuevas fichas de fincas diferentes a las ya mostradas
  3. Fotos de las nuevas fincas
- **Verificar:** No repite fincas ya mostradas, texto intro antes de fichas

### 2.4 Cambio de zona
- **Pre-condición:** Ya en offering para Villeta
- **Input:** "Mejor muéstrame en Anapoima"
- **Esperado:** El agente busca fincas en Anapoima (no Villeta) y presenta nuevas opciones
- **Verificar:** search_criteria actualizado con nueva zona

### 2.5 Cambio de fechas
- **Pre-condición:** Ya en offering
- **Input:** "Mejor para la otra semana"
- **Esperado:** El agente actualiza fechas y busca disponibilidad con las nuevas fechas
- **Verificar:** datos_extraidos reflejan nuevas fechas

---

## 3. Flujo QA (Preguntas fuera de contexto)

### 3.1 Pregunta sobre amenidades
- **Pre-condición:** En cualquier estado
- **Input:** "¿Las fincas tienen parqueadero?"
- **Esperado:** Respuesta puntual sobre parqueadero, sin preguntas genéricas al final
- **Verificar:** NO termina con "¿En qué más puedo ayudarte?" ni similar

### 3.2 Pregunta sobre la empresa
- **Input:** "¿Dónde están ubicados?"
- **Esperado:** Respuesta con info de la empresa, vuelve al flujo comercial automáticamente

### 3.3 Pregunta irrelevante
- **Input:** "¿Cuál es la capital de Francia?"
- **Esperado:** Redirección amable al tema de fincas

---

## 4. Envío de Fotos (Media Groups)

### 4.1 Fotos llegan correctamente
- **Pre-condición:** Offering muestra fincas con fotos en Google Drive
- **Esperado:** Cada finca tiene sus fotos como attachments en WhatsApp
- **Verificar:**
  - Las fotos son de la finca correcta
  - No se envían archivos HTML ni corruptos
  - Videos cortos también llegan

### 4.2 Finca sin fotos
- **Pre-condición:** Finca en el sheets sin URL de fotos
- **Esperado:** Se muestra la ficha de texto sin fotos (no error)
- **Verificar:** No hay error ni crash

---

## 5. Infraestructura y Estabilidad

### 5.1 Sin ejecuciones zombie
- **Verificar:** Después de cada prueba, `GET /api/v1/executions?status=running` no tiene ejecuciones de más de 10 minutos
- **Tolerancia:** El envío de fotos puede tomar hasta 3 minutos

### 5.2 Dedup funciona
- **Enviar:** 3 mensajes rápidos seguidos
- **Verificar:** Solo 1 respuesta del bot, las ejecuciones anteriores se detienen al detectar mensajes más nuevos

### 5.3 Chatwoot webhook no genera ecos
- **Verificar:** Los mensajes outbound del bot NO generan ejecuciones procesadas (deben ser filtrados como `not_incoming_customer_message`)

### 5.4 Concurrencia
- **Verificar:** Con `N8N_CONCURRENCY_PRODUCTION_LIMIT=5`, el bot puede manejar múltiples conversaciones simultáneas sin zombies

---

## 6. Matriz de Zonas

| Zona | Tiene fincas | Resultado esperado |
|------|-------------|-------------------|
| Anapoima | ✅ | Muestra opciones |
| Villeta | ✅ | Muestra opciones |
| La Vega | ✅ | Muestra opciones |
| Girardot | ✅ | Muestra opciones |
| Carmen de Apicalá | ✅ | Muestra opciones |
| Eje Cafetero | ✅ | Muestra opciones |
| Antioquia | ✅ | Muestra opciones |
| Villavicencio | ✅ | Muestra opciones |
| Melgar | ❌ | Informa que no hay y sugiere alternativas |
| Bogotá | ❌ | Informa que no hay y sugiere zonas disponibles |
| Cartagena | ❌ | Fuera de cobertura, sugiere zonas disponibles |

---

## Cómo ejecutar las pruebas

1. Enviar mensajes desde WhatsApp al número del bot
2. Monitorear ejecuciones en n8n: `GET /api/v1/executions?limit=10`
3. Verificar mensajes en Chatwoot
4. Verificar que no haya zombies: `GET /api/v1/executions?status=running`
