#!/usr/bin/env python3
"""
Fix: WhatsApp Selection Notification Sender usa `await fetch(...)` que falla
porque n8n Code node no tiene `fetch` global. Resultado: error "fetch is not
defined" → la notificación al asesor (573014013366) nunca llega.

Cambio: usar `this.helpers.httpRequest(...)` que es el patrón estándar de n8n
(mismo que usa el nodo `Typing ON` del customer agent).
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = 'tNvfWKi1TA7O6maf'  # WhatsApp Selection Notification Sender
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """try {
  const response = await fetch('https://api.kapso.ai/meta/whatsapp/v24.0/1170778729444650/messages', {
    method: 'POST',
    headers: {
      'X-API-Key': '667a2e651151354252ac88e88e9036476542f2265e280769873caeed14c88c37',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: String(input.recipient_phone || '').trim(),
      type: 'template',
      template: {
        name: String(input.template_name || 'staff_finca_selected_v1').trim(),
        language: {
          code: String(input.template_language || 'es_CO').trim(),
        },
        components: [
          {
            type: 'body',
            parameters: bodyParameters,
          },
        ],
      },
    }),
  });

  responseStatus = response.status;
  const raw = await response.text();
  try {
    responseBody = raw ? JSON.parse(raw) : null;
  } catch {
    responseBody = { raw };
  }

  providerMessageId =
    responseBody?.messages?.[0]?.id ||
    responseBody?.message_id ||
    responseBody?.messages?.[0]?.message_id ||
    null;

  if (!response.ok) {
    errorMessage =
      responseBody?.error?.message ||
      responseBody?.message ||
      raw ||
      'Kapso template send failed';
  }
} catch (error) {
  errorMessage = error.message;
  responseBody = { error: error.message };
}"""

NEW = """try {
  const response = await this.helpers.httpRequest({
    url: 'https://api.kapso.ai/meta/whatsapp/v24.0/1170778729444650/messages',
    method: 'POST',
    headers: {
      'X-API-Key': '667a2e651151354252ac88e88e9036476542f2265e280769873caeed14c88c37',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: {
      messaging_product: 'whatsapp',
      to: String(input.recipient_phone || '').trim(),
      type: 'template',
      template: {
        name: String(input.template_name || 'staff_finca_selected_v1').trim(),
        language: {
          code: String(input.template_language || 'es_CO').trim(),
        },
        components: [
          {
            type: 'body',
            parameters: bodyParameters,
          },
        ],
      },
    },
    json: true,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
    timeout: 10000,
  });

  responseStatus = response.statusCode;
  responseBody = response.body || null;

  providerMessageId =
    responseBody?.messages?.[0]?.id ||
    responseBody?.message_id ||
    responseBody?.messages?.[0]?.message_id ||
    null;

  if (responseStatus < 200 || responseStatus >= 300) {
    errorMessage =
      responseBody?.error?.message ||
      responseBody?.message ||
      JSON.stringify(responseBody) ||
      'Kapso template send failed';
  }
} catch (error) {
  errorMessage = error.message;
  responseBody = { error: error.message };
}"""

for n in wf['nodes']:
    if n['name'] != 'Send WhatsApp selection template': continue
    code = n['parameters']['jsCode']
    if 'this.helpers.httpRequest' in code:
        print('!! already migrated'); sys.exit(0)
    if OLD not in code:
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    print('✓ Send WhatsApp selection template: migrated fetch → this.helpers.httpRequest')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
