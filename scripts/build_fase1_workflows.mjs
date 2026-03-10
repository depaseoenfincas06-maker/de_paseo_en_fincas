import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const cwd = process.cwd();
const sourcePath = path.join(cwd, 'current_workflow.json');
const outMainPath = path.join(cwd, 'updated_main_workflow.json');
const outAdminPath = path.join(cwd, 'admin_workflow.json');

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

const byName = new Map(source.nodes.map((node) => [node.name, node]));

function cloneNode(name) {
  const node = byName.get(name);
  if (!node) {
    throw new Error(`Missing source node: ${name}`);
  }
  return JSON.parse(JSON.stringify(node));
}

function newId() {
  return crypto.randomUUID();
}

function stringify(value) {
  return JSON.stringify(value, null, 2);
}

const googleSheetsCredential = {
  googleSheetsOAuth2Api: {
    id: 'hGxsL47CSLAz1Zkw',
    name: 'Google Sheets account 2',
  },
};

const workflowSettings = {
  executionOrder: 'v1',
  availableInMCP: true,
  callerPolicy: 'workflowsFromSameOwner',
};

const main = {
  name: source.name,
  nodes: [],
  connections: {},
  settings: workflowSettings,
  staticData: source.staticData ?? null,
};

const chatTrigger = cloneNode('When chat message received');
chatTrigger.position = [-8840, 2240];
chatTrigger.parameters = {
  ...(chatTrigger.parameters || {}),
  options: {
    ...(chatTrigger.parameters?.options || {}),
    responseMode: 'responseNode',
  },
};

const filterMessages = cloneNode('Filtro Mensajes');
filterMessages.parameters = {
  conditions: {
    options: {
      caseSensitive: true,
      leftValue: '',
      typeValidation: 'loose',
      version: 3,
    },
    conditions: [
      {
        id: newId(),
        leftValue: "={{ String($json.chatInput || '').trim().length > 0 }}",
        rightValue: '',
        operator: {
          type: 'boolean',
          operation: 'true',
          singleValue: true,
        },
      },
      {
        id: newId(),
        leftValue:
          "={{ /^\\/(disponible|no-disponible)\\b/i.test(String($json.chatInput || '').trim()) }}",
        rightValue: '',
        operator: {
          type: 'boolean',
          operation: 'false',
          singleValue: true,
        },
      },
    ],
    combinator: 'and',
  },
  looseTypeValidation: true,
  options: {},
};
filterMessages.position = [-8576, 2240];

const executionData = cloneNode('Execution Data1');
executionData.position = [-8352, 2240];

const config = cloneNode('config');
config.parameters = {
  assignments: {
    assignments: [
      {
        id: newId(),
        name: 'insertar_mensjae',
        value: true,
        type: 'boolean',
      },
      {
        id: newId(),
        name: 'tono',
        value:
          "=- No inventes información. Solo usa el input.\n- Mensajes cortos para WhatsApp (máx 500 caracteres).\n- Tuteo, tono amigable, máximo 2 emojis.\n- Si el cliente pide hablar con humano o visitar: intent=HITL_REQUEST.\n- Responde natural, como un humano, sin sonar adulador.\n- Sé respetuoso, amable y firme.\n- Si el interés real no es alquilar una finca, redirígelo con claridad.\n- Usa doble salto de línea entre párrafos.",
        type: 'string',
      },
      {
        id: newId(),
        name: 'current_message',
        value: "={{ String($json.chatInput || '').trim() }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'conversation_key',
        value:
          "={{ $json.sessionId || $json.conversationId || $json.metadata?.conversationKey || $json.metadata?.conversation_id || $json.metadata?.wa_id || $json.metadata?.chatId || $execution.id }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'client_name',
        value:
          "={{ $json.metadata?.client_name || $json.metadata?.name || $json.metadata?.user?.name || null }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'chatwoot_id',
        value: "={{ $json.metadata?.chatwoot_id || null }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'message_type',
        value: 'TEXT',
        type: 'string',
      },
      {
        id: newId(),
        name: 'inventory_sheet_enabled',
        value: true,
        type: 'boolean',
      },
      {
        id: newId(),
        name: 'inventory_sheet_document_id',
        value: '1AHeDsZin_U5ZzfAB50i7JZvOoJcP9uAM71RRZgnDlgo',
        type: 'string',
      },
      {
        id: newId(),
        name: 'inventory_sheet_gid',
        value: '1708735749',
        type: 'string',
      },
      {
        id: newId(),
        name: 'inventory_sheet_tab_name',
        value: 'fincas_inventory_ajustada_real',
        type: 'string',
      },
    ],
  },
  options: {},
};
config.position = [-8144, 2240];

const mergeSets = cloneNode('Merge Sets1');
mergeSets.parameters = {
  assignments: {
    assignments: [
      {
        id: newId(),
        name: 'insertar_mensjae',
        value: "={{ $json.insertar_mensjae ?? $('config').item.json.insertar_mensjae }}",
        type: 'boolean',
      },
      {
        id: newId(),
        name: 'last-message',
        value: "={{ $json['last-message'] ?? $('config').item.json.current_message }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'conversation_key',
        value: "={{ $('config').item.json.conversation_key }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'client_name',
        value: "={{ $('config').item.json.client_name }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'chatwoot_id',
        value: "={{ $('config').item.json.chatwoot_id }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'message_type',
        value: "={{ $('config').item.json.message_type }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'inventory_sheet_enabled',
        value: "={{ $('config').item.json.inventory_sheet_enabled }}",
        type: 'boolean',
      },
      {
        id: newId(),
        name: 'inventory_sheet_document_id',
        value: "={{ $('config').item.json.inventory_sheet_document_id }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'inventory_sheet_gid',
        value: "={{ $('config').item.json.inventory_sheet_gid }}",
        type: 'string',
      },
      {
        id: newId(),
        name: 'inventory_sheet_tab_name',
        value: "={{ $('config').item.json.inventory_sheet_tab_name }}",
        type: 'string',
      },
    ],
  },
  options: {},
};
mergeSets.position = [-7904, 2240];

