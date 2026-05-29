#!/usr/bin/env python3
"""Reescribir el sender de notificaciones (tNvfWKi1TA7O6maf → 'Send WhatsApp
selection template') para enviar el template DIRECTO por Meta WhatsApp Cloud
API (graph.facebook.com), en vez de Chatwoot cuenta 1 (que no existe / da 401).

Esto arregla AMBAS notificaciones que pasan por este sender:
- hitl_handoff_v1 (3 params: nombre, teléfono, link)
- staff_finca_selected_v1 (2 params: nombre, detalle)

Las credenciales (phone_number_id + access token del +57) se leen del .env en
deploy-time y se inyectan al nodo, para NO dejar el token crudo en git.
"""
import json, subprocess, sys, os

JWT = open('/tmp/n8n_jwt.txt').read().strip()
OS_WID = 'tNvfWKi1TA7O6maf'

# --- Leer credenciales del .env ---
ENV = '/Users/jd/Desktop/Proyectos/depaseoenfincas-agent/.env'
phone_id = token = None
for line in open(ENV):
    line = line.strip()
    if line.startswith('WHATSAPP_PHONE_NUMBER_ID='):
        phone_id = line.split('=',1)[1].strip().strip('"').strip("'")
    elif line.startswith('WHATSAPP_ACCESS_TOKEN='):
        token = line.split('=',1)[1].strip().strip('"').strip("'")
if not phone_id or not token:
    print('!! no pude leer credenciales del .env'); sys.exit(1)
print(f'creds leídas: phone_id={phone_id} token_len={len(token)}')

NEW_CODE = '''const input = $json || {};
const payload = input.payload || {};
const text = (value) => { const n = String(value ?? '').trim(); return n || 'Sin dato'; };
const compact = (value) => String(value ?? '').trim();
const normalizeWaTo = (value) => {
  let d = String(value || '').replace(/\\D+/g, '').trim();
  if (!d) return '';
  if (d.length === 10) d = '57' + d;
  return d;
};

const recipientTo = normalizeWaTo(input.recipient_phone);
const clientName = text(payload.client_name);
const templateName = String(input.template_name || 'staff_finca_selected_v1').trim();
const templateLanguage = String(input.template_language || 'es_CO').trim();

const detail = [
  'Tel\\u00e9fono: ' + text(payload.wa_id),
  'Finca: ' + text(payload.selected_finca_name || payload.selected_finca_id),
  'Fechas: ' + text(payload.fechas),
  'Personas: ' + text(payload.personas),
  'Zona: ' + text(payload.zona),
  'Chatwoot: ' + text(payload.chatwoot_link),
].join(' | ');

// Body params seg\\u00fan template
const bodyParams = templateName === 'hitl_handoff_v1'
  ? [
      { type: 'text', text: clientName !== 'Sin dato' ? clientName : 'Cliente' },
      { type: 'text', text: text(payload.wa_id) },
      { type: 'text', text: text(payload.chatwoot_link) },
    ]
  : [
      { type: 'text', text: clientName !== 'Sin dato' ? clientName : 'Cliente' },
      { type: 'text', text: detail },
    ];

// Meta WhatsApp Cloud API directo (+57 WABA). Notif NO pasa por Chatwoot.
const PHONE_ID = '__WA_PHONE_ID__';
const TOKEN = '__WA_TOKEN__';

let responseStatus = null;
let responseBody = null;
let providerMessageId = null;
let errorMessage = null;

try {
  if (!recipientTo) throw new Error('selection_recipient_phone_missing');
  const res = await this.helpers.httpRequest({
    url: 'https://graph.facebook.com/v21.0/' + PHONE_ID + '/messages',
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: {
      messaging_product: 'whatsapp',
      to: recipientTo,
      type: 'template',
      template: {
        name: templateName,
        language: { code: templateLanguage },
        components: [{ type: 'body', parameters: bodyParams }],
      },
    },
    json: true,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
    timeout: 15000,
  });
  responseStatus = res.statusCode;
  responseBody = res.body;
  providerMessageId =
    (res.body && res.body.messages && res.body.messages[0] && res.body.messages[0].id) || null;
  if (responseStatus < 200 || responseStatus >= 300) {
    errorMessage =
      (res.body && res.body.error && res.body.error.message) ||
      JSON.stringify(res.body) ||
      'meta_template_send_failed';
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
    },
  },
];'''

# Inyectar credenciales (solo en el nodo desplegado, NO en el .py commiteado)
deployed_code = NEW_CODE.replace('__WA_PHONE_ID__', phone_id).replace('__WA_TOKEN__', token)

wf = json.loads(subprocess.run(['curl','-sk',f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{OS_WID}','-H',f'X-N8N-API-KEY: {JWT}'],capture_output=True,text=True).stdout)
found=False
for n in wf['nodes']:
    if n['name']=='Send WhatsApp selection template':
        n['parameters']['jsCode']=deployed_code
        found=True; break
if not found:
    print('!! node not found'); sys.exit(2)

ALLOWED={'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution','saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload={'name':wf['name'],'nodes':wf['nodes'],'connections':wf['connections'],'settings':{k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r=subprocess.run(['curl','-sk','-X','PUT',f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{OS_WID}','-H',f'X-N8N-API-KEY: {JWT}','-H','Content-Type: application/json','-d','@-'],input=json.dumps(payload),capture_output=True,text=True)
print('✓ Send WhatsApp selection template → Meta Graph API directo. active=', json.loads(r.stdout).get('active'))
