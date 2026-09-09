# Plan de implementación — Informe de fallas del cliente (8-sep-2026)

Origen: `Informe fallas agente virtual De Paseo en Fincas AJUSTADO.docx` (Luis Andretti +
Santiago Hernández) + análisis forense propio (Chatwoot completo, DB, reproducciones en
simulador contra el n8n de producción el 8-sep).

## 0. Control de versiones y rollback

| Qué | Valor |
|---|---|
| Commit base (estado estable antes de tocar nada) | `05bd532` en `main` — tag **`pre-informe-2026-09-08`** |
| Rama de trabajo | `fix/informe-cliente-2026-09-08` (un commit por fase, luego merge a `main`) |
| Backups n8n (pre-cambio) | `backups/n8n/*-20260908-182056.json` (5 workflows; carpeta gitignored porque los JSON traen tokens) |
| Restaurar un workflow | `python3 scripts/n8n_restore.py backups/n8n/<archivo>.json` (hace backup del estado actual antes de pisar, y reactiva) |
| Rollback total | `git checkout pre-informe-2026-09-08` + restaurar los 2 workflows tocados (customer agent `2NV08zRFKENUsQVC`, follow-up sender `xxK2FfX6QMPxKaZw`) + revertir la migración `2026-09-08_reset_archive` (solo crea tablas nuevas; no toca datos) |

Cada patch de n8n se hace con un script en `scripts/patches_2026_09_08/` que: (1) respalda,
(2) aplica sobre anclas de texto exactas y aborta si no las encuentra, (3) reactiva.

## 1. Casos mapeados y cómo se prueban

Los 7 escenarios de reproducción del 8-sep quedan como suite permanente en
`evals/scenarios-informe/` y son **la definición de "resuelto"**: se corren después de
cada fase hasta que pasen todos, y la suite `g100` (100/100 hoy) no puede bajar.

| Escenario | Caso del informe | Estado hoy | Criterio de éxito |
|---|---|---|---|
| `inf-01-min-noches-cambio-criterios-docx` | Luis 1 + 2a | cotiza 2 noches con mínimo 5; cambio a 12 px/23-26 dic no se persiste; 2 turnos en silencio | nunca cotiza bajo el mínimo; `search_criteria` refleja el cambio; el docx sale con 12 px y 23-26 dic |
| `inf-02-mesa-de-yeguas` | Santiago (Mesa de Yeguas) | "se me enredaron" ×1; orden inestable | responde con casas de Mesa de Yeguas para 8 y para 6; cero stalls |
| `inf-03-mas-opciones-anapoima` | Santiago 31-ago + Luis 3 | stall + "ya te mostré todas" con 49 fincas | muestra 3 más; nunca dice "ya te mostré todas" si hay más |
| `inf-04-mas-opciones-antioquia` | Luis 3 | stall | idem |
| `inf-05-empleada-opcional-docx` | Luis 4 | el docx sale sin empleada 2 veces | el docx trae 2 empleadas × 2 días y el total correcto; no reenvía el mismo documento |
| `inf-06-rafaga-mensajes` | Santiago (varios mensajes) | 1 de 5 en stall; eligió finca de 12 para 15 px | cero stalls; no entra a CONFIRMING con personas > capacidad |
| `inf-07-rafaga-agregada` | Santiago (varios mensajes, path Chatwoot) | cotizó "15 personas" cobrando 12 | rechaza/avisa capacidad; nunca cotiza más personas que `capacidad_max` |

Aserciones nuevas en `evals/lib/assertions.mjs`: `no_stall_fallback`, `criteria_equals`,
`docx_payload` (decodifica el último `reservation-confirmation` enviado y compara campos).

## 2. Fases (orden = impacto/riesgo)

### Fase 0 — Forense y red de seguridad (sin tocar el agente)
- [x] Tag + rama + backups + `scripts/n8n_backup.py` / `scripts/n8n_restore.py`.
- [x] `evals/extract-chatwoot.mjs`: historial completo desde Chatwoot (sobrevive al Reset).
- [x] **Reset archiva en vez de borrar**: migración `conversations_archive` (snapshot jsonb de
      conversación + mensajes + follow_on) y nodo `Archive RESET conversation` antes de los
      DELETE. `extract-conversation.mjs --archived <wa_id>` lista los snapshots.