const getContext = cloneNode('Get Context-conversations1');
getContext.parameters = {
  operation: 'executeQuery',
  query: String.raw`with payload as (
  select
    {{ "'" + String($('Merge Sets1').item.json.conversation_key).replace(/'/g, "''") + "'" }}::varchar as wa_id,
    {{
      $('Merge Sets1').item.json.chatwoot_id
        ? "'" + String($('Merge Sets1').item.json.chatwoot_id).replace(/'/g, "''") + "'"
        : "null"
    }}::integer as chatwoot_id,
    {{
      $('Merge Sets1').item.json.client_name
        ? "'" + String($('Merge Sets1').item.json.client_name).replace(/'/g, "''") + "'"
        : "null"
    }}::varchar as client_name
),
upserted as (
  insert into public.conversations (
    wa_id,
    chatwoot_id,
    client_name,
    current_state,
    state_changed_at,
    last_interaction,
    last_message_from,
    agente_activo,
    search_criteria,
    extras,
    huespedes,
    shown_fincas,
    owner_response,
    followup_count,
    followup_enabled,
    waiting_for,
    confirmacion_enviada,
    confirmacion_aceptada,
    confirmacion_version,
    huespedes_completos
  )
  select
    p.wa_id,
    p.chatwoot_id,
    p.client_name,
    'QUALIFYING',
    now(),
    now(),
    'CLIENT',
    true,
    '{
      "fecha_inicio": null,
      "fecha_fin": null,
      "personas": null,
      "zona": null,
      "presupuesto_max": null,
      "tipo_evento": null,
      "amenidades": [],
      "mascotas": null
    }'::jsonb,
    '{
      "personas_adicionales": { "cantidad": 0, "precio_unitario": 0, "subtotal": 0 },
      "check_in_temprano": { "aplica": false, "costo": 0 },
      "late_checkout": { "aplica": false, "costo": 0 },
      "servicio_empleada": { "dias": 0, "costo_dia": 0, "subtotal": 0 }
    }'::jsonb,
    '[]'::jsonb,
    '{}'::text[],
    null,
    0,
    true,
    'CLIENT',
    false,
    false,
    0,
    false
  from payload p
  on conflict (wa_id)
  do update set
    chatwoot_id = coalesce(excluded.chatwoot_id, public.conversations.chatwoot_id),
    client_name = coalesce(excluded.client_name, public.conversations.client_name),
    last_interaction = now(),
    last_message_from = 'CLIENT',
    updated_at = now()
  returning *
)
select
  u.*,
  jsonb_build_object(
    'conversation', jsonb_build_object(
      'id', u.wa_id,
      'client_name', u.client_name,
      'current_state', u.current_state,
      'previous_state', u.previous_state,
      'started_at', u.created_at,
      'channel', 'CHAT'
    ),
    'search_criteria', (
      '{
        "fecha_inicio": null,
        "fecha_fin": null,
        "personas": null,
        "zona": null,
        "presupuesto_max": null,
        "tipo_evento": null,
        "amenidades": [],
        "mascotas": null
      }'::jsonb
      || coalesce(u.search_criteria, '{}'::jsonb)
    )
    || jsonb_build_object(
      'datos_faltantes', to_jsonb(array_remove(array[
        case when coalesce(u.search_criteria->>'fecha_inicio', '') = ''
               or coalesce(u.search_criteria->>'fecha_fin', '') = ''
          then 'fechas' else null end,
        case when coalesce(u.search_criteria->>'personas', '') = ''
          then 'personas' else null end,
        case when coalesce(u.search_criteria->>'zona', '') = ''
          then 'zona' else null end
      ], null)),
      'datos_completos', (
        jsonb_array_length(
          to_jsonb(array_remove(array[
            case when coalesce(u.search_criteria->>'fecha_inicio', '') = ''
                   or coalesce(u.search_criteria->>'fecha_fin', '') = ''
              then 'fechas' else null end,
            case when coalesce(u.search_criteria->>'personas', '') = ''
              then 'personas' else null end,
            case when coalesce(u.search_criteria->>'zona', '') = ''
              then 'zona' else null end
          ], null))
        ) = 0
      )
    ),
    'selected_finca_id', to_jsonb(u.selected_finca_id),
    'selected_finca', coalesce(u.selected_finca, 'null'::jsonb),
    'shown_fincas', to_jsonb(coalesce(u.shown_fincas, '{}'::text[])),
    'owner_response', coalesce(u.owner_response, 'null'::jsonb),
    'pricing', jsonb_build_object(
      'precio_noche', u.precio_noche,
      'noches', u.noches,
      'subtotal', u.subtotal,
      'deposito_seguridad', u.deposito_seguridad,
      'total', u.total,
      'anticipo_requerido', u.anticipo_requerido,
      'anticipo_pagado', u.anticipo_pagado,
      'saldo_pagado', u.saldo_pagado,
      'metodo_pago', u.metodo_pago,
      'comprobante_url', u.comprobante_url
    ),
    'extras', coalesce(u.extras, '{}'::jsonb),
    'followup', jsonb_build_object(
      'count', u.followup_count,
      'enabled', u.followup_enabled,
      'next_followup_at', u.next_followup_at,
      'waiting_for', u.waiting_for
    ),
    'agente_activo', u.agente_activo,
    'hitl_reason', u.hitl_reason
  ) as context
from upserted u;`,
    options: {},
};
getContext.position = [-7648, 2240];

const fetchMessages = cloneNode('Fetch messages1');
fetchMessages.parameters = {
  operation: 'executeQuery',
  query: String.raw`with params as (
  select {{ "'" + String($('Merge Sets1').item.json.conversation_key).replace(/'/g, "''") + "'" }}::varchar as wa_id
)
select
  (
    select jsonb_build_object(
      'direction', m.direction,
      'message_type', m.message_type,
      'content', m.content,
      'media_url', m.media_url,
      'state_at_time', m.state_at_time,
      'agent_used', m.agent_used,
      'created_at', m.created_at
    )
    from public.messages m
    join params p on p.wa_id = m.conversation_id
    where m.direction = 'INBOUND'
    order by m.created_at desc
    limit 1
  ) as current_message,
  coalesce((
    select jsonb_agg(x.msg order by x.created_at desc)
    from (
      select
        m2.created_at,
        jsonb_build_object(
          'direction', m2.direction,
          'message_type', m2.message_type,
          'content', m2.content,
          'media_url', m2.media_url,
          'state_at_time', m2.state_at_time,
          'agent_used', m2.agent_used,
          'created_at', m2.created_at
        ) as msg
      from public.messages m2
      join params p2 on p2.wa_id = m2.conversation_id
      order by m2.created_at desc
      limit 20
    ) x
  ), '[]'::jsonb) as recent_messages
from params;`,
    options: {},
};
fetchMessages.position = [-7392, 2240];

const hasInventoryConfig = {
  id: newId(),
  name: 'Has Inventory Config',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.3,
  position: [-7120, 2240],
  parameters: {
    conditions: {
      options: {
        caseSensitive: true,
        leftValue: '',
        typeValidation: 'loose',
        version: 3,
      },
      conditions: [
        {
          id: newId(),
          leftValue: "={{ $('Merge Sets1').item.json.inventory_sheet_enabled === true }}",
          rightValue: '',
          operator: {
            type: 'boolean',
            operation: 'true',
            singleValue: true,
          },
        },
      ],
      combinator: 'and',
    },
    looseTypeValidation: true,
    options: {},
  },
};

const getInventorySheet = {
  id: newId(),
  name: 'Get row(s) in fincas sheet',
  type: 'n8n-nodes-base.googleSheets',
  typeVersion: 4.7,
  position: [-6880, 2096],
  alwaysOutputData: true,
  retryOnFail: true,
  waitBetweenTries: 5000,
  onError: 'continueRegularOutput',
  parameters: {
    documentId: {
      __rl: true,
      value: "={{ $('config').item.json.inventory_sheet_document_id }}",
      mode: 'id',
      cachedResultName: 'REPLACE_WITH_FINCAS_SHEET',
      cachedResultUrl: '',
    },
    sheetName: {
      __rl: true,
      value: "={{ $('config').item.json.inventory_sheet_tab_name }}",
      mode: 'name',
      cachedResultName: 'REPLACE_WITH_FINCAS_TAB',
      cachedResultUrl: '',
    },
    options: {},
  },
  credentials: googleSheetsCredential,
};

