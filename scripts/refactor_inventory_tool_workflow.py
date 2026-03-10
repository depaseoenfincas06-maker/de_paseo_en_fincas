#!/usr/bin/env python3
import json
import os
import sys
import uuid
from copy import deepcopy
from pathlib import Path


def new_id():
    return str(uuid.uuid4())


def load_env(path: Path) -> dict:
    env = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def find_node(workflow: dict, name: str) -> dict:
    for node in workflow["nodes"]:
        if node.get("name") == name:
            return node
    raise KeyError(f"Node not found: {name}")


def ensure_node(workflow: dict, name: str, node: dict) -> dict:
    for index, existing in enumerate(workflow["nodes"]):
        if existing.get("name") == name:
            workflow["nodes"][index] = node
            return node
    workflow["nodes"].append(node)
    return node


def rename_connection_targets(connections: dict, old_name: str, new_name: str) -> None:
    if old_name in connections:
        connections[new_name] = connections.pop(old_name)
    for mapping in connections.values():
        for groups in mapping.values():
            for group in groups:
                for edge in group:
                    if edge.get("node") == old_name:
                        edge["node"] = new_name


def make_workflow_tool_field(display_name: str, value: str, field_type: str = "string") -> dict:
    return {
        "id": new_id(),
        "displayName": display_name,
        "required": False,
        "defaultMatch": False,
        "display": True,
        "canBeUsedToMatch": True,
        "type": field_type,
        "removed": False,
        "stringValue": value,
    }


def inventory_normalize_code() -> str:
    return r"""const rows = $input.all().map((item) => item.json || {});

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

const activeInventory = inventory.filter((item) => item.activa);

return [
  {
    json: {
      inventory: activeInventory,
      inventory_meta: {
        configured: true,
        count: activeInventory.length,
        total_rows: inventory.length,
      },
    },
  },
];"""


