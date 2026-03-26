#!/usr/bin/env python3
from __future__ import annotations

import copy
import json
import os
import pathlib
import urllib.error
import urllib.request
import uuid


ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKUP_DIR = ROOT / "backups" / "workflows"
MAIN_WORKFLOW_ID = "RrIniaNJCUC72nfI"
MAIN_WORKFLOW_FILE = ROOT / "current_workflow.json"

CONTEXT_IF_NODE = "Should generate offering context?"
CONTEXT_AGENT_NODE = "Run offering context pass"
CONTEXT_FINAL_NODE = "Finalize offering outbound"
CODE_NODE_NAME = "Code in JavaScript1"
GEMINI_NODE_NAME = "Google Gemini Chat Model1"


def load_env(path: pathlib.Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


ENV = load_env(ROOT / ".env")
for env_key, env_value in ENV.items():
    os.environ.setdefault(env_key, env_value)

N8N_BASE_URL = os.environ.get("N8N_BASE_URL", "").rstrip("/")
N8N_API_KEY = os.environ.get("N8N_PUBLIC_API_TOKEN", "").strip()

if not N8N_BASE_URL or not N8N_API_KEY:
    raise SystemExit("Missing N8N_BASE_URL or N8N_PUBLIC_API_TOKEN in .env")


def timestamp_key() -> str:
    return __import__("datetime").datetime.utcnow().isoformat().replace(":", "-").replace(".", "-")


def new_id() -> str:
    return str(uuid.uuid4())


def api(pathname: str, method: str = "GET", payload=None):
    body = None
    headers = {
        "X-N8N-API-KEY": N8N_API_KEY,
        "Accept": "application/json",
    }
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(f"{N8N_BASE_URL}{pathname}", method=method, headers=headers, data=body)
    try:
        with urllib.request.urlopen(request) as response:
            text = response.read().decode("utf-8")
            return json.loads(text) if text else None
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            parsed = {"raw": raw}
        raise RuntimeError(f"HTTP {error.code} {pathname}: {json.dumps(parsed, ensure_ascii=False)}") from error


def sanitize_settings(settings: dict | None) -> dict:
    data = settings or {}
    return {key: value for key, value in data.items() if value is not None}


def sanitize_workflow_for_update(workflow: dict) -> dict:
    return {
        "name": workflow["name"],
        "nodes": workflow["nodes"],
        "connections": workflow["connections"],
        "settings": sanitize_settings(
            {
                "executionOrder": workflow.get("settings", {}).get("executionOrder", "v1"),
                "timezone": workflow.get("settings", {}).get("timezone", "America/Bogota"),
                "callerPolicy": workflow.get("settings", {}).get("callerPolicy"),
                "availableInMCP": workflow.get("settings", {}).get("availableInMCP"),
            }
        ),
    }


def write_backup(workflow: dict, prefix: str, suffix: str) -> str:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{prefix}-{suffix}-{timestamp_key()}.json"
    path = BACKUP_DIR / filename
    path.write_text(json.dumps(workflow, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return str(path)


def write_local_json(path: pathlib.Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def find_node(container: dict, name: str) -> dict:
    for node in container.get("nodes", []):
        if node.get("name") == name:
            return node
    raise KeyError(f"Node not found: {name}")


def ensure_node(container: dict, node: dict) -> dict:
    for index, existing in enumerate(container.get("nodes", [])):
        if existing.get("name") == node["name"]:
            preserved_id = existing.get("id", node["id"])
            container["nodes"][index] = {**node, "id": preserved_id}
            return container["nodes"][index]
    container.setdefault("nodes", []).append(node)
    return node


def set_main_connections(container: dict, node_name: str, branches: list[list[str]]) -> None:
    container.setdefault("connections", {})
    container["connections"][node_name] = {
        "main": [
            [{"node": downstream, "type": "main", "index": 0} for downstream in branch]
            for branch in branches
        ]
    }


def ensure_ai_language_model_target(container: dict, model_node_name: str, target_node_name: str) -> None:
    container.setdefault("connections", {})
    model_connections = container["connections"].setdefault(model_node_name, {})
    branches = model_connections.setdefault("ai_languageModel", [[]])
    if not branches:
        branches.append([])
    targets = branches[0]
    if not any(target.get("node") == target_node_name for target in targets):
        targets.append({"node": target_node_name, "type": "ai_languageModel", "index": 0})


def replace_node_reference_strings(value, old: str, new: str):
    if isinstance(value, str):
        return value.replace(old, new)
    if isinstance(value, list):
        return [replace_node_reference_strings(item, old, new) for item in value]
    if isinstance(value, dict):
        return {key: replace_node_reference_strings(item, old, new) for key, item in value.items()}
    return value


def patch_node_references(container: dict) -> None:
    old_ref = "$('Code in JavaScript1').item.json"
    new_ref = "$('Finalize offering outbound').item.json"
    skip_nodes = {CODE_NODE_NAME, CONTEXT_IF_NODE, CONTEXT_AGENT_NODE, CONTEXT_FINAL_NODE}
    for node in container.get("nodes", []):
        if node.get("name") in skip_nodes:
            continue
        node["parameters"] = replace_node_reference_strings(node.get("parameters", {}), old_ref, new_ref)


CONTEXT_IF_NODE_DEF = {
    "parameters": {
        "conditions": {
            "options": {
                "caseSensitive": True,
                "leftValue": "",
                "typeValidation": "loose",
                "version": 3,
            },
            "conditions": [
                {
                    "id": new_id(),
                    "leftValue": "={{ $('Code in JavaScript1').item.json.tool_chosen === 'offering_agent' && $('Code in JavaScript1').item.json.tool_output_parsed?.intent === 'SHOW_OPTIONS' && Array.isArray($('Code in JavaScript1').item.json.tool_output_parsed?.fincas_mostradas) && $('Code in JavaScript1').item.json.tool_output_parsed.fincas_mostradas.length > 0 }}",
                    "rightValue": "",
                    "operator": {
                        "type": "boolean",
                        "operation": "true",
                        "singleValue": True,
                    },
                }
            ],
            "combinator": "and",
        },
        "looseTypeValidation": True,
        "options": {},
    },
    "id": new_id(),
    "name": CONTEXT_IF_NODE,
    "type": "n8n-nodes-base.if",
    "typeVersion": 2.3,
    "position": [5712, -224],
}


CONTEXT_AGENT_PROMPT = """=RUNTIME INPUT

current_message:
{{ JSON.stringify($('Merge Sets1').item.json['last-message'] || null, null, 2) }}

current_search_criteria:
{{ JSON.stringify($('Get Context-conversations1').item.json.search_criteria || $('Get Context-conversations1').item.json.context?.search_criteria || {}, null, 2) }}

offering_result:
{{ JSON.stringify($('Code in JavaScript1').item.json.tool_output_parsed || {}, null, 2) }}

derived_scenario:
{{ JSON.stringify((() => {
  const parsed = $('Code in JavaScript1').item.json.tool_output_parsed || {};
  const currentCriteria =
    $('Get Context-conversations1').item.json.search_criteria ||
    $('Get Context-conversations1').item.json.context?.search_criteria ||
    {};
  const fincas = Array.isArray(parsed.fincas_mostradas) ? parsed.fincas_mostradas : [];
  const normalize = (value) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '')
      .toLowerCase()
      .trim();
  const requestedZone = String(parsed.search_criteria_update?.zona || currentCriteria.zona || '').trim();
  const offeredZones = Array.from(new Set(fincas.map((finca) => String(finca?.zona || '').trim()).filter(Boolean)));
  const offeredMunicipios = Array.from(new Set(fincas.map((finca) => String(finca?.municipio || '').trim()).filter(Boolean)));
  const positiveFilters = Array.from(new Set([
    ...(Array.isArray(currentCriteria.amenidades) ? currentCriteria.amenidades : []),
    ...(Array.isArray(parsed.search_criteria_update?.amenidades) ? parsed.search_criteria_update.amenidades : []),
  ].map((item) => String(item || '').trim()).filter(Boolean)));
  const allOfferedOutsideRequestedZone = requestedZone
    ? fincas.length > 0 && fincas.every((finca) => {
        const zone = normalize(finca?.zona);
        const municipio = normalize(finca?.municipio);
        const requested = normalize(requestedZone);
        return zone !== requested && municipio !== requested;
      })
    : false;
  return {
    requested_zone: requestedZone || null,
    offered_zones: offeredZones,
    offered_municipios: offeredMunicipios,
    offered_count: fincas.length,
    all_offered_outside_requested_zone: allOfferedOutsideRequestedZone,
    has_filter_updates: Boolean(
      parsed.search_criteria_update &&
      Object.entries(parsed.search_criteria_update).some(([key, value]) => {
        if (key === 'zona') return String(value || '').trim() !== '';
        if (Array.isArray(value)) return value.length > 0;
        return value !== null && value !== undefined && String(value).trim() !== '';
      })
    ),
    positive_filters: positiveFilters,
    raw_offering_text: String(parsed.respuesta || '').trim() || null
  };
})(), null, 2) }}

Devuelve EXCLUSIVAMENTE JSON válido:
{
  "context_message": "..."
}"""


CONTEXT_AGENT_SYSTEM = """=Eres un micro-agente de copy comercial para el estado OFFERING del sistema "De Paseo en Finca".

Tu única tarea es redactar un mensaje corto que vaya ANTES de las fichas de fincas.
Debes explicar el escenario encontrado y abrir la puerta a las opciones que vienen enseguida.

REGLAS
- Responde EXCLUSIVAMENTE JSON válido con: {"context_message":"..."}
- El mensaje debe ser una sola idea breve, máximo 25 palabras.
- Debe sonar natural, comercial y orientador.
- Debe incluir un conector explícito como "pero", "y", "así que", "por eso" o "igual".
- Si hay contraste, falta de match exacto o cambio de zona, prefiere "pero".
- Si hubo refinamiento exitoso o ajuste de filtros, prefiere "y".
- Si lo que viene es consecuencia natural de la búsqueda, puedes usar "así que" o "por eso".
- Nunca termines en una negación seca o cortada.
- Siempre cierra abriendo la puerta a las opciones que vienen después.
- No enumeres fincas.
- No repitas descripciones, precios ni fichas.
- No inventes datos, zonas ni filtros.
- Si el escenario muestra que no hubo match exacto en la zona pedida, dilo y conéctalo con las opciones que sí vas a mostrar.
- Si el escenario muestra que el filtro cambió y ahora sí hay opciones, dilo y conéctalo con las opciones que sí vas a mostrar.

EJEMPLOS DE ESTILO
- "En Melgar no tengo opciones exactas, pero encontré estas que de pronto te pueden gustar."
- "Busqué opciones que sí cumplen con jacuzzi y encontré estas para ti."
- "En esta zona no vi tantas opciones exactas, pero sí encontré estas alternativas cercanas." """


CONTEXT_AGENT_NODE_DEF = {
    "parameters": {
        "promptType": "define",
        "text": CONTEXT_AGENT_PROMPT,
        "options": {
            "systemMessage": CONTEXT_AGENT_SYSTEM,
            "maxIterations": 2,
        },
    },
    "id": new_id(),
    "name": CONTEXT_AGENT_NODE,
    "type": "@n8n/n8n-nodes-langchain.agent",
    "typeVersion": 3.1,
    "position": [6016, -224],
}


CONTEXT_FINAL_CODE = """function stripCodeFences(str) {
  if (!str) return '';
  return String(str)
    .trim()
    .replace(/^\\s*\\`\\`\\`json\\s*/i, '')
    .replace(/^\\s*\\`\\`\\`\\s*/i, '')
    .replace(/\\s*\\`\\`\\`\\s*$/i, '')
    .trim();
}

function extractFirstJsonObject(text) {
  const source = String(text || '');
  const start = source.search(/[\\[{]/);
  if (start === -1) return null;
  const open = source[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escape) escape = false;
      else if (char === '\\\\') escape = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return null;
}

function safeParse(text) {
  if (text == null) return null;
  const raw = String(text).trim();
  try {
    return JSON.parse(raw);
  } catch {
    const candidate = extractFirstJsonObject(stripCodeFences(raw));
    if (!candidate) return { _raw: raw.slice(0, 8000) };
    try {
      return JSON.parse(candidate);
    } catch {
      return { _raw: raw.slice(0, 8000) };
    }
  }
}

function parseSequence(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createTextMessage(content) {
  const text = String(content || '').trim();
  if (!text) return null;
  return {
    type: 'text',
    content: text,
    media_url: null,
    property_title: null,
    property_id: null,
  };
}

function extractContextMessage(source) {
  if (!source || typeof source !== 'object') return '';

  if (typeof source.context_message === 'string' && source.context_message.trim()) {
    return source.context_message.trim();
  }

  const candidates = [];
  if (typeof source.output === 'string') candidates.push(source.output);
  if (Array.isArray(source.output) && typeof source.output[0]?.output === 'string') {
    candidates.push(source.output[0].output);
  }

  for (const candidate of candidates) {
    const parsed = safeParse(candidate);
    if (parsed && typeof parsed.context_message === 'string' && parsed.context_message.trim()) {
      return parsed.context_message.trim();
    }
  }

  return '';
}

const base = $('Code in JavaScript1').item.json || {};
const outboundSequence = parseSequence(base.outbound_sequence || base.outbound_sequence_json || '[]');

let contextSource = null;
try {
  contextSource = $('Run offering context pass').item.json || null;
} catch {
  contextSource = null;
}

const contextMessage = extractContextMessage(contextSource);
const shouldInject =
  base.tool_chosen === 'offering_agent' &&
  base.tool_output_parsed?.intent === 'SHOW_OPTIONS' &&
  Array.isArray(base.tool_output_parsed?.fincas_mostradas) &&
  base.tool_output_parsed.fincas_mostradas.length > 0 &&
  Boolean(contextMessage) &&
  outboundSequence.length > 0;

if (!shouldInject) {
  return [
    {
      json: {
        ...base,
        offering_context_message: null,
      },
    },
  ];
}

const contextItem = createTextMessage(contextMessage);
const firstExistingText = String(outboundSequence[0]?.content || '').trim();
const nextSequence =
  contextItem && firstExistingText !== contextMessage
    ? [contextItem, ...outboundSequence]
    : outboundSequence;

const primaryOutboundMessage =
  [...nextSequence]
    .reverse()
    .map((item) => String(item?.content || '').trim())
    .find(Boolean) || base.outbound_message || base.final_whatsapp_text || null;

return [
  {
    json: {
      ...base,
      offering_context_message: contextMessage,
      outbound_sequence: nextSequence,
      outbound_sequence_json: JSON.stringify(nextSequence),
      outbound_message: primaryOutboundMessage,
      final_whatsapp_text: primaryOutboundMessage,
    },
  },
];"""


CONTEXT_FINAL_NODE_DEF = {
    "parameters": {
        "jsCode": CONTEXT_FINAL_CODE,
    },
    "id": new_id(),
    "name": CONTEXT_FINAL_NODE,
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [6320, 0],
}


def patch_layout(container: dict) -> None:
    positions = {
        CONTEXT_IF_NODE: [5712, -224],
        CONTEXT_AGENT_NODE: [6016, -224],
        CONTEXT_FINAL_NODE: [6320, 0],
        "actualizar contexto1": [6624, 0],
        "Should sync ia_activa to Chatwoot (engine)?": [6912, 0],
        "Sync ia_activa to Chatwoot (engine)": [6912, 208],
        "If3": [7200, 0],
        "Insert INBOUND message (messages)1": [7504, -96],
        "Insert OUTBOUND message (messages)": [7504, 112],
        "Agregar follow on": [7808, 0],
        "Engine Result": [8112, 0],
        "Should send via Chatwoot?": [8416, 0],
    }
    for node in container.get("nodes", []):
        if node.get("name") in positions:
            node["position"] = positions[node["name"]]


def patch_version(container: dict) -> None:
    ensure_node(container, copy.deepcopy(CONTEXT_IF_NODE_DEF))
    ensure_node(container, copy.deepcopy(CONTEXT_AGENT_NODE_DEF))
    ensure_node(container, copy.deepcopy(CONTEXT_FINAL_NODE_DEF))

    set_main_connections(container, CODE_NODE_NAME, [[CONTEXT_IF_NODE]])
    set_main_connections(container, CONTEXT_IF_NODE, [[CONTEXT_AGENT_NODE], [CONTEXT_FINAL_NODE]])
    set_main_connections(container, CONTEXT_AGENT_NODE, [[CONTEXT_FINAL_NODE]])
    set_main_connections(container, CONTEXT_FINAL_NODE, [["actualizar contexto1"]])
    ensure_ai_language_model_target(container, GEMINI_NODE_NAME, CONTEXT_AGENT_NODE)

    patch_node_references(container)
    patch_layout(container)


def patch_workflow_definition(workflow: dict) -> dict:
    patch_version(workflow)
    active_version = workflow.get("activeVersion")
    if isinstance(active_version, dict) and active_version.get("nodes") and active_version.get("connections") is not None:
        patch_version(active_version)
    return workflow


def validate_workflow(workflow: dict) -> None:
    node_names = {node.get("name") for node in workflow.get("nodes", [])}
    required = {
        CODE_NODE_NAME,
        CONTEXT_IF_NODE,
        CONTEXT_AGENT_NODE,
        CONTEXT_FINAL_NODE,
        "actualizar contexto1",
        GEMINI_NODE_NAME,
    }
    missing = sorted(required - node_names)
    if missing:
        raise RuntimeError(f"Missing nodes after patch: {missing}")

    connections = workflow.get("connections", {})
    code_targets = [item["node"] for item in connections.get(CODE_NODE_NAME, {}).get("main", [[]])[0]]
    if code_targets != [CONTEXT_IF_NODE]:
        raise RuntimeError(f"Unexpected {CODE_NODE_NAME} targets: {code_targets}")

    if_targets = connections.get(CONTEXT_IF_NODE, {}).get("main", [])
    if len(if_targets) != 2 or [item["node"] for item in if_targets[0]] != [CONTEXT_AGENT_NODE] or [
        item["node"] for item in if_targets[1]
    ] != [CONTEXT_FINAL_NODE]:
        raise RuntimeError(f"Unexpected {CONTEXT_IF_NODE} branches: {if_targets}")

    final_targets = [item["node"] for item in connections.get(CONTEXT_FINAL_NODE, {}).get("main", [[]])[0]]
    if final_targets != ["actualizar contexto1"]:
        raise RuntimeError(f"Unexpected {CONTEXT_FINAL_NODE} targets: {final_targets}")

    model_targets = connections.get(GEMINI_NODE_NAME, {}).get("ai_languageModel", [[]])[0]
    if not any(target.get("node") == CONTEXT_AGENT_NODE for target in model_targets):
        raise RuntimeError(f"{GEMINI_NODE_NAME} is not connected to {CONTEXT_AGENT_NODE}")

    referenced = []
    for node in workflow.get("nodes", []):
        params_json = json.dumps(node.get("parameters", {}), ensure_ascii=False)
        if "$('Code in JavaScript1').item.json" in params_json and node.get("name") not in {
            CODE_NODE_NAME,
            CONTEXT_IF_NODE,
            CONTEXT_AGENT_NODE,
            CONTEXT_FINAL_NODE,
        }:
            referenced.append(node["name"])
    if referenced:
        raise RuntimeError(f"Stale downstream references to {CODE_NODE_NAME}: {referenced}")


def deploy() -> None:
    workflow = api(f"/api/v1/workflows/{MAIN_WORKFLOW_ID}")
    before_backup = write_backup(workflow, MAIN_WORKFLOW_ID, "before-offering-ai-context-bridge")
    was_active = workflow.get("active") is True

    patched = patch_workflow_definition(copy.deepcopy(workflow))
    validate_workflow(patched)

    if was_active:
        api(f"/api/v1/workflows/{MAIN_WORKFLOW_ID}/deactivate", method="POST")

    api(
        f"/api/v1/workflows/{MAIN_WORKFLOW_ID}",
        method="PUT",
        payload=sanitize_workflow_for_update(patched),
    )

    if was_active:
        api(f"/api/v1/workflows/{MAIN_WORKFLOW_ID}/activate", method="POST")

    refreshed = api(f"/api/v1/workflows/{MAIN_WORKFLOW_ID}")
    after_backup = write_backup(refreshed, MAIN_WORKFLOW_ID, "after-offering-ai-context-bridge")
    write_local_json(MAIN_WORKFLOW_FILE, refreshed)

    print(
        json.dumps(
            {
                "workflowId": MAIN_WORKFLOW_ID,
                "versionId": refreshed.get("versionId"),
                "updatedAt": refreshed.get("updatedAt"),
                "active": refreshed.get("active"),
                "beforeBackup": before_backup,
                "afterBackup": after_backup,
                "nodeCount": len(refreshed.get("nodes", [])),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    deploy()
