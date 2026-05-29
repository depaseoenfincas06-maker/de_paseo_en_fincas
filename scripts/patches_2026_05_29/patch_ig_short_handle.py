#!/usr/bin/env python3
"""Fix IG link (May 29 2026): el bot a veces escribe el handle CORTO
'@depaseoenfincas' (sin 'col') y sin link — confirmado en conv 573112407139.
El normalizador _ensureInstagramLink solo matcheaba '@depaseoenfincascol',
así que el handle corto se escapaba sin link.

Fix: el regex ahora matchea '@depaseoenfincas' con 'col' OPCIONAL y normaliza
SIEMPRE al handle canónico + link. Si el link completo ya está presente, no
toca nada (early return).
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """function _ensureInstagramLink(s) {
  if (s == null) return s;
  var str = String(s);
  if (/@depaseoenfincascol/i.test(str) && !/instagram\\.com\\/depaseoenfincascol/i.test(str)) {
    str = str.replace(/@depaseoenfincascol/i, '@depaseoenfincascol (https://www.instagram.com/depaseoenfincascol)');
  }
  return str;
}"""

NEW = """function _ensureInstagramLink(s) {
  if (s == null) return s;
  var str = String(s);
  // Si ya viene el link completo, no tocar.
  if (/instagram\\.com\\/depaseoenfincascol/i.test(str)) return str;
  // Normaliza CUALQUIER mención del handle (@depaseoenfincas o @depaseoenfincascol)
  // al handle canónico + link. Cubre la alucinación del handle corto sin 'col'.
  if (/@depaseoenfincas(?:col)?\\b/i.test(str)) {
    str = str.replace(/@depaseoenfincas(?:col)?\\b/i, '@depaseoenfincascol (https://www.instagram.com/depaseoenfincascol)');
  }
  return str;
}"""

found = False
for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    if '@depaseoenfincas(?:col)?' in code:
        print('!! already deployed'); sys.exit(0)
    if OLD not in code:
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    print('✓ CodeJS1: _ensureInstagramLink ahora cubre handle corto @depaseoenfincas')
    found = True
    break
if not found: sys.exit(4)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
