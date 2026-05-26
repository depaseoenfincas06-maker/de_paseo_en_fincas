#!/usr/bin/env python3
"""Agregar URLs corporativas de depaseoenfincas a la whitelist:
- https://www.instagram.com/depaseoenfincascol (perfil + reels + posts)
- https://depaseoenfincas.com y https://www.depaseoenfincas.com (web principal + subpaths)

Estos están en initial_message_template, company_knowledge, y otros lugares
del prompt. Sin whitelist, el sanitizer los reemplazaba por [link removido].
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """  // confirming_video_url en config
  try {
    var v = String($('config').item.json.confirming_video_url || '').trim();
    if (v) allowedExact.add(v);
  } catch (e) {}"""

NEW = """  // confirming_video_url en config
  try {
    var v = String($('config').item.json.confirming_video_url || '').trim();
    if (v) allowedExact.add(v);
  } catch (e) {}
  // URLs corporativas siempre permitidas (depaseoenfincas web + IG oficial).
  // Cualquier URL que empiece con estos prefijos pasa, sin importar deep path.
  allowedPrefixes.push('https://www.instagram.com/depaseoenfincascol');
  allowedPrefixes.push('https://instagram.com/depaseoenfincascol');
  allowedPrefixes.push('https://www.depaseoenfincas.com');
  allowedPrefixes.push('https://depaseoenfincas.com');
  allowedPrefixes.push('http://www.depaseoenfincas.com');
  allowedPrefixes.push('http://depaseoenfincas.com');"""

for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    if OLD not in code:
        if 'URLs corporativas siempre permitidas' in code:
            print('!! already deployed'); sys.exit(0)
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    print('✓ Whitelist sanitizer: IG + depaseoenfincas.com prefixes agregados')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
