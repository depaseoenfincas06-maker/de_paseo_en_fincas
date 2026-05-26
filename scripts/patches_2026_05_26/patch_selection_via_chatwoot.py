#!/usr/bin/env python3
"""Refactor Send WhatsApp selection template to use Chatwoot account 1 API
(misma WABA que solicitud_reserva, manda desde +57 +573105639334) en
lugar de Kapso direct (que viene del +1 sandbox).

Mismo patrón que owner template — find/create inbox + contact + conversation,
luego POST con template_params.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = 'tNvfWKi1TA7O6maf'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# Replace the entire Send WhatsApp selection template jsCode with Chatwoot-based version
NEW_CODE = r"""const input = $json || {};
const payload = input.payload || {};
const text = (value) => {
  const normalized = String(value ?? '').trim();
  return normalized || 'Sin dato';
};
const compact = (value) => String(value ?? '').trim();
const normalizePhone = (value) => {
  const digits = String(value || '').replace(/\D+/g, '').trim();
  if (!digits) return '';
  if (digits.startsWith('57') && digits.length === 12) return '+' + digits;
  if (digits.length === 10) return '+57' + digits;
  return '+' + digits;
};
const sourceIdForPhone = (value) => String(value || '').replace(/\D+/g, '').trim();
const parseNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
};

const detail = [
  'Teléfono: ' + text(payload.wa_id),
  'Finca: ' + text(payload.selected_finca_name || payload.selected_finca_id),
  'Fechas: ' + text(payload.fechas),
  'Personas: ' + text(payload.personas),
  'Zona: ' + text(payload.zona),
  'Chatwoot: ' + text(payload.chatwoot_link),
].join(' | ');

const recipientPhone = normalizePhone(input.recipient_phone);
const clientName = text(payload.client_name);

// Chatwoot account 1 (owner-side WABA = +573105639334 — usa el mismo número
// que envía solicitud_reserva al propietario, NO Kapso sandbox +1).
const inboxName = 'Agent_propietarios';
const chatwootBaseUrl = 'https://chat.depaseoenfincas.raaamp.co';
const chatwootAccountId = '1';
const chatwootApiToken = 'HHtQoPLW991XS8Rcu5thbZ5x';
const templateName = String(input.template_name || 'staff_finca_selected_v1').trim();
const templateLanguage = String(input.template_language || 'es_CO').trim();

let responseStatus = null;
let responseBody = null;
let providerMessageId = null;
let errorMessage = null;
let cwInboxId = null;
let cwContactId = null;
let cwConversationId = null;

async function cwApi(pathname, method = 'GET', body = null, query = null) {
  const url = chatwootBaseUrl.replace(/\/+$/, '') + (pathname.startsWith('/') ? pathname : '/' + pathname) +
    (query ? '?' + Object.entries(query).filter(([k,v])=>v!=null&&v!=='').map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(String(v))).join('&') : '');
  const opts = {
    url,
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', api_access_token: chatwootApiToken },
    json: true,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
    timeout: 12000,
  };
  if (body !== null) opts.body = body;
  const res = await this.helpers.httpRequest(opts);
  return { status: res.statusCode, body: res.body };
}

