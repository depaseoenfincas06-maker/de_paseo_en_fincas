# WhatsApp Agent Simulator

Simulador local para probar el workflow productivo con una interfaz estilo WhatsApp.

## Qué hace

- Crea conversaciones nuevas de prueba.
- Envía mensajes como cliente al mismo webhook unificado que usa Chatwoot.
- Recibe la respuesta real del workflow productivo.
- Lee `current_state` y el contexto desde `public.conversations`.
- Persiste mensajes de simulación en `public.messages`.

## Cómo correrlo

```bash
npm install
npm run simulator
```

Luego abre [http://localhost:3101](http://localhost:3101).

## Variables usadas

Se leen desde [`.env`](/Users/juandavidvizcaya/Desktop/mscpn8n%20paseoenfinacas/.env):

- `N8N_BASE_URL`
- `SUPABASE_DB_HOST`
- `SUPABASE_DB_PORT`
- `SUPABASE_DB_NAME`
- `SUPABASE_DB_USER`
- `SUPABASE_DB_PASSWORD`
- `SIMULATOR_PORT`
- `CHATWOOT_INBOUND_WEBHOOK_PATH`
- `SIMULATOR_WEBHOOK_PATH`

## Notas operativas

- El roster local de pruebas se guarda en `simulator/data/conversations.json`.
- Cada conversación usa un `wa_id` simulado con formato de teléfono y ese mismo valor se guarda en `public.conversations`.
- El panel derecho muestra etapa, criterios, finca elegida, respuesta del propietario y contexto completo.
- Por defecto `SIMULATOR_WEBHOOK_PATH` apunta al mismo path de producción para que el simulador use exactamente el mismo flujo.