def inventory_response_code() -> str:
    return r"""const payload = $('When inventory tool is called').item.json || {};
const inventory = Array.isArray($json.inventory) ? $json.inventory : [];
const meta = $json.inventory_meta || { configured: false, count: 0, reason: 'inventory_sheet_disabled_or_missing' };

const normalizeText = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const compact = (value) => (value === undefined || value === null ? '' : String(value).trim());

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

const sanitizeListItem = (item) => ({
  finca_id: item.finca_id,
  nombre: item.nombre,
  zona: item.zona,
  municipio: item.municipio,
  capacidad_max: item.capacidad_max,
  min_noches: item.min_noches,
  precio_noche_base: item.precio_noche_base,
  precio_fin_semana: item.precio_fin_semana,
  precio_persona_extra: item.precio_persona_extra,
  pet_friendly: item.pet_friendly,
  amenidades: item.amenidades,
  tipo_evento: item.tipo_evento,
  descripcion_corta: item.descripcion_corta,
  foto_url: item.foto_url,
  owner_nombre: item.owner_nombre,
  descuento_max_pct: item.descuento_max_pct,
});

const sanitizeDetailItem = (item) => ({
  ...sanitizeListItem(item),
  deposito_seguridad: item.deposito_seguridad,
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
const nights = calculateNights(payload.context_fecha_inicio, payload.context_fecha_fin);
const limit = Math.max(1, Math.min(5, toNumber(payload.limit, 3) || 3));
const shownFincas = new Set(parseJsonArray(payload.shown_fincas_json).map((item) => String(item)));
const tokens = tokenise([query, explicitName, explicitFincaId].filter(Boolean).join(' '));

const scoreItem = (item) => {
  let score = 0;
  if (explicitFincaId && normalizeText(item.finca_id) === normalizeText(explicitFincaId)) score += 1000;
  if (explicitName && normalizeText(item.nombre).includes(normalizeText(explicitName))) score += 250;
  if (zona) {
    if (normalizeText(item.zona).includes(normalizeText(zona))) score += 120;
    if (normalizeText(item.municipio).includes(normalizeText(zona))) score += 90;
  }
  if (personas !== null && item.capacidad_max !== null) {
    if (item.capacidad_max >= personas) score += 60;
    else score -= 200;
  }
  if (nights !== null && item.min_noches !== null) {
    if (item.min_noches <= nights) score += 20;
    else score -= 120;
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
      if (haystack.includes(token)) score += 18;
    }
  }
  score -= Number(item.prioridad || 999) / 1000;
  return score;
};

const ranked = inventory
  .map((item) => ({ item, score: scoreItem(item) }))
  .filter(({ score }) => score > -150)
  .sort((a, b) => b.score - a.score || Number(a.item.prioridad || 999) - Number(b.item.prioridad || 999) || String(a.item.nombre).localeCompare(String(b.item.nombre)))
  .map(({ item }) => item);

const findBestMatch = () => {
  if (!meta.configured || !inventory.length) return null;
  if (explicitFincaId) {
    const exact = inventory.find((item) => normalizeText(item.finca_id) === normalizeText(explicitFincaId));
    if (exact) return exact;
  }
  return ranked[0] || null;
};

if (!meta.configured) {
  return [
    {
      json: {
        configured: false,
        operation,
        matched_count: 0,
        items: [],
        selected_finca: null,
        owner: null,
        search_applied: {
          zona,
          personas,
          nights,
          query,
          excluded_finca_ids: Array.from(shownFincas),
        },
        notes: meta.reason || 'inventory_sheet_disabled_or_missing',
      },
    },
  ];
}

if (operation === 'list_matching_fincas') {
  const filtered = ranked
    .filter((item) => !shownFincas.has(String(item.finca_id)))
    .slice(0, limit)
    .map(sanitizeListItem);

  return [
    {
      json: {
        configured: true,
        operation,
        matched_count: filtered.length,
        items: filtered,
        selected_finca: null,
        owner: null,
        search_applied: {
          zona,
          personas,
          nights,
          query,
          excluded_finca_ids: Array.from(shownFincas),
        },
        notes: filtered.length ? null : 'no_match',
      },
    },
  ];
}

const bestMatch = findBestMatch();

if (operation === 'get_owner_contact') {
  return [
    {
      json: {
        configured: true,
        operation,
        matched_count: bestMatch ? 1 : 0,
        items: [],
        selected_finca: bestMatch ? sanitizeDetailItem(bestMatch) : null,
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
      configured: true,
      operation: 'get_finca_details',
      matched_count: bestMatch ? 1 : 0,
      items: [],
      selected_finca: bestMatch ? sanitizeDetailItem(bestMatch) : null,
      owner: null,
      search_applied: {
        finca_id: explicitFincaId || null,
        nombre: explicitName || null,
        query,
      },
      notes: bestMatch ? null : 'finca_not_found',
    },
  },
];"""


def orchestrator_text() -> str:
    return r"""=A continuación tienes el input runtime de la conversación.
Tu tarea es decidir el sub-agente correcto, ejecutarlo y devolver un JSON final con post_actions listos para persistir.

IMPORTANTE:
- conversation es la conversación activa almacenada en Postgres.
- recent_messages son los últimos 20 mensajes persistidos.
- current_message es el mensaje nuevo de este turno. Si viene vacío, estás en loop-back y debes decidir con el nuevo estado.

=== RUNTIME INPUT ===

conversation:
{{ JSON.stringify($('Get Context-conversations1').item.json, null, 2) }}

recent_messages:
{{ JSON.stringify($('Fetch messages1').item.json.recent_messages || [], null, 2) }}

current_message:
{{ JSON.stringify($('Merge Sets1').item.json['last-message'] || null, null, 2) }}

=== END RUNTIME INPUT ===

Ahora:
1) Decide action y tool_chosen.
2) Llama el tool elegido con este input mínimo:
{
  "context": {{ JSON.stringify($('Get Context-conversations1').item.json.context, null, 2) }},
  "recent_messages": {{ JSON.stringify($('Fetch messages1').item.json.recent_messages || [], null, 2) }},
  "current_message": {{ JSON.stringify($('Merge Sets1').item.json['last-message'] || null, null, 2) }}
}
3) Devuelve EXCLUSIVAMENTE el JSON final."""


