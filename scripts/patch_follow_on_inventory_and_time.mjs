import fs from 'node:fs/promises';
import path from 'node:path';

import dotenv from 'dotenv';

dotenv.config({ path: path.resolve('.env') });

const WORKFLOW_ID = process.argv[2] || 'RrIniaNJCUC72nfI';
const SCHEDULER_WORKFLOW_NAME = 'Follow on scheduler';
const N8N_BASE_URL = process.env.N8N_BASE_URL;
const N8N_API_KEY = process.env.N8N_PUBLIC_API_TOKEN;
const INVENTORY_DOCUMENT_ID = process.env.INVENTORY_SHEET_DOCUMENT_ID || '1AHeDsZin_U5ZzfAB50i7JZvOoJcP9uAM71RRZgnDlgo';
const INVENTORY_TAB_NAME = process.env.INVENTORY_SHEET_TAB_NAME || 'fincas_inventory_ajustada_real';

if (!N8N_BASE_URL || !N8N_API_KEY) {
  throw new Error('Missing N8N_BASE_URL or N8N_PUBLIC_API_TOKEN in .env');
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

function findNode(workflow, name) {
  return workflow.nodes.find((node) => node.name === name);
}

function removeNode(workflow, name) {
  workflow.nodes = workflow.nodes.filter((node) => node.name !== name);
  delete workflow.connections[name];

  for (const key of Object.keys(workflow.connections)) {
    const bucket = workflow.connections[key];
    for (const type of Object.keys(bucket || {})) {
      bucket[type] = (bucket[type] || []).map((group) =>
        (group || []).filter((edge) => edge.node !== name),
      );
    }
  }
}

function ensureConnectionBucket(connections, nodeName, type) {
  if (!connections[nodeName]) connections[nodeName] = {};
  if (!connections[nodeName][type]) connections[nodeName][type] = [[]];
  if (!Array.isArray(connections[nodeName][type][0])) {
    connections[nodeName][type] = [[]];
  }
  return connections[nodeName][type][0];
}

function replaceMainConnection(connections, sourceNodeName, targetNodeName) {
  connections[sourceNodeName] = {
    ...(connections[sourceNodeName] || {}),
    main: [[{ node: targetNodeName, type: 'main', index: 0 }]],
  };
}

function setToolTargets(connections, toolName, targetNames) {
  connections[toolName] = {
    ...(connections[toolName] || {}),
    ai_tool: [
      targetNames.map((node) => ({
        node,
        type: 'ai_tool',
        index: 0,
      })),
    ],
  };
}

function filterLanguageTargets(connections, sourceNodeName, removedNames) {
  const current = (((connections[sourceNodeName] || {}).ai_languageModel || [[]])[0] || []).filter(
    (edge) => !removedNames.includes(edge.node),
  );
  connections[sourceNodeName] = {
    ...(connections[sourceNodeName] || {}),
    ai_languageModel: [current],
  };
}

function patchPrompt(text, replacements) {
  let next = String(text || '');
  for (const [search, replace] of replacements) {
    next = next.replace(search, replace);
  }
  return next;
}

function inventoryWorkflowInputs() {
  return {
    mappingMode: 'defineBelow',
    value: {},
    matchingColumns: [],
    schema: [
      {
        id: 'af150af7-2b28-4795-85c2-ff9c78ff45a0',
        displayName: 'operation',
        required: false,
        defaultMatch: false,
        display: true,
        canBeUsedToMatch: true,
        type: 'string',
        removed: false,
        stringValue:
          "={{ $fromAI('operation', `Operacion: list_matching_fincas | get_finca_details | get_owner_contact`, 'string') }}",
      },
      {
        id: '9d69bf2f-c055-4095-b238-b79239ebbc5d',
        displayName: 'finca_id',
        required: false,
        defaultMatch: false,
        display: true,
        canBeUsedToMatch: true,
        type: 'string',
        removed: false,
        stringValue:
          "={{ $fromAI('finca_id', `ID de la finca si ya lo tienes`, 'string') }}",
      },
      {
        id: '160ae2d8-8c53-4f03-b01c-e83edb21d2d1',
        displayName: 'nombre',
        required: false,
        defaultMatch: false,
        display: true,
        canBeUsedToMatch: true,
        type: 'string',
        removed: false,
        stringValue:
          "={{ $fromAI('nombre', `Nombre de la finca si no tienes el ID`, 'string') }}",
      },
      {
        id: '0f6338f9-d6f5-472d-b1ae-9cb227cf932c',
        displayName: 'query',
        required: false,
        defaultMatch: false,
        display: true,
        canBeUsedToMatch: true,
        type: 'string',
        removed: false,
        stringValue:
          "={{ $fromAI('query', `Pregunta puntual o criterio libre sobre la finca`, 'string') }}",
      },
      {
        id: 'cc885368-245a-4144-a931-52fe0b8152de',
        displayName: 'zona',
        required: false,
        defaultMatch: false,
        display: true,
        canBeUsedToMatch: true,
        type: 'string',
        removed: false,
        stringValue:
          "={{ $fromAI('zona', `Zona o destino a usar para filtrar`, 'string') }}",
      },
      {
        id: 'c8c0b32b-ef3e-4f7c-9ff6-f196ca809a71',
        displayName: 'personas',
        required: false,
        defaultMatch: false,
        display: true,
        canBeUsedToMatch: true,
        type: 'string',
        removed: false,
        stringValue:
          "={{ $fromAI('personas', `Cantidad de personas para filtrar`, 'string') }}",
      },
      {
        id: '91a758dc-2d8d-48af-8c87-e67b7e0a9b3d',
        displayName: 'presupuesto_max',
        required: false,
        defaultMatch: false,
        display: true,
        canBeUsedToMatch: true,
        type: 'string',
        removed: false,
        stringValue:
          "={{ $fromAI('presupuesto_max', `Presupuesto maximo aproximado por noche`, 'string') }}",
      },
      {
        id: '84bb09bc-fda7-4600-8676-3c84a11ad061',
        displayName: 'limit',
        required: false,
        defaultMatch: false,
        display: true,
        canBeUsedToMatch: true,
        type: 'string',
        removed: false,
        stringValue:
          "={{ $fromAI('limit', `Numero maximo de opciones a devolver`, 'string') }}",
      },
      {
        id: '6f96f6e8-6f60-48ea-b53a-6901f6fdecf4',
        displayName: 'selected_finca_id',
        required: false,
        defaultMatch: false,
        display: true,
        canBeUsedToMatch: true,
        type: 'string',
        removed: false,
        stringValue:
          "={{ $('Get Context-conversations1').item.json.context?.selected_finca_id || $('Get Context-conversations1').item.json.context?.selected_finca?.finca_id || '' }}",
      },
      {
        id: '542a063d-7560-4eb4-a33a-542cee37ba77',
        displayName: 'selected_finca_nombre',
        required: false,
        defaultMatch: false,
        display: true,
        canBeUsedToMatch: true,
        type: 'string',
        removed: false,
        stringValue:
          "={{ $('Get Context-conversations1').item.json.context?.selected_finca?.nombre || '' }}",
      },
      {
        id: '7bbb3f9b-3610-4c71-a321-80301cee4275',
        displayName: 'shown_fincas_json',
        required: false,
        defaultMatch: false,
        display: true,
        canBeUsedToMatch: true,
        type: 'string',
        removed: false,
        stringValue:
          "={{ JSON.stringify($('Get Context-conversations1').item.json.context?.shown_fincas || []) }}",
      },
      {
        id: '640032b2-7c44-4089-a060-19f075ad5c7a',
        displayName: 'context_zona',
        required: false,
        defaultMatch: false,
        display: true,
        canBeUsedToMatch: true,
        type: 'string',
        removed: false,
        stringValue:
          "={{ $('Get Context-conversations1').item.json.context?.search_criteria?.zona || '' }}",
      },
      {
        id: '2ce0880c-38c0-45a3-bd48-03f566816c90',
        displayName: 'context_personas',
        required: false,
        defaultMatch: false,
        display: true,
        canBeUsedToMatch: true,
        type: 'string',
        removed: false,
        stringValue:
          "={{ $('Get Context-conversations1').item.json.context?.search_criteria?.personas || '' }}",
      },
      {
        id: '0cf68377-d5df-4d37-b42c-4a56107f5160',
        displayName: 'context_presupuesto_max',
        required: false,
        defaultMatch: false,
        display: true,
        canBeUsedToMatch: true,
        type: 'string',
        removed: false,
        stringValue:
          "={{ $('Get Context-conversations1').item.json.context?.search_criteria?.presupuesto_max || '' }}",
      },
      {
        id: 'd109de4e-12ee-43ca-a17f-767475728b80',
        displayName: 'context_fecha_inicio',
        required: false,
        defaultMatch: false,
        display: true,
        canBeUsedToMatch: true,
        type: 'string',
        removed: false,
        stringValue:
          "={{ $('Get Context-conversations1').item.json.context?.search_criteria?.fecha_inicio || '' }}",
      },
      {
        id: '8d3c6755-6aef-4c47-9981-4d383ed7c2a6',
        displayName: 'context_fecha_fin',
        required: false,
        defaultMatch: false,
        display: true,
        canBeUsedToMatch: true,
        type: 'string',
        removed: false,
        stringValue:
          "={{ $('Get Context-conversations1').item.json.context?.search_criteria?.fecha_fin || '' }}",
      },
    ],
    attemptToConvertTypes: false,
    convertFieldsToString: false,
  };
}

function normalizeInventoryCode() {
  return `const rawItems = $input.all();
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
  const num = Number(String(value).replace(/[^\\d.-]/g, ''));
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
}

function buildInventoryResponseCode() {
  return `const payload = $('When inventory tool is called').item.json || {};
const inventory = Array.isArray($json.inventory) ? $json.inventory : [];
const meta = $json.inventory_meta || { access_ok: true, error_message: null, count: inventory.length, total_rows: inventory.length };

const normalizeText = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .trim();

const compact = (value) => (value === undefined || value === null ? '' : String(value).trim());

const toNumber = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(String(value).replace(/[^\\d.-]/g, ''));
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
  zona: item.zona,
  municipio: item.municipio,
  capacidad_max: item.capacidad_max,
  min_noches: item.min_noches,
  precio_noche_base: item.precio_noche_base,
  precio_fin_semana: item.precio_fin_semana,
  precio_persona_extra: item.precio_persona_extra,
  precio_referencia_noche: nightlyReference(item, nights),
  pet_friendly: item.pet_friendly,
  amenidades: item.amenidades,
  tipo_evento: item.tipo_evento,
  descripcion_corta: item.descripcion_corta,
  foto_url: item.foto_url,
  owner_nombre: item.owner_nombre,
  descuento_max_pct: item.descuento_max_pct,
});

