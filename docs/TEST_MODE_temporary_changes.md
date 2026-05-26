# TEST MODE — Cambios temporales para validación
**Última actualización**: 2026-05-26

Este documento lista TODOS los cambios que están actualmente activos en producción **solo para testing**. Antes de soltar el bot a clientes reales, hay que revertir cada uno.

---

## 1. Una sola foto por finca (en lugar de 10-15)

**Por qué**: durante validación, recibir 1 foto por card hace el testing ~10x más rápido y barato. En producción cada finca debe enviar todas sus fotos.

### Cambios

#### 1.1. Customer agent — `Code in JavaScript1` → `buildMediaMessages`
```js
// ACTUAL (TEST MODE):
return [
  {
    type: 'media_group',
    content: '',
    media_url: urls[0],
    media_urls: [urls[0]],  // ← solo primera
    property_title: title,
    property_id: finca?.finca_id || null,
    media_count: 1,
  },
];

// REVERTIR A:
return [
  {
    type: 'media_group',
    content: '',
    media_url: urls[0],
    media_urls: urls,        // ← todas
    property_title: title,
    property_id: finca?.finca_id || null,
    media_count: urls.length,
  },
];
```

#### 1.2. Chatwoot Outbound Sender (`Bg5nl2Y26PuwF2NB`) → `Expand outbound items` → `resolveFolderAssets`
```js
// ACTUAL (TEST MODE):
return uniqueStrings(matches.map((match) => directDriveDownloadUrl(match[1])))
  .slice(0, 1)                                                                  // ← cap 1
  .map((downloadUrl) => ({ source_url: folderUrl, download_url: downloadUrl }));

// REVERTIR A (quitar el slice):
return uniqueStrings(matches.map((match) => directDriveDownloadUrl(match[1])))
  .map((downloadUrl) => ({ source_url: folderUrl, download_url: downloadUrl }));
```

---

## 2. Follow-up a 2 minutos (en lugar de 3 horas)

**Por qué**: el FU#1 dispara a las 3h en prod (`followup_first_offset_minutes=180`). Para testing puse 2 minutos.

### Cambio (DB)
```sql
-- ACTUAL (TEST MODE):
UPDATE agent_settings SET followup_first_offset_minutes = 2 WHERE id = 1;

-- REVERTIR A:
UPDATE agent_settings SET followup_first_offset_minutes = 180 WHERE id = 1;
```

---

## 3. ⚡ Owner Test Mode — notif al "propietario" y "asesor" van al cliente

**Por qué**: Juan está probando como cliente. Para no spamear a propietarios reales (Diego, Mauricio, etc.) ni al asesor real (573014013366), las dos notificaciones (al propietario y al asesor) se redirigen al mismo número del cliente que está chateando con el bot.

### Cómo funciona ahora (TEST MODE)

| Trigger | Destinatario normal (prod) | Destinatario TEST | Template |
|---------|---------------------------|-------------------|----------|
| Cliente elige finca + DOCUMENT_READY → preguntar disponibilidad al propietario | `owner_contacto` de la finca (Diego Caicedo, etc.) | `engine.wa_id` (el cliente mismo) | `solicitud_reserva` |
| Cliente aprueba PDF (RESERVATION_APPROVED) → notif al asesor con link Chatwoot | `selection_notification_recipients = 573014013366` | `engine.wa_id` (el cliente mismo) | `staff_finca_selected_v1` |

### Cambio (DB)
```sql
-- ACTUAL (TEST MODE):
UPDATE agent_settings SET owner_test_mode_enabled = true WHERE id = 1;

-- REVERTIR A:
UPDATE agent_settings SET owner_test_mode_enabled = false WHERE id = 1;
```

### Cómo se implementa
- **Owner template** (`Resolve owner reservation target` en workflow `6RycYEsoSQbjrIpp`): si `ownerTestModeEnabled=true` → `recipientPhone = normalizePhone(input.wa_id)` y `phoneSource = 'test_same_user'`.
- **Selection notification** (`Prepare selection notifications` en workflow `2NV08zRFKENUsQVC`): si `settings.owner_test_mode_enabled === true` → `recipients = [normalizePhone(engine.wa_id)]` en lugar de leer `selection_notification_recipients`.

⚠️ Ambas envían desde **+57 3105639334** (la WABA del propietario / asesor con las plantillas aprobadas).

---

## 4. Confirmación tono — referencias

### 4.1 Niños umbral 5 años (B.1)
Status: **PERMANENTE**, no revertir. Es regla de negocio dictada por Juan.

### 4.2 followup_first_offset_minutes
Ver sección 2.

---

## Checklist pre-producción

Antes de abrir el bot a clientes reales:

- [ ] Revertir cambio 1.1 (`buildMediaMessages` → `media_urls: urls`)
- [ ] Revertir cambio 1.2 (`resolveFolderAssets` → quitar `.slice(0,1)`)
- [ ] Revertir cambio 2 (`followup_first_offset_minutes = 180`)
- [ ] Revertir cambio 3 (`owner_test_mode_enabled = false`)
- [ ] Verificar `selection_notification_recipients` está con el phone correcto del manager (hoy: `573014013366`)
- [ ] Verificar templates Meta siguen aprobados: `solicitud_reserva`, `staff_finca_selected_v1`, `followup_24h_check_in_es`, `followup_farewell_es`
- [ ] Llenar columna `review_video_urls` en el Sheet (Track 5.1)
- [ ] Graduar app Meta del sandbox para recibir cualquier número

---

## Script de revert rápido (cuando termines de testear)

```bash
# 1+2 — restaurar fotos completas (ambos workflows)
# Hay que editar manualmente vía n8n API. Patches de revert en scripts/patches_2026_05_XX/

# 3 — DB
python3 /tmp/db_query.py "UPDATE agent_settings SET 
  followup_first_offset_minutes = 180,
  owner_test_mode_enabled = false,
  updated_at = now()
WHERE id = 1"

# Verificar
python3 /tmp/db_query.py "SELECT followup_first_offset_minutes, owner_test_mode_enabled, selection_notification_recipients FROM agent_settings WHERE id=1"
```