def orchestrator_system() -> str:
    return r"""=IDENTIDAD
Eres el ORQUESTADOR del sistema "De Paseo en Finca". Operas dentro de n8n como Agent con Tools.
No eres el agente comercial final. Tu tarea es elegir el sub-agente correcto, ejecutarlo y devolver post_actions consistentes con la fase 1.

TOOLS DISPONIBLES
- qualifying_agent
- offering_agent
- verifying_availability_agent
- negotiating_agent
- qa_agent

REGLAS ABSOLUTAS
- Nunca inventes disponibilidad, precios, ubicaciones exactas ni datos del propietario.
- El inventario NO viene precargado en este nivel.
- Si un sub-agente necesita inventario, deberá consultar su tool interno inventory_reader_tool.
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
  - action = "RUN_TOOL"
  - tool_chosen = "negotiating_agent"
  - post_actions.state_transition = "NEGOTIATING"
  - post_actions.waiting_for = "CLIENT"
  - post_actions.owner_response = "__CLEAR__"
- Si owner_response.disponible = false:
  - action = "RUN_TOOL"
  - tool_chosen = "offering_agent"
  - incluye en tool_input.context.owner_unavailable = true
  - post_actions.state_transition = "OFFERING"
  - post_actions.waiting_for = "CLIENT"
  - post_actions.owner_response = "__CLEAR__"
  - post_actions.selected_finca_id = "__CLEAR__"
  - post_actions.selected_finca = "__CLEAR__"

PRIORIDAD 3: CAMBIO / CANCELACION
- Si el cliente pide otra finca, mas opciones o cambiar la elegida: offering_agent
- Si el cliente cancela: HITL con agente_activo = false

PRIORIDAD 4: QA FLOTANTE
Si la pregunta es puntual y no cambia el estado del negocio:
- action = "RUN_TOOL"
- tool_chosen = "qa_agent"
- current_state_changed = false

PRIORIDAD 5: DEFAULT
Mapeo estado -> tool:
- QUALIFYING -> qualifying_agent
- OFFERING -> offering_agent
- VERIFYING_AVAILABILITY -> verifying_availability_agent
- NEGOTIATING -> negotiating_agent

CONTRATO DE SALIDA
Devuelve EXCLUSIVAMENTE este JSON:
{
  "action": "RUN_TOOL | HITL | CANCEL_REQUEST | NOOP_BOT_DISABLED",
  "tool_chosen": "qualifying_agent | offering_agent | verifying_availability_agent | negotiating_agent | qa_agent | NONE",
  "tool_input": { ... },
  "tool_output": { ... },
  "post_actions": {
    "state_transition": "QUALIFYING | OFFERING | VERIFYING_AVAILABILITY | NEGOTIATING | __IGNORE__",
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

REGLAS DE MAPEO A post_actions
- qualifying_agent:
  - mergea datos_extraidos utiles en search_criteria
  - si datos_completos = true -> state_transition = "OFFERING", current_state_changed = true
- offering_agent:
  - si intent = "CLIENT_CHOSE" -> state_transition = "VERIFYING_AVAILABILITY", selected_finca_id, selected_finca, waiting_for = "OWNER"
  - si intent = "SHOW_OPTIONS" -> shown_fincas = fincas_mostradas
  - si intent = "ADJUST_CRITERIA" -> mergea search_criteria_update
- verifying_availability_agent:
  - normalmente no cambia estado; mantiene waiting_for = "OWNER"
  - si intent = "CHANGE_FINCA" -> state_transition = "OFFERING"
- negotiating_agent:
  - mergea pricing y extras si existen
  - si intent = "ACCEPTED" -> agente_activo = false
  - si intent = "REJECT_PRICE" -> state_transition = "OFFERING", selected_finca_id = "__CLEAR__", selected_finca = "__CLEAR__"
- qa_agent:
  - no cambia estado, pero debe devolver una respuesta que retome el flujo

Si un campo no cambia, usa "__IGNORE__"."""


