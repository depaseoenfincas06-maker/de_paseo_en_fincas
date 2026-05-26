#!/usr/bin/env python3
"""Fix global pairedItem: reemplazar .item.json con .first().json en TODOS
los nodos del workflow (no solo Code in JavaScript1). El bug puede dispararse
desde cualquier expresión que use $('Node').item.json (Code nodes, IF nodes,
Set nodes, Postgres query, LangChain agent systemMessage, etc.)
"""
import json, subprocess, sys, re

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

PATTERN = re.compile(r"(\$\('[^']+'\))\.item\.json")
REPLACEMENT = r"\1.first().json"

def swap_in_string(s):
    if not isinstance(s, str): return s, 0
    new_s, n = PATTERN.subn(REPLACEMENT, s)
    return new_s, n

total_replaced = 0
per_node = []

for n in wf['nodes']:
    p = n.get('parameters', {})
    node_count = 0

    # jsCode
    if 'jsCode' in p:
        new, c = swap_in_string(p['jsCode'])
        if c: p['jsCode'] = new; node_count += c
    # query (Postgres)
    if 'query' in p:
        new, c = swap_in_string(p['query'])
        if c: p['query'] = new; node_count += c
    # text (Set, IF)
    if 'text' in p:
        new, c = swap_in_string(p['text'])
        if c: p['text'] = new; node_count += c
    # jsonBody
    if 'jsonBody' in p:
        new, c = swap_in_string(p['jsonBody'])
        if c: p['jsonBody'] = new; node_count += c
    # url, body params
    if 'url' in p and isinstance(p['url'], str):
        new, c = swap_in_string(p['url'])
        if c: p['url'] = new; node_count += c

    # options.systemMessage (LangChain)
    if isinstance(p.get('options'), dict):
        for k in ['systemMessage']:
            if k in p['options']:
                new, c = swap_in_string(p['options'][k])
                if c: p['options'][k] = new; node_count += c

    # values/assignments arrays
    for key in ['values','assignments']:
        if isinstance(p.get(key), dict):
            arr = p[key].get('values') or p[key].get('assignments') or []
            for item in arr:
                if isinstance(item.get('value'), str):
                    new, c = swap_in_string(item['value'])
                    if c: item['value'] = new; node_count += c

    # conditions[].leftValue/rightValue
    if isinstance(p.get('conditions'), dict):
        for cond in p['conditions'].get('conditions', []):
            for k in ['leftValue','rightValue']:
                if isinstance(cond.get(k), str):
                    new, c = swap_in_string(cond[k])
                    if c: cond[k] = new; node_count += c

    # headerParameters[].value (HTTP nodes)
    if isinstance(p.get('headerParameters'), dict):
        for hp in p['headerParameters'].get('parameters', []):
            if isinstance(hp.get('value'), str):
                new, c = swap_in_string(hp['value'])
                if c: hp['value'] = new; node_count += c

    if node_count > 0:
        per_node.append((n['name'], node_count))
        total_replaced += node_count

print(f'Total .item.json → .first().json: {total_replaced}')
print(f'Nodes affected: {len(per_node)}')
for name, count in sorted(per_node, key=lambda x: -x[1])[:20]:
    print(f'  {count:3d}  {name}')

if total_replaced == 0:
    print('No changes'); sys.exit(0)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'\nPUT ok. active={json.loads(r2.stdout).get("active")}')
