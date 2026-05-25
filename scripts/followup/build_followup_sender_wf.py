#!/usr/bin/env python3
"""
Build & deploy the "Follow-up Sender - De Paseo en Fincas" workflow.

Structure:
  Schedule Trigger (30 min) → Select due follow-ups (Postgres)
                            → Split In Batches (size=1)
                              → Decide path (Code: compute hours_since_inbound, flag should_use_llm)
                                → IF should_use_llm
                                  ├─ true (LLM path):
                                  │   Follow-up Agent (LangChain) ← Gemini Chat Model
                                  │   → Send LLM message (Code: parse + Chatwoot send)
                                  └─ false (Template path):
                                      Send template message (Code: pick + Chatwoot send)
                                → Merge
                                → Mark sent + reprogram (Postgres)
                                → [loop back to Split In Batches]

Credentials:
  Postgres: OY6FEujGvFF1rDbg
  Gemini:   P2iS8hYjm7h4Ez13 (via LangChain Chat Model node)
  Chatwoot: hardcoded token (same pattern as Owner Reservation Reminder Scheduler)
"""
import json, subprocess, sys, uuid

JWT = open('/tmp/n8n_jwt.txt').read().strip()
BASE = 'https://n8n.depaseoenfincas.raaamp.co/api/v1'
PG_CRED = 'OY6FEujGvFF1rDbg'
GEMINI_CRED = 'P2iS8hYjm7h4Ez13'

# =============== Nodes ===============

NODES = []

def nid(): return str(uuid.uuid4())

# 1) Schedule Trigger
sched_id = nid()
NODES.append({
    "id": sched_id,
    "name": "Schedule Trigger",
    "type": "n8n-nodes-base.scheduleTrigger",
    "typeVersion": 1.2,
    "position": [0, 0],
    "parameters": {
        # Default 30 min. Para pruebas, bajar a 1 min desde la UI o reemplazar via API.
        "rule": {"interval": [{"field": "minutes", "minutesInterval": 30}]}
    }
})

# 2) Select due follow-ups
sel_id = nid()
SELECT_SQL = """select
  fo.id            as follow_on_id,
  fo.conversation_id,
  fo.attempt_number,
  fo.metadata      as fo_metadata,
  fo.scheduled_for,
  c.chatwoot_id,
  c.client_name,
  c.current_state,
  c.search_criteria,
  -- (conversation_context removed: c.context isn't a real column, it's computed in Get Context-conversations1)
  c.followup_count,
  (extract(epoch from (now() - coalesce(li.last_inbound_at, fo.created_at))) / 3600.0)::numeric(10,2) as hours_since_inbound
from public.follow_on fo
join public.conversations c on c.wa_id = fo.conversation_id
left join lateral (
  select max(m.created_at) as last_inbound_at
  from public.messages m
  where m.conversation_id = fo.conversation_id
    and m.direction = 'INBOUND'
) li on true
cross join lateral (
  select followup_window_start, followup_window_end
  from public.agent_settings where id = 1
) s
where fo.status = 'pendiente'
  and fo.scheduled_for <= now()
  and c.agente_activo = true
  and c.followup_enabled = true
  and c.waiting_for in ('CLIENT', 'CLIENT_APPROVAL')
  and c.last_message_from = 'AGENT'
  and ((now() AT TIME ZONE 'America/Bogota')::time
       between coalesce(s.followup_window_start, time '08:00')
           and coalesce(s.followup_window_end,   time '22:00'))
order by fo.scheduled_for asc
limit 20
for update of fo skip locked;"""

NODES.append({
    "id": sel_id,
    "name": "Select due follow-ups",
    "type": "n8n-nodes-base.postgres",
    "typeVersion": 2.6,
    "position": [240, 0],
    "parameters": {
        "operation": "executeQuery",
        "query": SELECT_SQL,
        "options": {}
    },
    "credentials": {"postgres": {"id": PG_CRED, "name": "Postgres account"}}
})

# 3) Split In Batches
sib_id = nid()
NODES.append({
    "id": sib_id,
    "name": "Split In Batches",
    "type": "n8n-nodes-base.splitInBatches",
    "typeVersion": 3,
    "position": [480, 0],
    "parameters": {
        "batchSize": 1,
        "options": {}
    }
})

