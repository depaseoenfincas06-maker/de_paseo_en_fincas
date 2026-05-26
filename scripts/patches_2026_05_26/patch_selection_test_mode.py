#!/usr/bin/env python3
"""TEST MODE — override selection_notification_recipients to use engine.wa_id
(el número del cliente) cuando owner_test_mode_enabled=true.

Esto permite a Juan probar como cliente y RECIBIR la notif del asesor en
el MISMO número desde el que está conversando. Para producción: poner
owner_test_mode_enabled=false en agent_settings.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """const recipients = String(settings.selection_notification_recipients || '')
  .split(',')
  .map((value) => normalizePhone(value))
  .filter(Boolean)
  .filter((value, index, array) => array.indexOf(value) === index);"""

NEW = """// TEST MODE — cuando owner_test_mode_enabled=true, la notif al asesor se
// envía al MISMO número del cliente (engine.wa_id) para facilitar testing
// de Juan como cliente. Para revertir: agent_settings.owner_test_mode_enabled=false.
const recipients = settings.owner_test_mode_enabled === true
  ? (engine.wa_id ? [normalizePhone(engine.wa_id)] : []).filter(Boolean)
  : String(settings.selection_notification_recipients || '')
      .split(',')
      .map((value) => normalizePhone(value))
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);"""

for n in wf['nodes']:
    if n['name'] != 'Prepare selection notifications': continue
    code = n['parameters']['jsCode']
    if OLD not in code:
        if 'TEST MODE — cuando owner_test_mode_enabled' in code:
            print('!! already deployed'); sys.exit(0)
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    print('✓ Prepare selection notifications: TEST MODE override added')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