const normalizeInventory = {
  id: newId(),
  name: 'Normalize Inventory',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [-6608, 2096],
  parameters: {
    jsCode: String.raw`const rows = $input.all().map((item) => item.json || {});

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

const activeInventory = inventory.filter(
  (item) => item.activa && item.review_status === 'READY_FOR_OFFERING',
);

return [
  {
    json: {
      inventory: activeInventory,
      inventory_meta: {
        configured: true,
        count: activeInventory.length,
        total_rows: inventory.length,
      },
      inventory_overview: activeInventory.slice(0, 25).map((item) => ({
        finca_id: item.finca_id,
        nombre: item.nombre,
        zona: item.zona,
        capacidad_max: item.capacidad_max,
        precio_noche_base: item.precio_noche_base,
        precio_fin_semana: item.precio_fin_semana,
      })),
    },
  },
];`,
  },
};

const inventoryNotConfigured = {
  id: newId(),
  name: 'Inventory not configured',
  type: 'n8n-nodes-base.set',
  typeVersion: 3.4,
  position: [-6880, 2384],
  parameters: {
    assignments: {
      assignments: [
        {
          id: newId(),
          name: 'inventory',
          value: '=[]',
          type: 'array',
        },
        {
          id: newId(),
          name: 'inventory_meta',
          value:
            '={{ { configured: false, count: 0, reason: "inventory_sheet_disabled_or_missing" } }}',
          type: 'object',
        },
        {
          id: newId(),
          name: 'inventory_overview',
          value: '=[]',
          type: 'array',
        },
      ],
    },
    options: {},
  },
};

const prepareInventory = {
  id: newId(),
  name: 'Prepare Inventory Payload',
  type: 'n8n-nodes-base.set',
  typeVersion: 3.4,
  position: [-6368, 2240],
  parameters: {
    assignments: {
      assignments: [
        {
          id: newId(),
          name: 'inventory',
          value: '={{ $json.inventory || [] }}',
          type: 'array',
        },
        {
          id: newId(),
          name: 'inventory_meta',
          value:
            '={{ $json.inventory_meta || { configured: false, count: 0, reason: "missing_inventory_payload" } }}',
          type: 'object',
        },
        {
          id: newId(),
          name: 'inventory_overview',
          value: '={{ $json.inventory_overview || [] }}',
          type: 'array',
        },
      ],
    },
    options: {},
  },
};

const model = cloneNode('Google Gemini Chat Model1');
model.position = [-6848, 1792];

const orchestrator = cloneNode('Orquestador AI1');
orchestrator.parameters = {
  promptType: 'define',
  text: String.raw`=A continuación tienes el input runtime de la conversación.
Tu tarea es decidir el sub-agente correcto, ejecutarlo y devolver un JSON final con post_actions listos para persistir.

IMPORTANTE:
- conversation es la conversación activa almacenada en Postgres.
- recent_messages son los últimos 20 mensajes persistidos.
- current_message es el mensaje nuevo de este turno. Si viene vacío, estás en loop-back y debes decidir con el nuevo estado.
- inventory contiene la oferta de fincas ya normalizada desde Google Sheets. Si inventory_meta.configured = false, no inventes opciones.

=== RUNTIME INPUT ===

conversation:
{{ JSON.stringify($('Get Context-conversations1').item.json, null, 2) }}

recent_messages:
{{ JSON.stringify($('Fetch messages1').item.json.recent_messages || [], null, 2) }}

current_message:
{{ JSON.stringify($('Merge Sets1').item.json['last-message'] || null, null, 2) }}

inventory_meta:
{{ JSON.stringify($('Prepare Inventory Payload').item.json.inventory_meta || {}, null, 2) }}

inventory:
{{ JSON.stringify($('Prepare Inventory Payload').item.json.inventory || [], null, 2) }}

=== END RUNTIME INPUT ===

Ahora:
1) Decide action y tool_chosen.
2) Llama el tool elegido con este input mínimo:
{
  "context": {{ JSON.stringify($('Get Context-conversations1').item.json.context, null, 2) }},
  "recent_messages": {{ JSON.stringify($('Fetch messages1').item.json.recent_messages || [], null, 2) }},
  "current_message": {{ JSON.stringify($('Merge Sets1').item.json['last-message'] || null, null, 2) }},
  "inventory": {{ JSON.stringify($('Prepare Inventory Payload').item.json.inventory || [], null, 2) }},
  "inventory_meta": {{ JSON.stringify($('Prepare Inventory Payload').item.json.inventory_meta || {}, null, 2) }}
}
3) Devuelve EXCLUSIVAMENTE el JSON final.`,
    options: {
      systemMessage: String.raw`=IDENTIDAD
Eres el ORQUESTADOR del sistema "De Paseo en Finca". Operas dentro de n8n como Agent con Tools.
No eres el agente comercial final. Tu tarea es elegir el sub-agente correcto, ejecutarlo y devolver post_actions consistentes con la fase 1.

TOOLS DISPONIBLES
- qualifying_agent
- offering_agent
- verifying_availability_agent
- qa_agent

REGLAS ABSOLUTAS
- Nunca inventes disponibilidad, precios, ubicaciones exactas ni datos del propietario.
- Usa inventory únicamente como fuente de oferta.
- Si inventory_meta.configured = false y necesitas mostrar fincas, no inventes opciones: responde que el inventario no está listo y escala a HITL.
- No uses negotiating_agent en esta fase.
- La respuesta final al cliente debe salir del sub-agente o de un handoff corto si escalas a humano.
- Devuelve SIEMPRE JSON válido y nada más.

PRIORIDADES DE DECISIÓN
PRIORIDAD 0: BOT_DISABLED
Si context.agente_activo = false:
- action = "NOOP_BOT_DISABLED"
- tool_chosen = "NONE"
- final_whatsapp_text = null
- post_actions.agente_activo = false

PRIORIDAD 1: HITL
Si el cliente pide humano, asesor, visita, hay disputa de pago, amenaza, insulto fuerte o frustración crítica:
- action = "HITL"
- tool_chosen = "NONE"
- final_whatsapp_text = "Te voy a pasar con un asesor humano para continuar con tu solicitud."
- post_actions.agente_activo = false
- post_actions.waiting_for = "CLIENT"

PRIORIDAD 2: OWNER_RESPONSE
Si context.conversation.current_state = "VERIFYING_AVAILABILITY" y context.owner_response != null:
- Si owner_response.disponible = true:
  - action = "HITL"
  - tool_chosen = "NONE"
  - final_whatsapp_text = "Ya confirmé que la finca que elegiste está disponible. Te voy a pasar con un asesor humano para continuar con la reserva y el pago."
  - post_actions.agente_activo = false
  - post_actions.waiting_for = "CLIENT"
  - post_actions.owner_response = "__CLEAR__"
  - current_state_changed = false
- Si owner_response.disponible = false:
  - action = "RUN_TOOL"
  - tool_chosen = "offering_agent"
  - incluye en tool_input.context.owner_unavailable = true
  - post_actions.state_transition = "OFFERING"
  - post_actions.waiting_for = "CLIENT"
  - post_actions.owner_response = "__CLEAR__"
  - post_actions.selected_finca_id = "__CLEAR__"
  - post_actions.selected_finca = "__CLEAR__"

PRIORIDAD 3: NEGOTIATING LEGACY
Si context.conversation.current_state = "NEGOTIATING":
- action = "HITL"
- tool_chosen = "NONE"
- final_whatsapp_text = "Te voy a pasar con un asesor humano para continuar con tu reserva."
- post_actions.agente_activo = false
- post_actions.waiting_for = "CLIENT"

PRIORIDAD 4: CAMBIO / CANCELACIÓN
- Si el cliente pide otra finca, más opciones o cambiar la elegida: offering_agent
- Si el cliente cancela: HITL con agente_activo = false

PRIORIDAD 5: QA FLOTANTE
Si la pregunta es puntual y no cambia el estado del negocio:
- action = "RUN_TOOL"
- tool_chosen = "qa_agent"
- current_state_changed = false

PRIORIDAD 6: DEFAULT
Mapeo estado -> tool:
- QUALIFYING -> qualifying_agent
- OFFERING -> offering_agent
- VERIFYING_AVAILABILITY -> verifying_availability_agent
- cualquier otro estado -> HITL

CONTRATO DE SALIDA
Devuelve EXCLUSIVAMENTE este JSON:
{
  "action": "RUN_TOOL | HITL | CANCEL_REQUEST | NOOP_BOT_DISABLED",
  "tool_chosen": "qualifying_agent | offering_agent | verifying_availability_agent | qa_agent | NONE",
  "tool_input": { ... },
  "tool_output": { ... },
  "post_actions": {
    "state_transition": "QUALIFYING | OFFERING | VERIFYING_AVAILABILITY | __IGNORE__",
    "search_criteria": { ... } | "__IGNORE__",
    "waiting_for": "CLIENT | OWNER | __IGNORE__",
    "agente_activo": true | false | "__IGNORE__",
    "shown_fincas": ["finca_id"] | "__IGNORE__",
    "selected_finca_id": "id | __CLEAR__ | __IGNORE__",
    "selected_finca": { ... } | "__CLEAR__" | "__IGNORE__",
    "owner_response": { ... } | "__CLEAR__" | "__IGNORE__",
    "pricing": { "precio_noche": number, "noches": number, "subtotal": number, "deposito_seguridad": number, "total": number, "anticipo_requerido": number } | "__IGNORE__",
    "extras": { ... } | "__IGNORE__"
  },
  "final_whatsapp_text": "texto final o null",
  "current_state_changed": true | false
}

REGLAS DE MAPE0 A post_actions
- qualifying_agent:
  - mergea datos_extraidos útiles en search_criteria
  - si datos_completos = true -> state_transition = "OFFERING", current_state_changed = true
- offering_agent:
  - si intent = "CLIENT_CHOSE" -> state_transition = "VERIFYING_AVAILABILITY", selected_finca_id, selected_finca, waiting_for = "OWNER"
  - si intent = "SHOW_OPTIONS" -> shown_fincas = fincas_mostradas
  - si intent = "ADJUST_CRITERIA" -> mergea search_criteria_update
- verifying_availability_agent:
  - normalmente no cambia estado; mantiene waiting_for = "OWNER"
  - si intent = "CHANGE_FINCA" -> state_transition = "OFFERING"
- qa_agent:
  - no cambia estado, pero debe devolver una respuesta que retome el flujo
- Si action = "HITL": agente_activo = false

Si un campo no cambia, usa "__IGNORE__".`,
    },
};
orchestrator.position = [-6080, 2240];