- [ ] **Retención de ejecuciones n8n**: hoy ~48 h. Subir a 30 días
      (`EXECUTIONS_DATA_MAX_AGE=720`, `EXECUTIONS_DATA_PRUNE_MAX_COUNT=50000`) en el
      container de Coolify. **Requiere tu OK (cambio de infra + restart).**
- [x] Suite `evals/scenarios-informe/` + aserciones nuevas.

### Fase 1 — El tool de inventario nunca falla en silencio (19 % de los turnos hoy)
- [x] **P1.1** `inventory_reader_tool`: todos los `$fromAI` con default (`operation` →
      `list_matching_fincas`), elimina el error duro "Required at operation" (= bot mudo).
- [x] **P1.2** Ruta determinística para la "llamada narrada": si la salida del agente es
      `Calling inventory_reader_tool with input: {...}`, `Wrap offering result` lo detecta,
      un nodo `Execute Workflow` ejecuta el tool con esos parámetros y `Synthesize offering
      from tool` arma SHOW_OPTIONS (cards + intro) sin volver al LLM. Mismo tratamiento en
      `Wrap qa result`. Cableado: la rama vuelve a entrar por `Refetch last_inventory_items`
      (respeta el invariante §1.8.6: Refetch en serie con passthrough).
- [x] **P1.3** "Más opciones" determinístico: si el mensaje pide más opciones y el LLM no
      emite `fincas_mostradas`, se sirven las 3 siguientes desde `cache_extra` (misma zona) o
      vía P1.2. BIT devuelve `remaining_count`; el prompt prohíbe "ya te mostré todas" si
      `remaining_count > 0` y, en código, se reemplaza esa frase cuando hay más.
- Prueba: `inf-02/03/04/06` sin stalls.

### Fase 2 — Objeto de reserva único y validado (fechas, personas, extras, capacidad)
- [x] **P2.1** Extractor determinístico de fechas/personas en CodeJS1 (regex conservadoras:
      "23-26 dic", "del 12 al 18 de octubre", "12 personas / px / somos 12"). Si detecta un
      cambio, se persiste en `search_criteria` **aunque el LLM no emita
      `search_criteria_update`**, y se marca `criteria_changed_at`.
- [x] **P2.2** Invariantes antes de cotizar / elegir / generar docx (código, no prompt):
      `personas ≤ capacidad_max` (si no: texto fijo con la capacidad y opciones, no entra a
      CONFIRMING), `noches ≥ mínimo de temporada` (si no: texto fijo pidiendo fechas, nunca
      un total), y el docx se arma desde `raw.search_criteria` ya actualizado (hoy usa el
      contexto viejo del inicio de la ejecución).
- [x] **P2.3** Extras opcionales como estado: `extras.servicio_empleada = {cantidad, dias,
      costo_dia, subtotal, solicitado}`; el LLM propone (`extras_update`), el código valida
      contra `servicio_empleada_valor_8h` del sheet y calcula; cotización y docx lo incluyen.
- [x] **P2.4** No reenviar el mismo documento: si el payload del docx no cambió, responde
      "el documento no cambió, dime qué ajusto" en vez de mandarlo otra vez; si cambió,
      `confirmacion_version++`.
- Prueba: `inf-01`, `inf-05`, `inf-07`.

### Fase 3 — Follow-ups, handoff, leads perdidos, Mesa de Yeguas, orden, tarjeta
- [~] **P3.1** Follow-up (guardas desplegadas; falta el UPDATE del offset): `followup_first_offset_minutes` 2 → 180 (**UPDATE en
      `agent_settings`, requiere tu OK**) + guardas en `Select due follow-ups`: no enviar si
      el cliente escribió hace < 10 min, ni con menos de 30 min desde el último outbound, ni
      en HITL. Nombre de cliente que parece teléfono → template sin nombre.
