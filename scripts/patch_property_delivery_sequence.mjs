import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';

dotenv.config({ path: path.resolve('.env') });

const MAIN_WORKFLOW_ID = process.argv[2] || process.env.SIMULATOR_WORKFLOW_ID || 'RrIniaNJCUC72nfI';
const OUTBOUND_WORKFLOW_ID = process.argv[3] || 'pLyrdDO3mneaCp7m';

const N8N_BASE_URL = process.env.N8N_BASE_URL;
const N8N_API_KEY = process.env.N8N_PUBLIC_API_TOKEN;

if (!N8N_BASE_URL || !N8N_API_KEY) {
  throw new Error('Missing N8N_BASE_URL or N8N_PUBLIC_API_TOKEN');
}

async function api(pathname, options = {}) {
  const response = await fetch(`${N8N_BASE_URL}${pathname}`, {
    ...options,
    headers: {
      'X-N8N-API-KEY': N8N_API_KEY,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`HTTP ${response.status} ${pathname}`);
    error.payload = payload;
    throw error;
  }

  return payload;
}

function sanitizeWorkflowSettings(settings) {
  return Object.fromEntries(Object.entries(settings || {}).filter(([, value]) => value !== undefined));
}

function sanitizeWorkflowForUpdate(workflow) {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: sanitizeWorkflowSettings({
      executionOrder: workflow.settings?.executionOrder || 'v1',
      timezone: workflow.settings?.timezone || 'America/Bogota',
      callerPolicy: workflow.settings?.callerPolicy,
      availableInMCP: workflow.settings?.availableInMCP,
    }),
  };
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((item) => item.name === name);
  if (!node) {
    throw new Error(`Node not found: ${name}`);
  }
  return node;
}

async function patchWorkflow(workflowId, patchFn) {
  const workflow = await api(`/api/v1/workflows/${workflowId}`);
  const wasActive = workflow.active === true;

  patchFn(workflow);

  if (wasActive) {
    await api(`/api/v1/workflows/${workflowId}/deactivate`, { method: 'POST' });
  }

  await api(`/api/v1/workflows/${workflowId}`, {
    method: 'PUT',
    body: JSON.stringify(sanitizeWorkflowForUpdate(workflow)),
  });

  if (wasActive) {
    await api(`/api/v1/workflows/${workflowId}/activate`, { method: 'POST' });
  }

  return api(`/api/v1/workflows/${workflowId}`);
}

const normalizeInventoryCode = String.raw`const rawItems = $input.all();
const rows = rawItems.map((item) => item.json || {});
const firstErrorItem = rawItems.find((item) => {
  const json = item.json || {};
  return Boolean(
    item.error ||
      json.error ||
      json.errorMessage ||
      json.message === 'Forbidden' ||
      json.message === 'Unauthorized'
  );
});

const toNumber = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(num) ? num : fallback;
};

const toBool = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'si', 'sí', 'yes', 'y', 'activo', 'activa'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'inactivo', 'inactiva'].includes(normalized)) return false;
  return fallback;
};

const toCsv = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const pick = (row, keys) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return row[key];
  }
  return null;
};

if (firstErrorItem) {
  return [
    {
      json: {
        inventory: [],
        inventory_meta: {
          access_ok: false,
          error_message:
            firstErrorItem.json?.errorMessage ||
            firstErrorItem.json?.message ||
            firstErrorItem.json?.error?.message ||
            'inventory_access_error',
          count: 0,
          total_rows: 0,
        },
      },
    },
  ];
}

const inventory = rows
  .map((row) => {
    const fincaId = pick(row, ['finca_id', 'Finca ID', 'id', 'ID']);
    const nombre = pick(row, ['nombre', 'Nombre']);
    if (!fincaId || !nombre) return null;

    return {
      finca_id: String(fincaId),
      nombre: String(nombre),
      zona: pick(row, ['zona', 'Zona']),
      municipio: pick(row, ['municipio', 'Municipio']),
      activa: toBool(pick(row, ['activa', 'Activa']), true),
      review_status: String(pick(row, ['review_status', 'Review Status']) || '').trim().toUpperCase(),
      prioridad: toNumber(pick(row, ['prioridad', 'Prioridad']), 999),
      capacidad_max: toNumber(pick(row, ['capacidad_max', 'Capacidad Max', 'capacidad']), null),
      min_noches: toNumber(pick(row, ['min_noches', 'Min Noches']), 1),
      precio_noche_base: toNumber(pick(row, ['precio_noche_base', 'Precio Noche Base']), null),
      precio_fin_semana: toNumber(pick(row, ['precio_fin_semana', 'Precio Fin de Semana']), null),
      deposito_seguridad: toNumber(pick(row, ['deposito_seguridad', 'Deposito Seguridad']), 0),
      precio_persona_extra: toNumber(pick(row, ['precio_persona_extra', 'Precio Persona Extra']), 0),
      pet_friendly: toBool(pick(row, ['pet_friendly', 'Pet Friendly', 'mascotas']), false),
      amenidades: toCsv(pick(row, ['amenidades_csv', 'Amenidades'])),
      tipo_evento: toCsv(pick(row, ['tipo_evento_csv', 'Tipo Evento'])),
      descripcion_corta: pick(row, ['descripcion_corta', 'Descripción Corta', 'Descripcion Corta']),
      foto_url: pick(row, ['foto_url', 'Foto URL']),
      owner_nombre: pick(row, ['owner_nombre', 'Owner Nombre']),
      owner_contacto: pick(row, ['owner_contacto', 'Owner Contacto']),
      descuento_max_pct: toNumber(pick(row, ['descuento_max_pct', 'Descuento Max %']), 0),
      codigo_original: pick(row, ['codigo_original', 'Codigo Original']),
      capacidad_minima_tarifa: toNumber(pick(row, ['capacidad_minima_tarifa']), null),
      precio_festivo: toNumber(pick(row, ['precio_festivo']), null),
      precio_semana_santa_receso: toNumber(pick(row, ['precio_semana_santa_receso']), null),
      precio_temporada_alta: toNumber(pick(row, ['precio_temporada_alta']), null),
      habitaciones: toNumber(pick(row, ['habitaciones', 'Habitaciones']), null),
      empleadas: toNumber(pick(row, ['empleadas', 'Empleadas']), null),
      especificacion_habitaciones: pick(row, ['especificacion_habitaciones']),
      observaciones_originales: pick(row, ['observaciones_originales']),
      caracteristicas_originales: pick(row, ['caracteristicas_originales']),
      administrador_nombre: pick(row, ['administrador_nombre']),
      administrador_contacto: pick(row, ['administrador_contacto']),
      pricing_model: pick(row, ['pricing_model']),
      review_notes: pick(row, ['review_notes']),
    };
  })
  .filter(Boolean)
  .sort((a, b) => {
    if (a.prioridad !== b.prioridad) return a.prioridad - b.prioridad;
    return a.nombre.localeCompare(b.nombre);
  });

const activeInventory = inventory.filter((item) => item.activa && item.review_status === 'READY_FOR_OFFERING');

return [
  {
    json: {
      inventory: activeInventory,
      inventory_meta: {
        access_ok: true,
        error_message: null,
        count: activeInventory.length,
        total_rows: inventory.length,
      },
    },
  },
];`;

