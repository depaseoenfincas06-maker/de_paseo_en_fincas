import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import express from 'express';
import pkg from 'pg';

import { downloadAssetBuffer, sendChatwootAttachment } from './lib/chatwoot_media_relay.mjs';

const { Pool, types } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(rootDir, '.env') });

const PORT = Number(process.env.SIMULATOR_PORT || 3101);
const N8N_BASE_URL = process.env.N8N_BASE_URL;
const SIMULATOR_WEBHOOK_PATH = process.env.SIMULATOR_WEBHOOK_PATH || 'simulator/de-paseo-en-fincas/inbound';
const BOGOTA_TIMEZONE = 'America/Bogota';
const IS_VERCEL = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL);
const CHATWOOT_BASE_URL = process.env.CHATWOOT_BASE_URL || '';
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || '1';
const SUPABASE_DB_HOST = process.env.SUPABASE_DB_HOST;
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL || '';
const DATABASE_URL = process.env.DATABASE_URL || '';
const POSTGRES_URL = process.env.POSTGRES_URL || '';
const POSTGRES_PRISMA_URL = process.env.POSTGRES_PRISMA_URL || '';
const POSTGRES_URL_NON_POOLING = process.env.POSTGRES_URL_NON_POOLING || '';
const BURST_WINDOW_MS = 4000;
const RAW_SUPABASE_DB_PORT = Number(process.env.SUPABASE_DB_PORT || 0);
const SUPABASE_DB_PORT =
  /\.pooler\.supabase\.com$/i.test(String(SUPABASE_DB_HOST || '')) && RAW_SUPABASE_DB_PORT === 5432
    ? 6543
    : RAW_SUPABASE_DB_PORT || 5432;
const DB_CONFIG_ERROR_MESSAGE =
  'Falta configurar la conexión a la base de datos. Define SUPABASE_DB_URL, DATABASE_URL, POSTGRES_URL o SUPABASE_DB_* en Vercel.';
const N8N_WEBHOOK_ERROR_MESSAGE =
  'Falta configurar N8N_BASE_URL. El simulador puede cargar, pero no puede reenviar mensajes al workflow.';

const publicDir = path.join(rootDir, 'public');
const POOL_SYMBOL = Symbol.for('depaseo.simulator.pg.pool');
const firstPresent = (...values) => {
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
};

types.setTypeParser(1114, (value) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().replace(' ', 'T');
  return new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
});

types.setTypeParser(1184, (value) => {
  if (value === null || value === undefined) return null;
  return new Date(value);
});

function createMissingDbPoolStub() {
  return {
    async query() {
      const error = new Error(DB_CONFIG_ERROR_MESSAGE);
      error.code = 'DB_CONFIG_MISSING';
      throw error;
    },
    async end() {
      return undefined;
    },
  };
}

function createPool() {
  const connectionString = firstPresent(
    SUPABASE_DB_URL,
    DATABASE_URL,
    POSTGRES_URL,
    POSTGRES_PRISMA_URL,
    POSTGRES_URL_NON_POOLING,
  );

  if (connectionString) {
    return new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false,
      },
      max: IS_VERCEL ? 1 : 2,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    });
  }

  if (
    SUPABASE_DB_HOST &&
    process.env.SUPABASE_DB_NAME &&
    process.env.SUPABASE_DB_USER &&
    process.env.SUPABASE_DB_PASSWORD
  ) {
    return new Pool({
      host: SUPABASE_DB_HOST,
      port: SUPABASE_DB_PORT,
      database: process.env.SUPABASE_DB_NAME,
      user: process.env.SUPABASE_DB_USER,
      password: process.env.SUPABASE_DB_PASSWORD,
      ssl: {
        rejectUnauthorized: false,
      },
      max: IS_VERCEL ? 1 : 2,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    });
  }

  return createMissingDbPoolStub();
}

const pool = globalThis[POOL_SYMBOL] || createPool();
if (!globalThis[POOL_SYMBOL]) {
  globalThis[POOL_SYMBOL] = pool;
}

const simulatorWebhookUrl = String(N8N_BASE_URL || '').trim()
  ? `${String(N8N_BASE_URL).replace(/\/$/, '')}/webhook/${SIMULATOR_WEBHOOK_PATH}`
  : null;
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

function parseTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed) &&
      !/(Z|[+-]\d{2}(?::?\d{2})?)$/i.test(trimmed)
    ) {
      const utcDate = new Date(trimmed.replace(' ', 'T') + 'Z');
      return Number.isNaN(utcDate.getTime()) ? null : utcDate;
    }
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toIsoString(value) {
  const date = parseTimestamp(value);
  return date ? date.toISOString() : null;
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

function toSerializable(value) {
  if (value instanceof Date) return toIsoString(value);
  if (Array.isArray(value)) return value.map((item) => toSerializable(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toSerializable(entry)]));
  }
  return value;
}

function serializeConversationRecord(conversation) {
  if (!conversation) return null;
  return Object.fromEntries(
    Object.entries(conversation).map(([key, value]) => [key, toSerializable(value)]),
  );
}

function presentApiError(error) {
  const rawMessage = String(error?.message || 'Unexpected error');
  if (rawMessage.includes('MaxClientsInSessionMode: max clients reached')) {
    return {
      message: 'El pool de conexiones a Supabase está saturado temporalmente. Vuelve a intentar en unos segundos.',
      details: null,
    };
  }

  return {
    message: rawMessage,
    details: error?.payload || null,
  };
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

function isMissingRelationError(error, relationName) {
  const message = String(error?.message || '');
  return (
    message.includes(`relation "${relationName}" does not exist`) ||
    message.includes(`relation '${relationName}' does not exist`) ||
    message.includes(`relation "${relationName.split('.').pop()}" does not exist`) ||
    message.includes(`relation '${relationName.split('.').pop()}' does not exist`)
  );
}

function serializeSimulatorConversation(row = {}) {
  return {
    id: String(row.id || ''),
    title: compactText(row.title || row.id || ''),
    createdAt: toIsoString(row.created_at || row.createdAt || new Date()),
    updatedAt: toIsoString(row.updated_at || row.updatedAt || row.created_at || row.createdAt || new Date()),
  };
}

function createConversationId() {
  const suffix = String(Date.now()).slice(-7);
  const nonce = crypto.randomInt(100, 1000);
  return `57300${nonce}${suffix}`;
}

async function listSimulatorConversationRecords() {
  try {
    const { rows } = await pool.query(
      `
        select
          id,
          title,
          created_at,
          updated_at
        from public.simulator_conversations
        order by updated_at desc, created_at desc
        limit 500
      `,
    );

    return rows.map(serializeSimulatorConversation);
  } catch (error) {
    if (isMissingRelationError(error, 'public.simulator_conversations')) {
      return [];
    }
    throw error;
  }
}

async function getSimulatorConversationRecord(conversationId) {
  const { rows } = await pool.query(
    `
      select
        id,
        title,
        created_at,
        updated_at
      from public.simulator_conversations
      where id = $1
      limit 1
    `,
    [conversationId],
  );

  return rows[0] ? serializeSimulatorConversation(rows[0]) : null;
}

async function createSimulatorConversationRecord() {
  const record = {
    id: createConversationId(),
    title: null,
  };

  const { rows } = await pool.query(
    `
      insert into public.simulator_conversations (
        id,
        title
      )
      values (
        $1,
        $2
      )
      returning
        id,
        title,
        created_at,
        updated_at
    `,
    [record.id, record.title],
  );

  return serializeSimulatorConversation(rows[0] || record);
}

async function touchSimulatorConversationRecord(conversationId) {
  await pool.query(
    `
      update public.simulator_conversations
      set updated_at = now()
      where id = $1
    `,
    [conversationId],
  );
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
  if (!simulatorWebhookUrl) {
    const error = new Error(N8N_WEBHOOK_ERROR_MESSAGE);
    error.code = 'N8N_WEBHOOK_MISSING';
    throw error;
  }
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
  return sendWebhookMessage({ waId, chatInput, clientName, clientMessageId, localSequence });
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

  const operationalRecord = serializeConversationRecord(conversation);

  return {
    conversation: {
      id: conversation.wa_id,
      client_name: conversation.client_name,
      current_state: conversation.current_state,
      previous_state: conversation.previous_state,
      started_at: conversation.created_at,
      last_interaction: conversation.last_interaction,
      updated_at: conversation.updated_at,
      channel: conversation.chatwoot_id ? 'CHATWOOT' : 'SIMULATOR',
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
    huespedes: conversation.huespedes || null,
    huespedes_completos: conversation.huespedes_completos ?? false,
    titular_data: conversation.titular_data || null,
    correcciones: conversation.correcciones || null,
    confirmacion: {
      enviada: conversation.confirmacion_enviada ?? false,
      aceptada: conversation.confirmacion_aceptada ?? false,
      version: conversation.confirmacion_version ?? 0,
    },
    owner_tracking: {
      contacted_at: conversation.owner_contacted_at,
      confirmed_payment: conversation.owner_confirmed_payment ?? false,
      response: conversation.owner_response || null,
    },
    lifecycle: {
      state_changed_at: conversation.state_changed_at,
      closed_at: conversation.closed_at,
      loss_reason: conversation.loss_reason || null,
      hitl_activated_at: conversation.hitl_activated_at,
      last_message_from: conversation.last_message_from || null,
    },
    chatwoot: {
      conversation_id: conversation.chatwoot_id || null,
    },
    agente_activo: conversation.agente_activo,
    hitl_reason: conversation.hitl_reason,
    operational_record: operationalRecord,
  };
}

function buildBurstStatus(conversation, messages = []) {
  if (!conversation) {
    return {
      pending: false,
      pendingCount: 0,
      waitingUntil: null,
      activeClaim: null,
    };
  }

  const lastProcessedInboundAt = parseTimestamp(conversation.last_processed_inbound_at)?.getTime()
    ?? Number.NEGATIVE_INFINITY;
  const pendingBurstLastMessageAt = parseTimestamp(conversation.pending_burst_last_message_at)?.getTime()
    ?? Number.NEGATIVE_INFINITY;

  if (!conversation.active_burst_claim && pendingBurstLastMessageAt <= lastProcessedInboundAt) {
    return {
      pending: false,
      pendingCount: 0,
      waitingUntil: null,
      activeClaim: null,
    };
  }

  const pendingMessages = (messages || []).filter((message) => {
    if (message.direction !== 'INBOUND') return false;
    const createdAt = parseTimestamp(message.created_at || message.createdAt)?.getTime();
    if (!Number.isFinite(createdAt)) return false;
    return createdAt > lastProcessedInboundAt;
  });

  const waitingUntil = conversation.pending_burst_last_message_at
    ? new Date((parseTimestamp(conversation.pending_burst_last_message_at)?.getTime() || 0) + BURST_WINDOW_MS).toISOString()
    : null;

  return {
    pending: pendingMessages.length > 0 || Boolean(conversation.active_burst_claim),
    pendingCount: pendingMessages.length,
    waitingUntil,
    activeClaim: conversation.active_burst_claim || null,
  };
}

async function getConversationSnapshot(record) {
  const conversation = await getConversationRow(record.id);
  const messages = await getMessages(record.id);
  const lastMessage = messages.at(-1) || null;
  const burstStatus = buildBurstStatus(conversation, messages);

  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: toIsoString(conversation?.updated_at || record.updatedAt || record.createdAt),
    stage: conversation?.current_state || 'NEW',
    waitingFor: conversation?.waiting_for || 'CLIENT',
    agenteActivo: conversation?.agente_activo ?? true,
    lastMessage: lastMessage
      ? {
          direction: lastMessage.direction,
          content: lastMessage.content,
          created_at: toIsoString(lastMessage.created_at),
        }
      : null,
    messages: messages.map((message) => ({
      id: message.id,
      direction: message.direction,
      content: message.content,
      messageType: message.message_type,
      stateAtTime: message.state_at_time,
      agentUsed: message.agent_used,
      createdAt: toIsoString(message.created_at),
    })),
    context: buildContext(conversation),
    conversationRow: conversation,
    burstStatus,
  };
}

async function listConversationSnapshots() {
  const records = await listSimulatorConversationRecords();
  const snapshots = [];
  for (const record of records) {
    snapshots.push(await getConversationSnapshot(record));
  }
  return snapshots.sort((a, b) => {
    const aTime = new Date(a.updatedAt || a.createdAt).getTime();
    const bTime = new Date(b.updatedAt || b.createdAt).getTime();
    return bTime - aTime;
  });
}

function createApp() {
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
        webhookReady: Boolean(simulatorWebhookUrl),
        webhookUrl: simulatorWebhookUrl,
      },
      chatwootBaseUrl: CHATWOOT_BASE_URL,
      chatwootAccountId: CHATWOOT_ACCOUNT_ID,
      settings,
      conversations,
    });
  } catch (error) {
    const apiError = presentApiError(error);
    res.status(500).json({
      message: apiError.message,
      details: apiError.details,
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
    const apiError = presentApiError(error);
    res.status(500).json({
      message: apiError.message,
      details: apiError.details,
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
    const apiError = presentApiError(error);
    res.status(500).json({
      message: apiError.message,
      details: apiError.details,
    });
  }
  });

  app.post('/api/chatwoot/send-drive-asset', async (req, res) => {
    const payload = req.body || {};
    const chatwootId = compactText(payload.chatwoot_id);
    const downloadUrl = compactText(payload.download_url);
    const sourceUrl = compactText(payload.source_url) || downloadUrl;
    const propertyTitle = compactText(payload.property_title) || null;
    const caption = payload.caption == null ? '' : String(payload.caption);
    const privateMessage = normalizeBoolean(payload.private, false);
    const chatwootBaseUrl = compactText(payload.chatwoot_base_url || CHATWOOT_BASE_URL);
    const chatwootAccountId = compactText(payload.chatwoot_account_id || CHATWOOT_ACCOUNT_ID) || '1';
    const chatwootApiToken = compactText(payload.chatwoot_api_token || process.env.CHATWOOT_API_TOKEN || '');

    if (!chatwootId) {
      res.status(400).json({ ok: false, message: 'chatwoot_id is required' });
      return;
    }

    if (!downloadUrl) {
      res.status(400).json({ ok: false, message: 'download_url is required' });
      return;
    }

    if (!chatwootBaseUrl || !chatwootApiToken) {
      res.status(500).json({
        ok: false,
        message: 'Missing Chatwoot relay configuration',
        details: {
          chatwootBaseUrlPresent: Boolean(chatwootBaseUrl),
          chatwootApiTokenPresent: Boolean(chatwootApiToken),
        },
      });
      return;
    }

    try {
      const file = await downloadAssetBuffer(downloadUrl, { sourceUrl });
      const response = await sendChatwootAttachment({
        chatwootBaseUrl,
        chatwootAccountId,
        chatwootApiToken,
        chatwootId,
        file,
        caption,
        privateMessage,
      });

      res.json({
        ok: true,
        chatwoot_id: chatwootId,
        filename: file.filename,
        contentType: file.contentType,
        source_url: sourceUrl,
        property_title: propertyTitle,
        response,
      });
    } catch (error) {
      const apiError = presentApiError(error);
      const message = String(error?.message || apiError.message || 'chatwoot_media_relay_failed');

      res.status(502).json({
        ok: false,
        message: apiError.message,
        error: message,
        chatwoot_id: chatwootId,
        source_url: sourceUrl,
        property_title: propertyTitle,
      });
    }
  });

  app.post('/api/conversations', async (_req, res) => {
    try {
      const record = await createSimulatorConversationRecord();
      const snapshot = await getConversationSnapshot(record);
      res.status(201).json(snapshot);
    } catch (error) {
      const apiError = presentApiError(error);
      res.status(500).json({
        message: apiError.message,
      });
    }
  });

  app.get('/api/conversations', async (_req, res) => {
    try {
    const conversations = await listConversationSnapshots();
    res.json(conversations);
  } catch (error) {
    const apiError = presentApiError(error);
    res.status(500).json({
      message: apiError.message,
    });
  }
  });

  app.get('/api/conversations/:id', async (req, res) => {
  try {
    const record = await getSimulatorConversationRecord(req.params.id);

    if (!record) {
      res.status(404).json({ message: 'Conversation not found' });
      return;
    }

    const snapshot = await getConversationSnapshot(record);
    res.json(snapshot);
  } catch (error) {
    const apiError = presentApiError(error);
    res.status(500).json({
      message: apiError.message,
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
    const apiError = presentApiError(error);
    res.status(500).json({
      message: apiError.message,
      details: apiError.details,
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
    const apiError = presentApiError(error);
    res.status(500).json({
      message: apiError.message,
      details: apiError.details,
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

  const record = await getSimulatorConversationRecord(req.params.id);

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
    await touchSimulatorConversationRecord(record.id);

    if (IS_VERCEL) {
      await enqueueWebhookMessage({
        waId: record.id,
        chatInput: text,
        clientName: record.title,
        clientMessageId,
        localSequence,
      });
    } else {
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
    }

    res.status(202).json({
      accepted: true,
      conversationId: record.id,
      queuedAt,
    });
  } catch (error) {
    const apiError = presentApiError(error);
    res.status(500).json({
      message: apiError.message,
      details: apiError.details,
    });
  }
  });

  app.get(['/', '/simulator', '/monitoring', '/settings'], (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}

const app = createApp();

export { app, createApp };
export default app;

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  app.listen(PORT, () => {
    console.log(`Simulator running at http://localhost:${PORT}`);
  });
}
