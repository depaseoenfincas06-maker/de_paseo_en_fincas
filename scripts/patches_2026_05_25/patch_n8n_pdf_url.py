#!/usr/bin/env python3
"""
Cambiar el URL builder de createReservationDocumentItem en CodeJS1 para
que el documento de reserva apunte al endpoint .pdf en vez del .docx.

Cambio único:
  ANTES: pdfUrl = .../api/reservation-confirmation.docx?payload=...
  AHORA: pdfUrl = .../api/reservation-confirmation.pdf?payload=...

El payload base64 sigue idéntico — el endpoint .pdf en Vercel arma el docx
internamente, lo manda a Gotenberg, y devuelve el PDF binary. Si Gotenberg
falla, hace fallback a docx (no rompe la conversación; el cliente siempre
recibe un archivo).
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    OLD = "  var pdfUrl = publicBase.replace(/\\/$/, '') + '/api/reservation-confirmation.docx?payload=' + encoded;"
    NEW = "  var pdfUrl = publicBase.replace(/\\/$/, '') + '/api/reservation-confirmation.pdf?payload=' + encoded;"
    if OLD not in code:
        print('!! URL builder marker not found'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    print('✓ createReservationDocumentItem: URL ahora apunta a .pdf')
    break
else:
    print('!! Code in JavaScript1 node not found'); sys.exit(2)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload = {
    'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED},
}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL,
                     '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload), capture_output=True, text=True, check=True)
out = json.loads(r2.stdout)
print(f'PUT ok. active={out.get("active")}')
if not out.get('active'):
    subprocess.run(['curl','-sk','-X','POST', URL+'/activate', '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True)