const qualifyingAgent = cloneNode('qualifying_agent1');
qualifyingAgent.name = 'qualifying_agent';
qualifyingAgent.position = [-6288, 2688];

const offeringAgent = {
  id: newId(),
  name: 'offering_agent',
  type: '@n8n/n8n-nodes-langchain.agentTool',
  typeVersion: 3,
  position: [-6032, 2528],
  parameters: {
    toolDescription:
      '**offering_agent**\nMuestra y ajusta la oferta de fincas. Debe usar solo el inventario normalizado, evitar repetir fincas ya mostradas y capturar elección o ajuste de criterios.',
    text: String.raw`=Hoy es {{ new Date().toLocaleString("sv-SE", { timeZone: "America/Bogota" }).slice(0, 10) }}.

CONTEXT:
{{ JSON.stringify($('Get Context-conversations1').item.json.context, null, 2) }}

INVENTORY:
{{ JSON.stringify($('Prepare Inventory Payload').item.json.inventory || [], null, 2) }}

RECENT_MESSAGES:
{{ JSON.stringify($('Fetch messages1').item.json.recent_messages || [], null, 2) }}

CURRENT_MESSAGE:
{{ JSON.stringify($('Merge Sets1').item.json['last-message'] || null, null, 2) }}

INSTRUCCIÓN:
- Usa solo las fincas del inventario.
- Prioriza coincidencia por zona, personas, noches mínimas y prioridad.
- Evita repetir fincas ya incluidas en context.shown_fincas.
- Muestra máximo 3 opciones.
- Si current_message es vacío, estás en el segundo ciclo y debes mostrar directamente opciones o retomar el estado.`,
    options: {
      systemMessage: String.raw`=Eres el agente del estado OFFERING del sistema "De Paseo en Finca".

OBJETIVO
- Presentar hasta 3 fincas relevantes.
- Capturar si el cliente elige una finca.
- Permitir ajuste de criterios sin romper el flujo.

REGLAS
{{ $('config').item.json.tono }}
- Nunca inventes fincas.
- Si owner_unavailable = true o context.owner_response.disponible = false, primero informa que la opción anterior no estaba disponible y luego muestra alternativas.
- Si no hay inventario configurado o no hay coincidencias, dilo con claridad y pide ajustar criterios.
- Si el cliente solo pregunta algo puntual de una finca ya mostrada, responde breve y sigue pidiendo elección.

OUTPUT
Responde EXCLUSIVAMENTE en JSON válido con este schema:
{
  "respuesta": "texto para el cliente",
  "intent": "SHOW_OPTIONS | CLIENT_CHOSE | ADJUST_CRITERIA | NO_MATCH | QUESTION | HITL_REQUEST | CANCEL",
  "finca_elegida_id": null | "string",
  "selected_finca": null | {
    "finca_id": "string",
    "nombre": "string"
  },
  "fincas_mostradas": [],
  "search_criteria_update": {}
}`,
    },
  },
};

const verifyingAgent = {
  id: newId(),
  name: 'verifying_availability_agent',
  type: '@n8n/n8n-nodes-langchain.agentTool',
  typeVersion: 3,
  position: [-5776, 2528],
  parameters: {
    toolDescription:
      '**verifying_availability_agent**\nSostiene la conversación mientras se espera la respuesta del propietario. Nunca confirma disponibilidad por su cuenta.',
    text: String.raw`=CONTEXT:
{{ JSON.stringify($('Get Context-conversations1').item.json.context, null, 2) }}

RECENT_MESSAGES:
{{ JSON.stringify($('Fetch messages1').item.json.recent_messages || [], null, 2) }}

CURRENT_MESSAGE:
{{ JSON.stringify($('Merge Sets1').item.json['last-message'] || null, null, 2) }}`,
    options: {
      systemMessage: String.raw`=Eres el agente del estado VERIFYING_AVAILABILITY.

OBJETIVO
- Informar que estás validando con el propietario.
- Mantener al cliente contenido sin prometer disponibilidad.
- Permitir cambio de finca si el cliente lo pide.

REGLAS
{{ $('config').item.json.tono }}
- Nunca confirmes disponibilidad sin owner_response.disponible = true.
- No hables de pagos, anticipo, reservas ni cierres comerciales en esta fase.
- Si el cliente pide otra finca, marca CHANGE_FINCA.
- Si hace una pregunta simple sobre la finca elegida, respóndela sin salir del estado.
- Si ya se confirmó disponibilidad, el handoff a humano lo resuelve el orquestador, no tú.

OUTPUT
Devuelve EXCLUSIVAMENTE JSON válido:
{
  "respuesta": "texto para el cliente",
  "intent": "WAITING_OWNER | CHANGE_FINCA | QUESTION | HITL_REQUEST | CANCEL",
  "finca_elegida_id": null | "string"
}`,
    },
  },
};