const sanitizeDetailItem = (item, nights) => ({
  ...sanitizeListItem(item, nights),
  deposito_seguridad: item.deposito_seguridad,
  owner_contacto: item.owner_contacto,
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
const limit = Math.max(1, Math.min(5, toNumber(payload.limit, 3) || 3));
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
      item.zona,
      item.municipio,
      item.descripcion_corta,
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
              owner_contacto: bestMatch.owner_contacto,
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
}

function followOnScheduleQuery() {
  return `with convo as (
  select *
  from public.conversations
  where wa_id = {{ "'" + String($('Merge Sets1').item.json.conversation_key).replace(/'/g, "''") + "'" }}
),
cancel_existing as (
  update public.follow_on
  set
    status = 'cancelada',
    cancelled_at = now(),
    cancel_reason = 'rescheduled',
    updated_at = now()
  where conversation_id = {{ "'" + String($('Merge Sets1').item.json.conversation_key).replace(/'/g, "''") + "'" }}
    and status = 'pendiente'
  returning id
),
plan as (
  select
    c.wa_id as conversation_id,
    c.current_state,
    c.followup_count,
    c.followup_enabled,
    c.waiting_for,
    c.agente_activo,
    case
      when c.agente_activo = false or c.followup_enabled = false then null
      when c.waiting_for = 'CLIENT' and c.last_message_from = 'AGENT' then
        case
          when coalesce(c.followup_count, 0) <= 0 then now() + interval '2 hours'
          when coalesce(c.followup_count, 0) = 1 then now() + interval '24 hours'
          else now() + interval '72 hours'
        end
      else null
    end as scheduled_for,
    case
      when c.current_state = 'QUALIFYING' then
        'Hola, sigo atento para ayudarte con la búsqueda de tu finca. Si quieres, compárteme fechas, número de personas y zona y retomamos.'
      when c.current_state = 'OFFERING' then
        'Hola, sigo atento. Si quieres, te comparto más opciones o ajustamos la búsqueda por zona, capacidad o presupuesto.'
      when c.current_state = 'VERIFYING_AVAILABILITY' then
        'Hola, sigo atento con tu solicitud. Si quieres, también puedo ayudarte a revisar otra opción similar.'
      else
        'Hola, sigo atento para ayudarte con tu solicitud.'
    end as follow_on_message
  from convo c
),
updated_conversation as (
  update public.conversations c
  set
    next_followup_at = p.scheduled_for,
    updated_at = now()
  from plan p
  where c.wa_id = p.conversation_id
  returning c.wa_id, c.next_followup_at, c.followup_count, c.waiting_for, p.current_state, p.follow_on_message
),
inserted as (
  insert into public.follow_on (
    conversation_id,
    message,
    scheduled_for,
    status,
    metadata
  )
  select
    uc.wa_id,
    uc.follow_on_message,
    uc.next_followup_at,
    'pendiente',
    jsonb_build_object(
      'source', 'main_workflow',
      'source_state', uc.current_state,
      'followup_count_at_schedule', coalesce(uc.followup_count, 0)
    )
  from updated_conversation uc
  where uc.next_followup_at is not null
  returning id, conversation_id, scheduled_for, status
)
select
  (select count(*) from cancel_existing) as cancelled_previous,
  (select count(*) from inserted) as inserted_count,
  (select scheduled_for from inserted order by id desc limit 1) as scheduled_for,
  (select status from inserted order by id desc limit 1) as status;`;
}

function cancelPendingFollowOnQuery() {
  return `update public.follow_on
set
  status = 'cancelada',
  cancelled_at = now(),
  cancel_reason = 'client_replied',
  updated_at = now()
where conversation_id = {{ "'" + String($('Merge Sets1').item.json.conversation_key).replace(/'/g, "''") + "'" }}
  and status = 'pendiente'
returning id, scheduled_for, status;`;
}

function schedulerWorkflowDefinition() {
  return {
    name: SCHEDULER_WORKFLOW_NAME,
    nodes: [
      {
        parameters: {
          rule: {
            interval: [
              {
                field: 'minutes',
                minutesInterval: 30,
              },
            ],
          },
        },
        id: '9090b3d3-d502-4835-b902-6353af66ecaf',
        name: 'Every 30 minutes',
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2,
        position: [240, 240],
      },
      {
        parameters: {
          operation: 'executeQuery',
          query: `with cancellable as (
  update public.follow_on f
  set
    status = 'cancelada',
    cancelled_at = now(),
    cancel_reason = 'conversation_not_eligible',
    updated_at = now()
  from public.conversations c
  where f.conversation_id = c.wa_id
    and f.status = 'pendiente'
    and f.scheduled_for <= now()
    and (c.agente_activo = false or coalesce(c.waiting_for, 'CLIENT') <> 'CLIENT')
  returning f.id
),
due as (
  select
    f.id,
    f.conversation_id,
    f.message,
    c.current_state
  from public.follow_on f
  join public.conversations c on c.wa_id = f.conversation_id
  where f.status = 'pendiente'
    and f.scheduled_for <= now()
    and c.agente_activo = true
    and coalesce(c.waiting_for, 'CLIENT') = 'CLIENT'
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
    extracted_data
  )
  select
    d.conversation_id,
    'OUTBOUND',
    'TEXT',
    d.message,
    null,
    d.current_state,
    'follow_on_scheduler',
    '{}'::jsonb
  from due d
  returning conversation_id
),
updated_conversations as (
  update public.conversations c
  set
    last_interaction = now(),
    last_message_from = 'AGENT',
    updated_at = now(),
    next_followup_at = null,
    followup_count = coalesce(c.followup_count, 0) + 1
  from (select distinct conversation_id from due) d
  where c.wa_id = d.conversation_id
  returning c.wa_id
),
sent as (
  update public.follow_on f
  set
    status = 'enviada',
    sent_at = now(),
    updated_at = now()
  from due d
  where f.id = d.id
  returning f.id
)
select
  (select count(*) from cancellable) as cancelled_count,
  (select count(*) from sent) as sent_count;`,
          options: {},
        },
        id: 'b4c4cdd8-cb5a-46f1-81b9-31715a2f03eb',
        name: 'Process due follow on',
        type: 'n8n-nodes-base.postgres',
        typeVersion: 2,
        position: [528, 240],
        credentials: {
          postgres: {
            id: 'CKoiBGlPXq82taIc',
            name: 'Postgres account',
          },
        },
      },
    ],
    connections: {
      'Every 30 minutes': {
        main: [[{ node: 'Process due follow on', type: 'main', index: 0 }]],
      },
      'Process due follow on': {
        main: [[]],
      },
    },
    settings: {
      executionOrder: 'v1',
      timezone: 'America/Bogota',
    },
  };
}

function sanitizeWorkflowForUpdate(workflow) {
  return {
    name: workflow.name,
    nodes: workflow.nodes,
    connections: workflow.connections,
    settings: {
      executionOrder: workflow.settings?.executionOrder,
      timezone: workflow.settings?.timezone,
      callerPolicy: workflow.settings?.callerPolicy,
      availableInMCP: workflow.settings?.availableInMCP,
    },
  };
}

function sanitizeWorkflowSettings(settings) {
  return Object.fromEntries(
    Object.entries(settings || {}).filter(([, value]) => value !== undefined),
  );
}

async function findWorkflowByName(name) {
  const payload = await api('/api/v1/workflows?limit=200');
  const workflows = Array.isArray(payload?.data) ? payload.data : [];
  return workflows.find((item) => item.name === name) || null;
}

function patchMainWorkflow(workflow) {
  const currentDatetimeNode = findNode(workflow, 'Build Current Datetime Tool Response');
  if (currentDatetimeNode) {
    currentDatetimeNode.parameters.assignments.assignments = [
      {
        id: 'c73e550f-4d20-4d79-aef4-7468375bfca0',
        name: 'now_iso',
        value: "={{ $now.setZone('America/Bogota').toISO() }}",
        type: 'string',
      },
      {
        id: '653755ac-f9dc-4052-b76c-93b6082a5610',
        name: 'today_iso_date',
        value: "={{ $now.setZone('America/Bogota').toISODate() }}",
        type: 'string',
      },
      {
        id: '8ea47adb-0cc7-4979-b5b0-59e3f9e90fc4',
        name: 'current_time_24h',
        value: "={{ $now.setZone('America/Bogota').toFormat('HH:mm:ss') }}",
        type: 'string',
      },
      {
        id: '40d004db-dc61-4d78-b22d-a3bac4103f56',
        name: 'timezone',
        value: 'America/Bogota',
        type: 'string',
      },
      {
        id: '61c43179-c12a-4b34-9e85-29402e9f5dd9',
        name: 'utc_offset',
        value: '-05:00',
        type: 'string',
      },
      {
        id: 'f13bbd2f-bc21-4f16-9db0-bda7d7e5233d',
        name: 'timezone_label',
        value: 'GMT-5',
        type: 'string',
      },
      {
        id: '8f2e09f0-f1b1-48ee-86c0-4593db9cd7ff',
        name: 'weekday_es',
        value: "={{ $now.setZone('America/Bogota').setLocale('es').toFormat('cccc') }}",
        type: 'string',
      },
      {
        id: 'f40861ab-7c6f-4d89-a6ec-a31d411e11b1',
        name: 'human_readable_es',
        value:
          "={{ $now.setZone('America/Bogota').setLocale('es').toFormat(\"cccc d 'de' LLLL 'de' yyyy, HH:mm\") }}",
        type: 'string',
      },
      {
        id: 'f7e680a3-1efe-40a4-8821-a169683adaf9',
        name: 'request_context',
        value: '={{ $json.reason || "" }}',
        type: 'string',
      },
      {
        id: '525d46be-e26e-43f6-b4aa-d1b1e3f121fc',
        name: 'notes',
        value:
          'Usa estos valores como referencia única de fecha y hora actual de Colombia (GMT-5) en esta ejecución.',
        type: 'string',
      },
    ];
  }

  const inventoryTool = findNode(workflow, 'inventory_reader_tool');
  if (inventoryTool) {
    inventoryTool.parameters.workflowInputs = inventoryWorkflowInputs();
  }

  const getRowsNode = findNode(workflow, 'Get row(s) in fincas sheet');
  if (getRowsNode) {
    getRowsNode.parameters.documentId = {
      __rl: true,
      value: INVENTORY_DOCUMENT_ID,
      mode: 'id',
      cachedResultName: INVENTORY_DOCUMENT_ID,
      cachedResultUrl: '',
    };
    getRowsNode.parameters.sheetName = {
      __rl: true,
      value: INVENTORY_TAB_NAME,
      mode: 'name',
      cachedResultName: INVENTORY_TAB_NAME,
      cachedResultUrl: '',
    };
  }

  const normalizeInventoryNode = findNode(workflow, 'Normalize Inventory');
  if (normalizeInventoryNode) {
    normalizeInventoryNode.parameters.jsCode = normalizeInventoryCode();
  }

  const buildInventoryNode = findNode(workflow, 'Build Inventory Tool Response');
  if (buildInventoryNode) {
    buildInventoryNode.parameters.jsCode = buildInventoryResponseCode();
  }

  const offeringAgent = findNode(workflow, 'offering_agent');
  if (offeringAgent?.parameters?.options?.systemMessage) {
    offeringAgent.parameters.options.systemMessage = patchPrompt(offeringAgent.parameters.options.systemMessage, [
      [
        '- Si inventory_reader_tool responde configured = false o no hay coincidencias, dilo con claridad y pide ajustar criterios.',
        '- Si inventory_reader_tool responde error = true, devuelve intent = "HITL_REQUEST" porque hubo un problema real accediendo al inventario.\n- Si no hay coincidencias exactas pero sí similar_items, aclara que no encontraste match exacto y muestra esas alternativas similares.\n- Si no hay coincidencias exactas ni similares, dilo con claridad y propone ajustar criterios.',
      ],
    ]);
  }

  const verifyingAgent = findNode(workflow, 'verifying_availability_agent');
  if (verifyingAgent?.parameters?.options?.systemMessage) {
    verifyingAgent.parameters.options.systemMessage = patchPrompt(verifyingAgent.parameters.options.systemMessage, [
      [
        '- Si la tarea correcta es recuperar el numero de contacto del propietario, usa inventory_reader_tool con operation="get_owner_contact".',
        '- Si la tarea correcta es recuperar el numero de contacto del propietario, usa inventory_reader_tool con operation="get_owner_contact".\n- Si inventory_reader_tool devuelve error = true, responde con intent = "HITL_REQUEST".',
      ],
    ]);
  }

  const qaAgent = findNode(workflow, 'qa_agent');
  if (qaAgent?.parameters?.options?.systemMessage) {
    qaAgent.parameters.options.systemMessage = patchPrompt(qaAgent.parameters.options.systemMessage, [
      [
        '- Si el dato no aparece en inventory_reader_tool o context, dilo y ofrece ayuda parcial.',
        '- Si inventory_reader_tool devuelve error = true, responde con intent = "HITL_REQUEST".\n- Si el dato no aparece en inventory_reader_tool o context, dilo y ofrece ayuda parcial.',
      ],
    ]);
  }

  removeNode(workflow, 'Has Inventory Config');
  removeNode(workflow, 'Inventory not configured');

  replaceMainConnection(workflow.connections, 'When inventory tool is called', 'Get row(s) in fincas sheet');
  workflow.connections['Get row(s) in fincas sheet'] = {
    ...(workflow.connections['Get row(s) in fincas sheet'] || {}),
    main: [[{ node: 'Normalize Inventory', type: 'main', index: 0 }]],
  };
  workflow.connections['Normalize Inventory'] = {
    ...(workflow.connections['Normalize Inventory'] || {}),
    main: [[{ node: 'Build Inventory Tool Response', type: 'main', index: 0 }]],
  };
  workflow.connections['Build Inventory Tool Response'] = { main: [[]] };

  const cancelPendingNode = {
    parameters: {
      operation: 'executeQuery',
      query: cancelPendingFollowOnQuery(),
      options: {},
    },
    id: '0a0a2a2d-f1e4-485a-a5f8-45d2b2da8c11',
    name: 'Cancel pending follow on',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2,
    position: [-2864, 160],
    credentials: {
      postgres: {
        id: 'CKoiBGlPXq82taIc',
        name: 'Postgres account',
      },
    },
  };

  const existingCancelNode = findNode(workflow, 'Cancel pending follow on');
  if (existingCancelNode) {
    existingCancelNode.parameters = cancelPendingNode.parameters;
    existingCancelNode.credentials = cancelPendingNode.credentials;
  } else {
    workflow.nodes.push(cancelPendingNode);
  }

  replaceMainConnection(workflow.connections, 'Merge Sets1', 'Cancel pending follow on');
  replaceMainConnection(workflow.connections, 'Cancel pending follow on', 'Get Context-conversations1');

  const followOnNode = findNode(workflow, 'Agregar follow on');
  if (followOnNode) {
    followOnNode.parameters.query = followOnScheduleQuery();
  }

  workflow.settings = {
    ...(workflow.settings || {}),
    timezone: 'America/Bogota',
  };

  return workflow;
}

async function upsertSchedulerWorkflow() {
  const definition = schedulerWorkflowDefinition();
  const existing = await findWorkflowByName(SCHEDULER_WORKFLOW_NAME);

  if (existing) {
    const full = await api(`/api/v1/workflows/${existing.id}`);
    const wasActive = full.active === true;
    if (wasActive) {
      await api(`/api/v1/workflows/${existing.id}/deactivate`, { method: 'POST' });
    }
    const payload = {
      name: definition.name,
      nodes: definition.nodes,
      connections: definition.connections,
      settings: sanitizeWorkflowSettings(definition.settings),
    };
    const updated = await api(`/api/v1/workflows/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    await api(`/api/v1/workflows/${existing.id}/activate`, { method: 'POST' });
    return { id: updated.id, created: false };
  }

  const created = await api('/api/v1/workflows', {
    method: 'POST',
    body: JSON.stringify({
      name: definition.name,
      nodes: definition.nodes,
      connections: definition.connections,
      settings: sanitizeWorkflowSettings(definition.settings),
    }),
  });
  await api(`/api/v1/workflows/${created.id}/activate`, { method: 'POST' });
  return { id: created.id, created: true };
}

const mainWorkflow = await api(`/api/v1/workflows/${WORKFLOW_ID}`);
const wasActive = mainWorkflow.active === true;
patchMainWorkflow(mainWorkflow);

if (wasActive) {
  await api(`/api/v1/workflows/${WORKFLOW_ID}/deactivate`, { method: 'POST' });
}

const updatedMain = await api(`/api/v1/workflows/${WORKFLOW_ID}`, {
  method: 'PUT',
  body: JSON.stringify(sanitizeWorkflowForUpdate(mainWorkflow)),
});

if (wasActive) {
  await api(`/api/v1/workflows/${WORKFLOW_ID}/activate`, { method: 'POST' });
}

const scheduler = await upsertSchedulerWorkflow();

await fs.writeFile(path.resolve('current_workflow.json'), JSON.stringify(updatedMain, null, 2));

console.log(
  JSON.stringify(
    {
      mainWorkflowId: updatedMain.id,
      mainVersionId: updatedMain.versionId,
      schedulerWorkflowId: scheduler.id,
      schedulerCreated: scheduler.created,
    },
    null,
    2,
  ),
);
