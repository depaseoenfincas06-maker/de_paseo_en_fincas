import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import express from 'express';
import pkg from 'pg';

const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(rootDir, '.env') });

const PORT = Number(process.env.SIMULATOR_PORT || 3101);
const N8N_BASE_URL = process.env.N8N_BASE_URL;
const SIMULATOR_WEBHOOK_PATH = process.env.SIMULATOR_WEBHOOK_PATH || 'simulator/de-paseo-en-fincas/inbound';
const BOGOTA_TIMEZONE = 'America/Bogota';

if (!N8N_BASE_URL) {
  throw new Error('Missing N8N_BASE_URL in .env');
}

const dataDir = path.join(rootDir, 'simulator', 'data');
const storePath = path.join(dataDir, 'conversations.json');
const publicDir = path.join(rootDir, 'simulator', 'public');

const pool = new Pool({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  database: process.env.SUPABASE_DB_NAME,
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 10,
});

const simulatorWebhookUrl = `${N8N_BASE_URL.replace(/\/$/, '')}/webhook/${SIMULATOR_WEBHOOK_PATH}`;
const outboundQueueByConversation = new Map();
const recentClientMessageIds = new Map();

const DEFAULT_SETTINGS = Object.freeze({
  id: 1,
  tonePreset: 'calido_profesional',
  toneGuidelinesExtra: '',
  initialMessageTemplate:
    'Excelente día!🤩🌅\nMi nombre es Santiago Gallego\nDepaseoenfincas.com, estaré frente a tu reserva!⚡\nPor favor indícame:\n*Fechas exactas?\n*Número de huéspedes?\n*Localización?\n*Tarifa aproximada por noche\n\n🌎 En el momento disponemos de propiedades en Anapoima, Villeta, La Vega, Girardot, Eje cafetero, Carmen de Apicalá, Antioquia y Villavicencio.',
  handoffMessage: 'Te voy a pasar con un asesor humano para continuar con tu solicitud.',
  ownerContactOverride: '',
  globalBotEnabled: true,
  followupEnabled: true,
  followupWindowStart: '08:00',
  followupWindowEnd: '22:00',
  followupMessageQualifying:
    'Hola, sigo atento para ayudarte con la búsqueda de tu finca. Si quieres, compárteme fechas, número de personas y zona y retomamos.',
  followupMessageOffering:
    'Hola, sigo atento. Si quieres, te comparto más opciones o ajustamos la búsqueda por zona, capacidad o presupuesto.',
  followupMessageVerifyingAvailability:
    'Hola, sigo atento con tu solicitud. Si quieres, también puedo ayudarte a revisar otra opción similar.',
  inventorySheetEnabled: true,
  inventorySheetDocumentId:
    process.env.INVENTORY_SHEET_DOCUMENT_ID || '1AHeDsZin_U5ZzfAB50i7JZvOoJcP9uAM71RRZgnDlgo',
  inventorySheetTabName: process.env.INVENTORY_SHEET_TAB_NAME || 'fincas_inventory_ajustada_real',
  coverageZonesText:
    'Anapoima, Villeta, La Vega, Girardot, Eje cafetero, Carmen de Apicalá, Antioquia y Villavicencio',
  maxPropertiesToShow: 3,
  selectionNotificationEnabled: true,
  selectionNotificationRecipients: '',
  selectionNotificationTemplateName: 'staff_finca_selected_v1',
  selectionNotificationTemplateLanguage: 'es_CO',
  updatedAt: null,
});

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toBogotaDateKey(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BOGOTA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function daysAgoIsoKey(daysAgo) {
  const now = new Date();
  const target = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return toBogotaDateKey(target);
}

function matchesTimeframe(value, timeframe = 'all') {
  if (!value || timeframe === 'all') return true;

  const currentKey = toBogotaDateKey(value);
  if (!currentKey) return false;

  if (timeframe === 'today') return currentKey === daysAgoIsoKey(0);
  if (timeframe === 'yesterday') return currentKey === daysAgoIsoKey(1);
  if (timeframe === 'last7') {
    const valueDate = new Date(value);
    return valueDate.getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000;
  }

  return true;
}

function compactText(value) {
  return String(value || '').trim();
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined || value === '') return fallback;
  return ['true', '1', 'yes', 'si', 'sí', 'on'].includes(String(value).trim().toLowerCase());
}