const buildInventoryToolResponseCode = String.raw`const payload = $('When inventory tool is called').item.json || {};
const inventory = Array.isArray($json.inventory) ? $json.inventory : [];
const meta = $json.inventory_meta || { access_ok: true, error_message: null, count: inventory.length, total_rows: inventory.length };

const compact = (value) => (value === undefined || value === null ? '' : String(value).trim());
let settings = {};
try {
  settings = $('Get agent settings').item.json || {};
} catch {
  settings = {};
}
const ownerContactOverride = compact(settings.owner_contact_override || settings.ownerContactOverride);

const normalizeText = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const toNumber = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(num) ? num : fallback;
};

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
};

const tokenise = (value) =>
  normalizeText(value)
    .split(/[^a-z0-9]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);

const calculateNights = (start, end) => {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  const diff = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
  return diff > 0 ? diff : null;
};

const nightlyReference = (item, nights) => {
  if (item.precio_noche_base) return item.precio_noche_base;
  if (item.precio_fin_semana && nights) return Math.round(item.precio_fin_semana / Math.max(nights, 2));
  if (item.precio_fin_semana) return Math.round(item.precio_fin_semana / 2);
  return null;
};

const sanitizeListItem = (item, nights) => ({
  finca_id: item.finca_id,
  nombre: item.nombre,
  codigo_original: item.codigo_original,
  zona: item.zona,
  municipio: item.municipio,
  capacidad_max: item.capacidad_max,
  capacidad_minima_tarifa: item.capacidad_minima_tarifa,
  habitaciones: item.habitaciones,
  min_noches: item.min_noches,
  precio_noche_base: item.precio_noche_base,
  precio_fin_semana: item.precio_fin_semana,
  precio_festivo: item.precio_festivo,
  precio_semana_santa_receso: item.precio_semana_santa_receso,
  precio_temporada_alta: item.precio_temporada_alta,
  precio_persona_extra: item.precio_persona_extra,
  precio_referencia_noche: nightlyReference(item, nights),
  pet_friendly: item.pet_friendly,
  amenidades: item.amenidades,
  tipo_evento: item.tipo_evento,
  descripcion_corta: item.descripcion_corta,
  foto_url: item.foto_url,
  owner_nombre: item.owner_nombre,
  descuento_max_pct: item.descuento_max_pct,
  especificacion_habitaciones: item.especificacion_habitaciones,
  observaciones_originales: item.observaciones_originales,
  caracteristicas_originales: item.caracteristicas_originales,
});

const sanitizeDetailItem = (item, nights) => ({
  ...sanitizeListItem(item, nights),
  deposito_seguridad: item.deposito_seguridad,
  owner_contacto: ownerContactOverride || item.owner_contacto,
  empleadas: item.empleadas,
  administrador_nombre: item.administrador_nombre,
  administrador_contacto: item.administrador_contacto,
  pricing_model: item.pricing_model,
  review_notes: item.review_notes,
});

const opInput = normalizeText(payload.operation);
const operation = (() => {
  if (['mostrar_propiedades', 'show_properties', 'buscar_fincas', 'search_fincas', 'list_matching_fincas', 'list'].includes(opInput)) return 'list_matching_fincas';
  if (['pregunta_propiedad', 'property_question', 'finca_question', 'detalle_finca', 'get_finca_details', 'details'].includes(opInput)) return 'get_finca_details';
  if (['contacto_propietario', 'owner_contact', 'get_owner_contact'].includes(opInput)) return 'get_owner_contact';
  return 'list_matching_fincas';
})();

const explicitFincaId = compact(payload.finca_id || payload.selected_finca_id);
const explicitName = compact(payload.nombre || payload.selected_finca_nombre);
const query = compact(payload.query);
const zona = compact(payload.zona || payload.context_zona);
const personas = toNumber(payload.personas || payload.context_personas, null);
const presupuestoMax = toNumber(payload.presupuesto_max || payload.context_presupuesto_max, null);
const nights = calculateNights(payload.context_fecha_inicio, payload.context_fecha_fin);
const defaultLimit = Math.max(1, Math.min(10, toNumber(settings.max_properties_to_show || settings.maxPropertiesToShow, 3) || 3));
const limit = Math.max(1, Math.min(10, toNumber(payload.limit, defaultLimit) || defaultLimit));
const shownFincas = new Set(parseJsonArray(payload.shown_fincas_json).map((item) => String(item)));
const tokens = tokenise([query, explicitName, explicitFincaId, zona].filter(Boolean).join(' '));

const zoneMatches = (item) => {
  if (!zona) return true;
  const normalizedZona = normalizeText(zona);
  return (
    normalizeText(item.zona).includes(normalizedZona) ||
    normalizeText(item.municipio).includes(normalizedZona)
  );
};

const scoreItem = (item, strict) => {
  let score = 0;
  if (explicitFincaId && normalizeText(item.finca_id) === normalizeText(explicitFincaId)) score += 1000;
  if (explicitName && normalizeText(item.nombre).includes(normalizeText(explicitName))) score += 280;
  if (zona) {
    if (zoneMatches(item)) score += strict ? 160 : 120;
    else score -= strict ? 600 : 120;
  }
  if (personas !== null && item.capacidad_max !== null) {
    if (item.capacidad_max >= personas) {
      score += 90;
      score -= Math.max(0, item.capacidad_max - personas) * 0.5;
    } else {
      score -= strict ? 800 : 180;
    }
  }
  if (nights !== null && item.min_noches !== null) {
    if (item.min_noches <= nights) score += 20;
    else score -= strict ? 120 : 40;
  }
  if (presupuestoMax !== null) {
    const refPrice = nightlyReference(item, nights);
    if (refPrice !== null) {
      const delta = Math.abs(refPrice - presupuestoMax);
      const deltaRatio = presupuestoMax > 0 ? delta / presupuestoMax : 0;
      score += Math.max(0, 90 - deltaRatio * 110);
      if (refPrice <= presupuestoMax) score += 25;
      else score -= Math.min(50, deltaRatio * 70);
    }
  }
  if (tokens.length) {
    const haystack = normalizeText([
      item.finca_id,
      item.nombre,
      item.codigo_original,
      item.zona,
      item.municipio,
      item.descripcion_corta,
      item.observaciones_originales,
      item.caracteristicas_originales,
      (item.amenidades || []).join(' '),
      (item.tipo_evento || []).join(' '),
    ].filter(Boolean).join(' '));
    for (const token of tokens) {
      if (haystack.includes(token)) score += 16;
    }
  }
  score -= Number(item.prioridad || 999) / 1000;
  return score;
};

const ranked = (items, strict) =>
  items
    .map((item) => ({ item, score: scoreItem(item, strict) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(a.item.prioridad || 999) - Number(b.item.prioridad || 999) ||
        String(a.item.nombre).localeCompare(String(b.item.nombre)),
    )
    .map(({ item }) => item);

const strictCandidates = inventory.filter((item) => {
  if (!zoneMatches(item)) return false;
  if (personas !== null && item.capacidad_max !== null && item.capacidad_max < personas) return false;
  return true;
});

const similarCandidates = inventory.filter((item) => {
  if (shownFincas.has(String(item.finca_id))) return false;
  if (zona && !zoneMatches(item) && personas !== null && item.capacidad_max !== null && item.capacidad_max < personas) {
    return false;
  }
  return true;
});

const strictRanked = ranked(strictCandidates, true).filter((item) => !shownFincas.has(String(item.finca_id)));
const similarRanked = ranked(similarCandidates, false).filter((item) => !shownFincas.has(String(item.finca_id)));

const buildErrorResponse = () => [
  {
    json: {
      operation,
      error: true,
      matched_count: 0,
      items: [],
      similar_items: [],
      selected_finca: null,
      owner: null,
      search_applied: {
        zona,
        personas,
        presupuesto_max: presupuestoMax,
        nights,
        query,
        excluded_finca_ids: Array.from(shownFincas),
      },
      notes: meta.error_message || 'inventory_access_error',
    },
  },
];

if (meta.access_ok === false) {
  return buildErrorResponse();
}

const findBestMatch = () => {
  if (!inventory.length) return null;
  if (explicitFincaId) {
    const exact = inventory.find((item) => normalizeText(item.finca_id) === normalizeText(explicitFincaId));
    if (exact) return exact;
  }
  return ranked(inventory, false)[0] || null;
};

if (operation === 'list_matching_fincas') {
  const exactItems = strictRanked.slice(0, limit).map((item) => sanitizeListItem(item, nights));
  const similarItems = (strictRanked.length ? strictRanked.slice(limit) : similarRanked)
    .slice(0, limit)
    .map((item) => sanitizeListItem(item, nights));

  return [
    {
      json: {
        error: false,
        operation,
        matched_count: exactItems.length,
        items: exactItems,
        similar_items: exactItems.length ? [] : similarItems,
        selected_finca: null,
        owner: null,
        search_applied: {
          zona,
          personas,
          presupuesto_max: presupuestoMax,
          nights,
          query,
          excluded_finca_ids: Array.from(shownFincas),
        },
        notes: exactItems.length ? null : similarItems.length ? 'no_exact_match_but_similar' : 'no_match',
      },
    },
  ];
}

const bestMatch = findBestMatch();

if (operation === 'get_owner_contact') {
  return [
    {
      json: {
        error: false,
        operation,
        matched_count: bestMatch ? 1 : 0,
        items: [],
        similar_items: [],
        selected_finca: bestMatch ? sanitizeDetailItem(bestMatch, nights) : null,
        owner: bestMatch
          ? {
              finca_id: bestMatch.finca_id,
              nombre: bestMatch.nombre,
              owner_nombre: bestMatch.owner_nombre,
              owner_contacto: ownerContactOverride || bestMatch.owner_contacto,
            }
          : null,
        search_applied: {
          finca_id: explicitFincaId || null,
          nombre: explicitName || null,
          query,
        },
        notes: bestMatch ? null : 'owner_contact_not_found',
      },
    },
  ];
}

return [
  {
    json: {
      error: false,
      operation: 'get_finca_details',
      matched_count: bestMatch ? 1 : 0,
      items: [],
      similar_items: [],
      selected_finca: bestMatch ? sanitizeDetailItem(bestMatch, nights) : null,
      owner: null,
      search_applied: {
        finca_id: explicitFincaId || null,
        nombre: explicitName || null,
        query,
      },
      notes: bestMatch ? null : 'finca_not_found',
    },
  },
];`;