def offering_text() -> str:
    return r"""=Hoy es {{ new Date().toLocaleString("sv-SE", { timeZone: "America/Bogota" }).slice(0, 10) }}.

CONTEXT:
{{ JSON.stringify($('Get Context-conversations1').item.json.context, null, 2) }}

RECENT_MESSAGES:
{{ JSON.stringify($('Fetch messages1').item.json.recent_messages || [], null, 2) }}

CURRENT_MESSAGE:
{{ JSON.stringify($('Merge Sets1').item.json['last-message'] || null, null, 2) }}

INSTRUCCION:
- Antes de listar fincas o responder algo puntual sobre una finca, llama inventory_reader_tool.
- Para mostrar opciones usa operation="list_matching_fincas".
- Para aclarar una propiedad concreta usa operation="get_finca_details".
- Evita repetir fincas ya incluidas en context.shown_fincas.
- Si current_message es vacio, estas en el segundo ciclo y debes mostrar opciones o retomar el estado con ayuda del tool."""


def offering_system() -> str:
    return r"""=Eres el agente del estado OFFERING del sistema "De Paseo en Finca".

OBJETIVO
- Presentar hasta 3 fincas relevantes.
- Capturar si el cliente elige una finca.
- Permitir ajuste de criterios sin romper el flujo.

REGLAS
{{ $('config').item.json.tono }}
- Nunca inventes fincas.
- Debes consultar inventory_reader_tool antes de proponer opciones.
- Si owner_unavailable = true o context.owner_response.disponible = false, primero informa que la opcion anterior no estaba disponible y luego muestra alternativas.
- Si inventory_reader_tool responde configured = false o no hay coincidencias, dilo con claridad y pide ajustar criterios.
- Si el cliente solo pregunta algo puntual de una finca, puedes consultar operation="get_finca_details" y luego seguir pidiendo eleccion.

OUTPUT
Responde EXCLUSIVAMENTE en JSON valido con este schema:
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
}"""


def verifying_text() -> str:
    return r"""=CONTEXT:
{{ JSON.stringify($('Get Context-conversations1').item.json.context, null, 2) }}

RECENT_MESSAGES:
{{ JSON.stringify($('Fetch messages1').item.json.recent_messages || [], null, 2) }}

CURRENT_MESSAGE:
{{ JSON.stringify($('Merge Sets1').item.json['last-message'] || null, null, 2) }}

INSTRUCCION:
- Si necesitas datos de la finca elegida, llama inventory_reader_tool con operation="get_finca_details".
- Si necesitas el contacto del propietario, llama inventory_reader_tool con operation="get_owner_contact".
- Si solo debes sostener la conversacion mientras esperas respuesta, no necesitas llamar el tool."""


def verifying_system() -> str:
    return r"""=Eres el agente del estado VERIFYING_AVAILABILITY.

OBJETIVO
- Informar que estas validando con el propietario.
- Mantener al cliente contenido sin prometer disponibilidad.
- Permitir cambio de finca si el cliente lo pide.

REGLAS
{{ $('config').item.json.tono }}
- Nunca confirmes disponibilidad sin owner_response.disponible = true.
- Si el cliente pide otra finca, marca CHANGE_FINCA.
- Si hace una pregunta simple sobre la finca elegida, puedes usar inventory_reader_tool con operation="get_finca_details".
- Si la tarea correcta es recuperar el numero de contacto del propietario, usa inventory_reader_tool con operation="get_owner_contact".

OUTPUT
Devuelve EXCLUSIVAMENTE JSON valido:
{
  "respuesta": "texto para el cliente",
  "intent": "WAITING_OWNER | CHANGE_FINCA | QUESTION | HITL_REQUEST | CANCEL",
  "finca_elegida_id": null | "string"
}"""


