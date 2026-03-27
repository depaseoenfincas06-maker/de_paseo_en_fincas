#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import pathlib
import re
import urllib.error
import urllib.request
import uuid


ROOT = pathlib.Path(__file__).resolve().parents[1]
BACKUP_DIR = ROOT / "backups" / "workflows"
MAIN_WORKFLOW_ID = "RrIniaNJCUC72nfI"
MAIN_WORKFLOW_FILE = ROOT / "current_workflow.json"
OWNER_REQUEST_NAME = "Owner Reservation Request Sender - De Paseo en Fincas"
OWNER_REMINDER_NAME = "Owner Reservation Reminder Scheduler - De Paseo en Fincas"
OWNER_INBOUND_NAME = "Owner Reservation Inbound Handler - De Paseo en Fincas"
OWNER_REQUEST_FILE = ROOT / "owner_reservation_request_workflow.json"
OWNER_REMINDER_FILE = ROOT / "owner_reservation_reminder_scheduler_workflow.json"
OWNER_INBOUND_FILE = ROOT / "owner_reservation_inbound_handler_workflow.json"
POSTGRES_CREDENTIAL = {
    "postgres": {
        "id": "CKoiBGlPXq82taIc",
        "name": "Postgres account",
    }
}
CHATWOOT_OWNER_INBOX_ID = "4"
CHATWOOT_OWNER_INBOX_NAME = "Agent_propietarios"


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
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "").strip()
CHATWOOT_API_TOKEN = os.environ.get("CHATWOOT_API_TOKEN", "").strip()
MAIN_PUBLIC_WEBHOOK_URL = f"{N8N_BASE_URL}/webhook/chatwoot/de-paseo-en-fincas/inbound"

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


def sanitize_workflow_for_create(definition: dict) -> dict:
    return {
        "name": definition["name"],
        "nodes": definition["nodes"],
        "connections": definition["connections"],
        "settings": sanitize_settings(definition.get("settings")),
    }