const codeNodeJs = String.raw`function stripCodeFences(str) {
  if (!str) return '';
  return String(str)
    .trim()
    .replace(/^\s*\`\`\`json\s*/i, '')
    .replace(/^\s*\`\`\`\s*/i, '')
    .replace(/\s*\`\`\`\s*$/i, '')
    .trim();
}

function extractFirstJsonObject(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
    } else {
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }

  return null;
}

function escapeControlCharsInsideStrings(jsonLike) {
  const s = String(jsonLike || '');
  let out = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = ch.charCodeAt(0);

    if (inString) {
      if (escape) {
        out += ch;
        escape = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escape = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      if (ch === '\r') {
        out += '\\r';
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        continue;
      }
      if (code >= 0x00 && code <= 0x1f) {
        out += '\\u' + code.toString(16).padStart(4, '0');
        continue;
      }
    }

    if (ch === '"') inString = true;
    out += ch;
  }

  return out;
}

function safeParse(text) {
  if (text == null) return null;
  const cleaned = escapeControlCharsInsideStrings(String(text).trim());
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const obj = extractFirstJsonObject(cleaned);
    if (!obj) return { _raw: cleaned.slice(0, 4000), _parse_error: error.message };
    try {
      return JSON.parse(obj);
    } catch (innerError) {
      return { _raw: cleaned.slice(0, 4000), _parse_error: innerError.message };
    }
  }
}

function parseToolOutput(parsed) {
  const toolOutput = parsed?.tool_output;
  if (!toolOutput || typeof toolOutput !== 'object') return null;

  let rawResult = null;

  if (typeof toolOutput.result === 'string') {
    rawResult = toolOutput.result;
  } else {
    const firstKey = Object.keys(toolOutput)[0];
    if (firstKey && toolOutput[firstKey] && typeof toolOutput[firstKey].result === 'string') {
      rawResult = toolOutput[firstKey].result;
    }
  }

  if (!rawResult) return toolOutput;

  const firstPass = safeParse(rawResult);
  if (Array.isArray(firstPass) && firstPass[0]?.output) {
    return safeParse(stripCodeFences(firstPass[0].output));
  }
  return firstPass;
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined || value === '') return false;
  return ['true', '1', 'yes', 'si', 'sí'].includes(String(value).trim().toLowerCase());
}

function compactCriteria(source = {}) {
  const out = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    out[key] = value;
  }
  return out;
}

function normalizePostActions(parsed, toolOutput) {
  const raw = parsed?.post_actions && typeof parsed.post_actions === 'object' ? { ...parsed.post_actions } : {};
  const tool = parsed?.tool_chosen || 'NONE';
  const intent = toolOutput?.intent || null;

  if (tool === 'qualifying_agent') {
    const extraidos = compactCriteria(toolOutput?.datos_extraidos || {});
    if (Object.keys(extraidos).length && !raw.search_criteria) raw.search_criteria = extraidos;
    if (toolOutput?.datos_completos === true && !raw.state_transition) raw.state_transition = 'OFFERING';
    if (toolOutput?.datos_completos === true && !raw.waiting_for) raw.waiting_for = 'CLIENT';
  }

  if (tool === 'offering_agent') {
    if (Array.isArray(toolOutput?.fincas_mostradas) && !raw.shown_fincas) {
      raw.shown_fincas = toolOutput.fincas_mostradas
        .map((item) => item?.finca_id || item?.id || null)
        .filter(Boolean);
    }
    if (toolOutput?.search_criteria_update && !raw.search_criteria) raw.search_criteria = compactCriteria(toolOutput.search_criteria_update);
    if (toolOutput?.intent === 'CLIENT_CHOSE') {
      raw.state_transition ||= 'VERIFYING_AVAILABILITY';
      raw.selected_finca_id ||= toolOutput.finca_elegida_id || toolOutput.selected_finca?.finca_id || '__IGNORE__';
      raw.selected_finca ||= toolOutput.selected_finca || '__IGNORE__';
      raw.waiting_for ||= 'OWNER';
    }
  }

  if (tool === 'verifying_availability_agent' && intent === 'CHANGE_FINCA') {
    raw.state_transition ||= 'OFFERING';
    raw.waiting_for ||= 'CLIENT';
    raw.selected_finca_id ||= '__CLEAR__';
    raw.selected_finca ||= '__CLEAR__';
  }

  if ((parsed?.action === 'HITL' || intent === 'HITL_REQUEST') && raw.agente_activo === undefined) {
    raw.agente_activo = false;
  }

  if (parsed?.action === 'NOOP_BOT_DISABLED' && raw.agente_activo === undefined) {
    raw.agente_activo = false;
  }

  const normalized = {
    state_transition:
      typeof raw.state_transition === 'string' && raw.state_transition.trim()
        ? raw.state_transition
        : '__IGNORE__',
    search_criteria:
      raw.search_criteria && typeof raw.search_criteria === 'object'
        ? compactCriteria(raw.search_criteria)
        : '__IGNORE__',
    waiting_for:
      typeof raw.waiting_for === 'string' && raw.waiting_for.trim() ? raw.waiting_for : '__IGNORE__',
    agente_activo:
      typeof raw.agente_activo === 'boolean' ? raw.agente_activo : '__IGNORE__',
    shown_fincas: Array.isArray(raw.shown_fincas) ? raw.shown_fincas : '__IGNORE__',
    selected_finca_id:
      raw.selected_finca_id === '__CLEAR__'
        ? '__CLEAR__'
        : typeof raw.selected_finca_id === 'string' && raw.selected_finca_id.trim()
          ? raw.selected_finca_id
          : '__IGNORE__',
    selected_finca:
      raw.selected_finca === '__CLEAR__'
        ? '__CLEAR__'
        : raw.selected_finca && typeof raw.selected_finca === 'object'
          ? raw.selected_finca
          : '__IGNORE__',
    owner_response:
      raw.owner_response === '__CLEAR__'
        ? '__CLEAR__'
        : raw.owner_response && typeof raw.owner_response === 'object'
          ? raw.owner_response
          : '__IGNORE__',
    pricing:
      raw.pricing && typeof raw.pricing === 'object' && !Array.isArray(raw.pricing) ? raw.pricing : '__IGNORE__',
    extras:
      raw.extras && typeof raw.extras === 'object' && !Array.isArray(raw.extras) ? raw.extras : '__IGNORE__',
  };

  if (normalized.search_criteria !== '__IGNORE__' && Object.keys(normalized.search_criteria).length === 0) {
    normalized.search_criteria = '__IGNORE__';
  }

  return normalized;
}

function getRawOutput(itemJson) {
  if (typeof itemJson?.output === 'string') return itemJson.output;
  if (Array.isArray(itemJson?.output) && typeof itemJson.output[0]?.output === 'string') return itemJson.output[0].output;
  return null;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function parseUrls(value) {
  const matches = String(value || '').match(/https?:\/\/[^\s,]+/g);
  return Array.from(new Set(matches || []));
}

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(amount);
}

function numberFromText(value, pattern) {
  const match = String(value || '').match(pattern);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueLines(values = []) {
  const seen = new Set();
  const lines = [];
  for (const value of values) {
    const normalized = slugify(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    lines.push(String(value).trim());
  }
  return lines;
}

function amenityLabel(rawValue) {
  const value = slugify(rawValue);
  const map = [
    { pattern: /piscina/, label: 'Piscina 🏊' },
    { pattern: /jacuzzi/, label: 'Jacuzzi 🛁' },
    { pattern: /kiosko|quiosco/, label: 'Kiosko 🔝' },
    { pattern: /tejo/, label: 'Cancha de tejo 🎯' },
    { pattern: /micro futbol|microfutbol|futbol/, label: 'Cancha de micro fútbol ⚽️' },
    { pattern: /ping pong/, label: 'Mesa de ping pong 🏓' },
    { pattern: /billar|pool|mini mesa de billar/, label: 'Mesa de billar 🎱' },
    { pattern: /rana/, label: 'Rana 🐸' },
    { pattern: /bbq/, label: 'BBQ ♨️' },
    { pattern: /zonas verdes|zona verde/, label: 'Zonas verdes 🌴' },
    { pattern: /wifi|wi fi/, label: 'Wifi 🛜' },
    { pattern: /golf/, label: 'Golf ⛳️' },
    { pattern: /tenis/, label: 'Tenis 🎾' },
    { pattern: /parqueadero/, label: 'Parqueadero 🚗' },
    { pattern: /pet friendly|mascotas/, label: 'Pet friendly 🐶' },
    { pattern: /empleada/, label: 'Servicio de empleada 👩‍🍳' },
  ];

  const matched = map.find((item) => item.pattern.test(value));
  if (matched) return matched.label;
  if (!value) return null;
  return titleCase(rawValue);
}

function buildHighlightLines(finca) {
  const combinedText = [
    finca.descripcion_corta,
    finca.observaciones_originales,
    finca.caracteristicas_originales,
    finca.especificacion_habitaciones,
  ]
    .filter(Boolean)
    .join('\n');

  const lines = [];

  if (finca.habitaciones) {
    lines.push(String(finca.habitaciones) + ' habitaciones 🍃');
  } else {
    const habitaciones = numberFromText(combinedText, /(\d+)\s+habitaciones?/i);
    if (habitaciones) lines.push(String(habitaciones) + ' habitaciones 🍃');
  }

  const banos = numberFromText(combinedText, /(\d+)\s+bañ?os?/i);
  if (banos) lines.push(String(banos) + ' baños 🚻');

  const amenidades = Array.isArray(finca.amenidades) ? finca.amenidades : [];
  for (const amenidad of amenidades) {
    const label = amenityLabel(amenidad);
    if (label) lines.push(label);
  }

  if (finca.capacidad_max) {
    lines.push('Capacidad máxima ' + String(finca.capacidad_max) + ' personas 👥');
  }

  if (finca.municipio || finca.zona) {
    const locationLabel =
      finca.municipio && finca.zona && slugify(finca.municipio) !== slugify(finca.zona)
        ? 'Ubicada en ' + String(finca.municipio) + ', ' + String(finca.zona)
        : 'Ubicada en ' + String(finca.municipio || finca.zona);
    lines.push(locationLabel);
  }

  return uniqueLines(lines);
}

function buildTarifaLine(finca) {
  if (finca.precio_noche_base) {
    return 'Tarifa: ' + formatCurrency(finca.precio_noche_base) + '/noche';
  }
  if (finca.precio_fin_semana) {
    return 'Tarifa: ' + formatCurrency(finca.precio_fin_semana) + '/fin de semana';
  }
  if (finca.precio_referencia_noche) {
    return 'Tarifa: ' + formatCurrency(finca.precio_referencia_noche) + '/noche';
  }
  return null;
}

function buildFincaCard(finca) {
  if (!finca || typeof finca !== 'object') return null;
  const title = String(finca.nombre || finca.finca_id || 'Finca').trim();
  const code = String(finca.codigo_original || finca.finca_id || '').trim();
  const highlights = buildHighlightLines(finca);
  const tarifa = buildTarifaLine(finca);
  const parts = [
    '☀️🌴*' + title + '*🌴☀️',
    code || null,
    null,
    ...highlights.map((line) => '- ' + line),
    tarifa,
  ].filter((value) => value !== null && value !== undefined && String(value).trim() !== '');
  return parts.join('\n');
}

function buildMediaMessages(finca) {
  const urls = parseUrls(finca?.foto_url);
  if (!urls.length) return [];
  const title = finca?.nombre || finca?.finca_id || 'la finca';
  return urls.map((url) => ({
    type: 'text',
    content: 'Fotos y/o video de ' + title + ':\n' + url,
    media_url: url,
  }));
}

function createTextMessage(content, extra = {}) {
  const text = String(content || '').trim();
  if (!text) return null;
  return {
    type: 'text',
    content: text,
    media_url: extra.media_url || null,
  };
}

function buildPropertySequence(tool, toolOutputParsed, finalWhatsappText) {
  const intent = toolOutputParsed?.intent || null;
  const selectedFinca = toolOutputParsed?.selected_finca && typeof toolOutputParsed.selected_finca === 'object'
    ? toolOutputParsed.selected_finca
    : null;
  const fincasMostradas = Array.isArray(toolOutputParsed?.fincas_mostradas)
    ? toolOutputParsed.fincas_mostradas.filter((item) => item && typeof item === 'object')
    : [];

  const sequence = [];

  if (tool === 'offering_agent' && intent === 'SHOW_OPTIONS' && fincasMostradas.length) {
    const intro = createTextMessage(finalWhatsappText);
    if (intro) sequence.push(intro);
    for (const finca of fincasMostradas) {
      sequence.push(...buildMediaMessages(finca));
      const card = buildFincaCard(finca);
      const cardMessage = createTextMessage(card);
      if (cardMessage) sequence.push(cardMessage);
    }
    return sequence;
  }

  if (selectedFinca && ['offering_agent', 'verifying_availability_agent', 'qa_agent'].includes(tool)) {
    const intro = createTextMessage(finalWhatsappText);
    if (intro) sequence.push(intro);
    sequence.push(...buildMediaMessages(selectedFinca));
    const card = buildFincaCard(selectedFinca);
    const cardMessage = createTextMessage(card);
    if (cardMessage) sequence.push(cardMessage);
    return sequence;
  }

  return [];
}

const item = $input.first();
const rawOutput = getRawOutput(item.json);
const parsed = safeParse(stripCodeFences(rawOutput || ''));
const toolOutputParsed = parseToolOutput(parsed);
const normalizedPostActions = normalizePostActions(parsed, toolOutputParsed);
const action = parsed?.action || 'RUN_TOOL';
const toolChosen = parsed?.tool_chosen || 'NONE';
const currentState = $('Get Context-conversations1').item.json.current_state || null;
const requestedStateTransition = normalizedPostActions.state_transition;
const stateActuallyChanged =
  requestedStateTransition !== '__IGNORE__' &&
  requestedStateTransition !== currentState;
const currentStateChanged =
  parsed?.current_state_changed === true ||
  normalizeBoolean(parsed?.current_state_changed) ||
  stateActuallyChanged;

const handoffText = $('config').item.json.handoff_message || 'Te voy a pasar con un asesor humano para continuar con tu solicitud.';
const rawFinalWhatsappText =
  parsed?.final_whatsapp_text ||
  toolOutputParsed?.respuesta ||
  (action === 'HITL' ? handoffText : null);

const propertySequence = buildPropertySequence(toolChosen, toolOutputParsed, rawFinalWhatsappText);
const fallbackSequence = propertySequence.length
  ? propertySequence
  : [createTextMessage(rawFinalWhatsappText)].filter(Boolean);
const outboundSequence = fallbackSequence.filter(Boolean);
const primaryOutboundMessage = outboundSequence.at(-1)?.content || rawFinalWhatsappText || null;
const hasCustomerFacingMessage = Boolean(String(primaryOutboundMessage || '').trim());
const shouldImmediateLoop = currentStateChanged && !hasCustomerFacingMessage;

return [
  {
    json: {
      parsed,
      tool_output_parsed: toolOutputParsed,
      normalized_post_actions: normalizedPostActions,
      final_whatsapp_text: primaryOutboundMessage,
      outbound_message: primaryOutboundMessage,
      outbound_sequence: outboundSequence,
      outbound_sequence_json: JSON.stringify(outboundSequence),
      current_state_changed: currentStateChanged,
      should_immediate_loop: shouldImmediateLoop,
      tool_chosen: toolChosen,
      action,
      chatwoot_id:
        $('Get Context-conversations1').item.json.chatwoot_id || $('Merge Sets1').item.json.chatwoot_id || null,
      conversation_key:
        parsed?.tool_input?.context?.conversation?.id || $('Merge Sets1').item.json.conversation_key,
    },
  },
];`;