# 4) Decide path
decide_id = nid()
DECIDE_CODE = r"""// Add should_use_llm flag based on the 24h WhatsApp window rule.
// If hours_since_inbound < 24 → LLM-text path; otherwise → template path.
const item = $input.first().json || {};
const hours = Number(item.hours_since_inbound);
const should_use_llm = Number.isFinite(hours) && hours < 24;

// Build a compact context block useful for both paths.
const search_criteria = item.search_criteria || {};
const missing = [];
if (!search_criteria.fecha_inicio || !search_criteria.fecha_fin) missing.push('fechas');
if (!search_criteria.personas) missing.push('personas');
if (!search_criteria.zona) missing.push('zona');

return [{
  json: {
    ...item,
    should_use_llm,
    datos_faltantes: missing,
  }
}];"""

NODES.append({
    "id": decide_id,
    "name": "Decide path",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [720, 0],
    "parameters": {"jsCode": DECIDE_CODE}
})

# 5) IF should_use_llm
if_id = nid()
NODES.append({
    "id": if_id,
    "name": "Should use LLM?",
    "type": "n8n-nodes-base.if",
    "typeVersion": 2.3,
    "position": [960, 0],
    "parameters": {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 3},
            "conditions": [{
                "id": nid(),
                "leftValue": "={{ $json.should_use_llm === true }}",
                "rightValue": "",
                "operator": {"type": "boolean", "operation": "true", "singleValue": True}
            }],
            "combinator": "and"
        },
        "looseTypeValidation": True,
        "options": {}
    }
})

# 6) LangChain Agent - Follow-up Agent (true branch)
agent_id = nid()
SYS_MSG = (
"Sos el bot \"Santiago\" de De Paseo en Fincas. Estás haciendo follow-up porque "
"el cliente no contestó. Mandá UN solo mensaje WhatsApp ultra-corto.\n\n"
"REGLAS DE REDACCIÓN:\n"
"- NO confirmes datos ya recibidos. No repitas \"para X personas en Y del A al B\".\n"
"- Si faltan datos, preguntá SOLO por lo que falta. Una pregunta corta.\n"
"- Si ya hay todos los datos pero el cliente no eligió finca, sondeá amable\n"
"  (\"¿qué te parecieron las opciones?\", \"¿alguna te gustó?\").\n"
"- Si está en CONFIRMING y no aprobó el PDF, retomá amable\n"
"  (\"¿pudiste revisar la confirmación?\").\n"
"- Máximo ~120 caracteres.\n"
"- Sin signos de admiración invertidos (¡) ni de pregunta invertidos (¿).\n"
"- Saludo personalizado con NOMBRE si está disponible.\n\n"
"REGLA DE TIMING:\n"
"- next_followup_at_offset_hours: número de horas desde \"ahora\" para programar\n"
"  el SIGUIENTE follow-up (FU #2 o #3) si el cliente no responde.\n"
"  - Default razonable: 24.\n"
"  - Si el cliente dijo \"hablamos la otra semana\", poné las horas hasta entonces.\n"
"  - Si solo le falta un dato y está cordial, 24-48.\n"
"  - Si vio cards y no respondió, 48.\n"
"- should_stop_followups: true SOLO si el cliente expresó claramente que no quiere\n"
"  más mensajes, o si la conversación se cerró formalmente. Default false.\n\n"
"OUTPUT JSON estricto (sin code fences, sin texto extra antes/después):\n"
"{\n"
"  \"mensaje\": \"string corto\",\n"
"  \"next_followup_at_offset_hours\": <number>,\n"
"  \"should_stop_followups\": <boolean>\n"
"}"
)

AGENT_TEXT = (
"=Cliente: {{ $json.client_name || 'cliente' }}\n"
"Estado actual: {{ $json.current_state }}\n"
"attempt_number (este es el FU #): {{ $json.attempt_number }}\n"
"Datos disponibles (search_criteria):\n"
"{{ JSON.stringify($json.search_criteria || {}, null, 2) }}\n"
"Datos faltantes: {{ JSON.stringify($json.datos_faltantes || []) }}\n"
"Horas desde el último mensaje del cliente: {{ $json.hours_since_inbound }}\n\n"
"Redactá el mensaje según las reglas. Devolvé SOLO el JSON con las 3 claves."
)

NODES.append({
    "id": agent_id,
    "name": "Follow-up Agent",
    "type": "@n8n/n8n-nodes-langchain.agent",
    "typeVersion": 3.1,
    "position": [1200, -100],
    "parameters": {
        "promptType": "define",
        "text": AGENT_TEXT,
        "options": {
            "systemMessage": SYS_MSG,
            "maxIterations": 2
        }
    },
    "retryOnFail": True,
    "maxTries": 3,
    "waitBetweenTries": 2000
})

