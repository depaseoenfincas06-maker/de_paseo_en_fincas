#!/usr/bin/env python3
"""
Track C.1 — Fix colateral encontrado en E2E test T-C.1.1.

Bug: cuando confirming_reservation_agent emite REQUEST_CONFIRMATION_DATA
con search_criteria_update (caso típico: cliente cambió #personas mid-
CONFIRMING), el LLM hace su parte correcta — pero el branch de
'confirming_reservation_agent' en CodeJS1 NO aplica search_criteria_update
a `raw.search_criteria`. Consecuencia: el next turn entra con criteria.
personas stale, drift detector dispara otra vez → loop infinito entre
LLM y safety net.

Otras ramas (offering, verifying, qualifying) sí aplican search_criteria_
update, pero usan `!raw.search_criteria` como guard, lo que OVERWRITE en
vez de MERGE. Para confirming (que solo emite partial como
{personas: 19}), necesitamos MERGE con el current persisted para no
perder zona/fechas.

Fix: agregar después del `selected_finca` handling un merge explícito de
search_criteria_update con el current persisted.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = (
"  if (tool === 'confirming_reservation_agent') {\n"
"    if (toolOutput?.selected_finca && !raw.selected_finca) raw.selected_finca = toolOutput.selected_finca;\n"
"    if ((toolOutput?.finca_elegida_id || toolOutput?.selected_finca?.finca_id) && !raw.selected_finca_id) {\n"
"      raw.selected_finca_id = toolOutput.finca_elegida_id || toolOutput.selected_finca?.finca_id;\n"
"    }"
)

NEW = (
"  if (tool === 'confirming_reservation_agent') {\n"
"    if (toolOutput?.selected_finca && !raw.selected_finca) raw.selected_finca = toolOutput.selected_finca;\n"
"    if ((toolOutput?.finca_elegida_id || toolOutput?.selected_finca?.finca_id) && !raw.selected_finca_id) {\n"
"      raw.selected_finca_id = toolOutput.finca_elegida_id || toolOutput.selected_finca?.finca_id;\n"
"    }\n"
"\n"
"    // === Persist search_criteria_update from confirming (T-C.1 — May 25 2026) ===\n"
"    // Cuando el cliente cambia #personas / fechas mid-CONFIRMING y el\n"
"    // LLM emite search_criteria_update, hay que persistirlo o el drift\n"
"    // detector queda en loop con el LLM. Usar MERGE (no overwrite)\n"
"    // porque el confirming emite solo el delta — preservar zona/fechas.\n"
"    if (toolOutput?.search_criteria_update && typeof toolOutput.search_criteria_update === 'object') {\n"
"      var _currentSC = ($('Get Context-conversations1').item.json.search_criteria) ||\n"
"                       ($('Get Context-conversations1').item.json.context && $('Get Context-conversations1').item.json.context.search_criteria) ||\n"
"                       {};\n"
"      raw.search_criteria = compactCriteria(Object.assign({}, _currentSC, toolOutput.search_criteria_update));\n"
"    }"
)

found = False
for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    if OLD not in code:
        print('!! anchor not found verbatim'); sys.exit(2)
    if 'Persist search_criteria_update from confirming' in code:
        print('!! already patched, skipping')
    else:
        n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
        print('✓ Code in JavaScript1: confirming branch now persists search_criteria_update (merge)')
    found = True
    break

if not found:
    print('!! Code in JavaScript1 not found'); sys.exit(2)

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
if not out.get('active'):
    subprocess.run(['curl','-sk','-X','POST', URL+'/activate', '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True)
