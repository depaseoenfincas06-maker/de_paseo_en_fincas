#!/usr/bin/env python3
"""La notif al asesor debe disparar SOLO en RESERVATION_APPROVED (cliente aprueba PDF),
NO en CLIENT_CHOSE (cliente eligió finca). Hoy dispara en ambos casos."""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """    shouldNotify:
      (toolChosen === 'offering_agent' &&
        intent === 'CLIENT_CHOSE' &&
        (currentStateAfter === 'CONFIRMING_RESERVATION' || currentStateAfter === 'VERIFYING_AVAILABILITY') &&
        Boolean(selectedFincaId)) ||
      (toolChosen === 'confirming_reservation_agent' &&
        intent === 'RESERVATION_APPROVED' &&
        Boolean(selectedFincaId)),"""

NEW = """    shouldNotify:
      // SOLO RESERVATION_APPROVED dispara la notif al asesor (May 26 2026).
      // Antes también disparaba en CLIENT_CHOSE pero se removió porque el
      // asesor solo necesita enterarse cuando el cliente aprueba el PDF
      // (no cuando selecciona finca — todavía puede cambiar de opinión).
      (toolChosen === 'confirming_reservation_agent' &&
        intent === 'RESERVATION_APPROVED' &&
        Boolean(selectedFincaId)),"""

for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    if OLD not in code:
        if 'SOLO RESERVATION_APPROVED dispara' in code:
            print('!! already deployed'); sys.exit(0)
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    print('✓ shouldNotify: solo RESERVATION_APPROVED')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