def qa_text() -> str:
    return r"""=CONTEXT:
{{ JSON.stringify($('Get Context-conversations1').item.json.context, null, 2) }}

RECENT_MESSAGES:
{{ JSON.stringify($('Fetch messages1').item.json.recent_messages || [], null, 2) }}

CURRENT_MESSAGE:
{{ JSON.stringify($('Merge Sets1').item.json['last-message'] || null, null, 2) }}

INSTRUCCION:
- Si la pregunta es sobre una propiedad concreta, llama inventory_reader_tool con operation="get_finca_details".
- Si necesitas aclarar si hay opciones por zona o capacidad, llama inventory_reader_tool con operation="list_matching_fincas".
- Si la respuesta ya esta en context o en mensajes recientes, responde sin llamar el tool."""


def qa_system() -> str:
    return r"""=Eres el agente QA flotante del sistema comercial.

OBJETIVO
- Responder preguntas puntuales sobre fincas, amenidades, mascotas, parqueadero, horarios o proceso.
- No cambies el estado de la conversacion.
- Tu respuesta debe retomar el hilo comercial al final.

REGLAS
{{ $('config').item.json.tono }}
- Usa inventory_reader_tool solo cuando la pregunta dependa del inventario real.
- Si el dato no aparece en inventory_reader_tool o context, dilo y ofrece ayuda parcial.

OUTPUT
Devuelve EXCLUSIVAMENTE JSON valido:
{
  "respuesta": "texto para el cliente",
  "intent": "QA_ANSWERED",
  "search_criteria_update": {}
}"""


def build_inventory_tool_node(workflow_id_expr: str = "={{ $workflow.id }}") -> dict:
    return {
        "id": new_id(),
        "name": "inventory_reader_tool",
        "type": "@n8n/n8n-nodes-langchain.toolWorkflow",
        "typeVersion": 2.2,
        "position": [-5536, 2832],
        "parameters": {
            "name": "inventory_reader_tool",
            "description": "Lee el inventario de fincas desde Google Sheets solo cuando hace falta: mostrar propiedades, responder preguntas sobre una propiedad o recuperar el contacto del propietario.",
            "workflowId": {"__rl": True, "mode": "id", "value": workflow_id_expr},
            "workflowInputs": {
                "mappingMode": "defineBelow",
                "value": {},
                "matchingColumns": [],
                "schema": [
                    make_workflow_tool_field(
                        "operation",
                        "={{ $fromAI('operation', `Operacion: list_matching_fincas | get_finca_details | get_owner_contact`, 'string') }}",
                    ),
                    make_workflow_tool_field(
                        "finca_id",
                        "={{ $fromAI('finca_id', `ID de la finca si ya lo tienes`, 'string') }}",
                    ),
                    make_workflow_tool_field(
                        "nombre",
                        "={{ $fromAI('nombre', `Nombre de la finca si no tienes el ID`, 'string') }}",
                    ),
                    make_workflow_tool_field(
                        "query",
                        "={{ $fromAI('query', `Pregunta puntual o criterio libre sobre la finca`, 'string') }}",
                    ),
                    make_workflow_tool_field(
                        "zona",
                        "={{ $fromAI('zona', `Zona o destino a usar para filtrar`, 'string') }}",
                    ),
                    make_workflow_tool_field(
                        "personas",
                        "={{ $fromAI('personas', `Cantidad de personas para filtrar`, 'string') }}",
                    ),
                    make_workflow_tool_field(
                        "limit",
                        "={{ $fromAI('limit', `Numero maximo de opciones a devolver`, 'string') }}",
                    ),
                    make_workflow_tool_field(
                        "inventory_sheet_enabled",
                        "={{ $('config').item.json.inventory_sheet_enabled ? 'true' : 'false' }}",
                    ),
                    make_workflow_tool_field(
                        "inventory_sheet_document_id",
                        "={{ $('config').item.json.inventory_sheet_document_id || '' }}",
                    ),
                    make_workflow_tool_field(
                        "inventory_sheet_tab_name",
                        "={{ $('config').item.json.inventory_sheet_tab_name || '' }}",
                    ),
                    make_workflow_tool_field(
                        "selected_finca_id",
                        "={{ $('Get Context-conversations1').item.json.context?.selected_finca_id || $('Get Context-conversations1').item.json.context?.selected_finca?.finca_id || '' }}",
                    ),
                    make_workflow_tool_field(
                        "selected_finca_nombre",
                        "={{ $('Get Context-conversations1').item.json.context?.selected_finca?.nombre || '' }}",
                    ),
                    make_workflow_tool_field(
                        "shown_fincas_json",
                        "={{ JSON.stringify($('Get Context-conversations1').item.json.context?.shown_fincas || []) }}",
                    ),
                    make_workflow_tool_field(
                        "context_zona",
                        "={{ $('Get Context-conversations1').item.json.context?.search_criteria?.zona || '' }}",
                    ),
                    make_workflow_tool_field(
                        "context_personas",
                        "={{ $('Get Context-conversations1').item.json.context?.search_criteria?.personas || '' }}",
                    ),
                    make_workflow_tool_field(
                        "context_fecha_inicio",
                        "={{ $('Get Context-conversations1').item.json.context?.search_criteria?.fecha_inicio || '' }}",
                    ),
                    make_workflow_tool_field(
                        "context_fecha_fin",
                        "={{ $('Get Context-conversations1').item.json.context?.search_criteria?.fecha_fin || '' }}",
                    ),
                ],
                "attemptToConvertTypes": False,
                "convertFieldsToString": False,
            },
        },
    }