const outboundInsertQuery = String.raw`with payload as (
  select
    {{ "'" + String($('Merge Sets1').item.json.conversation_key).replace(/'/g, "''") + "'" }}::text as conversation_id,
    {{ "'" + String($('actualizar contexto1').item.json.current_state || '').replace(/'/g, "''") + "'" }}::text as current_state,
    {{ "'" + String($('Code in JavaScript1').item.json.tool_chosen || 'NONE').replace(/'/g, "''") + "'" }}::text as agent_used,
    {{ "'" + JSON.stringify($('Code in JavaScript1').item.json.tool_output_parsed?.datos_extraidos || {}).replace(/'/g, "''") + "'" }}::jsonb as extracted_data,
    {{ "'" + JSON.stringify($('Code in JavaScript1').item.json.outbound_sequence || []).replace(/'/g, "''") + "'" }}::jsonb as outbound_sequence
),
inserted_messages as (
  insert into public.messages (
    conversation_id,
    direction,
    message_type,
    content,
    media_url,
    state_at_time,
    agent_used,
    extracted_data,
    created_at
  )
  select
    payload.conversation_id,
    'OUTBOUND',
    'TEXT',
    message.value->>'content',
    nullif(message.value->>'media_url', ''),
    nullif(payload.current_state, ''),
    payload.agent_used,
    payload.extracted_data,
    now() + ((message.ordinality - 1) * interval '1 second')
  from payload
  cross join lateral jsonb_array_elements(payload.outbound_sequence) with ordinality as message(value, ordinality)
  where nullif(trim(coalesce(message.value->>'content', '')), '') is not null
  returning id
)
update public.conversations
set
  last_interaction = now(),
  last_message_from = 'AGENT',
  updated_at = now()
where wa_id = {{ "'" + String($('Merge Sets1').item.json.conversation_key).replace(/'/g, "''") + "'" }}
returning wa_id;`;