- [x] **P3.2** Handoff real: al pasar a HITL o aprobar reserva, nota privada en Chatwoot con
      resumen estructurado (finca, fechas, personas, total, extras, datos del cliente, último
      mensaje, motivo) + etiqueta `handoff`. En HITL el texto "te paso con mi compañero" se
      envía una sola vez; después "ya avisé a mi compañero, te escribe en breve" y sigue
      respondiendo preguntas factuales.
- [ ] **P3.3** (pendiente de tu OK + número) Notificación al asesor: `owner_test_mode_enabled` → false y
      `selection_notification_recipients` → número del asesor (**necesito el número; UPDATE
      requiere tu OK**). El sender de propietarios (401, cuenta 1) queda como ítem aparte.
- [x] **P3.4** `Resolve thread policy`: si el `chatwoot_id` guardado no coincide y esa
      conversación lleva > 7 días sin actividad, adopta el nuevo id en vez de ignorar al
      cliente. Corrección puntual del lead Javier Plata (`chatwoot_id` 19 → 10, **UPDATE
      requiere tu OK**).
- [x] **P3.5** Mesa de Yeguas (municipio): alias de zona `mesa de yeguas` → target
      `mesa de yeguas`; el matcher compara también contra `nombre`/`finca_id` cuando el
      sheet aún no tiene `municipio = Mesa de Yeguas`; `Normalize Inventory` descarta
      amenidades con texto largo (basura en las 8 filas `MESA DE YEGUAS CASA APxx`).
      Recomendación de datos para el cliente: `municipio = Mesa de Yeguas` y IDs canónicos.
- [x] **P3.6** Orden: no se envían cards antes de tener fechas + personas (gate en código
      sobre la transición QUALIFYING → OFFERING), salvo que el cliente pregunte por una finca
      concreta por código.
- [x] **P3.7** Tarjeta de crédito 5 %: ya estaba en `payment_methods_text` ("Tarjeta Crédito/Débito/PSE (+5%)"); agregada la regla explícita en los prompts de QA y confirming.
- Prueba: `inf-*` completa + `g100` completa + verificación manual de follow_on en DB
  (`scheduled_for - created_at ≥ 170 min`).

### Fase 4 — Modelo y cierre
- [ ] Fijar versión del modelo (hoy `gemini-flash-latest`, alias flotante). Lo dejas para tu
      prueba con un modelo mejor; el resto del plan no depende del modelo.
- [ ] Documento para el cliente con los ajustes de datos (Mesa de Yeguas, LA_MESA_#07
      cap_min=1, filas con `activa` en blanco) y el nuevo comportamiento.
- [ ] Actualizar memoria/invariantes del proyecto.

## 3. Lo que necesito de ti

1. OK para los 4 UPDATE en `agent_settings` (offset 180, test mode off, destinatarios,
   payment_methods_text) y el UPDATE de `chatwoot_id` de Javier Plata.
2. Número de WhatsApp del asesor que debe recibir "cliente eligió finca / aprobó reserva /
   pidió humano".
3. OK para subir la retención de ejecuciones en Coolify (implica restart del container).

## 4. Estado (9-sep-2026, madrugada)

| Commit | Contenido |
|---|---|
| `c923177` | Fase 0: plan, backups/restore n8n, extractor Chatwoot, suite, migración reset-archive |
| `4875dcf` | Fases 1+2: tool determinístico, más opciones desde cache, integridad de reserva |
| `18e4992` | Fase 3: handoff con nota privada, follow-ups con guardas, chatwoot_id viejo, Mesa de Yeguas, orden, tarjeta 5 % |
| `2a6c89b` | Fixes rev2/rev3 (hydrate en CLIENT_CHOSE, finca_id→details, selected_finca hidratada, confirmation_data sin nulls) |

Desplegado en n8n (customer agent `2NV08zRFKENUsQVC` y follow-up sender `xxK2FfX6QMPxKaZw`);
backups pre-cambio en `backups/n8n/*-20260908-18*.json`. Migración `conversations_archive` aplicada.

Pendiente de JD: `node scripts/patches_2026_09_08/apply_settings_updates.mjs --apply --recipients=<número asesor>`
(S1 offset 180, S2 test mode off, S3 destinatarios, S5 Javier Plata) y retención de ejecuciones en Coolify.
