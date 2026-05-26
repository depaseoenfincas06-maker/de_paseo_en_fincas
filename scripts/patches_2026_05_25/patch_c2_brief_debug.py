#!/usr/bin/env python3
"""Modify brief sender to console.error the brief content when chatwoot_id is null,
so we can validate brief construction via exec logs in simulator tests."""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """    if (!chatwootId) return; // simulator runs no tienen chatwoot_id"""

NEW = """    if (!chatwootId) {
      // Simulator path: log the brief so we can validate construction via exec logs.
      // Build the brief anyway (so the construction code runs) then exit without POST.
    }"""

OLD2 = """    });
    console.error('[brief-sender] private_note posted to chatwoot_id=' + chatwootId + ' (' + changeBullets.length + ' change-notes)');"""

NEW2 = """    });
    console.error('[brief-sender] private_note posted to chatwoot_id=' + chatwootId + ' (' + changeBullets.length + ' change-notes)');
    return;
"""

# Easier: just add a separate debug branch before the POST
INSERT_AFTER = """      '\\n_PDF de confirmación enviado al cliente. Cliente esperando instrucciones de pago._';"""

DEBUG_INSERT = """      '\\n_PDF de confirmación enviado al cliente. Cliente esperando instrucciones de pago._';
    if (!chatwootId) {
      console.error('[brief-sender DEBUG] simulator (no chatwoot_id) — brief content follows:\\n' + brief);
      return;
    }"""

found = False
for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    # Apply the INSERT_AFTER edit
    if INSERT_AFTER not in code:
        print('!! anchor not found'); sys.exit(2)
    if 'simulator (no chatwoot_id)' in code:
        print('!! debug already present, skipping')
    else:
        code = code.replace(INSERT_AFTER, DEBUG_INSERT, 1)
        # Also remove the early-return on null chatwoot_id since brief now built unconditionally
        if 'if (!chatwootId) return; // simulator' in code:
            code = code.replace('if (!chatwootId) return; // simulator runs no tienen chatwoot_id\n    ', '    ', 1)
        n['parameters']['jsCode'] = code
        print('✓ brief sender: debug log added for simulator path')
    found = True
    break

if not found:
    print('!! node not found'); sys.exit(2)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {
    'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED},
}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL,
                     '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
out = json.loads(r2.stdout)
print(f'PUT ok. active={out.get("active")}')
