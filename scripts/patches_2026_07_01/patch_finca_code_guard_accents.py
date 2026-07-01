#!/usr/bin/env python3
"""Fix accento en el guardrail finca-por-código (Jul 1 2026).

Bug del deploy anterior: el regex `\\b([A-ZÑ_]{3,})[\\s_#-]{0,3}(\\d{1,3})\\b`
NO matchea "Sopetrán 20" porque el 'á' no está en `[A-ZÑ_]`. La regex se
frena en "Sopetr" y como el próximo char 'á' no es `[\\s_#-]`, no matchea.

Fix: normalizar el mensaje del cliente ANTES de matchear (strip accents),
así "Sopetrán 20" → "Sopetran 20" → regex matchea zone=SOPETRAN, num=20.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
BASE = 'https://n8n.depaseoenfincas.raaamp.co'
WID = '2NV08zRFKENUsQVC'
URL = f'{BASE}/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """let clientLastMsg = '';
try {
  clientLastMsg = String($('Merge Sets1').first().json['last-message'] || '');
} catch (e) { clientLastMsg = ''; }
const FINCA_CODE_RE = /\\b([A-ZÑ_]{3,})[\\s_#-]{0,3}(\\d{1,3})\\b/i;
const codeMatch = clientLastMsg.match(FINCA_CODE_RE);"""

NEW = """let clientLastMsg = '';
try {
  clientLastMsg = String($('Merge Sets1').first().json['last-message'] || '');
} catch (e) { clientLastMsg = ''; }
// Normalizar acentos ANTES de matchear — la regex [A-ZÑ_] no captura vocales
// tildadas (á/é/í/ó/ú), así que "Sopetrán 20" fallaba silenciosamente.
const _clientLastMsgNormalized = _stripAccents(clientLastMsg);
const FINCA_CODE_RE = /\\b([A-ZÑ_]{3,})[\\s_#-]{0,3}(\\d{1,3})\\b/i;
const codeMatch = _clientLastMsgNormalized.match(FINCA_CODE_RE);"""

applied = False
for n in wf['nodes']:
    if n['name'] != 'Finalize offering outbound': continue
    code = n['parameters']['jsCode']
    if '_clientLastMsgNormalized' in code:
        print('already deployed'); sys.exit(0)
    if OLD not in code:
        print('!! anchor missing'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    applied = True
    print('✓ Finalize offering outbound: strip accents antes de matchear código')
    break
if not applied: sys.exit(3)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {
    'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED},
}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