const offeringSystemMessage = String.raw`=Eres el agente del estado OFFERING del sistema "De Paseo en Finca".

OBJETIVO
- Presentar hasta 3 fincas relevantes.
- Capturar si el cliente elige una finca.
- Permitir ajuste de criterios sin romper el flujo.

REGLAS
- Si necesitas confirmar la fecha actual o interpretar referencias temporales del cliente, usa current_datetime_tool.
{{ $('config').item.json.tono }}
- Nunca inventes fincas.
- Debes consultar inventory_reader_tool antes de proponer opciones.
- Si owner_unavailable = true o context.owner_response.disponible = false, primero informa que la opcion anterior no estaba disponible y luego muestra alternativas.
- Si inventory_reader_tool responde error = true, devuelve intent = "HITL_REQUEST" porque hubo un problema real accediendo al inventario.
- Si no hay coincidencias exactas pero sí similar_items, aclara que no encontraste match exacto y muestra esas alternativas similares.
- Si no hay coincidencias exactas ni similares, dilo con claridad y propone ajustar criterios.
- Si el cliente solo pregunta algo puntual de una finca, puedes consultar operation="get_finca_details" y luego seguir pidiendo eleccion.
- Cuando muestres opciones, fincas_mostradas debe incluir objetos reales del tool con suficiente detalle para que el sistema formatee la ficha de la finca.
- Cuando el cliente elija una finca, selected_finca debe ser el objeto completo de esa finca, no solo el id.

OUTPUT
Responde EXCLUSIVAMENTE en JSON valido con este schema:
{
  "respuesta": "texto para el cliente",
  "intent": "SHOW_OPTIONS | CLIENT_CHOSE | ADJUST_CRITERIA | NO_MATCH | QUESTION | HITL_REQUEST | CANCEL",
  "finca_elegida_id": null | "string",
  "selected_finca": null | {
    "finca_id": "string",
    "nombre": "string",
    "codigo_original": "string",
    "zona": "string",
    "municipio": "string",
    "capacidad_max": number,
    "habitaciones": number,
    "precio_noche_base": number,
    "precio_fin_semana": number,
    "amenidades": [],
    "descripcion_corta": "string",
    "foto_url": "string",
    "observaciones_originales": "string",
    "caracteristicas_originales": "string"
  },
  "fincas_mostradas": [
    {
      "finca_id": "string",
      "nombre": "string",
      "codigo_original": "string",
      "zona": "string",
      "municipio": "string",
      "capacidad_max": number,
      "habitaciones": number,
      "precio_noche_base": number,
      "precio_fin_semana": number,
      "amenidades": [],
      "descripcion_corta": "string",
      "foto_url": "string",
      "observaciones_originales": "string",
      "caracteristicas_originales": "string"
    }
  ],
  "search_criteria_update": {}
}`;