const negotiatingAgent = {
  id: newId(),
  name: 'negotiating_agent',
  type: '@n8n/n8n-nodes-langchain.agentTool',
  typeVersion: 3,
  position: [-5520, 2528],
  parameters: {
    toolDescription:
      '**negotiating_agent**\nPresenta precio, depósito y negociación controlada a partir de la finca elegida y del owner_response.',
    text: String.raw`=CONTEXT:
{{ JSON.stringify($('Get Context-conversations1').item.json.context, null, 2) }}

SELECTED_FINCA:
{{ JSON.stringify($('Get Context-conversations1').item.json.context?.selected_finca || null, null, 2) }}

OWNER_RESPONSE:
{{ JSON.stringify($('Get Context-conversations1').item.json.context?.owner_response || null, null, 2) }}

RECENT_MESSAGES:
{{ JSON.stringify($('Fetch messages1').item.json.recent_messages || [], null, 2) }}

CURRENT_MESSAGE:
{{ JSON.stringify($('Merge Sets1').item.json['last-message'] || null, null, 2) }}`,
    options: {
      systemMessage: String.raw`=Eres el agente del estado NEGOTIATING.

OBJETIVO
- Presentar precio y condiciones comerciales.
- Negociar dentro del descuento máximo permitido.
- Cuando el cliente acepta, cerrar la automatización y pasar a humano.

REGLAS
{{ $('config').item.json.tono }}
- Usa primero owner_response.precio_noche si existe. Si no, usa selected_finca.precio_noche_base.
- Calcula noches desde fecha_inicio y fecha_fin cuando estén presentes.
- Usa deposito_seguridad y precio_persona_extra si existen.
- No ofrezcas descuentos por encima de selected_finca.descuento_max_pct.
- Si el cliente acepta el precio o pide reservar, marca ACCEPTED.
- Si rechaza el precio y quiere volver a ver opciones, marca REJECT_PRICE.

OUTPUT
Devuelve EXCLUSIVAMENTE JSON válido:
{
  "respuesta": "texto para el cliente",
  "intent": "PRICE_PRESENTED | NEGOTIATION | ACCEPTED | REJECT_PRICE | QUESTION | HITL_REQUEST | CANCEL",
  "pricing": {
    "precio_noche": null,
    "noches": null,
    "subtotal": null,
    "deposito_seguridad": null,
    "total": null,
    "anticipo_requerido": null,
    "descuento_pct_aplicado": null
  },
  "extras_update": {}
}`,
    },
  },
};

const qaAgent = {
  id: newId(),
  name: 'qa_agent',
  type: '@n8n/n8n-nodes-langchain.agentTool',
  typeVersion: 3,
  position: [-5264, 2528],
  parameters: {
    toolDescription:
      '**qa_agent**\nResponde preguntas puntuales sin romper el estado comercial y retoma el hilo de la conversación.',
    text: String.raw`=CONTEXT:
{{ JSON.stringify($('Get Context-conversations1').item.json.context, null, 2) }}

INVENTORY:
{{ JSON.stringify($('Prepare Inventory Payload').item.json.inventory || [], null, 2) }}

RECENT_MESSAGES:
{{ JSON.stringify($('Fetch messages1').item.json.recent_messages || [], null, 2) }}

CURRENT_MESSAGE:
{{ JSON.stringify($('Merge Sets1').item.json['last-message'] || null, null, 2) }}`,
    options: {
      systemMessage: String.raw`=Eres el agente QA flotante del sistema comercial.

OBJETIVO
- Responder preguntas puntuales sobre fincas, amenidades, mascotas, parqueadero, horarios o proceso.
- No cambies el estado de la conversación.
- Tu respuesta debe retomar el hilo comercial al final.

REGLAS
{{ $('config').item.json.tono }}
- Si no tienes el dato en inventory o context, dilo y ofrece ayuda parcial.
- No reveles ubicación exacta ni contacto del propietario.

OUTPUT
Devuelve EXCLUSIVAMENTE JSON válido:
{
  "respuesta": "texto para el cliente",
  "intent": "QA_ANSWERED",
  "search_criteria_update": {}
}`,
    },
  },
};

const codeNode = cloneNode('Code in JavaScript1');
codeNode.parameters = {
  jsCode: String.raw`function stripCodeFences(str) {
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
    if (Array.isArray(toolOutput?.fincas_mostradas) && !raw.shown_fincas) raw.shown_fincas = toolOutput.fincas_mostradas;
    if (toolOutput?.search_criteria_update && !raw.search_criteria) raw.search_criteria = compactCriteria(toolOutput.search_criteria_update);
    if (toolOutput?.intent === 'CLIENT_CHOSE') {
      raw.state_transition ||= 'VERIFYING_AVAILABILITY';
      raw.selected_finca_id ||= toolOutput.finca_elegida_id || '__IGNORE__';
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

  if (tool === 'negotiating_agent') {
    if (toolOutput?.pricing && !raw.pricing) raw.pricing = toolOutput.pricing;
    if (toolOutput?.extras_update && !raw.extras) raw.extras = toolOutput.extras_update;
    if (intent === 'ACCEPTED' && raw.agente_activo === undefined) raw.agente_activo = false;
    if (intent === 'REJECT_PRICE') {
      raw.state_transition ||= 'OFFERING';
      raw.selected_finca_id ||= '__CLEAR__';
      raw.selected_finca ||= '__CLEAR__';
      raw.waiting_for ||= 'CLIENT';
    }
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

const handoffText = 'Te voy a pasar con un asesor humano para continuar con tu solicitud.';
const finalWhatsappText =
  parsed?.final_whatsapp_text ||
  toolOutputParsed?.respuesta ||
  (action === 'HITL' ? handoffText : null);
const hasCustomerFacingMessage = Boolean(String(finalWhatsappText || '').trim());
const shouldImmediateLoop = currentStateChanged && !hasCustomerFacingMessage;

return [
  {
    json: {
      parsed,
      tool_output_parsed: toolOutputParsed,
      normalized_post_actions: normalizedPostActions,
      final_whatsapp_text: finalWhatsappText,
      outbound_message: finalWhatsappText,
      current_state_changed: currentStateChanged,
      should_immediate_loop: shouldImmediateLoop,
      tool_chosen: toolChosen,
      action,
      conversation_key:
        parsed?.tool_input?.context?.conversation?.id || $('Merge Sets1').item.json.conversation_key,
    },
  },
];`,
};
codeNode.position = [-5808, 2240];

