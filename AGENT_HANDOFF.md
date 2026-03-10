# De Paseo en Fincas — Agent Handoff

## Resumen

Este proyecto implementa un sistema multiagente en `n8n` para soporte comercial y reservas de fincas en Colombia.

La fase actual es `chat-only`.

Objetivo del sistema:

- calificar al lead
- ofrecer fincas desde un inventario en Google Sheets
- consultar disponibilidad con propietario
- negociar precio
- responder preguntas puntuales
- apagar el bot y pasar a humano cuando corresponde

## Workflows activos

### 1. Workflow comercial principal

- `id`: `jHbvLYUil68YDY2X`
- `name`: `De paseo en fincas customer agent`
- `status`: activo

Arquitectura actual:

1. `When chat message received`
2. `Filtro Mensajes`
3. `Execution Data1`
4. `config`
5. `Merge Sets1`
6. `Get Context-conversations1`
7. `Fetch messages1`
8. `Has Inventory Config`
9. `Get row(s) in fincas sheet`
10. `Normalize Inventory`
11. `Prepare Inventory Payload`
12. `Orquestador AI1`
13. `Code in JavaScript1`
14. `actualizar contexto1`
15. `Chat`
16. `If3`
17. `Insert INBOUND message (messages)1`
18. `Insert OUTBOUND message (messages)`
19. `If2`
20. `Edit Fields1`
21. `Agregar follow on`

Subagentes conectados al orquestador:

- `qualifying_agent`
- `offering_agent`
- `verifying_availability_agent`
- `negotiating_agent`
- `qa_agent`

### 2. Workflow admin

- `id`: `GvwMitmw3BGUZ9Q9`
- `name`: `De paseo en fincas owner admin commands`
- `status`: activo

Sirve para que un humano registre la respuesta del propietario por chat.

Comandos soportados:

```text
/disponible <finca_id> <conversation_key> <precio_noche>
/no-disponible <finca_id> <conversation_key>
```

## Decisiones importantes ya tomadas

- El sistema quedó en `chat-only`.
- La rama vieja de WhatsApp fue removida del workflow activo.
- `qualifying_agent` fue preservado; no se reescribió su prompt ni su lógica.
- `conversations.wa_id` se usa como `conversation_key` del chat trigger en esta fase.
- `HITL` en esta fase significa `agente_activo = false`.
- No hay integración con Chatwoot todavía.
- El follow-up existe solo como lógica/estado, no como envío automático real.
- El inventario viene desde Google Sheets, no desde Supabase.

## Estado de la base de datos

Antes de modificar workflows se verificó que la base correcta sí tenía:

- `public.conversations`
- `public.messages`

No se borró nada de la base.
No se hicieron cambios destructivos de esquema.

## Esquema esperado del inventory sheet

La pestaña recomendada es una sola tab llamada `fincas`.

Columnas mínimas recomendadas:

| columna | tipo | obligatoria | uso |
|---|---|---:|---|
| `finca_id` | texto | sí | identificador único de la finca |
| `nombre` | texto | sí | nombre comercial |
| `zona` | texto | sí | zona principal para filtrar |
| `municipio` | texto | no | apoyo descriptivo |
| `activa` | booleano | sí | si está disponible para ofertar |
| `prioridad` | número | no | orden de prioridad al ofertar |
| `capacidad_max` | número | sí | máximo de personas |
| `min_noches` | número | no | mínimo de noches |
| `precio_noche_base` | número | sí | precio base por noche |
| `precio_fin_semana` | número | no | precio por noche fin de semana |
| `deposito_seguridad` | número | no | depósito o garantía |
| `precio_persona_extra` | número | no | extra por persona adicional |
| `pet_friendly` | booleano | no | si acepta mascotas |
| `amenidades_csv` | texto CSV | no | amenidades separadas por coma |
| `tipo_evento_csv` | texto CSV | no | tipos de evento separados por coma |
| `descripcion_corta` | texto | no | resumen comercial |
| `foto_url` | texto | no | URL de imagen |
| `owner_nombre` | texto | no | nombre del propietario |
| `owner_contacto` | texto | no | contacto interno del propietario |
| `descuento_max_pct` | número | no | descuento máximo permitido |

### Alias que el normalizador ya acepta

El code node `Normalize Inventory` ya tolera varias variantes:

- `finca_id`, `Finca ID`, `id`, `ID`
- `capacidad_max`, `Capacidad Max`, `capacidad`
- `precio_noche_base`, `Precio Noche Base`
- `precio_fin_semana`, `Precio Fin de Semana`
- `deposito_seguridad`, `Deposito Seguridad`
- `precio_persona_extra`, `Precio Persona Extra`
- `pet_friendly`, `Pet Friendly`, `mascotas`
- `amenidades_csv`, `Amenidades`
- `tipo_evento_csv`, `Tipo Evento`
- `descripcion_corta`, `Descripción Corta`, `Descripcion Corta`
- `foto_url`, `Foto URL`
- `owner_nombre`, `Owner Nombre`
- `owner_contacto`, `Owner Contacto`
- `descuento_max_pct`, `Descuento Max %`

## Configuración pendiente del inventory sheet

En el nodo `config` del workflow principal quedaron estos campos:

- `inventory_sheet_enabled`
- `inventory_sheet_document_id`
- `inventory_sheet_gid`
- `inventory_sheet_tab_name`

Estado actual:

- `inventory_sheet_enabled = false`
- `inventory_sheet_document_id = REPLACE_WITH_FINCAS_SPREADSHEET_ID`
- `inventory_sheet_tab_name = fincas`

Importante:

- hoy el workflow usa `inventory_sheet_document_id`
- hoy el workflow usa `inventory_sheet_tab_name`
- `inventory_sheet_gid` quedó guardado pero no se está usando

Para activar inventario real:

1. poner el `spreadsheetId` real en `inventory_sheet_document_id`
2. poner el nombre real de la pestaña en `inventory_sheet_tab_name`
3. cambiar `inventory_sheet_enabled` a `true`

## Lógica del sistema

Estados de negocio activos:

- `QUALIFYING`
- `OFFERING`
- `VERIFYING_AVAILABILITY`
- `NEGOTIATING`
- `HITL`

Transiciones principales:

- `QUALIFYING -> OFFERING`
- `OFFERING -> VERIFYING_AVAILABILITY`
- `VERIFYING_AVAILABILITY -> NEGOTIATING`
- `VERIFYING_AVAILABILITY -> OFFERING` cuando el propietario dice no
- `NEGOTIATING -> HITL` cuando el cliente acepta o pide humano

También existe `qa_agent` para preguntas puntuales sin romper el estado.

## Persistencia

### `conversations`

Se usa para:

- estado actual
- criterios de búsqueda
- fincas ya mostradas
- finca seleccionada
- pricing actual
- owner response
- waiting_for
- follow-up
- flag `agente_activo`

### `messages`

Se usa para:

- inbound del cliente
- outbound del bot
- estado al momento del mensaje
- agente usado
- datos extraídos

## Loop-back

El workflow principal hace doble ciclo cuando:

- `current_state_changed = true`
- o `tool_chosen = qa_agent`

Para eso:

- `Edit Fields1` pone `insertar_mensjae = false`
- limpia `last-message`
- vuelve a `Merge Sets1`

## Archivos locales útiles

- [current_workflow.json](/Users/juandavidvizcaya/Desktop/mscpn8n paseoenfinacas/current_workflow.json): snapshot del workflow original antes del refactor
- [updated_main_workflow.json](/Users/juandavidvizcaya/Desktop/mscpn8n paseoenfinacas/updated_main_workflow.json): payload del workflow principal actualizado
- [admin_workflow.json](/Users/juandavidvizcaya/Desktop/mscpn8n paseoenfinacas/admin_workflow.json): payload del workflow admin
- [build_fase1_workflows.mjs](/Users/juandavidvizcaya/Desktop/mscpn8n paseoenfinacas/scripts/build_fase1_workflows.mjs): generador local de ambos workflows

## Riesgos o temas abiertos

1. No se probó una conversación real end-to-end con usuarios finales; la validación fue estructural y por API.
2. El inventory sheet sigue sin datos reales porque faltan `spreadsheetId` y tab reales.
3. `inventory_sheet_gid` hoy no se usa; si se quiere trabajar por gid habrá que adaptar el nodo de Google Sheets.
4. El sistema está diseñado para fase `chat-only`; la reactivación de WhatsApp como canal operativo requerirá otro ajuste.

## Si otro agente retoma el trabajo

Orden recomendado:

1. configurar Google Sheets real
2. ejecutar pruebas manuales del workflow principal
3. probar comandos del workflow admin
4. revisar prompts de `offering_agent`, `verifying_availability_agent`, `negotiating_agent` y `qa_agent` con casos reales
5. decidir si la siguiente fase vuelve a WhatsApp real o sigue en chat-only