const qaSystemMessage = String.raw`=Eres el agente QA flotante del sistema comercial.

OBJETIVO
- Responder preguntas puntuales sobre fincas, amenidades, mascotas, parqueadero, horarios o proceso.
- No cambies el estado de la conversacion.
- Tu respuesta debe retomar el hilo comercial al final.

REGLAS
- Si la respuesta depende de la fecha u hora actual, consulta current_datetime_tool en vez de asumirla.
{{ $('config').item.json.tono }}
- Usa inventory_reader_tool solo cuando la pregunta dependa del inventario real.
- Si inventory_reader_tool devuelve error = true, responde con intent = "HITL_REQUEST".
- Si el dato no aparece en inventory_reader_tool o context, dilo y ofrece ayuda parcial.
- Si la respuesta trata sobre una finca concreta y ya tienes el objeto del inventario, inclúyelo en selected_finca para que el sistema pueda formatear la ficha.

OUTPUT
Devuelve EXCLUSIVAMENTE JSON valido:
{
  "respuesta": "texto para el cliente",
  "intent": "QA_ANSWERED",
  "selected_finca": null | {
    "finca_id": "string",
    "nombre": "string",
    "codigo_original": "string",
    "zona": "string",
    "municipio": "string",
    "capacidad_max": number,
    "habitaciones": number,
    "precio_noche_base": number,
    "precio_fin_semana": number,
    "amenidades": [],
    "descripcion_corta": "string",
    "foto_url": "string",
    "observaciones_originales": "string",
    "caracteristicas_originales": "string"
  },
  "search_criteria_update": {}
}`;