# 7) Gemini Chat Model for the agent
gem_id = nid()
NODES.append({
    "id": gem_id,
    "name": "Google Gemini Chat Model",
    "type": "@n8n/n8n-nodes-langchain.lmChatGoogleGemini",
    "typeVersion": 1,
    "position": [1200, 80],
    "parameters": {
        "modelName": "models/gemini-flash-latest",
        "options": {}
    },
    "credentials": {"googlePalmApi": {"id": GEMINI_CRED, "name": "Google Gemini(PaLM) Api account"}}
})

# 8) Send LLM message (Code node — parse + Chatwoot send)
send_llm_id = nid()
SEND_LLM_CODE = r"""// Parse the LLM JSON output, then send via Chatwoot API as a regular outgoing message.
// On success, attach sent_via, message_text, next_offset_hours, should_stop to the item
// so the downstream "Mark sent" Postgres node can use them.
//
// Helper: $httpRequest is available globally in n8n Code nodes.

const item = $input.first().json || {};
const llmOutputRaw = String(item.output ?? '').trim();

// Strip code fences if any
let cleaned = llmOutputRaw
  .replace(/^```json\s*/i, '')
  .replace(/^```\s*/i, '')
  .replace(/```\s*$/i, '')
  .trim();

let parsed = null;
try { parsed = JSON.parse(cleaned); }
catch (e) {
  // try to extract first {...}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { parsed = JSON.parse(m[0]); } catch (e2) {} }
}

if (!parsed || typeof parsed !== 'object') {
  // LLM failed to produce valid JSON → fallback to a generic message + 24h offset
  parsed = {
    mensaje: "Hola, sigo por aquí para retomar cuando quieras.",
    next_followup_at_offset_hours: 24,
    should_stop_followups: false,
  };
}

// Pull the previous-node row data (Decide path or Split In Batches still have it).
// $('Decide path') is safer because $input.first().json here might be the agent's output only.
let row = {};
try { row = $('Decide path').item.json || {}; } catch (e) { row = item; }

const chatwoot_id = Number(row.chatwoot_id);
const messageText = String(parsed.mensaje || '').trim() || 'Hola, sigo por aquí.';
const nextOffsetHours = Number(parsed.next_followup_at_offset_hours);
const shouldStop = parsed.should_stop_followups === true;

const CW_BASE = 'https://chat.depaseoenfincas.raaamp.co';
const CW_ACCOUNT = '2';
const CW_TOKEN = 'HHtQoPLW991XS8Rcu5thbZ5x';

let responseStatus = null;
let providerMessageId = null;
let errorMessage = null;

if (!chatwoot_id) {
  errorMessage = 'chatwoot_id_missing';
} else {
  try {
    const resp = await this.helpers.httpRequest({
      url: `${CW_BASE}/api/v1/accounts/${CW_ACCOUNT}/conversations/${chatwoot_id}/messages`,
      method: 'POST',
      headers: {
        api_access_token: CW_TOKEN,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: {
        content: messageText,
        message_type: 'outgoing',
        private: false,
      },
      json: true,
      timeout: 30000,
      returnFullResponse: true,
      ignoreHttpStatusErrors: true,
    });
    responseStatus = Number(resp.statusCode || resp.status || 0);
    if (responseStatus < 200 || responseStatus >= 300) {
      errorMessage = resp.body?.message || `chatwoot_send_failed:${responseStatus}`;
    } else {
      providerMessageId = String(resp.body?.id ?? '');
    }
  } catch (e) {
    errorMessage = e.message || 'chatwoot_send_exception';
  }
}

return [{
  json: {
    ...row,
    sent_via: 'llm',
    message_text: messageText,
    template_name: null,
    next_offset_hours: Number.isFinite(nextOffsetHours) && nextOffsetHours > 0 ? nextOffsetHours : 24,
    should_stop: shouldStop,
    response_status: responseStatus,
    provider_message_id: providerMessageId,
    error_message: errorMessage,
    ok: !errorMessage,
  }
}];"""

NODES.append({
    "id": send_llm_id,
    "name": "Send LLM message",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [1440, -100],
    "parameters": {"jsCode": SEND_LLM_CODE}
})