def build_inventory_trigger_node() -> dict:
    return {
        "id": new_id(),
        "name": "When inventory tool is called",
        "type": "n8n-nodes-base.executeWorkflowTrigger",
        "typeVersion": 1.1,
        "position": [-7360, 1824],
        "parameters": {"inputSource": "passthrough"},
    }


def apply_refactor(workflow: dict, env: dict) -> dict:
    workflow = deepcopy(workflow)
    connections = workflow["connections"]

    main_chat_trigger = find_node(workflow, "When chat message received")
    main_chat_trigger.setdefault("parameters", {})
    main_chat_trigger.setdefault("parameters", {}).setdefault("options", {})
    main_chat_trigger["parameters"]["options"]["responseMode"] = "responseNode"

    config = find_node(workflow, "config")
    assignments = config["parameters"]["assignments"]["assignments"]
    assignment_by_name = {item["name"]: item for item in assignments}
    assignment_by_name["inventory_sheet_enabled"]["value"] = True
    assignment_by_name["inventory_sheet_document_id"]["value"] = env.get("INVENTORY_SHEET_DOCUMENT_ID", assignment_by_name["inventory_sheet_document_id"]["value"])
    assignment_by_name["inventory_sheet_gid"]["value"] = env.get("INVENTORY_SHEET_GID", assignment_by_name["inventory_sheet_gid"]["value"])
    assignment_by_name["inventory_sheet_tab_name"]["value"] = env.get("INVENTORY_SHEET_TAB_NAME", assignment_by_name["inventory_sheet_tab_name"]["value"])

    has_inventory = find_node(workflow, "Has Inventory Config")
    has_inventory["parameters"]["conditions"]["conditions"][0]["leftValue"] = "={{ String($json.inventory_sheet_enabled || '').toLowerCase() === 'true' }}"

    get_sheet = find_node(workflow, "Get row(s) in fincas sheet")
    get_sheet["parameters"]["documentId"]["value"] = "={{ $json.inventory_sheet_document_id }}"
    get_sheet["parameters"]["sheetName"]["value"] = "={{ $json.inventory_sheet_tab_name }}"

    normalize = find_node(workflow, "Normalize Inventory")
    normalize["parameters"]["jsCode"] = inventory_normalize_code()

    inventory_not_configured = find_node(workflow, "Inventory not configured")
    inventory_not_configured["parameters"]["assignments"]["assignments"] = [
        {
            "id": new_id(),
            "name": "inventory",
            "value": "=[]",
            "type": "array",
        },
        {
            "id": new_id(),
            "name": "inventory_meta",
            "value": '={{ { configured: false, count: 0, reason: "inventory_sheet_disabled_or_missing" } }}',
            "type": "object",
        },
    ]

    response_node = find_node(workflow, "Prepare Inventory Payload")
    old_response_name = response_node["name"]
    response_node["name"] = "Build Inventory Tool Response"
    response_node["type"] = "n8n-nodes-base.code"
    response_node["typeVersion"] = 2
    response_node["position"] = [-6368, 2096]
    response_node["parameters"] = {"jsCode": inventory_response_code()}
    rename_connection_targets(connections, old_response_name, response_node["name"])

    orchestrator = find_node(workflow, "Orquestador AI1")
    orchestrator["parameters"]["text"] = orchestrator_text()
    orchestrator["parameters"]["options"]["systemMessage"] = orchestrator_system()

    offering = find_node(workflow, "offering_agent")
    offering["parameters"]["toolDescription"] = "**offering_agent**\nMuestra y ajusta la oferta de fincas. Consulta el inventario real solo cuando necesita listar opciones o responder algo puntual sobre una propiedad."
    offering["parameters"]["text"] = offering_text()
    offering["parameters"]["options"]["systemMessage"] = offering_system()

    verifying = find_node(workflow, "verifying_availability_agent")
    verifying["parameters"]["toolDescription"] = "**verifying_availability_agent**\nSostiene la conversación mientras se espera la respuesta del propietario y consulta el inventario solo para datos puntuales o el contacto del propietario."
    verifying["parameters"]["text"] = verifying_text()
    verifying["parameters"]["options"]["systemMessage"] = verifying_system()

    qa = find_node(workflow, "qa_agent")
    qa["parameters"]["toolDescription"] = "**qa_agent**\nResponde preguntas puntuales y consulta el inventario real solo cuando la respuesta depende de una finca o del archivo."
    qa["parameters"]["text"] = qa_text()
    qa["parameters"]["options"]["systemMessage"] = qa_system()

    trigger_node = build_inventory_trigger_node()
    ensure_node(workflow, trigger_node["name"], trigger_node)

    tool_node = build_inventory_tool_node()
    ensure_node(workflow, tool_node["name"], tool_node)

    connections["Fetch messages1"] = {
        "main": [[{"node": "Orquestador AI1", "type": "main", "index": 0}]]
    }
    connections["When inventory tool is called"] = {
        "main": [[{"node": "Has Inventory Config", "type": "main", "index": 0}]]
    }
    connections["Has Inventory Config"] = {
        "main": [
            [{"node": "Get row(s) in fincas sheet", "type": "main", "index": 0}],
            [{"node": "Inventory not configured", "type": "main", "index": 0}],
        ]
    }
    connections["Get row(s) in fincas sheet"] = {
        "main": [[{"node": "Normalize Inventory", "type": "main", "index": 0}]]
    }
    connections["Normalize Inventory"] = {
        "main": [[{"node": "Build Inventory Tool Response", "type": "main", "index": 0}]]
    }
    connections["Inventory not configured"] = {
        "main": [[{"node": "Build Inventory Tool Response", "type": "main", "index": 0}]]
    }
    connections["Build Inventory Tool Response"] = {"main": [[]]}
    connections["inventory_reader_tool"] = {
        "ai_tool": [[
            {"node": "offering_agent", "type": "ai_tool", "index": 0},
            {"node": "verifying_availability_agent", "type": "ai_tool", "index": 0},
            {"node": "qa_agent", "type": "ai_tool", "index": 0},
        ]]
    }

    return workflow


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: refactor_inventory_tool_workflow.py <input.json> <output.json>")

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    env = load_env(Path(".env"))

    workflow = json.loads(input_path.read_text())
    updated = apply_refactor(workflow, env)
    output_path.write_text(json.dumps(updated, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