const verifyingSystemMessage = String.raw`=Eres el agente del estado VERIFYING_AVAILABILITY.

OBJETIVO
- Informar que estas validando con el propietario.
- Mantener al cliente contenido sin prometer disponibilidad.
- Permitir cambio de finca si el cliente lo pide.

REGLAS
- Si necesitas saber la fecha u hora actual para contextualizar tu respuesta, usa current_datetime_tool.
{{ $('config').item.json.tono }}
- Nunca confirmes disponibilidad sin owner_response.disponible = true.
- No hables de pagos, anticipo, reservas ni cierres comerciales en esta fase.
- Si el cliente pide otra finca, marca CHANGE_FINCA.
- Si hace una pregunta simple sobre la finca elegida, puedes usar inventory_reader_tool con operation="get_finca_details".
- Si la tarea correcta es recuperar el numero de contacto del propietario, usa inventory_reader_tool con operation="get_owner_contact".
- Si inventory_reader_tool devuelve error = true, responde con intent = "HITL_REQUEST".
- Si ya se confirmó disponibilidad, el handoff a humano lo resuelve el orquestador, no tú.
- Si respondes sobre una finca concreta y tienes el objeto real del inventario, inclúyelo en selected_finca.

OUTPUT
Devuelve EXCLUSIVAMENTE JSON valido:
{
  "respuesta": "texto para el cliente",
  "intent": "WAITING_OWNER | CHANGE_FINCA | QUESTION | HITL_REQUEST | CANCEL",
  "finca_elegida_id": null | "string",
  "selected_finca": null | {
    "finca_id": "string",
    "nombre": "string",
    "codigo_original": "string",
    "zona": "string",
    "municipio": "string",
    "capacidad_max": number,
    "habitaciones": number,
    "precio_noche_base": number,
    "precio_fin_semana": number,
    "amenidades": [],
    "descripcion_corta": "string",
    "foto_url": "string",
    "observaciones_originales": "string",
    "caracteristicas_originales": "string"
  }
}`;

