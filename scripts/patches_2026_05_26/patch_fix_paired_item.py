#!/usr/bin/env python3
"""Fix definitivo del pairedItem bug en n8n: reemplazar `$('Node').item.json`
con `$('Node').first().json` en Code in JavaScript1.

Causa raíz: en loops (offering re-call después de CHANGE_FINCA), n8n trata
de hacer trace de pairedItem desde el current Code execution hacia los nodos
upstream. Si la cadena de pairedItem está rota en cualquier punto del
camino, falla con "Cannot read properties of undefined (reading 'pairedItem')".

`.first()` accede al primer item del último run del nodo SIN trazar
pairedItem — bypasses la lógica que falla.

Todos los nodos que CodeJS1 accede vía $() son single-item (Postgres SELECTs,
Set nodes, etc.) → semánticamente idéntico, sin riesgo.

Nodos afectados (33 accesos totales):
- Get Context-conversations1: 16
- config: 10
- Merge Sets1: 4
- Get agent settings: 1
- Fetch messages1: 1
- Compute deterministic prechecks: 1
- Refetch last_inventory_items: 1
"""
import json, subprocess, sys, re

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# Pattern: $('NodeName').item.json → $('NodeName').first().json
# Pattern: $('NodeName').item) → $('NodeName').first()) — careful for try blocks
# Strategy: regex replace exact .item.json → .first().json

PATTERN = re.compile(r"(\$\('[^']+'\))\.item\.json")
REPLACEMENT = r"\1.first().json"

# Also handle the standalone .item (not followed by .json) — e.g. .item && .item.json
PATTERN_ITEM_BOOL = re.compile(r"(\$\('[^']+'\))\.item([^.])")
# This needs to map .item to ?.first() — but the ?.first() is different from .item bool check.
# Skip this for now — let's focus on .item.json which is the most common.

found = False
for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    before = code.count('.item.json')
    new_code = PATTERN.sub(REPLACEMENT, code)
    after_first = new_code.count('.first().json')
    after_item = new_code.count('.item.json')
    if before == 0:
        print('!! no .item.json patterns'); sys.exit(0)
    if False:
        # Already migrated
        if after_first > 30:
            print('!! already migrated'); sys.exit(0)
    n['parameters']['jsCode'] = new_code
    print(f'✓ replaced {before - after_item} occurrences of .item.json with .first().json')
    print(f'  remaining .item.json: {after_item} (should be 0)')
    print(f'  new .first().json: {after_first}')
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