# 9) Send template message (Code node — false branch)
send_tpl_id = nid()
SEND_TPL_CODE = r"""// Template path: pick template by attempt_number, render placeholder, send to Chatwoot.
// For FU #1 fuera de 24h or FU #2 → warm_reengagement
// For FU #3 → final_check_in

const row = $input.first().json || {};

const chatwoot_id = Number(row.chatwoot_id);
const clientName = String(row.client_name || 'hola').trim() || 'hola';
const attempt = Number(row.attempt_number) || 1;

const templateName = attempt >= 3 ? 'follow_up_final_check_in' : 'follow_up_warm_reengagement';

const renderedBody = attempt >= 3
  ? `Hola ${clientName}, no quisiera molestarte más. Si más adelante quieres retomar la búsqueda de tu finca, escríbeme por aquí y la retomamos sin problema. Quedo atento. 🌴`
  : `Hola ${clientName}, ¿pudiste revisar las opciones que te compartí? Sigo por aquí si quieres seguir buscando o ajustar algo de la búsqueda. ☀️`;

// Para el offset del siguiente FU, sin LLM call: usar defaults sensatos.
// FU #2 acaba de enviarse → próximo (FU #3) en 72h
// FU #3 → no hay próximo (cron lo marca lost)
const nextOffsetHours = attempt === 1 ? 24 : (attempt === 2 ? 72 : 0);

const CW_BASE = 'https://chat.depaseoenfincas.raaamp.co';
const CW_ACCOUNT = '2';
const CW_TOKEN = 'HHtQoPLW991XS8Rcu5thbZ5x';

let responseStatus = null;
let providerMessageId = null;
let errorMessage = null;

if (!chatwoot_id) {
  errorMessage = 'chatwoot_id_missing';
} else {
  try {
    const resp = await this.helpers.httpRequest({
      url: `${CW_BASE}/api/v1/accounts/${CW_ACCOUNT}/conversations/${chatwoot_id}/messages`,
      method: 'POST',
      headers: {
        api_access_token: CW_TOKEN,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: {
        content: renderedBody,
        message_type: 'outgoing',
        private: false,
        template_params: {
          name: templateName,
          category: 'MARKETING',
          language: 'es',
          processed_params: { body: { '1': clientName } },
        },
      },
      json: true,
      timeout: 30000,
      returnFullResponse: true,
      ignoreHttpStatusErrors: true,
    });
    responseStatus = Number(resp.statusCode || resp.status || 0);
    if (responseStatus < 200 || responseStatus >= 300) {
      errorMessage = resp.body?.message || `chatwoot_send_failed:${responseStatus}`;
    } else {
      providerMessageId = String(resp.body?.id ?? '');
    }
  } catch (e) {
    errorMessage = e.message || 'chatwoot_send_exception';
  }
}

return [{
  json: {
    ...row,
    sent_via: 'template',
    message_text: renderedBody,
    template_name: templateName,
    next_offset_hours: nextOffsetHours,
    should_stop: false,
    response_status: responseStatus,
    provider_message_id: providerMessageId,
    error_message: errorMessage,
    ok: !errorMessage,
  }
}];"""

NODES.append({
    "id": send_tpl_id,
    "name": "Send template message",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [1200, 240],
    "parameters": {"jsCode": SEND_TPL_CODE}
})

# 10) Mark sent + reprogram (Postgres) — handles both LLM and template paths
mark_id = nid()
MARK_SQL = """with bumped as (
  update public.conversations
  set followup_count = followup_count + 1,
      last_message_from = 'AGENT',
      next_followup_at = null,
      updated_at = now()
  where wa_id = {{ "'" + String($json.conversation_id).replace(/'/g, "''") + "'" }}
  returning followup_count, client_name
),
sent as (
  update public.follow_on
  set status = case when {{ $json.ok ? 'true' : 'false' }} then 'enviada' else 'pendiente' end,
      sent_at = case when {{ $json.ok ? 'true' : 'false' }} then now() else null end,
      message = {{ "'" + String($json.message_text || '').replace(/'/g, "''") + "'" }},
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'sent_via',           {{ "'" + String($json.sent_via || '').replace(/'/g, "''") + "'" }},
        'template_name',      {{ $json.template_name ? "'" + String($json.template_name).replace(/'/g, "''") + "'" : 'null' }},
        'provider_message_id',{{ $json.provider_message_id ? "'" + String($json.provider_message_id).replace(/'/g, "''") + "'" : 'null' }},
        'response_status',    {{ $json.response_status || 'null' }},
        'error_message',      {{ $json.error_message ? "'" + String($json.error_message).replace(/'/g, "''") + "'" : 'null' }}
      ),
      updated_at = now()
  where id = {{ Number($json.follow_on_id) }}
),
maybe_lost as (
  update public.conversations
  set funnel_status = 'lost'
  where wa_id = {{ "'" + String($json.conversation_id).replace(/'/g, "''") + "'" }}
    and (
      (select followup_count from bumped) >= 3
      or {{ $json.should_stop ? 'true' : 'false' }} = true
    )
),
maybe_next as (
  insert into public.follow_on (conversation_id, message, scheduled_for, status, attempt_number, metadata)
  select
    {{ "'" + String($json.conversation_id).replace(/'/g, "''") + "'" }},
    null,
    now() + ({{ Number($json.next_offset_hours) || 24 }} || ' hours')::interval,
    'pendiente',
    (select followup_count from bumped) + 1,
    jsonb_build_object('source', 'cron', 'attempt', (select followup_count from bumped) + 1)
  where (select followup_count from bumped) < 3
    and {{ $json.should_stop ? 'true' : 'false' }} = false
    and {{ $json.ok ? 'true' : 'false' }} = true
)
select (select followup_count from bumped) as new_followup_count;"""

