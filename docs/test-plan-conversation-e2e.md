# Test Plan: Conversation E2E — Offering + QA Flow

## Objetivo

Test automatizado que simula una conversación completa via el simulador local y valida el comportamiento del agente en cada paso.

## Infraestructura

- Framework: `node:test` (ya usado en el proyecto)
- API: Simulador local `http://localhost:3101`
- Polling: patrón de `scripts/generate_50_conversation_report.mjs` (1800ms interval, 5s quiet, 150s timeout)
- Archivo: `tests/conversation_offering_qa.test.mjs`

## Test Case

### Setup
- Crear conversación nueva (POST /api/conversations)

### Step 1: Saludo
- Send: "Hola"
- Wait for response
- **Assert**: respuesta contiene saludo/bienvenida (mensaje inicial del bot)

### Step 2: Solicitud de fincas
- Send: "Pereira 2 dias desde mañana para 6 personas por favor"
- Wait for response (timeout largo — offering muestra fincas + media)
- **Assert**: 
  - Se mostraron fincas (outbound messages con property cards)
  - `current_state` en DB = `OFFERING`
  - `shown_fincas` no vacío

### Step 3: Pregunta QA sobre finca
- Send: "Cuantas camas son por habitación en la 9?"
- Wait for response
- **Assert**:
  - Respuesta menciona acomodación/camas/habitaciones
  - Después de la respuesta hay un mensaje de retoma (offering retoma)
  - NO envía fincas nuevas (no debe haber SHOW_OPTIONS después del QA)
  - `current_state` en DB sigue = `OFFERING`

## Helpers necesarios

```javascript
async function createConversation() // POST /api/conversations
async function sendMessage(convId, text) // POST /api/conversations/:id/messages
async function waitForResponse(convId, afterTimestamp) // poll hasta outbound nuevo
async function getConversationState(convId) // GET /api/conversations/:id → stage
```

## Ejecución

```bash
npm run simulator:dev  # en otro terminal
npm test               # corre todos los tests
```

## Patrones de referencia

- `scripts/generate_50_conversation_report.mjs` — polling y 50 escenarios
- `tests/audio_transcript_utils.test.mjs` — estructura de test