const updateContext = cloneNode('actualizar contexto1');
updateContext.parameters = {
  operation: 'executeQuery',
  query: String.raw`with payload as (
  select
    {{ "'" + String($json.conversation_key).replace(/'/g, "''") + "'" }}::varchar as wa_id,
    {{ "'" + JSON.stringify($json.normalized_post_actions || {}).replace(/'/g, "''") + "'" }}::jsonb as p,
    {{
      $json.outbound_message
        ? "'" + String($json.outbound_message).replace(/'/g, "''") + "'"
        : "null"
    }}::text as outbound_message
)
update public.conversations c
set
  previous_state = case
    when coalesce(payload.p->>'state_transition', '__IGNORE__') <> '__IGNORE__'
      and payload.p->>'state_transition' <> c.current_state
    then c.current_state
    else c.previous_state
  end,
  current_state = case
    when coalesce(payload.p->>'state_transition', '__IGNORE__') <> '__IGNORE__'
    then payload.p->>'state_transition'
    else c.current_state
  end,
  state_changed_at = case
    when coalesce(payload.p->>'state_transition', '__IGNORE__') <> '__IGNORE__'
      and payload.p->>'state_transition' <> c.current_state
    then now()
    else c.state_changed_at
  end,
  search_criteria = case
    when coalesce(payload.p->>'search_criteria', '__IGNORE__') = '__IGNORE__'
      then c.search_criteria
    else coalesce(c.search_criteria, '{}'::jsonb) || coalesce(payload.p->'search_criteria', '{}'::jsonb)
  end,
  waiting_for = case
    when coalesce(payload.p->>'waiting_for', '__IGNORE__') <> '__IGNORE__'
    then payload.p->>'waiting_for'
    else c.waiting_for
  end,
  agente_activo = case
    when jsonb_typeof(payload.p->'agente_activo') = 'boolean'
      then (payload.p->>'agente_activo')::boolean
    else c.agente_activo
  end,
  shown_fincas = case
    when coalesce(payload.p->>'shown_fincas', '__IGNORE__') = '__IGNORE__'
      then c.shown_fincas
    else (
      select coalesce(array_agg(distinct value), '{}'::text[])
      from jsonb_array_elements_text(
        coalesce(to_jsonb(c.shown_fincas), '[]'::jsonb) || coalesce(payload.p->'shown_fincas', '[]'::jsonb)
      )
    )
  end,
  selected_finca_id = case
    when coalesce(payload.p->>'selected_finca_id', '__IGNORE__') = '__IGNORE__'
      then c.selected_finca_id
    when payload.p->>'selected_finca_id' = '__CLEAR__'
      then null
    else payload.p->>'selected_finca_id'
  end,
  selected_finca = case
    when coalesce(payload.p->>'selected_finca', '__IGNORE__') = '__IGNORE__'
      then c.selected_finca
    when payload.p->>'selected_finca' = '__CLEAR__'
      then null
    else payload.p->'selected_finca'
  end,
  owner_response = case
    when coalesce(payload.p->>'owner_response', '__IGNORE__') = '__IGNORE__'
      then c.owner_response
    when payload.p->>'owner_response' = '__CLEAR__'
      then null
    else payload.p->'owner_response'
  end,
  precio_noche = case
    when jsonb_typeof(payload.p->'pricing') = 'object' and payload.p->'pricing' ? 'precio_noche'
      then nullif(payload.p->'pricing'->>'precio_noche', '')::numeric
    else c.precio_noche
  end,
  noches = case
    when jsonb_typeof(payload.p->'pricing') = 'object' and payload.p->'pricing' ? 'noches'
      then nullif(payload.p->'pricing'->>'noches', '')::integer
    else c.noches
  end,
  subtotal = case
    when jsonb_typeof(payload.p->'pricing') = 'object' and payload.p->'pricing' ? 'subtotal'
      then nullif(payload.p->'pricing'->>'subtotal', '')::numeric
    else c.subtotal
  end,
  deposito_seguridad = case
    when jsonb_typeof(payload.p->'pricing') = 'object' and payload.p->'pricing' ? 'deposito_seguridad'
      then nullif(payload.p->'pricing'->>'deposito_seguridad', '')::numeric
    else c.deposito_seguridad
  end,
  total = case
    when jsonb_typeof(payload.p->'pricing') = 'object' and payload.p->'pricing' ? 'total'
      then nullif(payload.p->'pricing'->>'total', '')::numeric
    else c.total
  end,
  anticipo_requerido = case
    when jsonb_typeof(payload.p->'pricing') = 'object' and payload.p->'pricing' ? 'anticipo_requerido'
      then nullif(payload.p->'pricing'->>'anticipo_requerido', '')::numeric
    else c.anticipo_requerido
  end,
  extras = case
    when coalesce(payload.p->>'extras', '__IGNORE__') = '__IGNORE__'
      then c.extras
    else payload.p->'extras'
  end,
  next_followup_at = case
    when (
      case
        when jsonb_typeof(payload.p->'agente_activo') = 'boolean'
          then (payload.p->>'agente_activo')::boolean
        else c.agente_activo
      end
    ) = false then null
    when c.followup_enabled = false then c.next_followup_at
    when (
      case
        when coalesce(payload.p->>'waiting_for', '__IGNORE__') <> '__IGNORE__'
          then payload.p->>'waiting_for'
        else c.waiting_for
      end
    ) = 'CLIENT' and payload.outbound_message is not null then coalesce(c.next_followup_at, now() + interval '2 hours')
    else c.next_followup_at
  end,
  last_interaction = now(),
  updated_at = now()
from payload
where c.wa_id = payload.wa_id
returning c.*;`,
    options: {},
};
updateContext.position = [-5552, 2240];

const chatNode = cloneNode('Chat');
chatNode.parameters = {
  message:
    "={{ $('Code in JavaScript1').item.json.outbound_message || 'Te voy a pasar con un asesor humano para continuar con tu solicitud.' }}",
  options: {},
};
chatNode.position = [-5312, 2240];

const ifInsertInbound = cloneNode('If3');
ifInsertInbound.position = [-5056, 2240];

const insertInbound = cloneNode('Insert INBOUND message (messages)1');
insertInbound.parameters = {
  operation: 'executeQuery',
  query: String.raw`insert into public.messages (
  conversation_id,
  direction,
  message_type,
  content,
  media_url,
  state_at_time,
  agent_used,
  extracted_data
)
values (
  {{ "'" + String($('Merge Sets1').item.json.conversation_key).replace(/'/g, "''") + "'" }},
  'INBOUND',
  {{ "'" + String($('Merge Sets1').item.json.message_type || 'TEXT').replace(/'/g, "''") + "'" }},
  {{
    $('Merge Sets1').item.json['last-message']
      ? "'" + String($('Merge Sets1').item.json['last-message']).replace(/'/g, "''") + "'"
      : "null"
  }},
  null,
  {{ "'" + String($('Get Context-conversations1').item.json.current_state || 'QUALIFYING').replace(/'/g, "''") + "'" }},
  'USER',
  '{}'::jsonb
)
returning id, created_at;`,
    options: {},
};
insertInbound.position = [-4800, 2096];

const insertOutbound = cloneNode('Insert OUTBOUND message (messages)');
insertOutbound.parameters = {
  operation: 'executeQuery',
  query: String.raw`with inserted_message as (
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
  values (
    {{ "'" + String($('Merge Sets1').item.json.conversation_key).replace(/'/g, "''") + "'" }},
    'OUTBOUND',
    'TEXT',
    {{
      $('Code in JavaScript1').item.json.outbound_message
        ? "'" + String($('Code in JavaScript1').item.json.outbound_message).replace(/'/g, "''") + "'"
        : "'Te voy a pasar con un asesor humano para continuar con tu solicitud.'"
    }},
    null,
    {{
      $('actualizar contexto1').item.json.current_state
        ? "'" + String($('actualizar contexto1').item.json.current_state).replace(/'/g, "''") + "'"
        : "null"
    }},
    {{
      $('Code in JavaScript1').item.json.tool_chosen
        ? "'" + String($('Code in JavaScript1').item.json.tool_chosen).replace(/'/g, "''") + "'"
        : "'NONE'"
    }},
    {{ "'" + JSON.stringify($('Code in JavaScript1').item.json.tool_output_parsed?.datos_extraidos || {}).replace(/'/g, "''") + "'::jsonb" }}
  )
  returning id
)
update public.conversations
set
  last_interaction = now(),
  last_message_from = 'AGENT',
  updated_at = now()
where wa_id = {{ "'" + String($('Merge Sets1').item.json.conversation_key).replace(/'/g, "''") + "'" }}
returning wa_id;`,
    options: {},
};
insertOutbound.position = [-4560, 2240];