NODES.append({
    "id": mark_id,
    "name": "Mark sent + reprogram",
    "type": "n8n-nodes-base.postgres",
    "typeVersion": 2.6,
    "position": [1680, 80],
    "parameters": {
        "operation": "executeQuery",
        "query": MARK_SQL,
        "options": {}
    },
    "credentials": {"postgres": {"id": PG_CRED, "name": "Postgres account"}}
})

# =============== Connections ===============

CONNECTIONS = {
    "Schedule Trigger": {
        "main": [[{"node": "Select due follow-ups", "type": "main", "index": 0}]]
    },
    "Select due follow-ups": {
        "main": [[{"node": "Split In Batches", "type": "main", "index": 0}]]
    },
    "Split In Batches": {
        "main": [
            # output 0 = "done" (no more batches) — terminal
            [],
            # output 1 = each batch
            [{"node": "Decide path", "type": "main", "index": 0}]
        ]
    },
    "Decide path": {
        "main": [[{"node": "Should use LLM?", "type": "main", "index": 0}]]
    },
    "Should use LLM?": {
        "main": [
            # true → LLM path
            [{"node": "Follow-up Agent", "type": "main", "index": 0}],
            # false → template path
            [{"node": "Send template message", "type": "main", "index": 0}]
        ]
    },
    "Google Gemini Chat Model": {
        "ai_languageModel": [[{"node": "Follow-up Agent", "type": "ai_languageModel", "index": 0}]]
    },
    "Follow-up Agent": {
        "main": [[{"node": "Send LLM message", "type": "main", "index": 0}]]
    },
    "Send LLM message": {
        "main": [[{"node": "Mark sent + reprogram", "type": "main", "index": 0}]]
    },
    "Send template message": {
        "main": [[{"node": "Mark sent + reprogram", "type": "main", "index": 0}]]
    },
    "Mark sent + reprogram": {
        "main": [[{"node": "Split In Batches", "type": "main", "index": 0}]]
    }
}

# =============== Build & POST ===============

WF = {
    "name": "Follow-up Sender - De Paseo en Fincas",
    "nodes": NODES,
    "connections": CONNECTIONS,
    "settings": {
        "executionOrder": "v1",
        "timezone": "America/Bogota",
        "saveDataErrorExecution": "all",
        "saveDataSuccessExecution": "all",
        "saveManualExecutions": True,
        "saveExecutionProgress": True,
        "errorWorkflow": "Lt8n12vKuqnvd1LH"
    }
}

# Create workflow
r = subprocess.run(['curl','-sk','-X','POST', f'{BASE}/workflows',
                    '-H', f'X-N8N-API-KEY: {JWT}',
                    '-H', 'Content-Type: application/json',
                    '-d', '@-'],
                   input=json.dumps(WF), capture_output=True, text=True, check=True)
created = json.loads(r.stdout)
if 'id' not in created:
    print('POST failed:', r.stdout); sys.exit(2)
WID = created['id']
print(f'✓ Workflow created: id={WID} | name={created["name"]}')

# Activate it
r2 = subprocess.run(['curl','-sk','-X','POST', f'{BASE}/workflows/{WID}/activate',
                     '-H', f'X-N8N-API-KEY: {JWT}'],
                    capture_output=True, text=True)
out2 = json.loads(r2.stdout) if r2.stdout else {}
print(f'  activate response: active={out2.get("active")} | message={out2.get("message", "")}')

print(f'\n  Workflow URL: https://n8n.depaseoenfincas.raaamp.co/workflow/{WID}')
print(f'  ID for memory: {WID}')