function normalizeTime(value, fallback) {
  const source = compactText(value || fallback);
  const match = source.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]}:${match[2]}` : fallback;
}

function normalizeInteger(value, fallback, min = 1, max = 10) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function serializeSettings(row = {}) {
  return {
    id: 1,
    tonePreset: compactText(row.tone_preset || DEFAULT_SETTINGS.tonePreset) || DEFAULT_SETTINGS.tonePreset,
    toneGuidelinesExtra: compactText(row.tone_guidelines_extra || DEFAULT_SETTINGS.toneGuidelinesExtra),
    initialMessageTemplate:
      String(row.initial_message_template || DEFAULT_SETTINGS.initialMessageTemplate).trim() ||
      DEFAULT_SETTINGS.initialMessageTemplate,
    handoffMessage:
      String(row.handoff_message || DEFAULT_SETTINGS.handoffMessage).trim() || DEFAULT_SETTINGS.handoffMessage,
    ownerContactOverride: compactText(row.owner_contact_override),
    globalBotEnabled:
      row.global_bot_enabled === undefined
        ? DEFAULT_SETTINGS.globalBotEnabled
        : normalizeBoolean(row.global_bot_enabled, DEFAULT_SETTINGS.globalBotEnabled),
    followupEnabled:
      row.followup_enabled === undefined
        ? DEFAULT_SETTINGS.followupEnabled
        : normalizeBoolean(row.followup_enabled, DEFAULT_SETTINGS.followupEnabled),
    followupWindowStart: normalizeTime(row.followup_window_start, DEFAULT_SETTINGS.followupWindowStart),
    followupWindowEnd: normalizeTime(row.followup_window_end, DEFAULT_SETTINGS.followupWindowEnd),
    followupMessageQualifying:
      String(row.followup_message_qualifying || DEFAULT_SETTINGS.followupMessageQualifying).trim() ||
      DEFAULT_SETTINGS.followupMessageQualifying,
    followupMessageOffering:
      String(row.followup_message_offering || DEFAULT_SETTINGS.followupMessageOffering).trim() ||
      DEFAULT_SETTINGS.followupMessageOffering,
    followupMessageVerifyingAvailability:
      String(
        row.followup_message_verifying_availability || DEFAULT_SETTINGS.followupMessageVerifyingAvailability,
      ).trim() || DEFAULT_SETTINGS.followupMessageVerifyingAvailability,
    inventorySheetEnabled:
      row.inventory_sheet_enabled === undefined
        ? DEFAULT_SETTINGS.inventorySheetEnabled
        : normalizeBoolean(row.inventory_sheet_enabled, DEFAULT_SETTINGS.inventorySheetEnabled),
    inventorySheetDocumentId:
      compactText(row.inventory_sheet_document_id || DEFAULT_SETTINGS.inventorySheetDocumentId) ||
      DEFAULT_SETTINGS.inventorySheetDocumentId,
    inventorySheetTabName:
      compactText(row.inventory_sheet_tab_name || DEFAULT_SETTINGS.inventorySheetTabName) ||
      DEFAULT_SETTINGS.inventorySheetTabName,
    coverageZonesText:
      String(row.coverage_zones_text || DEFAULT_SETTINGS.coverageZonesText).trim() || DEFAULT_SETTINGS.coverageZonesText,
    maxPropertiesToShow: normalizeInteger(
      row.max_properties_to_show,
      DEFAULT_SETTINGS.maxPropertiesToShow,
      1,
      10,
    ),
    selectionNotificationEnabled:
      row.selection_notification_enabled === undefined
        ? DEFAULT_SETTINGS.selectionNotificationEnabled
        : normalizeBoolean(
            row.selection_notification_enabled,
            DEFAULT_SETTINGS.selectionNotificationEnabled,
          ),
    selectionNotificationRecipients: compactText(
      row.selection_notification_recipients || DEFAULT_SETTINGS.selectionNotificationRecipients,
    ),
    selectionNotificationTemplateName:
      compactText(
        row.selection_notification_template_name || DEFAULT_SETTINGS.selectionNotificationTemplateName,
      ) || DEFAULT_SETTINGS.selectionNotificationTemplateName,
    selectionNotificationTemplateLanguage:
      compactText(
        row.selection_notification_template_language ||
          DEFAULT_SETTINGS.selectionNotificationTemplateLanguage,
      ) || DEFAULT_SETTINGS.selectionNotificationTemplateLanguage,
    updatedAt: toIsoString(row.updated_at),
  };
}

function sanitizeSettingsPayload(payload = {}) {
  return {
    tonePreset: compactText(payload.tonePreset || DEFAULT_SETTINGS.tonePreset) || DEFAULT_SETTINGS.tonePreset,
    toneGuidelinesExtra: compactText(payload.toneGuidelinesExtra),
    initialMessageTemplate:
      String(payload.initialMessageTemplate || DEFAULT_SETTINGS.initialMessageTemplate).trim() ||
      DEFAULT_SETTINGS.initialMessageTemplate,
    handoffMessage:
      String(payload.handoffMessage || DEFAULT_SETTINGS.handoffMessage).trim() || DEFAULT_SETTINGS.handoffMessage,
    ownerContactOverride: compactText(payload.ownerContactOverride),
    globalBotEnabled: normalizeBoolean(payload.globalBotEnabled, DEFAULT_SETTINGS.globalBotEnabled),
    followupEnabled: normalizeBoolean(payload.followupEnabled, DEFAULT_SETTINGS.followupEnabled),
    followupWindowStart: normalizeTime(payload.followupWindowStart, DEFAULT_SETTINGS.followupWindowStart),
    followupWindowEnd: normalizeTime(payload.followupWindowEnd, DEFAULT_SETTINGS.followupWindowEnd),
    followupMessageQualifying:
      String(payload.followupMessageQualifying || DEFAULT_SETTINGS.followupMessageQualifying).trim() ||
      DEFAULT_SETTINGS.followupMessageQualifying,
    followupMessageOffering:
      String(payload.followupMessageOffering || DEFAULT_SETTINGS.followupMessageOffering).trim() ||
      DEFAULT_SETTINGS.followupMessageOffering,
    followupMessageVerifyingAvailability:
      String(
        payload.followupMessageVerifyingAvailability || DEFAULT_SETTINGS.followupMessageVerifyingAvailability,
      ).trim() || DEFAULT_SETTINGS.followupMessageVerifyingAvailability,
    inventorySheetEnabled: normalizeBoolean(payload.inventorySheetEnabled, DEFAULT_SETTINGS.inventorySheetEnabled),
    inventorySheetDocumentId:
      compactText(payload.inventorySheetDocumentId || DEFAULT_SETTINGS.inventorySheetDocumentId) ||
      DEFAULT_SETTINGS.inventorySheetDocumentId,
    inventorySheetTabName:
      compactText(payload.inventorySheetTabName || DEFAULT_SETTINGS.inventorySheetTabName) ||
      DEFAULT_SETTINGS.inventorySheetTabName,
    coverageZonesText:
      String(payload.coverageZonesText || DEFAULT_SETTINGS.coverageZonesText).trim() ||
      DEFAULT_SETTINGS.coverageZonesText,
    maxPropertiesToShow: normalizeInteger(
      payload.maxPropertiesToShow,
      DEFAULT_SETTINGS.maxPropertiesToShow,
      1,
      10,
    ),
    selectionNotificationEnabled: normalizeBoolean(
      payload.selectionNotificationEnabled,
      DEFAULT_SETTINGS.selectionNotificationEnabled,
    ),
    selectionNotificationRecipients: compactText(payload.selectionNotificationRecipients),
    selectionNotificationTemplateName:
      compactText(
        payload.selectionNotificationTemplateName ||
          DEFAULT_SETTINGS.selectionNotificationTemplateName,
      ) || DEFAULT_SETTINGS.selectionNotificationTemplateName,
    selectionNotificationTemplateLanguage:
      compactText(
        payload.selectionNotificationTemplateLanguage ||
          DEFAULT_SETTINGS.selectionNotificationTemplateLanguage,
      ) || DEFAULT_SETTINGS.selectionNotificationTemplateLanguage,
  };
}

function settingsStatus(settings) {
  return {
    globalBotEnabled: settings.globalBotEnabled,
    followupEnabled: settings.followupEnabled,
    ownerContactOverrideActive: Boolean(settings.ownerContactOverride),
    followupWindowStart: settings.followupWindowStart,
    followupWindowEnd: settings.followupWindowEnd,
    selectionNotificationEnabled: settings.selectionNotificationEnabled === true,
  };
}

async function getAgentSettings() {
  try {
    const { rows } = await pool.query(
      `
        select
          id,
          tone_preset,
          tone_guidelines_extra,
          initial_message_template,
          handoff_message,
          owner_contact_override,
          global_bot_enabled,
          followup_enabled,
          to_char(followup_window_start, 'HH24:MI') as followup_window_start,
          to_char(followup_window_end, 'HH24:MI') as followup_window_end,
          followup_message_qualifying,
          followup_message_offering,
          followup_message_verifying_availability,
          inventory_sheet_enabled,
          inventory_sheet_document_id,
          inventory_sheet_tab_name,
          coverage_zones_text,
          max_properties_to_show,
          selection_notification_enabled,
          selection_notification_recipients,
          selection_notification_template_name,
          selection_notification_template_language,
          updated_at
        from public.agent_settings
        where id = 1
        limit 1
      `,
    );

    return serializeSettings(rows[0] || DEFAULT_SETTINGS);
  } catch (error) {
    if (String(error.message || '').includes('relation "public.agent_settings" does not exist')) {
      return serializeSettings(DEFAULT_SETTINGS);
    }
    throw error;
  }
}

async function saveAgentSettings(payload) {
  const next = sanitizeSettingsPayload(payload);
  const { rows } = await pool.query(
    `
      insert into public.agent_settings (
        id,
        tone_preset,
        tone_guidelines_extra,
        initial_message_template,
        handoff_message,
        owner_contact_override,
        global_bot_enabled,
        followup_enabled,
        followup_window_start,
        followup_window_end,
        followup_message_qualifying,
        followup_message_offering,
        followup_message_verifying_availability,
        inventory_sheet_enabled,
        inventory_sheet_document_id,
        inventory_sheet_tab_name,
        coverage_zones_text,
        max_properties_to_show,
        selection_notification_enabled,
        selection_notification_recipients,
        selection_notification_template_name,
        selection_notification_template_language
      )
      values (
        1,
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8::time,
        $9::time,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17,
        $18,
        $19,
        $20,
        $21
      )
      on conflict (id)
      do update set
        tone_preset = excluded.tone_preset,
        tone_guidelines_extra = excluded.tone_guidelines_extra,
        initial_message_template = excluded.initial_message_template,
        handoff_message = excluded.handoff_message,
        owner_contact_override = excluded.owner_contact_override,
        global_bot_enabled = excluded.global_bot_enabled,
        followup_enabled = excluded.followup_enabled,
        followup_window_start = excluded.followup_window_start,
        followup_window_end = excluded.followup_window_end,
        followup_message_qualifying = excluded.followup_message_qualifying,
        followup_message_offering = excluded.followup_message_offering,
        followup_message_verifying_availability = excluded.followup_message_verifying_availability,
        inventory_sheet_enabled = excluded.inventory_sheet_enabled,
        inventory_sheet_document_id = excluded.inventory_sheet_document_id,
        inventory_sheet_tab_name = excluded.inventory_sheet_tab_name,
        coverage_zones_text = excluded.coverage_zones_text,
        max_properties_to_show = excluded.max_properties_to_show,
        selection_notification_enabled = excluded.selection_notification_enabled,
        selection_notification_recipients = excluded.selection_notification_recipients,
        selection_notification_template_name = excluded.selection_notification_template_name,
        selection_notification_template_language = excluded.selection_notification_template_language,
        updated_at = now()
      returning
        id,
        tone_preset,
        tone_guidelines_extra,
        initial_message_template,
        handoff_message,
        owner_contact_override,
        global_bot_enabled,
        followup_enabled,
        to_char(followup_window_start, 'HH24:MI') as followup_window_start,
        to_char(followup_window_end, 'HH24:MI') as followup_window_end,
        followup_message_qualifying,
        followup_message_offering,
        followup_message_verifying_availability,
        inventory_sheet_enabled,
        inventory_sheet_document_id,
        inventory_sheet_tab_name,
        coverage_zones_text,
        max_properties_to_show,
        selection_notification_enabled,
        selection_notification_recipients,
        selection_notification_template_name,
        selection_notification_template_language,
        updated_at
    `,
    [
      next.tonePreset,
      next.toneGuidelinesExtra,
      next.initialMessageTemplate,
      next.handoffMessage,
      next.ownerContactOverride || null,
      next.globalBotEnabled,
      next.followupEnabled,
      next.followupWindowStart,
      next.followupWindowEnd,
      next.followupMessageQualifying,
      next.followupMessageOffering,
      next.followupMessageVerifyingAvailability,
      next.inventorySheetEnabled,
      next.inventorySheetDocumentId,
      next.inventorySheetTabName,
      next.coverageZonesText,
      next.maxPropertiesToShow,
      next.selectionNotificationEnabled,
      next.selectionNotificationRecipients || null,
      next.selectionNotificationTemplateName,
      next.selectionNotificationTemplateLanguage,
    ],
  );

  return serializeSettings(rows[0] || next);
}

async function ensureStorage() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(storePath);
  } catch {
    await fs.writeFile(storePath, JSON.stringify({ conversations: [] }, null, 2));
  }
}

async function readStore() {
  await ensureStorage();
  const raw = await fs.readFile(storePath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.conversations) ? parsed : { conversations: [] };
}

async function writeStore(store) {
  await ensureStorage();
  await fs.writeFile(storePath, JSON.stringify(store, null, 2));
}

function rememberClientMessage(conversationId, clientMessageId) {
  if (!clientMessageId) return;
  const existing = recentClientMessageIds.get(conversationId) || new Map();
  existing.set(clientMessageId, Date.now());

  for (const [messageId, createdAt] of existing.entries()) {
    if (Date.now() - createdAt > 15 * 60 * 1000) {
      existing.delete(messageId);
    }
  }

  recentClientMessageIds.set(conversationId, existing);
}

function hasRecentClientMessage(conversationId, clientMessageId) {
  if (!clientMessageId) return false;
  const existing = recentClientMessageIds.get(conversationId);
  if (!existing) return false;

  const createdAt = existing.get(clientMessageId);
  if (!createdAt) return false;
  if (Date.now() - createdAt > 15 * 60 * 1000) {
    existing.delete(clientMessageId);
    if (!existing.size) {
      recentClientMessageIds.delete(conversationId);
    }
    return false;
  }

  return true;
}

async function sendWebhookMessage({ waId, chatInput, clientName, clientMessageId, localSequence }) {
  const response = await fetch(simulatorWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      wa_id: waId,
      client_name: clientName,
      text: chatInput,
      client_message_id: clientMessageId || null,
      local_sequence: Number(localSequence || 0) || 0,
    }),
  });

  const text = await response.text();
  let json = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`Simulator webhook ${response.status}`);
    error.payload = json;
    throw error;
  }

  return json;
}

function enqueueWebhookMessage({ waId, chatInput, clientName, clientMessageId, localSequence }) {
  const previous = outboundQueueByConversation.get(waId) || Promise.resolve();
  const next = previous
    .catch(() => null)
    .then(() =>
      sendWebhookMessage({ waId, chatInput, clientName, clientMessageId, localSequence }),
    );
  const settled = next.catch(() => null);

  outboundQueueByConversation.set(
    waId,
    settled.finally(() => {
      if (outboundQueueByConversation.get(waId) === settled) {
        outboundQueueByConversation.delete(waId);
      }
    }),
  );

  return next;
}

async function getConversationRow(conversationId) {
  const { rows } = await pool.query(
    `
      select *
      from public.conversations
      where wa_id = $1
      limit 1
    `,
    [conversationId],
  );

  return rows[0] || null;
}

async function getMessages(conversationId) {
  const { rows } = await pool.query(
    `
      select
        id,
        direction,
        message_type,
        content,
        state_at_time,
        agent_used,
        created_at
      from public.messages
      where conversation_id = $1
      order by
        created_at asc,
        case direction when 'INBOUND' then 0 else 1 end asc,
        id asc
    `,
    [conversationId],
  );

  return rows;
}

async function getFollowOnEntries(conversationId) {
  const { rows } = await pool.query(
    `
      select
        id,
        message,
        scheduled_for,
        status,
        sent_at,
        cancelled_at,
        cancel_reason,
        metadata,
        created_at,
        updated_at
      from public.follow_on
      where conversation_id = $1
      order by
        case when status = 'pendiente' then 0 else 1 end asc,
        scheduled_for asc nulls last,
        created_at desc
      limit 10
    `,
    [conversationId],
  );

  return rows;
}

async function getSelectionNotificationEntries(conversationId) {
  const { rows } = await pool.query(
    `
      select
        id,
        selected_finca_id,
        recipient_phone,
        template_name,
        template_language,
        status,
        provider_message_id,
        error_message,
        payload,
        created_at,
        sent_at
      from public.selection_notifications
      where conversation_id = $1
      order by created_at desc, id desc
      limit 20
    `,
    [conversationId],
  );

  return rows;
}

async function listMonitoringRows() {
  const { rows } = await pool.query(`
    with prioritized_follow_on as (
      select distinct on (f.conversation_id)
        f.conversation_id,
        f.id,
        f.message,
        f.scheduled_for,
        f.status,
        f.sent_at,
        f.cancelled_at,
        f.cancel_reason,
        f.metadata,
        f.created_at,
        f.updated_at
      from public.follow_on f
      where f.status = 'pendiente'
      order by
        f.conversation_id,
        f.scheduled_for asc nulls last,
        f.id desc
    )
    select
      c.*,
      pf.id as follow_on_id,
      pf.message as follow_on_message,
      pf.scheduled_for as follow_on_scheduled_for,
      pf.status as follow_on_status,
      pf.sent_at as follow_on_sent_at,
      pf.cancelled_at as follow_on_cancelled_at,
      pf.cancel_reason as follow_on_cancel_reason,
      pf.metadata as follow_on_metadata,
      lm.content as last_message_content,
      lm.direction as last_message_direction,
      lm.created_at as last_message_created_at,
      lm.agent_used as last_message_agent_used
    from public.conversations c
    left join prioritized_follow_on pf on pf.conversation_id = c.wa_id
    left join lateral (
      select
        m.content,
        m.direction,
        m.created_at,
        m.agent_used
      from public.messages m
      where m.conversation_id = c.wa_id
      order by m.created_at desc, m.id desc
      limit 1
    ) lm on true
    order by coalesce(c.last_interaction, c.updated_at, c.created_at) desc
    limit 500;
  `);

  return rows;
}

function decorateMonitoringConversation(row) {
  const lastInteractionAt = row.last_interaction || row.updated_at || row.created_at || null;
  const nextFollowUpAt = row.follow_on_scheduled_for || row.next_followup_at || null;
  const nextFollowUpDate = nextFollowUpAt ? new Date(nextFollowUpAt) : null;
  const now = Date.now();
  const followOnRemainingMs = nextFollowUpDate ? nextFollowUpDate.getTime() - now : null;
  const selectedFinca = row.selected_finca || null;
  const selectedFincaName = selectedFinca?.nombre || row.selected_finca_id || null;
  const converted = Boolean(row.selected_finca_id);
  const hitl = row.agente_activo === false;
  const followOnPending = row.follow_on_status === 'pendiente';

  return {
    waId: row.wa_id,
    clientName: row.client_name || row.wa_id,
    currentState: row.current_state || 'NEW',
    previousState: row.previous_state || null,
    waitingFor: row.waiting_for || 'CLIENT',
    agenteActivo: row.agente_activo !== false,
    hitl,
    chatwootId: row.chatwoot_id || null,
    selectedFincaId: row.selected_finca_id || null,
    selectedFincaName,
    converted,
    closedAt: toIsoString(row.closed_at),
    lastInteractionAt: toIsoString(lastInteractionAt),
    lastMessage: {
      content: row.last_message_content || null,
      direction: row.last_message_direction || null,
      createdAt: toIsoString(row.last_message_created_at),
      agentUsed: row.last_message_agent_used || null,
    },
    followOn: row.follow_on_id
      ? {
          id: row.follow_on_id,
          message: row.follow_on_message || '',
          status: row.follow_on_status || null,
          scheduledFor: toIsoString(nextFollowUpAt),
          sentAt: toIsoString(row.follow_on_sent_at),
          cancelledAt: toIsoString(row.follow_on_cancelled_at),
          cancelReason: row.follow_on_cancel_reason || null,
          remainingMs: followOnRemainingMs,
          due: followOnPending && followOnRemainingMs !== null && followOnRemainingMs <= 0,
          metadata: row.follow_on_metadata || null,
        }
      : null,
    searchCriteria: row.search_criteria || {},
  };
}

function filterMonitoringConversations(conversations, filters) {
  return conversations.filter((conversation) => {
    const haystack = [
      conversation.waId,
      conversation.clientName,
      conversation.currentState,
      conversation.selectedFincaName,
      conversation.lastMessage?.content,
      conversation.followOn?.message,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (filters.search && !haystack.includes(filters.search)) return false;
    if (!matchesTimeframe(conversation.lastInteractionAt, filters.timeframe)) return false;
    if (filters.agent === 'active' && !conversation.agenteActivo) return false;
    if (filters.agent === 'hitl' && conversation.agenteActivo) return false;
    if (filters.waitingFor === 'client' && conversation.waitingFor !== 'CLIENT') return false;
    if (filters.waitingFor === 'owner' && conversation.waitingFor !== 'OWNER') return false;
    if (filters.converted === 'converted' && !conversation.converted) return false;
    if (filters.converted === 'open' && conversation.converted) return false;
    if (filters.followOn === 'pending' && conversation.followOn?.status !== 'pendiente') return false;
    if (filters.followOn === 'due' && conversation.followOn?.due !== true) return false;
    if (filters.followOn === 'none' && conversation.followOn) return false;

    return true;
  });
}

function buildMonitoringSummary(conversations) {
  return {
    total: conversations.length,
    botActive: conversations.filter((item) => item.agenteActivo).length,
    hitl: conversations.filter((item) => !item.agenteActivo).length,
    waitingClient: conversations.filter((item) => item.waitingFor === 'CLIENT').length,
    waitingOwner: conversations.filter((item) => item.waitingFor === 'OWNER').length,
    converted: conversations.filter((item) => item.converted).length,
    pendingFollowOn: conversations.filter((item) => item.followOn?.status === 'pendiente').length,
    dueFollowOn: conversations.filter((item) => item.followOn?.due === true).length,
  };
}

function buildContext(conversation) {
  if (!conversation) return null;

  return {
    conversation: {
      id: conversation.wa_id,
      client_name: conversation.client_name,
      current_state: conversation.current_state,
      previous_state: conversation.previous_state,
      started_at: conversation.created_at,
      channel: 'SIMULATOR',
    },
    search_criteria: conversation.search_criteria || {},
    selected_finca_id: conversation.selected_finca_id,
    selected_finca: conversation.selected_finca,
    shown_fincas: conversation.shown_fincas || [],
    owner_response: conversation.owner_response,
    pricing: {
      precio_noche: conversation.precio_noche,
      noches: conversation.noches,
      subtotal: conversation.subtotal,
      deposito_seguridad: conversation.deposito_seguridad,
      total: conversation.total,
      anticipo_requerido: conversation.anticipo_requerido,
      anticipo_pagado: conversation.anticipo_pagado,
      saldo_pagado: conversation.saldo_pagado,
      metodo_pago: conversation.metodo_pago,
      comprobante_url: conversation.comprobante_url,
    },
    extras: conversation.extras || {},
    followup: {
      count: conversation.followup_count,
      enabled: conversation.followup_enabled,
      next_followup_at: conversation.next_followup_at,
      waiting_for: conversation.waiting_for,
    },
    agente_activo: conversation.agente_activo,
    hitl_reason: conversation.hitl_reason,
  };
}

async function getConversationSnapshot(record) {
  const conversation = await getConversationRow(record.id);
  const messages = await getMessages(record.id);
  const lastMessage = messages.at(-1) || null;

  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: conversation?.updated_at || record.createdAt,
    stage: conversation?.current_state || 'NEW',
    waitingFor: conversation?.waiting_for || 'CLIENT',
    agenteActivo: conversation?.agente_activo ?? true,
    lastMessage: lastMessage
      ? {
          direction: lastMessage.direction,
          content: lastMessage.content,
          created_at: lastMessage.created_at,
        }
      : null,
    messages: messages.map((message) => ({
      id: message.id,
      direction: message.direction,
      content: message.content,
      messageType: message.message_type,
      stateAtTime: message.state_at_time,
      agentUsed: message.agent_used,
      createdAt: message.created_at,
    })),
    context: buildContext(conversation),
    conversationRow: conversation,
  };
}

async function listConversationSnapshots() {
  const store = await readStore();
  const snapshots = await Promise.all(store.conversations.map((record) => getConversationSnapshot(record)));
  return snapshots.sort((a, b) => {
    const aTime = new Date(a.updatedAt || a.createdAt).getTime();
    const bTime = new Date(b.updatedAt || b.createdAt).getTime();
    return bTime - aTime;
  });
}

function createConversationRecord(existingCount) {
  const suffix = String(Date.now()).slice(-7);
  const seed = String(existingCount + 1).padStart(3, '0');
  const id = `57300${seed}${suffix}`;
  return {
    id,
    title: id,
    createdAt: new Date().toISOString(),
  };
}

const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));

app.get('/api/bootstrap', async (_req, res) => {
  try {
    const [conversations, settings] = await Promise.all([listConversationSnapshots(), getAgentSettings()]);

    res.json({
      workflow: {
        workflowName: 'De paseo en fincas customer agent',
        workflowId: SIMULATOR_WEBHOOK_PATH,
      },
      settings,
      conversations,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
      details: error.payload || null,
    });
  }
});

app.get('/api/settings', async (_req, res) => {
  try {
    const settings = await getAgentSettings();
    res.json({
      timezone: BOGOTA_TIMEZONE,
      settings,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
      details: error.payload || null,
    });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const settings = await saveAgentSettings(req.body || {});
    res.json({
      ok: true,
      settings,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
      details: error.payload || null,
    });
  }
});

app.post('/api/conversations', async (_req, res) => {
  try {
    const store = await readStore();
    const record = createConversationRecord(store.conversations.length);
    store.conversations.unshift(record);
    await writeStore(store);
    const snapshot = await getConversationSnapshot(record);
    res.status(201).json(snapshot);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

app.get('/api/conversations', async (_req, res) => {
  try {
    const conversations = await listConversationSnapshots();
    res.json(conversations);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

app.get('/api/conversations/:id', async (req, res) => {
  try {
    const store = await readStore();
    const record = store.conversations.find((item) => item.id === req.params.id);

    if (!record) {
      res.status(404).json({ message: 'Conversation not found' });
      return;
    }

    const snapshot = await getConversationSnapshot(record);
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

app.get('/api/monitoring', async (req, res) => {
  try {
    const filters = {
      search: compactText(req.query.search).toLowerCase(),
      timeframe: compactText(req.query.timeframe || 'all') || 'all',
      agent: compactText(req.query.agent || 'all') || 'all',
      waitingFor: compactText(req.query.waitingFor || 'all') || 'all',
      converted: compactText(req.query.converted || 'all') || 'all',
      followOn: compactText(req.query.followOn || 'all') || 'all',
    };

    const [rows, settings] = await Promise.all([listMonitoringRows(), getAgentSettings()]);
    const conversations = filterMonitoringConversations(rows.map(decorateMonitoringConversation), filters);

    res.json({
      generatedAt: new Date().toISOString(),
      timezone: BOGOTA_TIMEZONE,
      businessHours: {
        start: settings.followupWindowStart,
        end: settings.followupWindowEnd,
      },
      settingsStatus: settingsStatus(settings),
      filters,
      summary: buildMonitoringSummary(conversations),
      conversations,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
      details: error.payload || null,
    });
  }
});

app.get('/api/monitoring/conversations/:id', async (req, res) => {
  try {
    const [conversation, settings] = await Promise.all([getConversationRow(req.params.id), getAgentSettings()]);

    if (!conversation) {
      res.status(404).json({ message: 'Conversation not found' });
      return;
    }

    const [messages, followOns, selectionNotifications] = await Promise.all([
      getMessages(req.params.id),
      getFollowOnEntries(req.params.id),
      getSelectionNotificationEntries(req.params.id),
    ]);

    res.json({
      settingsStatus: settingsStatus(settings),
      conversation: {
        ...conversation,
        context: buildContext(conversation),
      },
      messages: messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        content: message.content,
        messageType: message.message_type,
        stateAtTime: message.state_at_time,
        agentUsed: message.agent_used,
        createdAt: toIsoString(message.created_at),
      })),
      followOn: followOns.map((entry) => ({
        id: entry.id,
        message: entry.message,
        status: entry.status,
        scheduledFor: toIsoString(entry.scheduled_for),
        sentAt: toIsoString(entry.sent_at),
        cancelledAt: toIsoString(entry.cancelled_at),
        cancelReason: entry.cancel_reason,
        metadata: entry.metadata,
        createdAt: toIsoString(entry.created_at),
        updatedAt: toIsoString(entry.updated_at),
      })),
      selectionNotifications: selectionNotifications.map((entry) => ({
        id: entry.id,
        selectedFincaId: entry.selected_finca_id,
        recipientPhone: entry.recipient_phone,
        templateName: entry.template_name,
        templateLanguage: entry.template_language,
        status: entry.status,
        providerMessageId: entry.provider_message_id,
        errorMessage: entry.error_message,
        payload: entry.payload,
        createdAt: toIsoString(entry.created_at),
        sentAt: toIsoString(entry.sent_at),
      })),
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
      details: error.payload || null,
    });
  }
});

app.post('/api/conversations/:id/messages', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const clientMessageId = compactText(req.body?.clientMessageId);
  const localSequence = Number(req.body?.localSequence || 0) || 0;
  if (!text) {
    res.status(400).json({ message: 'Message text is required' });
    return;
  }

  const store = await readStore();
  const record = store.conversations.find((item) => item.id === req.params.id);

  if (!record) {
    res.status(404).json({ message: 'Conversation not found' });
    return;
  }

  try {
    const queuedAt = new Date().toISOString();

    if (clientMessageId && hasRecentClientMessage(record.id, clientMessageId)) {
      res.status(202).json({
        accepted: true,
        duplicate: true,
        conversationId: record.id,
        queuedAt,
      });
      return;
    }

    rememberClientMessage(record.id, clientMessageId);

    void enqueueWebhookMessage({
      waId: record.id,
      chatInput: text,
      clientName: record.title,
      clientMessageId,
      localSequence,
    }).catch((error) => {
      console.error('Simulator background webhook failed', {
        conversationId: record.id,
        message: error.message,
        details: error.payload || null,
      });
    });

    res.status(202).json({
      accepted: true,
      conversationId: record.id,
      queuedAt,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
      details: error.payload || null,
    });
  }
});

app.get(['/', '/simulator', '/monitoring', '/settings'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

await ensureStorage();

app.listen(PORT, () => {
  console.log(`Simulator running at http://localhost:${PORT}`);
});