const ifLoop = cloneNode('If2');
ifLoop.parameters = {
  conditions: {
    options: {
      caseSensitive: true,
      leftValue: '',
      typeValidation: 'loose',
      version: 3,
    },
    conditions: [
      {
        id: newId(),
        leftValue: "={{ $('Code in JavaScript1').item.json.should_immediate_loop === true }}",
        rightValue: '',
        operator: {
          type: 'boolean',
          operation: 'true',
          singleValue: true,
        },
      },
    ],
    combinator: 'and',
  },
  looseTypeValidation: true,
  options: {},
};
ifLoop.position = [-4304, 2240];

const editFields = cloneNode('Edit Fields1');
editFields.parameters = {
  assignments: {
    assignments: [
      {
        id: newId(),
        name: 'insertar_mensjae',
        value: false,
        type: 'boolean',
      },
      {
        id: newId(),
        name: 'last-message',
        value: '',
        type: 'string',
      },
    ],
  },
  options: {},
};
editFields.position = [-4048, 2096];

const followOn = {
  id: newId(),
  name: 'Agregar follow on',
  type: 'n8n-nodes-base.postgres',
  typeVersion: 2.6,
  position: [-4048, 2384],
  credentials: insertOutbound.credentials,
  parameters: {
    operation: 'executeQuery',
    query: String.raw`update public.conversations
set
  next_followup_at = case
    when agente_activo = false or followup_enabled = false then null
    when waiting_for = 'CLIENT' and last_message_from = 'AGENT' then
      case
        when followup_count <= 0 then now() + interval '2 hours'
        when followup_count = 1 then now() + interval '24 hours'
        else now() + interval '72 hours'
      end
    else next_followup_at
  end,
  updated_at = now()
where wa_id = {{ "'" + String($('Merge Sets1').item.json.conversation_key).replace(/'/g, "''") + "'" }}
returning wa_id, next_followup_at, followup_count, waiting_for;`,
    options: {},
  },
};

main.nodes.push(
  chatTrigger,
  filterMessages,
  executionData,
  config,
  mergeSets,
  getContext,
  fetchMessages,
  hasInventoryConfig,
  getInventorySheet,
  normalizeInventory,
  inventoryNotConfigured,
  prepareInventory,
  model,
  orchestrator,
  qualifyingAgent,
  offeringAgent,
  verifyingAgent,
  negotiatingAgent,
  qaAgent,
  codeNode,
  updateContext,
  chatNode,
  ifInsertInbound,
  insertInbound,
  insertOutbound,
  ifLoop,
  editFields,
  followOn,
);

main.connections = {
  'When chat message received': {
    main: [[{ node: 'Filtro Mensajes', type: 'main', index: 0 }]],
  },
  'Filtro Mensajes': {
    main: [[{ node: 'Execution Data1', type: 'main', index: 0 }]],
  },
  ExecutionData1: undefined,
};

main.connections['Execution Data1'] = {
  main: [[{ node: 'config', type: 'main', index: 0 }]],
};
main.connections.config = {
  main: [[{ node: 'Merge Sets1', type: 'main', index: 0 }]],
};
main.connections['Merge Sets1'] = {
  main: [[{ node: 'Get Context-conversations1', type: 'main', index: 0 }]],
};
main.connections['Get Context-conversations1'] = {
  main: [[{ node: 'Fetch messages1', type: 'main', index: 0 }]],
};
main.connections['Fetch messages1'] = {
  main: [[{ node: 'Has Inventory Config', type: 'main', index: 0 }]],
};
main.connections['Has Inventory Config'] = {
  main: [
    [{ node: 'Get row(s) in fincas sheet', type: 'main', index: 0 }],
    [{ node: 'Inventory not configured', type: 'main', index: 0 }],
  ],
};
main.connections['Get row(s) in fincas sheet'] = {
  main: [[{ node: 'Normalize Inventory', type: 'main', index: 0 }]],
};
main.connections['Normalize Inventory'] = {
  main: [[{ node: 'Prepare Inventory Payload', type: 'main', index: 0 }]],
};
main.connections['Inventory not configured'] = {
  main: [[{ node: 'Prepare Inventory Payload', type: 'main', index: 0 }]],
};
main.connections['Prepare Inventory Payload'] = {
  main: [[{ node: 'Orquestador AI1', type: 'main', index: 0 }]],
};
main.connections['Google Gemini Chat Model1'] = {
  ai_languageModel: [[
    { node: 'Orquestador AI1', type: 'ai_languageModel', index: 0 },
    { node: 'qualifying_agent', type: 'ai_languageModel', index: 0 },
    { node: 'offering_agent', type: 'ai_languageModel', index: 0 },
    { node: 'verifying_availability_agent', type: 'ai_languageModel', index: 0 },
    { node: 'negotiating_agent', type: 'ai_languageModel', index: 0 },
    { node: 'qa_agent', type: 'ai_languageModel', index: 0 },
  ]],
};
main.connections['qualifying_agent'] = {
  ai_tool: [[{ node: 'Orquestador AI1', type: 'ai_tool', index: 0 }]],
};
main.connections['offering_agent'] = {
  ai_tool: [[{ node: 'Orquestador AI1', type: 'ai_tool', index: 0 }]],
};
main.connections['verifying_availability_agent'] = {
  ai_tool: [[{ node: 'Orquestador AI1', type: 'ai_tool', index: 0 }]],
};
main.connections['qa_agent'] = {
  ai_tool: [[{ node: 'Orquestador AI1', type: 'ai_tool', index: 0 }]],
};
main.connections['Orquestador AI1'] = {
  main: [[{ node: 'Code in JavaScript1', type: 'main', index: 0 }]],
};
main.connections['Code in JavaScript1'] = {
  main: [[{ node: 'actualizar contexto1', type: 'main', index: 0 }]],
};
main.connections['actualizar contexto1'] = {
  main: [[{ node: 'Chat', type: 'main', index: 0 }]],
};
main.connections.Chat = {
  main: [[{ node: 'If3', type: 'main', index: 0 }]],
};
main.connections.If3 = {
  main: [
    [{ node: 'Insert INBOUND message (messages)1', type: 'main', index: 0 }],
    [{ node: 'Insert OUTBOUND message (messages)', type: 'main', index: 0 }],
  ],
};
main.connections['Insert INBOUND message (messages)1'] = {
  main: [[{ node: 'Insert OUTBOUND message (messages)', type: 'main', index: 0 }]],
};
main.connections['Insert OUTBOUND message (messages)'] = {
  main: [[{ node: 'If2', type: 'main', index: 0 }]],
};
main.connections.If2 = {
  main: [
    [{ node: 'Edit Fields1', type: 'main', index: 0 }],
    [{ node: 'Agregar follow on', type: 'main', index: 0 }],
  ],
};
main.connections['Edit Fields1'] = {
  main: [[{ node: 'Merge Sets1', type: 'main', index: 0 }]],
};
main.connections['Agregar follow on'] = { main: [[]] };