const senderExpandNode = {
  parameters: {
    jsCode: String.raw`const parseSequence = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const input = $('When outbound sender is called').item.json || {};
const sequence = parseSequence(input.outbound_sequence_json || input.outbound_sequence);
const messages = sequence.length
  ? sequence
      .map((item) => ({
        content: String(item?.content || '').trim(),
        private: item?.private === true || input.private === true,
      }))
      .filter((item) => item.content)
  : [
      {
        content: String(input.message || input.outbound_message || input.final_whatsapp_text || '').trim(),
        private: input.private === true,
      },
    ].filter((item) => item.content);

return messages.map((message, index) => ({
  json: {
    chatwoot_id: input.chatwoot_id,
    chatwoot_account_id: input.chatwoot_account_id || '1',
    chatwoot_api_token: input.chatwoot_api_token || null,
    message: message.content,
    private: message.private,
    sequence_index: index,
    sequence_count: messages.length,
  },
}));`,
  },
  id: 'c53dfadb-f12e-4b91-b254-c4f9c25df908',
  name: 'Expand outbound sequence',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [392, 240],
};

function patchMainWorkflow(workflow) {
  findNode(workflow, 'Normalize Inventory').parameters.jsCode = normalizeInventoryCode;
  findNode(workflow, 'Build Inventory Tool Response').parameters.jsCode = buildInventoryToolResponseCode;
  findNode(workflow, 'Code in JavaScript1').parameters.jsCode = codeNodeJs;
  findNode(workflow, 'Insert OUTBOUND message (messages)').parameters.query = outboundInsertQuery;
  findNode(workflow, 'offering_agent').parameters.options.systemMessage = offeringSystemMessage;
  findNode(workflow, 'qa_agent').parameters.options.systemMessage = qaSystemMessage;
  findNode(workflow, 'verifying_availability_agent').parameters.options.systemMessage = verifyingSystemMessage;

  const engineResult = findNode(workflow, 'Engine Result');
  const assignments = engineResult.parameters.assignments.assignments;
  const existing = assignments.find((item) => item.name === 'outbound_sequence_json');
  if (existing) {
    existing.value = "={{ $('Code in JavaScript1').item.json.outbound_sequence_json || '[]' }}";
    existing.type = 'string';
  } else {
    assignments.push({
      id: '85c08fb1-c850-4738-853d-6a54ba6324a4',
      name: 'outbound_sequence_json',
      value: "={{ $('Code in JavaScript1').item.json.outbound_sequence_json || '[]' }}",
      type: 'string',
    });
  }

  const sendNode = findNode(workflow, 'Send outbound via Chatwoot');
  const schema = sendNode.parameters.workflowInputs.schema;
  const sequenceField = schema.find((item) => item.displayName === 'outbound_sequence_json');
  if (sequenceField) {
    sequenceField.stringValue = "={{ $json.outbound_sequence_json || '[]' }}";
  } else {
    schema.push({
      id: '7f125067-d965-43f4-91ad-6f23e7cfbd54',
      displayName: 'outbound_sequence_json',
      required: false,
      defaultMatch: false,
      display: true,
      canBeUsedToMatch: true,
      type: 'string',
      removed: false,
      stringValue: "={{ $json.outbound_sequence_json || '[]' }}",
    });
  }
}

function patchOutboundWorkflow(workflow) {
  const trigger = findNode(workflow, 'When outbound sender is called');
  const send = findNode(workflow, 'Send Chatwoot message');
  const result = findNode(workflow, 'Outbound send result');

  workflow.nodes = workflow.nodes.filter((node) => node.name !== 'Expand outbound sequence');
  workflow.nodes.push(senderExpandNode);

  workflow.connections['When outbound sender is called'] = {
    main: [[{ node: 'Expand outbound sequence', type: 'main', index: 0 }]],
  };
  workflow.connections['Expand outbound sequence'] = {
    main: [[{ node: 'Send Chatwoot message', type: 'main', index: 0 }]],
  };

  send.parameters.url =
    "={{ (\"https://chatwoot-9qe1j-u48275.vm.elestio.app\").replace(/\\/$/, '') + '/api/v1/accounts/' + String($json.chatwoot_account_id || \"1\") + '/conversations/' + String($json.chatwoot_id) + '/messages' }}";
  send.parameters.headerParameters.parameters[0].value = "={{ $json.chatwoot_api_token || \"7paF3kLsjSEPvXqgHPEgPTEq\" }}";
  send.parameters.jsonBody =
    "={{ JSON.stringify({ content: String($json.message || '').trim(), message_type: 'outgoing', private: $json.private === true }) }}";

  result.parameters.assignments.assignments = [
    {
      id: '5d2a7d75-a120-4a61-a927-a2ded8a30db1',
      name: 'ok',
      value: true,
      type: 'boolean',
    },
    {
      id: 'bf57433f-a321-45a9-bc7c-2ce462c038e0',
      name: 'chatwoot_id',
      value: "={{ $('When outbound sender is called').item.json.chatwoot_id }}",
      type: 'string',
    },
    {
      id: '3d398841-06fe-486a-84af-621ffe1556ac',
      name: 'message',
      value: "={{ $json.message }}",
      type: 'string',
    },
    {
      id: 'b4679fb9-e8f7-4d9f-ac2d-d07ef56f3d9f',
      name: 'sequence_index',
      value: '={{ $json.sequence_index }}',
      type: 'number',
    },
    {
      id: '0d5afb47-3685-4749-911a-fee1bc62cda1',
      name: 'response',
      value: '={{ $json }}',
      type: 'object',
    },
  ];

  void trigger;
}

const updatedMain = await patchWorkflow(MAIN_WORKFLOW_ID, patchMainWorkflow);
const updatedOutbound = await patchWorkflow(OUTBOUND_WORKFLOW_ID, patchOutboundWorkflow);

await fs.writeFile(path.resolve('current_workflow.json'), JSON.stringify(updatedMain, null, 2));
await fs.writeFile(path.resolve('chatwoot_outbound_sender_workflow.json'), JSON.stringify(updatedOutbound, null, 2));

console.log(
  JSON.stringify(
    {
      mainWorkflowId: updatedMain.id,
      mainVersionId: updatedMain.versionId,
      outboundWorkflowId: updatedOutbound.id,
      outboundVersionId: updatedOutbound.versionId,
    },
    null,
    2,
  ),
);
