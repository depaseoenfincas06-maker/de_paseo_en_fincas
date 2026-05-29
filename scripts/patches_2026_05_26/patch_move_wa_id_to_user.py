#!/usr/bin/env python3
"""El LLM emitió wa_id literal "{{ $('Merge Sets1')... }}" porque el systemMessage
del LangChain agent NO interpola templates (solo el user `text` lo hace).

Fix: mover el bloque CONTEXTO RUNTIME del systemMessage al user prompt (text),
que sí evalúa expressions n8n. Dejar la REGLA TOOL-CALL en systemMessage como
texto plano que referencia el campo wa_id_runtime del user prompt.

Aplica a los 5 agentes patcheados anteriormente: offering, qa, verifying,
confirming, qualifying.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD_SM_HEADER = """[CONTEXTO RUNTIME — NO MODIFICAR]
wa_id_runtime: {{ $('Merge Sets1').first().json.conversation_key }}
[/CONTEXTO RUNTIME]

⚠️ REGLA TOOL-CALL OBLIGATORIA: cuando llames al inventory_reader_tool, SIEMPRE incluye el campo `wa_id` con el valor exacto de wa_id_runtime de arriba. NO es opcional. Sin esto el sistema no puede persistir el inventario en cache y los siguientes turnos pierden datos.

"""

NEW_SM_HEADER = """⚠️ REGLA TOOL-CALL OBLIGATORIA: cuando llames al inventory_reader_tool, SIEMPRE incluye el campo `wa_id` con el valor exacto de wa_id_runtime que viene en el bloque CONTEXTO RUNTIME del user prompt. NO es opcional. Sin esto el sistema no puede persistir el inventario en cache. NUNCA copies la expresión literal `{{ ... }}` — usa el valor numérico ya interpolado.

"""

TARGET_AGENTS = ['Run offering pass', 'Run qa pass', 'Run verifying_availability pass', 'Run confirming_reservation pass', 'Run qualifying pass']

# user text injection: insert at top of user prompt template
USER_INJECT_AFTER = """=Hoy es {{ new Date().toLocaleString("sv-SE", { timeZone: "America/Bogota" }).slice(0, 10) }}."""

USER_INJECT_BLOCK = """=Hoy es {{ new Date().toLocaleString("sv-SE", { timeZone: "America/Bogota" }).slice(0, 10) }}.

CONTEXTO RUNTIME:
wa_id_runtime: {{ $('Merge Sets1').first().json.conversation_key }}"""

patched = []
for n in wf['nodes']:
    if n.get('name') not in TARGET_AGENTS: continue
    # 1. Patch systemMessage
    sm = n['parameters']['options']['systemMessage']
    if OLD_SM_HEADER in sm:
        n['parameters']['options']['systemMessage'] = sm.replace(OLD_SM_HEADER, NEW_SM_HEADER, 1)
        patched.append(f'{n["name"]}: SM header replaced')
    elif 'que viene en el bloque CONTEXTO RUNTIME del user prompt' in sm:
        patched.append(f'{n["name"]}: SM already updated')
    else:
        patched.append(f'{n["name"]}: SM anchor NOT found (skipping SM)')

    # 2. Patch user text (text param)
    text = n['parameters'].get('text','')
    if 'wa_id_runtime:' in text:
        patched.append(f'{n["name"]}: user text already has wa_id_runtime')
        continue
    if USER_INJECT_AFTER not in text:
        # offering/qa have a slightly different starting line — try to find generic "=Hoy es"
        import re
        # Replace just the "=Hoy es" line + the next blank line
        m = re.match(r"(=Hoy es [^\n]+\.)", text)
        if not m:
            patched.append(f'{n["name"]}: user text date anchor NOT found (skipping text)')
            continue
        old_first = m.group(1)
        new_first = old_first + '\n\nCONTEXTO RUNTIME:\nwa_id_runtime: {{ $(\'Merge Sets1\').first().json.conversation_key }}'
        n['parameters']['text'] = text.replace(old_first, new_first, 1)
        patched.append(f'{n["name"]}: user text injected via regex')
    else:
        n['parameters']['text'] = text.replace(USER_INJECT_AFTER, USER_INJECT_BLOCK, 1)
        patched.append(f'{n["name"]}: user text injected')

for p in patched: print('  -', p)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