def write_backup(workflow: dict, prefix: str, suffix: str) -> str:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{prefix}-{suffix}-{timestamp_key()}.json"
    path = BACKUP_DIR / filename
    path.write_text(json.dumps(workflow, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return str(path)


def sanitize_export(payload):
    if isinstance(payload, dict):
        return {key: sanitize_export(value) for key, value in payload.items()}
    if isinstance(payload, list):
        return [sanitize_export(value) for value in payload]
    if isinstance(payload, str):
        value = payload
        if CHATWOOT_API_TOKEN:
            value = value.replace(CHATWOOT_API_TOKEN, "__CHATWOOT_API_TOKEN__")
        if OPENAI_API_KEY:
            value = value.replace(OPENAI_API_KEY, "__OPENAI_API_KEY__")
            value = value.replace(f"Bearer {OPENAI_API_KEY}", "Bearer __OPENAI_API_KEY__")
        return value
    return payload


def write_local_json(path: pathlib.Path, payload: dict) -> None:
    path.write_text(json.dumps(sanitize_export(payload), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def find_workflow_by_name(name: str):
    response = api("/api/v1/workflows?limit=200")
    workflows = response.get("data", []) if isinstance(response, dict) else []
    for workflow in workflows:
        if workflow.get("name") == name:
            return workflow
    return None


def upsert_workflow_by_name(definition: dict, output_path: pathlib.Path, suffix: str) -> dict:
    existing_ref = find_workflow_by_name(definition["name"])
    if existing_ref:
        workflow = api(f"/api/v1/workflows/{existing_ref['id']}")
        before_backup = write_backup(workflow, existing_ref["id"], f"before-{suffix}")
        was_active = workflow.get("active") is True
        if was_active:
            api(f"/api/v1/workflows/{existing_ref['id']}/deactivate", method="POST")
        api(
            f"/api/v1/workflows/{existing_ref['id']}",
            method="PUT",
            payload=sanitize_workflow_for_create(definition),
        )
        if was_active:
            api(f"/api/v1/workflows/{existing_ref['id']}/activate", method="POST")
        refreshed = api(f"/api/v1/workflows/{existing_ref['id']}")
        after_backup = write_backup(refreshed, existing_ref["id"], f"after-{suffix}")
        write_local_json(output_path, refreshed)
        return {
            "id": refreshed["id"],
            "versionId": refreshed.get("versionId"),
            "updatedAt": refreshed.get("updatedAt"),
            "active": refreshed.get("active"),
            "created": False,
            "beforeBackup": before_backup,
            "afterBackup": after_backup,
        }

    created = api("/api/v1/workflows", method="POST", payload=sanitize_workflow_for_create(definition))
    api(f"/api/v1/workflows/{created['id']}/activate", method="POST")
    refreshed = api(f"/api/v1/workflows/{created['id']}")
    after_backup = write_backup(refreshed, refreshed["id"], f"created-{suffix}")
    write_local_json(output_path, refreshed)
    return {
        "id": refreshed["id"],
        "versionId": refreshed.get("versionId"),
        "updatedAt": refreshed.get("updatedAt"),
        "active": refreshed.get("active"),
        "created": True,
        "beforeBackup": None,
        "afterBackup": after_backup,
    }


def patch_existing_workflow(workflow_id: str, patcher, output_path: pathlib.Path, suffix: str) -> dict:
    workflow = api(f"/api/v1/workflows/{workflow_id}")
    before_backup = write_backup(workflow, workflow_id, f"before-{suffix}")
    patcher(workflow)
    was_active = workflow.get("active") is True
    if was_active:
        api(f"/api/v1/workflows/{workflow_id}/deactivate", method="POST")
    api(f"/api/v1/workflows/{workflow_id}", method="PUT", payload=sanitize_workflow_for_update(workflow))
    if was_active:
        api(f"/api/v1/workflows/{workflow_id}/activate", method="POST")
    refreshed = api(f"/api/v1/workflows/{workflow_id}")
    after_backup = write_backup(refreshed, workflow_id, f"after-{suffix}")
    write_local_json(output_path, refreshed)
    return {
        "id": refreshed["id"],
        "versionId": refreshed.get("versionId"),
        "updatedAt": refreshed.get("updatedAt"),
        "active": refreshed.get("active"),
        "beforeBackup": before_backup,
        "afterBackup": after_backup,
    }


def patch_workflow_by_name(name: str, patcher, output_path: pathlib.Path, suffix: str) -> dict:
    existing_ref = find_workflow_by_name(name)
    if not existing_ref:
        raise RuntimeError(f"Workflow not found: {name}")
    return patch_existing_workflow(existing_ref["id"], patcher, output_path, suffix)


def find_node(workflow: dict, name: str) -> dict:
    for node in workflow.get("nodes", []):
        if node.get("name") == name:
            return node
    raise RuntimeError(f"Node not found: {name}")


def ensure_node(workflow: dict, node: dict) -> dict:
    for index, existing in enumerate(workflow.get("nodes", [])):
        if existing.get("name") == node["name"]:
            preserved_id = existing.get("id", node["id"])
            workflow["nodes"][index] = {**node, "id": preserved_id}
            return workflow["nodes"][index]
    workflow.setdefault("nodes", []).append(node)
    return node


def set_main_connections(workflow: dict, node_name: str, branches: list[list[str]]) -> None:
    workflow.setdefault("connections", {})
    workflow["connections"][node_name] = {
        "main": [
            [{"node": downstream, "type": "main", "index": 0} for downstream in branch]
            for branch in branches
        ]
    }


def set_assignment_value(node: dict, assignment_name: str, value) -> None:
    for assignment in node["parameters"]["assignments"]["assignments"]:
        if assignment.get("name") == assignment_name:
            assignment["value"] = value
            return
    raise RuntimeError(f"Assignment not found: {node.get('name')}::{assignment_name}")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"Could not find expected {label} block to replace")
    return text.replace(old, new, 1)


def replace_regex_once(text: str, pattern: str, repl: str, label: str) -> str:
    if repl in text:
        return text
    updated, count = re.subn(pattern, repl, text, count=1, flags=re.MULTILINE)
    if count != 1:
        raise RuntimeError(f"Could not find expected {label} block to replace")
    return updated


OWNER_HANDLER_NORMALIZE_CODE = """
const input = $json || {};
const compact = (value) => String(value || '').trim();
const digitsOnly = (value) => String(value || '').replace(/\\D+/g, '').trim();
const normalizeText = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\\s]+/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();

let raw = {};
try {
  raw = input.raw_json ? JSON.parse(String(input.raw_json)) : {};
} catch {
  raw = {};
}

return [
  {
    json: {
      ...input,
      raw,
      eligible: input.eligible === true,
      event_type: compact(input.event_type || raw.event || 'message_created'),
      is_sync_event: input.is_sync_event === true,
      inbox_id: compact(input.inbox_id || raw.inbox?.id || raw.conversation?.inbox_id || null),
      inbox_name: compact(input.inbox_name || raw.inbox?.name || null),
      chatwoot_id: compact(input.chatwoot_id || raw.conversation?.id || null),
      chatwoot_message_id: compact(input.chatwoot_message_id || raw.id || null),
      wa_id:
        digitsOnly(
          input.wa_id ||
            raw.conversation?.meta?.sender?.phone_number ||
            raw.contact?.phone_number ||
            raw.sender?.phone_number ||
            raw.contact_inbox?.source_id ||
            raw.conversation?.contact_inbox?.source_id,
        ) || null,
      client_name:
        compact(input.client_name || raw.conversation?.meta?.sender?.name || raw.contact?.name || null) || null,
      contact_source_id:
        digitsOnly(input.contact_source_id || raw.conversation?.contact_inbox?.source_id || raw.contact_inbox?.source_id) || null,
      owner_reply_text: compact(input.chatInput || raw.content || null),
      owner_reply_text_normalized: normalizeText(input.chatInput || raw.content || null),
    },
  },
];
""".strip()


OWNER_HANDLER_ACTION_CODE = """
const inbound = $('Normalize owner inbound payload').item.json || {};
const row = $json || {};

const normalizeText = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\\s]+/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();

function collectStrings(value, depth = 0, acc = []) {
  if (depth > 5 || value === null || value === undefined) return acc;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) acc.push(trimmed);
    return acc;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, depth + 1, acc);
    return acc;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, depth + 1, acc);
  }
  return acc;
}

const prioritySignals = collectStrings(inbound.raw?.content_attributes || {});
const additionalSignals = collectStrings(inbound.raw?.additional_attributes || {});
const textSignals = [inbound.owner_reply_text];
const normalizedSignals = [...prioritySignals, ...additionalSignals, ...textSignals]
  .map(normalizeText)
  .filter(Boolean);

const availablePhrases = new Set([
  'si',
  'si esta disponible',
  'si esta disponible por ahora',
  'esta disponible',
  'disponible',
  'si disponible',
  'yes',
]);
const unavailablePhrases = new Set([
  'no',
  'no esta disponible',
  'no disponible',
  'not available',
]);

let ownerReplyType = 'other';
let matchedSignal = normalizedSignals[0] || inbound.owner_reply_text_normalized || '';

for (const signal of normalizedSignals) {
  if (availablePhrases.has(signal)) {
    ownerReplyType = 'available';
    matchedSignal = signal;
    break;
  }
  if (unavailablePhrases.has(signal)) {
    ownerReplyType = 'unavailable';
    matchedSignal = signal;
    break;
  }
}

let action = 'noop';
let actionReason = 'owner_event_ignored';

if (inbound.eligible !== true || inbound.is_sync_event === true || String(inbound.event_type || '') !== 'message_created') {
  action = 'noop';
  actionReason = inbound.eligible !== true ? 'owner_event_not_eligible' : 'owner_sync_or_non_message_event';
} else if (!(Number(row.id || 0) > 0)) {
  action = 'noop';
  actionReason = 'owner_request_not_found';
} else if (ownerReplyType === 'available') {
  action = 'resume_available';
  actionReason = 'owner_available_confirmed';
} else if (ownerReplyType === 'unavailable') {
  action = 'resume_unavailable';
  actionReason = 'owner_unavailable_confirmed';
} else {
  action = 'needs_review';
  actionReason = 'owner_reply_needs_review';
}

return [
  {
    json: {
      ...row,
      ...inbound,
      owner_reply_type: ownerReplyType,
      owner_reply_text: inbound.owner_reply_text || null,
      owner_reply_signal: matchedSignal || null,
      owner_reply_received_at: new Date().toISOString(),
      action,
      action_reason: actionReason,
    },
  },
];
""".strip()


OWNER_HANDLER_PERSIST_ACTIONABLE_QUERY = """
with params as (
  select
    {{ Number($json.id || 0) }}::bigint as request_id,
    {{ "'" + String($json.owner_reply_type || '').replace(/'/g, "''") + "'" }}::text as owner_reply_type,
    {{ $json.owner_reply_type === 'available' ? 'true' : 'false' }}::boolean as disponible,
    {{ $json.owner_reply_text ? "'" + String($json.owner_reply_text).replace(/'/g, "''") + "'" : 'null' }}::text as owner_reply_text,
    {{ $json.chatwoot_message_id ? "'" + String($json.chatwoot_message_id).replace(/'/g, "''") + "'" : 'null' }}::text as owner_reply_chatwoot_message_id,
    now() as responded_at
),
request_update as (
  update public.owner_reservation_requests r
  set
    status = case when p.disponible then 'available_confirmed' else 'unavailable_confirmed' end,
    error_message = null,
    updated_at = now(),
    payload = coalesce(r.payload, '{}'::jsonb) || jsonb_build_object(
      'owner_reply_type', p.owner_reply_type,
      'owner_reply_text', p.owner_reply_text,
      'owner_reply_received_at', to_char(p.responded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'owner_reply_chatwoot_message_id', p.owner_reply_chatwoot_message_id
    )
  from params p
  where r.id = p.request_id
  returning r.id, r.conversation_id
),
conversation_update as (
  update public.conversations c
  set
    owner_response = jsonb_build_object(
      'disponible', p.disponible,
      'source', 'owner_whatsapp',
      'responded_at', to_char(p.responded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'raw_text', p.owner_reply_text,
      'request_id', p.request_id
    ),
    updated_at = now()
  from request_update r
  cross join params p
  where c.wa_id = r.conversation_id
  returning c.wa_id, c.chatwoot_id, c.client_name
)
select
  ru.id,
  cu.wa_id as conversation_id,
  cu.chatwoot_id,
  cu.client_name,
  p.owner_reply_type
from request_update ru
join conversation_update cu on cu.wa_id = ru.conversation_id
cross join params p;
""".strip()


OWNER_HANDLER_PERSIST_REVIEW_QUERY = """
with params as (
  select
    {{ Number($json.id || 0) }}::bigint as request_id,
    {{ $json.owner_reply_text ? "'" + String($json.owner_reply_text).replace(/'/g, "''") + "'" : 'null' }}::text as owner_reply_text,
    {{ $json.chatwoot_message_id ? "'" + String($json.chatwoot_message_id).replace(/'/g, "''") + "'" : 'null' }}::text as owner_reply_chatwoot_message_id,
    now() as responded_at
),
request_update as (
  update public.owner_reservation_requests r
  set
    status = 'needs_review',
    updated_at = now(),
    payload = coalesce(r.payload, '{}'::jsonb) || jsonb_build_object(
      'owner_reply_type', 'other',
      'owner_reply_text', p.owner_reply_text,
      'owner_reply_received_at', to_char(p.responded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'owner_reply_chatwoot_message_id', p.owner_reply_chatwoot_message_id
    )
  from params p
  where r.id = p.request_id
  returning r.id, r.conversation_id
),
conversation_update as (
  update public.conversations c
  set
    owner_response = jsonb_build_object(
      'disponible', null,
      'source', 'owner_whatsapp',
      'responded_at', to_char(p.responded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'raw_text', p.owner_reply_text,
      'request_id', p.request_id,
      'reply_type', 'other',
      'needs_review', true
    ),
    agente_activo = false,
    waiting_for = 'CLIENT',
    hitl_reason = 'owner_reply_needs_review',
    updated_at = now()
  from request_update r
  cross join params p
  where c.wa_id = r.conversation_id
  returning c.wa_id, c.chatwoot_id, c.client_name
)
select
  ru.id,
  cu.wa_id as conversation_id,
  cu.chatwoot_id,
  cu.client_name
from request_update ru
join conversation_update cu on cu.wa_id = ru.conversation_id;
""".strip()


def build_resume_customer_flow_code(loop_reason: str) -> str:
    return (
        """
const input = $json || {};
const compact = (value) => String(value || '').trim();
const helperRequest =
  typeof $httpRequest === 'function'
    ? $httpRequest
    : typeof this !== 'undefined' && this?.helpers?.httpRequest
      ? this.helpers.httpRequest.bind(this.helpers)
      : null;

let resumeOk = false;
let resumeStatus = null;
let resumeBody = null;
let resumeError = null;

try {
  if (!helperRequest) throw new Error('http_request_helper_unavailable');
  const response = await helperRequest({
    url: __MAIN_WEBHOOK_URL__,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: {
      wa_id: input.conversation_id,
      chatwoot_id: input.chatwoot_id || null,
      client_name: input.client_name || null,
      current_message: '',
      internal_resume: true,
      insertar_mensjae: false,
      skip_validator: true,
      loop_reason: '__LOOP_REASON__',
      forced_state: null,
      owner_unavailable: false,
      message_type: 'TEXT',
      original_message_type: 'TEXT',
    },
    json: true,
    timeout: 30000,
    ignoreHttpStatusErrors: true,
    returnFullResponse: true,
  });
  resumeStatus = Number(response.statusCode || response.status || 0) || 0;
  resumeBody = response.body || null;
  resumeOk = resumeStatus >= 200 && resumeStatus < 300;
  if (!resumeOk) {
    resumeError = response.body?.message || response.body?.error || `resume_failed:${resumeStatus}`;
  }
} catch (error) {
  resumeError = error.message || 'resume_failed';
}

return [
  {
    json: {
      ...input,
      ok: resumeError ? false : true,
      processed: true,
      resumed_customer_flow: resumeOk,
      resume_status: resumeStatus,
      resume_body: resumeBody,
      resume_error: resumeError,
      wa_id: input.conversation_id || null,
      chatwoot_id: input.chatwoot_id || null,
    },
  },
];
"""
        .strip()
        .replace("__MAIN_WEBHOOK_URL__", json.dumps(MAIN_PUBLIC_WEBHOOK_URL))
        .replace("__LOOP_REASON__", loop_reason)
    )


OWNER_HANDLER_BUILD_NOOP_CODE = """
const input = $json || {};
return [
  {
    json: {
      ...input,
      ok: true,
      processed: false,
      resumed_customer_flow: false,
      wa_id: input.conversation_id || input.wa_id || null,
      chatwoot_id: input.chatwoot_id || null,
    },
  },
];
""".strip()


OWNER_HANDLER_BUILD_REVIEW_RESULT_CODE = """
const input = $json || {};
return [
  {
    json: {
      ...input,
      ok: true,
      processed: true,
      resumed_customer_flow: false,
      wa_id: input.conversation_id || null,
      chatwoot_id: input.chatwoot_id || null,
    },
  },
];
""".strip()


OWNER_REQUEST_DETERMINISTIC_SLA_CODE = """
const input = $json || {};
const BOGOTA_OFFSET_HOURS = -5;
const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 22;

function toBogotaParts(date = new Date()) {
  const shifted = new Date(date.getTime() + BOGOTA_OFFSET_HOURS * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function bogotaDateToUtc(year, month, day, hour = 0, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour - BOGOTA_OFFSET_HOURS, minute, 0));
}

function nextDay(parts) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + 24 * 60 * 60 * 1000);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function moveIntoBusinessWindow(date) {
  const parts = toBogotaParts(date);
  if (parts.hour < BUSINESS_START_HOUR) {
    return bogotaDateToUtc(parts.year, parts.month, parts.day, BUSINESS_START_HOUR, 0);
  }
  if (parts.hour >= BUSINESS_END_HOUR) {
    const tomorrow = nextDay(parts);
    return bogotaDateToUtc(tomorrow.year, tomorrow.month, tomorrow.day, BUSINESS_START_HOUR, 0);
  }
  return date;
}

function startOfNextBusinessDay(date) {
  const tomorrow = nextDay(toBogotaParts(date));
  return bogotaDateToUtc(tomorrow.year, tomorrow.month, tomorrow.day, BUSINESS_START_HOUR, 0);
}

function addBusinessHours(baseDate, hours) {
  let current = moveIntoBusinessWindow(baseDate);
  let remainingMinutes = Math.max(0, Math.round(Number(hours) * 60));

  while (remainingMinutes > 0) {
    const parts = toBogotaParts(current);
    const endOfWindow = bogotaDateToUtc(parts.year, parts.month, parts.day, BUSINESS_END_HOUR, 0);
    const availableToday = Math.max(0, Math.floor((endOfWindow.getTime() - current.getTime()) / 60000));

    if (availableToday <= 0) {
      current = startOfNextBusinessDay(current);
      continue;
    }

    if (remainingMinutes <= availableToday) {
      return new Date(current.getTime() + remainingMinutes * 60 * 1000);
    }

    remainingMinutes -= availableToday;
    current = startOfNextBusinessDay(current);
  }

  return current;
}

const base = input.initial_sent_at ? new Date(input.initial_sent_at) : new Date();
const reminderAt = addBusinessHours(base, 1);
const secondReminderAt = addBusinessHours(base, 3);
const ownerTimeoutAt = addBusinessHours(base, 10);

return [
  {
    json: {
      ...input,
      reminder_at: reminderAt.toISOString(),
      second_reminder_at: secondReminderAt.toISOString(),
      owner_timeout_at: ownerTimeoutAt.toISOString(),
      reminder_delay_minutes: 60,
      second_reminder_delay_minutes: 180,
      owner_timeout_delay_minutes: 600,
      reminder_reason: 'deterministic_business_hours_sla',
      reminder_planner_raw: 'deterministic_business_hours_sla',
    },
  },
];
""".strip()


SCHEDULER_EVALUATE_CODE = """
const input = $json || {};

const hasOwnerResponse = (() => {
  if (input.owner_response === null || input.owner_response === undefined) return false;
  if (typeof input.owner_response === 'object') return Object.keys(input.owner_response || {}).length > 0;
  return String(input.owner_response).trim() !== '';
})();

let action = 'cancel';
let cancelReason = null;

if (!['initial_sent', 'reminder_sent'].includes(String(input.request_status || ''))) {
  cancelReason = 'request_not_active_for_reminders';
} else if (String(input.waiting_for || '') !== 'OWNER') {
  cancelReason = 'conversation_not_waiting_for_owner';
} else if (String(input.request_selected_finca_id || '') !== String(input.conversation_selected_finca_id || '')) {
  cancelReason = 'selected_finca_changed';
} else if (hasOwnerResponse) {
  cancelReason = 'owner_response_already_present';
} else if (input.agente_activo === false) {
  cancelReason = 'bot_disabled';
} else if (input.owner_timeout_at && new Date(input.owner_timeout_at).getTime() <= Date.now()) {
  action = 'expire_unavailable';
} else if (input.reminder_at && !input.reminder_sent_at && new Date(input.reminder_at).getTime() <= Date.now()) {
  action = 'send_first_reminder';
} else if (
  input.second_reminder_at &&
  !input.second_reminder_sent_at &&
  input.reminder_sent_at &&
  new Date(input.second_reminder_at).getTime() <= Date.now()
) {
  action = 'send_second_reminder';
} else {
  cancelReason = 'nothing_due';
}

return [
  {
    json: {
      ...input,
      action,
      can_send_reminder: action === 'send_first_reminder' || action === 'send_second_reminder',
      cancel_reason: cancelReason,
    },
  },
];
""".strip()


SCHEDULER_DYNAMIC_MARK_SENT_QUERY = """
update public.owner_reservation_requests
set
  status = 'reminder_sent',
  reminder_provider_message_id = case
    when {{ "'" + String($json.action || '').replace(/'/g, "''") + "'" }} = 'send_first_reminder'
      then {{ $json.provider_message_id ? "'" + String($json.provider_message_id).replace(/'/g, "''") + "'" : 'null' }}
    else reminder_provider_message_id
  end,
  reminder_sent_at = case
    when {{ "'" + String($json.action || '').replace(/'/g, "''") + "'" }} = 'send_first_reminder'
      then now()
    else reminder_sent_at
  end,
  second_reminder_sent_at = case
    when {{ "'" + String($json.action || '').replace(/'/g, "''") + "'" }} = 'send_second_reminder'
      then now()
    else second_reminder_sent_at
  end,
  error_message = null,
  payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
    'owner_chatwoot_inbox_id', {{ Number($json.owner_chatwoot_inbox_id || 0) || 'null' }},
    'owner_chatwoot_contact_id', {{ Number($json.owner_chatwoot_contact_id || 0) || 'null' }},
    'owner_chatwoot_source_id', {{ $json.owner_chatwoot_source_id ? "'" + String($json.owner_chatwoot_source_id).replace(/'/g, "''") + "'" : 'null' }},
    'owner_chatwoot_conversation_id', {{ Number($json.owner_chatwoot_conversation_id || 0) || 'null' }},
    'owner_chatwoot_message_id', {{ Number($json.owner_chatwoot_message_id || 0) || 'null' }},
    'owner_chatwoot_inbox_name', {{ $json.owner_chatwoot_inbox_name ? "'" + String($json.owner_chatwoot_inbox_name).replace(/'/g, "''") + "'" : 'null' }},
    'owner_chatwoot_inbox_phone', {{ $json.owner_chatwoot_inbox_phone ? "'" + String($json.owner_chatwoot_inbox_phone).replace(/'/g, "''") + "'" : 'null' }},
    'owner_template_transport', 'chatwoot',
    'second_reminder_provider_message_id', case
      when {{ "'" + String($json.action || '').replace(/'/g, "''") + "'" }} = 'send_second_reminder'
        then {{ $json.provider_message_id ? "'" + String($json.provider_message_id).replace(/'/g, "''") + "'" : 'null' }}
      else coalesce(payload->>'second_reminder_provider_message_id', null)
    end
  ),
  updated_at = now()
where id = {{ Number($json.id) }}
returning id, status, reminder_sent_at, second_reminder_sent_at;
""".strip()


SCHEDULER_EXPIRE_QUERY = """
with params as (
  select
    {{ Number($json.id || 0) }}::bigint as request_id,
    now() as expired_at
),
request_update as (
  update public.owner_reservation_requests r
  set
    status = 'expired_unavailable',
    updated_at = now(),
    payload = coalesce(r.payload, '{}'::jsonb) || jsonb_build_object(
      'owner_timeout_triggered_at', to_char(p.expired_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'owner_timeout_source', 'owner_timeout'
    )
  from params p
  where r.id = p.request_id
  returning r.id, r.conversation_id
),
conversation_update as (
  update public.conversations c
  set
    owner_response = jsonb_build_object(
      'disponible', false,
      'source', 'owner_timeout',
      'responded_at', to_char(p.expired_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'request_id', p.request_id
    ),
    updated_at = now()
  from request_update r
  cross join params p
  where c.wa_id = r.conversation_id
  returning c.wa_id, c.chatwoot_id, c.client_name
)
select
  ru.id,
  cu.wa_id as conversation_id,
  cu.chatwoot_id,
  cu.client_name
from request_update ru
join conversation_update cu on cu.wa_id = ru.conversation_id;
""".strip()


def build_owner_inbound_definition() -> dict:
    trigger = {
        "parameters": {"inputSource": "passthrough"},
        "id": new_id(),
        "name": "When owner inbound handler is called",
        "type": "n8n-nodes-base.executeWorkflowTrigger",
        "typeVersion": 1.1,
        "position": [240, 320],
    }
    normalize = {
        "parameters": {"jsCode": OWNER_HANDLER_NORMALIZE_CODE},
        "id": new_id(),
        "name": "Normalize owner inbound payload",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [480, 320],
    }
    load = {
        "parameters": {
            "operation": "executeQuery",
            "query": """
with incoming as (
  select
    {{ $('Normalize owner inbound payload').item.json.chatwoot_id ? "'" + String($('Normalize owner inbound payload').item.json.chatwoot_id).replace(/'/g, "''") + "'" : 'null' }}::text as owner_chatwoot_conversation_id,
    {{ $('Normalize owner inbound payload').item.json.contact_source_id ? "'" + String($('Normalize owner inbound payload').item.json.contact_source_id).replace(/'/g, "''") + "'" : 'null' }}::text as owner_chatwoot_source_id,
    {{ $('Normalize owner inbound payload').item.json.wa_id ? "'" + String($('Normalize owner inbound payload').item.json.wa_id).replace(/'/g, "''") + "'" : 'null' }}::text as recipient_phone
),
matched as (
  select
    r.*,
    c.waiting_for,
    c.agente_activo,
    c.current_state,
    c.selected_finca_id as conversation_selected_finca_id,
    c.owner_response,
    c.client_name
  from public.owner_reservation_requests r
  join public.conversations c
    on c.wa_id = r.conversation_id
  cross join incoming i
  where r.status in ('initial_sent', 'reminder_sent')
    and (
      (
        i.owner_chatwoot_conversation_id is not null
        and coalesce(r.payload->>'owner_chatwoot_conversation_id', '') = i.owner_chatwoot_conversation_id
      )
      or (
        i.owner_chatwoot_source_id is not null
        and coalesce(r.payload->>'owner_chatwoot_source_id', '') = i.owner_chatwoot_source_id
      )
      or (
        i.recipient_phone is not null
        and regexp_replace(coalesce(r.recipient_phone, ''), '\\D', '', 'g') = regexp_replace(i.recipient_phone, '\\D', '', 'g')
      )
    )
  order by
    case
      when coalesce(r.payload->>'owner_chatwoot_conversation_id', '') = coalesce(i.owner_chatwoot_conversation_id, '') then 0
      when coalesce(r.payload->>'owner_chatwoot_source_id', '') = coalesce(i.owner_chatwoot_source_id, '') then 1
      else 2
    end,
    r.created_at desc
  limit 1
)
select
  m.*
from incoming i
left join matched m on true;
""".strip(),
            "options": {},
        },
        "id": new_id(),
        "name": "Load active owner request",
        "type": "n8n-nodes-base.postgres",
        "typeVersion": 2.6,
        "position": [760, 320],
        "credentials": POSTGRES_CREDENTIAL,
    }
    action = {
        "parameters": {"jsCode": OWNER_HANDLER_ACTION_CODE},
        "id": new_id(),
        "name": "Plan owner inbound action",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [1040, 320],
    }
    actionable = {
        "parameters": {
            "conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 3},
                "conditions": [
                    {
                        "id": new_id(),
                        "leftValue": "={{ ['resume_available', 'resume_unavailable'].includes(String($json.action || '')) }}",
                        "rightValue": "",
                        "operator": {"type": "boolean", "operation": "true", "singleValue": True},
                    }
                ],
                "combinator": "and",
            },
            "looseTypeValidation": True,
            "options": {},
        },
        "id": new_id(),
        "name": "Actionable owner reply?",
        "type": "n8n-nodes-base.if",
        "typeVersion": 2.2,
        "position": [1280, 240],
    }
    persist_actionable = {
        "parameters": {"operation": "executeQuery", "query": OWNER_HANDLER_PERSIST_ACTIONABLE_QUERY, "options": {}},
        "id": new_id(),
        "name": "Persist actionable owner reply",
        "type": "n8n-nodes-base.postgres",
        "typeVersion": 2.6,
        "position": [1520, 160],
        "credentials": POSTGRES_CREDENTIAL,
    }
    resume = {
        "parameters": {"jsCode": build_resume_customer_flow_code("owner_response_resume")},
        "id": new_id(),
        "name": "Resume customer flow after owner reply",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [1760, 160],
    }
    needs_review = {
        "parameters": {
            "conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 3},
                "conditions": [
                    {
                        "id": new_id(),
                        "leftValue": "={{ String($json.action || '') === 'needs_review' }}",
                        "rightValue": "",
                        "operator": {"type": "boolean", "operation": "true", "singleValue": True},
                    }
                ],
                "combinator": "and",
            },
            "looseTypeValidation": True,
            "options": {},
        },
        "id": new_id(),
        "name": "Needs owner review?",
        "type": "n8n-nodes-base.if",
        "typeVersion": 2.2,
        "position": [1520, 448],
    }
    persist_review = {
        "parameters": {"operation": "executeQuery", "query": OWNER_HANDLER_PERSIST_REVIEW_QUERY, "options": {}},
        "id": new_id(),
        "name": "Persist owner reply needs review",
        "type": "n8n-nodes-base.postgres",
        "typeVersion": 2.6,
        "position": [1760, 368],
        "credentials": POSTGRES_CREDENTIAL,
    }
    build_review = {
        "parameters": {"jsCode": OWNER_HANDLER_BUILD_REVIEW_RESULT_CODE},
        "id": new_id(),
        "name": "Build owner review result",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [2000, 368],
    }
    build_noop = {
        "parameters": {"jsCode": OWNER_HANDLER_BUILD_NOOP_CODE},
        "id": new_id(),
        "name": "Build owner inbound noop result",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [1760, 592],
    }

    return {
        "name": OWNER_INBOUND_NAME,
        "nodes": [
            trigger,
            normalize,
            load,
            action,
            actionable,
            persist_actionable,
            resume,
            needs_review,
            persist_review,
            build_review,
            build_noop,
        ],
        "connections": {
            "When owner inbound handler is called": {
                "main": [[{"node": "Normalize owner inbound payload", "type": "main", "index": 0}]]
            },
            "Normalize owner inbound payload": {
                "main": [[{"node": "Load active owner request", "type": "main", "index": 0}]]
            },
            "Load active owner request": {
                "main": [[{"node": "Plan owner inbound action", "type": "main", "index": 0}]]
            },
            "Plan owner inbound action": {
                "main": [[{"node": "Actionable owner reply?", "type": "main", "index": 0}]]
            },
            "Actionable owner reply?": {
                "main": [
                    [{"node": "Persist actionable owner reply", "type": "main", "index": 0}],
                    [{"node": "Needs owner review?", "type": "main", "index": 0}],
                ]
            },
            "Persist actionable owner reply": {
                "main": [[{"node": "Resume customer flow after owner reply", "type": "main", "index": 0}]]
            },
            "Needs owner review?": {
                "main": [
                    [{"node": "Persist owner reply needs review", "type": "main", "index": 0}],
                    [{"node": "Build owner inbound noop result", "type": "main", "index": 0}],
                ]
            },
            "Persist owner reply needs review": {
                "main": [[{"node": "Build owner review result", "type": "main", "index": 0}]]
            },
        },
        "settings": {
            "executionOrder": "v1",
            "timezone": "America/Bogota",
        },
    }


def patch_main_workflow(workflow: dict, owner_inbound_workflow_id: str) -> None:
    normalize_node = find_node(workflow, "Normalize inbound payload")
    normalize_code = normalize_node["parameters"]["jsCode"]
    normalize_code = replace_once(
        normalize_code,
        "  const waId = digitsOnly(payload.wa_id || payload.phone || payload.conversationId || payload.sessionId);\n  const chatInput = compact(payload.chatInput || payload.text || payload.current_message);\n",
        "  const waId = digitsOnly(payload.wa_id || payload.phone || payload.conversationId || payload.sessionId);\n  const chatInput = compact(payload.chatInput || payload.text || payload.current_message);\n  const internalResume = toNullableBoolean(payload.internal_resume) === true;\n",
        "Normalize inbound payload simulator internal resume prelude",
    )
    normalize_code = replace_once(
        normalize_code,
        """        eligible: Boolean(waId && chatInput),
        ignore_reason: waId && chatInput ? null : 'missing_wa_id_or_text',
        chatInput,
        chatwoot_id: payload.chatwoot_id || null,
        chatwoot_status: null,
        chatwoot_message_id: null,
        wa_id: waId,""",
        """        eligible: Boolean(waId && (chatInput || internalResume)),
        ignore_reason: waId && (chatInput || internalResume) ? null : 'missing_wa_id_or_text',
        chatInput,
        current_message: compact(payload.current_message || ''),
        chatwoot_id: payload.chatwoot_id || null,
        chatwoot_status: null,
        chatwoot_message_id: payload.chatwoot_message_id || null,
        inbox_id: payload.inbox_id || null,
        inbox_name: payload.inbox_name || null,
        contact_source_id: payload.contact_source_id || null,
        insertar_mensjae:
          typeof payload.insertar_mensjae === 'boolean'
            ? payload.insertar_mensjae
            : toNullableBoolean(payload.insertar_mensjae),
        skip_validator: payload.skip_validator === true,
        forced_state: compact(payload.forced_state || '') || null,
        loop_reason: compact(payload.loop_reason || '') || null,
        owner_unavailable: payload.owner_unavailable === true,
        internal_resume: internalResume,
        wa_id: waId,""",
        "Normalize inbound payload simulator object",
    )
    normalize_code = replace_once(
        normalize_code,
        """      chatwoot_message_id: chatwootMessageId ? String(chatwootMessageId) : null,
      wa_id: waId,""",
        """      chatwoot_message_id: chatwootMessageId ? String(chatwootMessageId) : null,
      inbox_id:
        payload.inbox?.id !== undefined && payload.inbox?.id !== null
          ? String(payload.inbox.id)
          : payload.conversation?.inbox_id !== undefined && payload.conversation?.inbox_id !== null
            ? String(payload.conversation.inbox_id)
            : null,
      inbox_name: payload.inbox?.name ? String(payload.inbox.name) : null,
      contact_source_id:
        payload.conversation?.contact_inbox?.source_id ||
        payload.contact_inbox?.source_id ||
        null,
      internal_resume: false,
      wa_id: waId,""",
        "Normalize inbound payload chatwoot owner inbox fields",
    )
    normalize_node["parameters"]["jsCode"] = normalize_code

    config_node = find_node(workflow, "config")
    set_assignment_value(config_node, "insertar_mensjae", "={{ $json.insertar_mensjae ?? true }}")
    set_assignment_value(
        config_node,
        "current_message",
        "={{ String(($json.current_message ?? $json.chatInput ?? $json.text) || '').trim() }}",
    )
    set_assignment_value(config_node, "skip_validator", "={{ $json.skip_validator === true }}")
    set_assignment_value(config_node, "forced_state", "={{ $json.forced_state || null }}")
    set_assignment_value(config_node, "loop_reason", "={{ $json.loop_reason || null }}")
    set_assignment_value(config_node, "owner_unavailable", "={{ $json.owner_unavailable === true }}")

    webhook_response = find_node(workflow, "Webhook Response")
    set_assignment_value(webhook_response, "ok", "={{ $json.ok ?? true }}")
    set_assignment_value(webhook_response, "processed", "={{ $json.processed ?? true }}")

    settings_node = find_node(workflow, "Get agent settings")
    settings_query = settings_node["parameters"]["query"]
    settings_query = replace_once(
        settings_query,
        "    null::text as owner_contact_override,\n",
        "    null::text as owner_contact_override,\n    false::boolean as owner_test_mode_enabled,\n",
        "Get agent settings owner_test_mode default",
    )
    settings_query = replace_once(
        settings_query,
        "  coalesce(s.owner_contact_override, d.owner_contact_override) as owner_contact_override,\n",
        "  coalesce(s.owner_contact_override, d.owner_contact_override) as owner_contact_override,\n  coalesce(s.owner_test_mode_enabled, d.owner_test_mode_enabled) as owner_test_mode_enabled,\n",
        "Get agent settings owner_test_mode select",
    )
    settings_node["parameters"]["query"] = settings_query

    prepare_node = find_node(workflow, "Prepare selection notifications")
    prepare_code = prepare_node["parameters"]["jsCode"]
    prepare_code = replace_once(
        prepare_code,
        "      conversation_link: chatwootLink,\n",
        "      conversation_link: chatwootLink,\n      owner_test_mode_enabled: settings.owner_test_mode_enabled === true,\n",
        "Prepare selection notifications owner_test_mode payload",
    )
    prepare_node["parameters"]["jsCode"] = prepare_code

    owner_if_node = {
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
                        "leftValue": f"={{{{ $('Normalize inbound payload').item.json.source === 'chatwoot' && (String($('Normalize inbound payload').item.json.inbox_id || '') === '{CHATWOOT_OWNER_INBOX_ID}' || String($('Normalize inbound payload').item.json.inbox_name || '').trim() === '{CHATWOOT_OWNER_INBOX_NAME}') }}}}",
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
        "name": "Is owner inbox event?",
        "type": "n8n-nodes-base.if",
        "typeVersion": 2.2,
        "position": [-1952, 128],
    }

    owner_execute_node = {
        "parameters": {
            "workflowId": {
                "__rl": True,
                "mode": "id",
                "value": owner_inbound_workflow_id,
                "cachedResultName": OWNER_INBOUND_NAME,
                "cachedResultUrl": f"/workflow/{owner_inbound_workflow_id}",
            },
            "workflowInputs": {
                "mappingMode": "defineBelow",
                "value": {},
                "matchingColumns": [],
                "schema": [
                    {
                        "id": new_id(),
                        "displayName": "event_type",
                        "required": False,
                        "defaultMatch": False,
                        "display": True,
                        "canBeUsedToMatch": True,
                        "type": "string",
                        "removed": False,
                        "stringValue": "={{ $json.event_type || null }}",
                    },
                    {
                        "id": new_id(),
                        "displayName": "eligible",
                        "required": False,
                        "defaultMatch": False,
                        "display": True,
                        "canBeUsedToMatch": True,
                        "type": "boolean",
                        "removed": False,
                        "booleanValue": "={{ $json.eligible === true }}",
                    },
                    {
                        "id": new_id(),
                        "displayName": "is_sync_event",
                        "required": False,
                        "defaultMatch": False,
                        "display": True,
                        "canBeUsedToMatch": True,
                        "type": "boolean",
                        "removed": False,
                        "booleanValue": "={{ $json.is_sync_event === true }}",
                    },
                    {
                        "id": new_id(),
                        "displayName": "chatInput",
                        "required": False,
                        "defaultMatch": False,
                        "display": True,
                        "canBeUsedToMatch": True,
                        "type": "string",
                        "removed": False,
                        "stringValue": "={{ $json.chatInput || '' }}",
                    },
                    {
                        "id": new_id(),
                        "displayName": "chatwoot_id",
                        "required": False,
                        "defaultMatch": False,
                        "display": True,
                        "canBeUsedToMatch": True,
                        "type": "string",
                        "removed": False,
                        "stringValue": "={{ $json.chatwoot_id || null }}",
                    },
                    {
                        "id": new_id(),
                        "displayName": "chatwoot_message_id",
                        "required": False,
                        "defaultMatch": False,
                        "display": True,
                        "canBeUsedToMatch": True,
                        "type": "string",
                        "removed": False,
                        "stringValue": "={{ $json.chatwoot_message_id || null }}",
                    },
                    {
                        "id": new_id(),
                        "displayName": "wa_id",
                        "required": False,
                        "defaultMatch": False,
                        "display": True,
                        "canBeUsedToMatch": True,
                        "type": "string",
                        "removed": False,
                        "stringValue": "={{ $json.wa_id || null }}",
                    },
                    {
                        "id": new_id(),
                        "displayName": "client_name",
                        "required": False,
                        "defaultMatch": False,
                        "display": True,
                        "canBeUsedToMatch": True,
                        "type": "string",
                        "removed": False,
                        "stringValue": "={{ $json.client_name || null }}",
                    },
                    {
                        "id": new_id(),
                        "displayName": "inbox_id",
                        "required": False,
                        "defaultMatch": False,
                        "display": True,
                        "canBeUsedToMatch": True,
                        "type": "string",
                        "removed": False,
                        "stringValue": "={{ $json.inbox_id || null }}",
                    },
                    {
                        "id": new_id(),
                        "displayName": "inbox_name",
                        "required": False,
                        "defaultMatch": False,
                        "display": True,
                        "canBeUsedToMatch": True,
                        "type": "string",
                        "removed": False,
                        "stringValue": "={{ $json.inbox_name || null }}",
                    },
                    {
                        "id": new_id(),
                        "displayName": "contact_source_id",
                        "required": False,
                        "defaultMatch": False,
                        "display": True,
                        "canBeUsedToMatch": True,
                        "type": "string",
                        "removed": False,
                        "stringValue": "={{ $json.contact_source_id || null }}",
                    },
                    {
                        "id": new_id(),
                        "displayName": "raw_json",
                        "required": False,
                        "defaultMatch": False,
                        "display": True,
                        "canBeUsedToMatch": True,
                        "type": "string",
                        "removed": False,
                        "stringValue": "={{ JSON.stringify($json.raw || {}) }}",
                    },
                ],
                "attemptToConvertTypes": False,
                "convertFieldsToString": False,
            },
            "options": {},
        },
        "id": new_id(),
        "name": "Handle owner inbound",
        "type": "n8n-nodes-base.executeWorkflow",
        "typeVersion": 1.2,
        "position": [-1728, 128],
    }

    ensure_node(workflow, owner_if_node)
    ensure_node(workflow, owner_execute_node)

    set_main_connections(workflow, "Normalize inbound payload", [["Is owner inbox event?"]])
    set_main_connections(workflow, "Is owner inbox event?", [["Handle owner inbound"], ["Is RESET command?"]])
    set_main_connections(workflow, "Handle owner inbound", [["Webhook Response"]])

    precheck_node = find_node(workflow, "Compute deterministic prechecks")
    precheck_code = precheck_node["parameters"]["jsCode"]
    precheck_code = replace_once(
        precheck_code,
        """        post_actions: {
          agente_activo: false,
          waiting_for: 'CLIENT',
          owner_response: '__CLEAR__',
        },""",
        """        post_actions: {
          agente_activo: false,
          waiting_for: 'CLIENT',
        },""",
        "Compute deterministic prechecks available owner_response clear",
    )
    precheck_code = replace_once(
        precheck_code,
        """        post_actions: {
          state_transition: 'OFFERING',
          waiting_for: 'CLIENT',
          owner_response: '__CLEAR__',
          selected_finca_id: '__CLEAR__',
          selected_finca: '__CLEAR__',
        },""",
        """        post_actions: {
          state_transition: 'OFFERING',
          waiting_for: 'CLIENT',
          selected_finca_id: '__CLEAR__',
          selected_finca: '__CLEAR__',
        },""",
        "Compute deterministic prechecks unavailable owner_response clear",
    )
    precheck_node["parameters"]["jsCode"] = precheck_code


def patch_owner_request_workflow(workflow: dict) -> None:
    normalize_node = find_node(workflow, "Normalize owner reservation request")
    normalize_code = normalize_node["parameters"]["jsCode"]
    if "const toBoolean = (value) => {" not in normalize_code:
        normalize_code = replace_once(
            normalize_code,
            "const compact = (value) => String(value ?? '').trim();\n",
            "const compact = (value) => String(value ?? '').trim();\nconst toBoolean = (value) => {\n  if (typeof value === 'boolean') return value;\n  const normalized = compact(value).toLowerCase();\n  return ['true', '1', 'yes', 'si', 'sí', 'on'].includes(normalized);\n};\n",
            "Normalize owner reservation request toBoolean helper",
        )
    if "owner_test_mode_enabled:" not in normalize_code:
        normalize_code = replace_regex_once(
            normalize_code,
            r"(?m)^(\s*inventory_sheet_document_id:\s*compact\(payload\.inventory_sheet_document_id\)\s*\|\|.*\n)",
            "      owner_test_mode_enabled: toBoolean(payload.owner_test_mode_enabled ?? payload.ownerTestModeEnabled),\n\\1",
            "Normalize owner reservation request owner_test_mode field",
        )
    normalize_node["parameters"]["jsCode"] = normalize_code

    resolve_node = find_node(workflow, "Resolve owner reservation target")
    resolve_code = resolve_node["parameters"]["jsCode"]
    if "const toBoolean = (value) => {" not in resolve_code:
        resolve_code = replace_once(
            resolve_code,
            "const normalizeText = (value) =>\n  compact(value)\n    .normalize('NFD')\n    .replace(/[\\u0300-\\u036f]/g, '')\n    .toLowerCase();\n",
            "const normalizeText = (value) =>\n  compact(value)\n    .normalize('NFD')\n    .replace(/[\\u0300-\\u036f]/g, '')\n    .toLowerCase();\nconst toBoolean = (value) => {\n  if (typeof value === 'boolean') return value;\n  const normalized = normalizeText(value);\n  return ['true', '1', 'yes', 'si', 'sí', 'on'].includes(normalized);\n};\n",
            "Resolve owner reservation target toBoolean helper",
        )
    if "ownerTestModeEnabled = toBoolean(input.owner_test_mode_enabled)" not in resolve_code:
        resolve_code = replace_once(
            resolve_code,
            "const rawCells = Array.isArray(matchedRow.__raw_cells) ? matchedRow.__raw_cells : [];\nconst phoneCandidates = [\n  ['administrador_contacto', pick(matchedRow, ['administrador_contacto'])],\n  ['owner_contacto', pick(matchedRow, ['owner_contacto', 'owner_contacto_1', 'owner_contacto_2'])],\n  ['ah', compact(rawCells[33]) || null],\n];\n\nlet phoneSource = null;\nlet recipientPhone = null;\nfor (const [source, rawValue] of phoneCandidates) {\n  const normalized = normalizePhone(rawValue);\n  if (normalized) {\n    phoneSource = source;\n    recipientPhone = normalized;\n    break;\n  }\n}\n",
            "const rawCells = Array.isArray(matchedRow.__raw_cells) ? matchedRow.__raw_cells : [];\nconst ownerTestModeEnabled = toBoolean(input.owner_test_mode_enabled);\nconst phoneCandidates = [\n  ['administrador_contacto', pick(matchedRow, ['administrador_contacto'])],\n  ['owner_contacto', pick(matchedRow, ['owner_contacto', 'owner_contacto_1', 'owner_contacto_2'])],\n  ['ah', compact(rawCells[33]) || null],\n];\n\nlet phoneSource = null;\nlet recipientPhone = null;\nif (ownerTestModeEnabled) {\n  recipientPhone = normalizePhone(input.wa_id);\n  phoneSource = recipientPhone ? 'test_same_user' : null;\n} else {\n  for (const [source, rawValue] of phoneCandidates) {\n    const normalized = normalizePhone(rawValue);\n    if (normalized) {\n      phoneSource = source;\n      recipientPhone = normalized;\n      break;\n    }\n  }\n}\n",
            "Resolve owner reservation target test mode recipient logic",
        )
    if "owner_test_mode_enabled: ownerTestModeEnabled" not in resolve_code:
        resolve_code = replace_once(
            resolve_code,
            "  zona: input.zona || null,\n  phone_source: phoneSource,\n",
            "  zona: input.zona || null,\n  owner_test_mode_enabled: ownerTestModeEnabled,\n  phone_source: phoneSource,\n",
            "Resolve owner reservation target payload owner_test_mode",
        )
    if "test_user_phone_not_found" not in resolve_code:
        resolve_code = replace_once(
            resolve_code,
            "const errorMessage =\n  !recipientPhone\n    ? 'owner_phone_not_found'\n    : !resolved.fecha_inicio_text || !resolved.fecha_fin_text\n      ? 'missing_or_invalid_reservation_dates'\n      : null;\n",
            "const errorMessage =\n  !recipientPhone\n    ? (ownerTestModeEnabled ? 'test_user_phone_not_found' : 'owner_phone_not_found')\n    : !resolved.fecha_inicio_text || !resolved.fecha_fin_text\n      ? 'missing_or_invalid_reservation_dates'\n      : null;\n",
            "Resolve owner reservation target test mode error",
        )
    resolve_node["parameters"]["jsCode"] = resolve_code

    parse_node = find_node(workflow, "Parse owner reservation reminder plan")
    parse_node["parameters"]["jsCode"] = OWNER_REQUEST_DETERMINISTIC_SLA_CODE

    save_node = find_node(workflow, "Save owner reservation reminder plan")
    save_node["parameters"]["query"] = """
update public.owner_reservation_requests
set
  reminder_at = {{ "'" + String($json.reminder_at).replace(/'/g, "''") + "'" }}::timestamptz,
  second_reminder_at = {{ "'" + String($json.second_reminder_at).replace(/'/g, "''") + "'" }}::timestamptz,
  owner_timeout_at = {{ "'" + String($json.owner_timeout_at).replace(/'/g, "''") + "'" }}::timestamptz,
  payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
    'owner_sla_strategy', 'deterministic_business_hours',
    'first_reminder_business_hours', 1,
    'second_reminder_business_hours', 3,
    'owner_timeout_business_hours', 10
  ),
  updated_at = now()
where id = {{ Number($json.id || 0) }}
returning *;
""".strip()

    set_main_connections(workflow, "Mark owner reservation initial sent", [["Parse owner reservation reminder plan"]])


def patch_owner_reminder_workflow(workflow: dict) -> None:
    load_node = find_node(workflow, "Load due owner reminders")
    load_node["parameters"]["query"] = """
select
  r.id,
  r.conversation_id,
  r.chatwoot_id,
  r.selected_finca_id as request_selected_finca_id,
  r.selected_finca_name,
  r.recipient_phone,
  r.template_language,
  r.reminder_template_name,
  r.status as request_status,
  r.send_after_at,
  r.initial_sent_at,
  r.reminder_at,
  r.reminder_sent_at,
  r.second_reminder_at,
  r.second_reminder_sent_at,
  r.owner_timeout_at,
  r.payload,
  c.waiting_for,
  c.selected_finca_id as conversation_selected_finca_id,
  c.owner_response,
  c.agente_activo,
  c.client_name,
  c.current_state
from public.owner_reservation_requests r
left join public.conversations c
  on c.wa_id = r.conversation_id
where r.status in ('initial_sent', 'reminder_sent')
  and r.recipient_phone is not null
  and (
    (r.owner_timeout_at is not null and r.owner_timeout_at <= now())
    or (r.reminder_at is not null and r.reminder_sent_at is null and r.reminder_at <= now())
    or (r.second_reminder_at is not null and r.second_reminder_sent_at is null and r.second_reminder_at <= now())
  )
  and ((now() at time zone 'America/Bogota')::time >= time '08:00')
  and ((now() at time zone 'America/Bogota')::time < time '22:00')
order by coalesce(r.owner_timeout_at, r.second_reminder_at, r.reminder_at) asc
limit 100;
""".strip()

    evaluate_node = find_node(workflow, "Evaluate owner reminder eligibility")
    evaluate_node["parameters"]["jsCode"] = SCHEDULER_EVALUATE_CODE

    send_if_node = find_node(workflow, "Should send owner reminder?")
    condition = send_if_node["parameters"]["conditions"]["conditions"][0]
    condition["leftValue"] = "={{ String($json.action || '').startsWith('send_') }}"

    mark_node = find_node(workflow, "Mark owner reminder sent")
    mark_node["parameters"]["query"] = SCHEDULER_DYNAMIC_MARK_SENT_QUERY

    fail_node = find_node(workflow, "Record owner reminder attempt failed")
    fail_node["parameters"]["query"] = """
update public.owner_reservation_requests
set
  error_message = {{ $json.error_message ? "'" + String($json.error_message).replace(/'/g, "''") + "'" : ("'" + (String($json.action || '') === 'send_second_reminder' ? 'owner_second_reminder_template_failed' : 'owner_reminder_template_failed') + "'") }},
  updated_at = now()
where id = {{ Number($json.id) }}
returning id, status, error_message;
""".strip()

    expire_if_node = {
        "parameters": {
            "conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 3},
                "conditions": [
                    {
                        "id": new_id(),
                        "leftValue": "={{ String($json.action || '') === 'expire_unavailable' }}",
                        "rightValue": "",
                        "operator": {"type": "boolean", "operation": "true", "singleValue": True},
                    }
                ],
                "combinator": "and",
            },
            "looseTypeValidation": True,
            "options": {},
        },
        "id": new_id(),
        "name": "Should expire owner request?",
        "type": "n8n-nodes-base.if",
        "typeVersion": 2.2,
        "position": [736, 256],
    }
    expire_node = {
        "parameters": {"operation": "executeQuery", "query": SCHEDULER_EXPIRE_QUERY, "options": {}},
        "id": new_id(),
        "name": "Expire owner request as unavailable",
        "type": "n8n-nodes-base.postgres",
        "typeVersion": 2.6,
        "position": [976, 160],
        "credentials": POSTGRES_CREDENTIAL,
    }
    resume_timeout_node = {
        "parameters": {"jsCode": build_resume_customer_flow_code("owner_timeout_resume")},
        "id": new_id(),
        "name": "Resume customer flow after owner timeout",
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [1216, 160],
    }

    ensure_node(workflow, expire_if_node)
    ensure_node(workflow, expire_node)
    ensure_node(workflow, resume_timeout_node)

    set_main_connections(workflow, "Evaluate owner reminder eligibility", [["Should expire owner request?"]])
    set_main_connections(workflow, "Should expire owner request?", [["Expire owner request as unavailable"], ["Should send owner reminder?"]])
    set_main_connections(workflow, "Expire owner request as unavailable", [["Resume customer flow after owner timeout"]])


def main() -> None:
    owner_inbound_definition = build_owner_inbound_definition()
    owner_inbound = upsert_workflow_by_name(
        owner_inbound_definition,
        OWNER_INBOUND_FILE,
        "owner-inbound-handler",
    )

    main_workflow = patch_existing_workflow(
        MAIN_WORKFLOW_ID,
        lambda workflow: patch_main_workflow(workflow, owner_inbound["id"]),
        MAIN_WORKFLOW_FILE,
        "owner-inbound-and-sla",
    )
    owner_request = patch_workflow_by_name(
        OWNER_REQUEST_NAME,
        patch_owner_request_workflow,
        OWNER_REQUEST_FILE,
        "owner-request-sla",
    )
    owner_reminder = patch_workflow_by_name(
        OWNER_REMINDER_NAME,
        patch_owner_reminder_workflow,
        OWNER_REMINDER_FILE,
        "owner-reminder-sla",
    )

    print(
        json.dumps(
            {
                "mainWorkflow": main_workflow,
                "ownerInboundWorkflow": owner_inbound,
                "ownerRequestWorkflow": owner_request,
                "ownerReminderWorkflow": owner_reminder,
            },
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
