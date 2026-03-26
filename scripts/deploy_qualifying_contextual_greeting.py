#!/usr/bin/env python3
from __future__ import annotations

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

NORMALIZE_NODE = "Normalize inbound payload"
ROUTE_QUALIFYING_NODE = "Route QUALIFYING state?"
PREPARE_GREETING_NODE = "Prepare qualifying greeting context"
RUN_QUALIFYING_NODE = "Run qualifying pass"


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


def find_node(workflow: dict, name: str) -> dict:
    for node in workflow.get("nodes", []):
        if node.get("name") == name:
            return node
    raise RuntimeError(f"Node not found: {name}")


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


def insert_block_once(text: str, marker: str, block: str) -> str:
    if block.strip() in text:
        return text
    if marker not in text:
        raise RuntimeError(f"Marker not found in prompt text: {marker}")
    return text.replace(marker, f"{marker}{block}")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"Could not find expected {label} block to replace")
    return text.replace(old, new, 1)


PREPARE_GREETING_NODE_DEF = {
    "parameters": {
        "jsCode": """const input = $json || {};
const fetchedMessages = $('Fetch messages1').item.json || {};
const recentMessages = Array.isArray(fetchedMessages.recent_messages) ? fetchedMessages.recent_messages : [];
const contextRow = $('Get Context-conversations1').item.json || {};
const raw = input.raw && typeof input.raw === 'object' ? input.raw : {};

const compact = (value) => String(value ?? '').trim();
const collapseSpaces = (value) => compact(value).replace(/\\s+/g, ' ');
const normalize = (value) =>
  collapseSpaces(value)
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase();

const now = new Date();
const hourFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Bogota',
  hour: '2-digit',
  hour12: false,
});
const bogotaHour = Number(hourFormatter.format(now));
let greetingTimeBucket = 'morning';
if (Number.isFinite(bogotaHour)) {
  if (bogotaHour >= 12 && bogotaHour < 19) greetingTimeBucket = 'afternoon';
  else if (bogotaHour >= 19 || bogotaHour < 5) greetingTimeBucket = 'night';
}

const stopwords = new Set([
  'amor',
  'bb',
  'bebe',
  'bebé',
  'bebé',
  'corazon',
  'corazón',
  'gorda',
  'gordo',
  'hija',
  'hijo',
  'mama',
  'mamá',
  'mami',
  'mi',
  'miamor',
  'papa',
  'papá',
  'papi',
  'princesa',
  'principe',
  'príncipe',
  'reina',
  'rey',
  'te',
  'amo',
  'vida',
]);

function isLikelyWord(token) {
  return /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]*$/.test(token);
}

function resolveGreetingNameCandidate() {
  const sourceCandidates = [
    raw?.conversation?.meta?.sender?.name,
    input.client_name,
    raw?.contact?.name,
    raw?.sender?.name,
    raw?.meta?.name,
    raw?.meta?.sender?.name,
  ];

  for (const sourceValue of sourceCandidates) {
    const collapsed = collapseSpaces(sourceValue);
    if (!collapsed) continue;
    if (/\\d/.test(collapsed)) continue;
    if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ\\s'-]+$/.test(collapsed)) continue;

    const parts = collapsed.split(' ').filter(Boolean);
    if (!parts.length || parts.length > 4) continue;
    if (!parts.every(isLikelyWord)) continue;

    const normalizedParts = parts.map(normalize);
    if (normalizedParts.some((part) => stopwords.has(part))) continue;

    const first = parts[0];
    const normalizedFirst = normalize(first);
    if (!first || first.length < 3) continue;
    if (stopwords.has(normalizedFirst)) continue;
    if (/^[A-ZÁÉÍÓÚÜÑ]{2,3}$/.test(first)) continue;

    return first;
  }

  return null;
}

const greetingNameCandidate = resolveGreetingNameCandidate();
const isInitialQualifyingTurn =
  String(contextRow.current_state || '').trim() === 'QUALIFYING' &&
  recentMessages.length === 0;

return [
  {
    json: {
      ...input,
      is_initial_qualifying_turn: isInitialQualifyingTurn,
      greeting_time_bucket: greetingTimeBucket,
      greeting_name_candidate: greetingNameCandidate,
      greeting_name_usable: Boolean(greetingNameCandidate),
      greeting_context: {
        is_initial_qualifying_turn: isInitialQualifyingTurn,
        greeting_time_bucket: greetingTimeBucket,
        greeting_name_candidate: greetingNameCandidate,
        greeting_name_usable: Boolean(greetingNameCandidate),
      },
    },
  },
];
""",
    },
    "id": new_id(),
    "name": PREPARE_GREETING_NODE,
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [4560, -208],
}


PROMPT_INSERT_MARKER = """MENSAJE ACTUAL:
{{ JSON.stringify(
 $('Merge Sets1').item.json['last-message'] ) }}

INSTRUCCIÓN:
"""

PROMPT_INSERT_BLOCK = """GREETING_CONTEXT:
{{ JSON.stringify({
  is_initial_qualifying_turn: $('Prepare qualifying greeting context').item.json.is_initial_qualifying_turn,
  greeting_time_bucket: $('Prepare qualifying greeting context').item.json.greeting_time_bucket,
  greeting_name_candidate: $('Prepare qualifying greeting context').item.json.greeting_name_candidate,
  greeting_name_usable: $('Prepare qualifying greeting context').item.json.greeting_name_usable
}, null, 2) }}

INITIAL_MESSAGE_TEMPLATE_BASE:
{{ JSON.stringify($('config').item.json.initial_message_template || null) }}

INSTRUCCIÓN:
"""