delete main.connections.ExecutionData1;

const admin = {
  name: 'De paseo en fincas owner admin commands',
  nodes: [],
  connections: {},
  settings: {
    executionOrder: 'v1',
    availableInMCP: false,
    callerPolicy: 'workflowsFromSameOwner',
  },
  staticData: null,
};

const adminChatTrigger = {
  ...cloneNode('When chat message received'),
  id: newId(),
  name: 'When admin chat message received',
  position: [-2128, 2240],
};
adminChatTrigger.webhookId = newId();
adminChatTrigger.parameters = {
  ...(adminChatTrigger.parameters || {}),
  options: {
    ...(adminChatTrigger.parameters?.options || {}),
    responseMode: 'responseNode',
  },
};

const adminFilter = {
  id: newId(),
  name: 'Filtro admin commands',
  type: 'n8n-nodes-base.filter',
  typeVersion: 2.3,
  position: [-1888, 2240],
  parameters: {
    conditions: {
      options: {
        caseSensitive: false,
        leftValue: '',
        typeValidation: 'loose',
        version: 3,
      },
      conditions: [
        {
          id: newId(),
          leftValue:
            "={{ /^\\/(disponible|no-disponible)\\b/i.test(String($json.chatInput || '').trim()) }}",
          rightValue: '',
          operator: {
            type: 'boolean',
            operation: 'true',
            singleValue: true,
          },
        },
      ],
      combinator: 'and',
    },
    looseTypeValidation: true,
    options: {},
  },
};

const adminParse = {
  id: newId(),
  name: 'Parse admin command',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [-1648, 2240],
  parameters: {
    jsCode: String.raw`const input = String($json.chatInput || '').trim();
const matchDisponible = input.match(/^\/disponible\s+(\S+)\s+(\S+)\s+([0-9.,]+)$/i);
const matchNoDisponible = input.match(/^\/no-disponible\s+(\S+)\s+(\S+)$/i);

let valid = false;
let command = null;
let fincaId = null;
let conversationKey = null;
let precioNoche = null;
let ownerResponse = null;

if (matchDisponible) {
  valid = true;
  command = 'disponible';
  fincaId = matchDisponible[1];
  conversationKey = matchDisponible[2];
  precioNoche = Number(matchDisponible[3].replace(/[^\d.-]/g, ''));
  ownerResponse = {
    disponible: true,
    finca_id: fincaId,
    precio_noche: Number.isFinite(precioNoche) ? precioNoche : null,
    responded_at: new Date().toISOString(),
    source: 'admin_chat',
  };
}

if (matchNoDisponible) {
  valid = true;
  command = 'no-disponible';
  fincaId = matchNoDisponible[1];
  conversationKey = matchNoDisponible[2];
  ownerResponse = {
    disponible: false,
    finca_id: fincaId,
    responded_at: new Date().toISOString(),
    source: 'admin_chat',
  };
}

return [
  {
    json: {
      input,
      valid,
      command,
      finca_id: fincaId,
      conversation_key: conversationKey,
      precio_noche: precioNoche,
      owner_response: ownerResponse,
    },
  },
];`,
  },
};

const adminIfValid = {
  id: newId(),
  name: 'If admin command valid',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.3,
  position: [-1408, 2240],
  parameters: {
    conditions: {
      options: {
        caseSensitive: true,
        leftValue: '',
        typeValidation: 'loose',
        version: 3,
      },
      conditions: [
        {
          id: newId(),
          leftValue: '={{ $json.valid === true }}',
          rightValue: '',
          operator: {
            type: 'boolean',
            operation: 'true',
            singleValue: true,
          },
        },
      ],
      combinator: 'and',
    },
    looseTypeValidation: true,
    options: {},
  },
};

const adminUpdateOwner = {
  id: newId(),
  name: 'Update owner response',
  type: 'n8n-nodes-base.postgres',
  typeVersion: 2.6,
  position: [-1168, 2096],
  credentials: getContext.credentials,
  parameters: {
    operation: 'executeQuery',
    query: String.raw`update public.conversations
set
  owner_response = {{ "'" + JSON.stringify($json.owner_response).replace(/'/g, "''") + "'::jsonb" }},
  waiting_for = 'CLIENT',
  last_interaction = now(),
  updated_at = now()
where wa_id = {{ "'" + String($json.conversation_key).replace(/'/g, "''") + "'" }}
returning wa_id, current_state, owner_response;`,
    options: {},
  },
};

const adminValidResponse = {
  id: newId(),
  name: 'Build valid admin response',
  type: 'n8n-nodes-base.set',
  typeVersion: 3.4,
  position: [-928, 2096],
  parameters: {
    assignments: {
      assignments: [
        {
          id: newId(),
          name: 'response_text',
          value:
            "={{ $json.wa_id ? 'Listo. Registré la respuesta del propietario para la conversación ' + $json.wa_id + '.' : 'No encontré esa conversación en Postgres.' }}",
          type: 'string',
        },
      ],
    },
    options: {},
  },
};

const adminInvalidResponse = {
  id: newId(),
  name: 'Build invalid admin response',
  type: 'n8n-nodes-base.set',
  typeVersion: 3.4,
  position: [-1168, 2384],
  parameters: {
    assignments: {
      assignments: [
        {
          id: newId(),
          name: 'response_text',
          value:
            "='Comando inválido. Usa /disponible <finca_id> <conversation_key> <precio_noche> o /no-disponible <finca_id> <conversation_key>'",
          type: 'string',
        },
      ],
    },
    options: {},
  },
};

const adminChat = {
  ...cloneNode('Chat'),
  id: newId(),
  name: 'Admin Chat',
  position: [-688, 2240],
  parameters: {
    message: '={{ $json.response_text }}',
    options: {},
  },
};
adminChat.webhookId = newId();

admin.nodes.push(
  adminChatTrigger,
  adminFilter,
  adminParse,
  adminIfValid,
  adminUpdateOwner,
  adminValidResponse,
  adminInvalidResponse,
  adminChat,
);

admin.connections = {
  'When admin chat message received': {
    main: [[{ node: 'Filtro admin commands', type: 'main', index: 0 }]],
  },
  'Filtro admin commands': {
    main: [[{ node: 'Parse admin command', type: 'main', index: 0 }]],
  },
  'Parse admin command': {
    main: [[{ node: 'If admin command valid', type: 'main', index: 0 }]],
  },
  'If admin command valid': {
    main: [
      [{ node: 'Update owner response', type: 'main', index: 0 }],
      [{ node: 'Build invalid admin response', type: 'main', index: 0 }],
    ],
  },
  'Update owner response': {
    main: [[{ node: 'Build valid admin response', type: 'main', index: 0 }]],
  },
  'Build valid admin response': {
    main: [[{ node: 'Admin Chat', type: 'main', index: 0 }]],
  },
  'Build invalid admin response': {
    main: [[{ node: 'Admin Chat', type: 'main', index: 0 }]],
  },
};

fs.mkdirSync(path.join(cwd, 'scripts'), { recursive: true });
fs.writeFileSync(outMainPath, stringify(main));
fs.writeFileSync(outAdminPath, stringify(admin));

console.log(`Wrote ${outMainPath}`);
console.log(`Wrote ${outAdminPath}`);
