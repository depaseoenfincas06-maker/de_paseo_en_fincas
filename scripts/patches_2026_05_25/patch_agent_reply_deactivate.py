#!/usr/bin/env python3
"""
Detectar respuesta de asesor por Chatwoot → desactivar bot.

Cuando el asesor responde por Chatwoot UI:
- senderType='user' (Chatwoot agent)
- !privateMessage (no es nota interna)
- eventType='message_created'
- incoming=false

Normalize inbound payload hoy lo MARCA como ignored ('not_incoming_customer_message')
pero no desactiva el bot. Ahora agregamos: HTTP PATCH a Chatwoot custom_attributes
para poner ia_activa=false. El webhook back de Chatwoot dispara
`conversation_updated`, que el workflow procesa con `Upsert Chatwoot ia_activa sync`
y actualiza el DB.

Idempotente: si ia_activa ya está en false, el PATCH es no-op.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# Anchor: just before the chatwoot return (where ignoreReason is set + eligible=false for !incoming case)
# Find the area where ignoreReason is computed in chatwoot branch
ANCHOR = """} else if (!incoming) {
  ignoreReason = 'not_incoming_customer_message';
} else if (!content && !audioAttachment) {"""

NEW = """} else if (!incoming) {
  ignoreReason = 'not_incoming_customer_message';
  // === Bot deactivation on agent reply (May 25 2026) ===
  // Cuando un asesor responde por Chatwoot UI (senderType='user',
  // !privateMessage), desactivamos el bot poniendo ia_activa=false en
  // custom_attributes de Chatwoot. El webhook conversation_updated que
  // dispara Chatwoot se procesa luego por Upsert Chatwoot ia_activa sync
  // y actualiza conversations.agente_activo en DB.
  // Idempotente: si ya está false, el PATCH es no-op.
  if (!privateMessage && conversationId && senderType === 'user') {
    try {
      await this.helpers.httpRequest({
        url: 'https://chat.depaseoenfincas.raaamp.co/api/v1/accounts/2/conversations/' + String(conversationId) + '/custom_attributes',
        method: 'POST',
        headers: {
          'api_access_token': 'HHtQoPLW991XS8Rcu5thbZ5x',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ custom_attributes: { ia_activa: false } }),
        timeout: 5000,
        ignoreHttpStatusErrors: true,
      });
      console.error('[agent-reply-detected] ia_activa=false set on chatwoot_id=' + conversationId);
    } catch (e) {
      console.error('[agent-reply-detected] failed:', String(e).slice(0,200));
    }
  }
} else if (!content && !audioAttachment) {"""

found = False
for n in wf['nodes']:
    if n['name'] != 'Normalize inbound payload': continue
    code = n['parameters']['jsCode']
    if ANCHOR not in code:
        if 'Bot deactivation on agent reply' in code:
            print('!! already deployed'); sys.exit(0)
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(ANCHOR, NEW, 1)
    print('✓ Normalize inbound payload: agent-reply deactivation added')
    found = True
    break

if not found:
    print('!! node not found'); sys.exit(2)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