OLD_INITIAL_NOTE_BLOCK = """- Si el current meessage es el único mensajes responde con este texto para whatsapp, ajustando el saludo dependiendo de la hora del día:
"Excelente día!🤩🌅
Mi nombre es Santiago Gallego
Depaseoenfincas.com, estaré frente a tu reserva!⚡
Por favor indícame:
*Fechas exactas?
*Número de huéspedes?
*Localización?
*Tarifa aproximada por noche 

🌎En el momento disponemos de propiedades en Anapoima ,Villeta, La Vega,Girardot , Eje cafetero , Carmen de Apicala , Antioquia y Villavicencio"
"""


NEW_INITIAL_NOTE_BLOCK = """- Si GREETING_CONTEXT.is_initial_qualifying_turn = true, usa INITIAL_MESSAGE_TEMPLATE_BASE como estructura comercial de referencia, pero NO lo copies literal salvo que el mensaje actual sea solo un saludo.
- Mantén el estilo actual del saludo y ajústalo por hora con GREETING_CONTEXT.greeting_time_bucket:
  - morning => "¡Excelente día!"
  - afternoon => "¡Excelente tarde!"
  - night => "¡Excelente noche!"
- Si GREETING_CONTEXT.greeting_name_usable = true, personaliza el saludo de forma formal usando GREETING_CONTEXT.greeting_name_candidate.
- Si GREETING_CONTEXT.greeting_name_usable = false, no uses nombre.
- Si el cliente ya compartió uno o más datos, reconócelos y pide solo los faltantes.
- Si el cliente ya pregunta por una zona o destino, responde de forma contextual y no como si hubiera mandado solo "hola".
- Si el cliente solo saluda, sí puedes usar la estructura completa del mensaje inicial.
- Si el cliente pide una zona fuera de cobertura, respeta la regla de cobertura y no fuerces el bloque genérico de captura completa.
"""


def patch_normalize_inbound_node(workflow: dict) -> None:
    node = find_node(workflow, NORMALIZE_NODE)
    code = node.get("parameters", {}).get("jsCode", "")
    old = """      client_name:
        payload.contact?.name ||
        payload.sender?.name ||
        payload.conversation?.meta?.sender?.name ||
        null,"""
    new = """      client_name:
        payload.conversation?.meta?.sender?.name ||
        payload.contact?.name ||
        payload.sender?.name ||
        payload.meta?.name ||
        payload.meta?.sender?.name ||
        null,"""
    node["parameters"]["jsCode"] = replace_once(code, old, new, "Normalize inbound payload client_name priority")


def patch_qualifying_prompt(workflow: dict) -> None:
    node = find_node(workflow, RUN_QUALIFYING_NODE)
    prompt_text = node.get("parameters", {}).get("text", "")
    node["parameters"]["text"] = insert_block_once(prompt_text, PROMPT_INSERT_MARKER, PROMPT_INSERT_BLOCK)

    system_message = node.get("parameters", {}).get("options", {}).get("systemMessage", "")
    node["parameters"]["options"]["systemMessage"] = replace_once(
        system_message,
        OLD_INITIAL_NOTE_BLOCK,
        NEW_INITIAL_NOTE_BLOCK,
        "Run qualifying pass initial greeting note",
    )


def patch_connections(workflow: dict) -> None:
    route_connections = workflow.get("connections", {}).get(ROUTE_QUALIFYING_NODE, {}).get("main", [])
    if len(route_connections) < 2:
        raise RuntimeError("Route QUALIFYING state? does not have the expected two branches")
    false_branch_targets = [entry["node"] for entry in route_connections[1]]
    set_main_connections(workflow, ROUTE_QUALIFYING_NODE, [[PREPARE_GREETING_NODE], false_branch_targets])
    set_main_connections(workflow, PREPARE_GREETING_NODE, [[RUN_QUALIFYING_NODE]])


def main() -> None:
    workflow = api(f"/api/v1/workflows/{MAIN_WORKFLOW_ID}")
    before_backup = write_backup(workflow, MAIN_WORKFLOW_ID, "before-contextual-qualifying-greeting")

    patch_normalize_inbound_node(workflow)
    patch_qualifying_prompt(workflow)
    ensure_node(workflow, PREPARE_GREETING_NODE_DEF)
    patch_connections(workflow)

    was_active = workflow.get("active") is True
    if was_active:
        api(f"/api/v1/workflows/{MAIN_WORKFLOW_ID}/deactivate", method="POST")

    api(
        f"/api/v1/workflows/{MAIN_WORKFLOW_ID}",
        method="PUT",
        payload=sanitize_workflow_for_update(workflow),
    )

    if was_active:
        api(f"/api/v1/workflows/{MAIN_WORKFLOW_ID}/activate", method="POST")

    refreshed = api(f"/api/v1/workflows/{MAIN_WORKFLOW_ID}")
    after_backup = write_backup(refreshed, MAIN_WORKFLOW_ID, "after-contextual-qualifying-greeting")
    write_local_json(MAIN_WORKFLOW_FILE, refreshed)

    print(
        json.dumps(
            {
                "workflowId": refreshed.get("id"),
                "versionId": refreshed.get("versionId"),
                "updatedAt": refreshed.get("updatedAt"),
                "active": refreshed.get("active"),
                "beforeBackup": before_backup,
                "afterBackup": after_backup,
            },
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