try {
  if (!recipientPhone) throw new Error('selection_recipient_phone_missing');

  // 1. Find inbox
  const inboxesRes = await cwApi.call(this, '/api/v1/accounts/' + chatwootAccountId + '/inboxes');
  if (inboxesRes.status >= 300) throw new Error('inbox_list_failed:' + inboxesRes.status);
  const inboxes = inboxesRes.body?.payload || [];
  const inbox = inboxes.find(i => compact(i.name).toLowerCase() === inboxName.toLowerCase()) || inboxes[0];
  if (!inbox?.id) throw new Error('inbox_not_found:' + inboxName);
  cwInboxId = parseNumber(inbox.id);

  // 2. Find or create contact
  const sourceId = sourceIdForPhone(recipientPhone);
  const searchRes = await cwApi.call(this, '/api/v1/accounts/' + chatwootAccountId + '/contacts/search', 'GET', null, { q: sourceId });
  let contact = null;
  if (searchRes.status < 300) {
    const matches = searchRes.body?.payload || [];
    contact = matches.find(c => normalizePhone(c.phone_number) === recipientPhone) || null;
  }
  if (!contact) {
    const createRes = await cwApi.call(this, '/api/v1/accounts/' + chatwootAccountId + '/contacts', 'POST', {
      inbox_id: null,
      name: clientName !== 'Sin dato' ? clientName : 'Cliente',
      phone_number: recipientPhone,
    });
    if (createRes.status >= 300) throw new Error('contact_create_failed:' + createRes.status);
    contact = createRes.body?.payload || createRes.body;
  }
  cwContactId = parseNumber(contact?.id);

  // 3. Ensure contact-inbox link
  const cibRes = await cwApi.call(this, '/api/v1/accounts/' + chatwootAccountId + '/contacts/' + cwContactId + '/contactable_inboxes');
  let resolvedSourceId = sourceId;
  if (cibRes.status < 300) {
    const ex = (cibRes.body?.payload || []).find(e => parseNumber(e.inbox?.id) === cwInboxId);
    if (ex) resolvedSourceId = compact(ex.source_id) || sourceId;
    else {
      const ciCreate = await cwApi.call(this, '/api/v1/accounts/' + chatwootAccountId + '/contacts/' + cwContactId + '/contact_inboxes', 'POST', {
        inbox_id: cwInboxId,
        source_id: sourceId,
      });
      if (ciCreate.status >= 300) throw new Error('contact_inbox_failed:' + ciCreate.status);
      resolvedSourceId = compact(ciCreate.body?.source_id) || compact(ciCreate.body?.payload?.source_id) || sourceId;
    }
  }

  // 4. Find or create conversation
  const convCreate = await cwApi.call(this, '/api/v1/accounts/' + chatwootAccountId + '/conversations', 'POST', {
    source_id: resolvedSourceId,
    inbox_id: cwInboxId,
    contact_id: cwContactId,
    status: 'open',
  });
  if (convCreate.status >= 300) throw new Error('conversation_create_failed:' + convCreate.status);
  cwConversationId = parseNumber(convCreate.body?.id);

  // 5. Send template message
  const sendRes = await cwApi.call(this, '/api/v1/accounts/' + chatwootAccountId + '/conversations/' + cwConversationId + '/messages', 'POST', {
    content: 'Cliente: ' + clientName + '\n\n' + detail,
    message_type: 'outgoing',
    private: false,
    content_type: 'text',
    content_attributes: {},
    template_params: {
      name: templateName,
      category: 'UTILITY',
      language: templateLanguage,
      processed_params: {
        body: {
          '1': clientName !== 'Sin dato' ? clientName : 'Cliente',
          '2': detail,
        },
      },
    },
  });
  responseStatus = sendRes.status;
  responseBody = sendRes.body;
  providerMessageId = compact(sendRes.body?.source_id) || null;
  if (responseStatus < 200 || responseStatus >= 300) {
    errorMessage = sendRes.body?.error?.message || sendRes.body?.message || JSON.stringify(sendRes.body) || 'chatwoot_template_send_failed';
  }
} catch (e) {
  errorMessage = e.message || 'selection_template_send_exception';
  responseBody = responseBody || { error: errorMessage };
}

return [
  {
    json: {
      ...input,
      provider_message_id: providerMessageId,
      response_status: responseStatus,
      response_body: responseBody,
      ok: !errorMessage,
      error_message: errorMessage,
      selection_chatwoot_inbox_id: cwInboxId,
      selection_chatwoot_contact_id: cwContactId,
      selection_chatwoot_conversation_id: cwConversationId,
    },
  },
];"""

for n in wf['nodes']:
    if n['name'] != 'Send WhatsApp selection template': continue
    code = n['parameters']['jsCode']
    if 'chatwoot_template_send_failed' in code and 'Agent_propietarios' in code:
        print('!! already migrated to Chatwoot'); sys.exit(0)
    n['parameters']['jsCode'] = NEW_CODE
    print('✓ Send WhatsApp selection template: migrado a Chatwoot account 1 (+57 WABA)')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
