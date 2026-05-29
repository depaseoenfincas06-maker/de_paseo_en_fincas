#!/usr/bin/env python3
"""Mover INTRO_TEMPLATE, DOC_READY_TEMPLATE y APPROVED_TEMPLATE del systemMessage
del confirming_reservation_agent al user text — el systemMessage de LangChain NO
interpola templates {{ }}, por eso el LLM copia literal el placeholder y el cliente
recibe basura técnica como '{{ $('config').first().json.confirming_intro_message_template }}'.

Fix:
1. En systemMessage, reemplazar el bloque que tiene los templates inline por
   referencias a "ver INTRO_TEMPLATE en user prompt".
2. Agregar al user text los 3 bloques con sus {{ }} que sí se interpolan.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD_SM_INTRO = """INTRO_TEMPLATE:
{{ $('config').first().json.confirming_intro_message_template }}

  Después del template,"""

NEW_SM_INTRO = """USA el campo INTRO_TEMPLATE_RESOLVED que viene en el user prompt como tu `respuesta` (copiado al pie de la letra, sustituyendo (NOMBRE) por el nombre o quitándolo). NO inventes texto, NO traduzcas, NO uses el placeholder literal `{{ ... }}` — usa SIEMPRE el valor interpolado que aparece en INTRO_TEMPLATE_RESOLVED del user prompt.

  Después del template,"""

OLD_SM_DOC = """DOC_READY_TEMPLATE:
{{ $('config').first().json.confirming_document_ready_message_template }}

  El PDF lo adjunta"""

NEW_SM_DOC = """USA el campo DOC_READY_TEMPLATE_RESOLVED del user prompt como tu `respuesta`. NUNCA copies el placeholder `{{ ... }}` literal — usa SIEMPRE el valor del user prompt.

  El PDF lo adjunta"""

OLD_SM_APP = """APPROVED_TEMPLATE:
{{ $('config').first().json.reservation_approved_message_template }}

  Si el cliente NO aprueba"""

NEW_SM_APP = """USA el campo APPROVED_TEMPLATE_RESOLVED del user prompt como tu `respuesta`. NUNCA copies el placeholder `{{ ... }}` literal.

  Si el cliente NO aprueba"""

# User text injection: add 3 RESOLVED templates after CONTEXT block
USER_OLD_ANCHOR = "PAYMENT_METHODS_TEXT:\n{{ $('config').first().json.payment_methods_text || 'No hay medios de pago configurados.' }}"

USER_NEW_BLOCK = """PAYMENT_METHODS_TEXT:
{{ $('config').first().json.payment_methods_text || 'No hay medios de pago configurados.' }}

INTRO_TEMPLATE_RESOLVED:
{{ $('config').first().json.confirming_intro_message_template || '' }}

DOC_READY_TEMPLATE_RESOLVED:
{{ $('config').first().json.confirming_document_ready_message_template || '' }}

APPROVED_TEMPLATE_RESOLVED:
{{ $('config').first().json.reservation_approved_message_template || '' }}"""

patched = []
for n in wf['nodes']:
    if n.get('name') != 'Run confirming_reservation pass': continue
    sm = n['parameters']['options']['systemMessage']
    if 'INTRO_TEMPLATE_RESOLVED' in sm:
        print('!! already deployed'); sys.exit(0)
    if OLD_SM_INTRO not in sm:
        print('!! INTRO anchor not found'); sys.exit(2)
    sm = sm.replace(OLD_SM_INTRO, NEW_SM_INTRO, 1)
    patched.append('SM: INTRO replaced')
    if OLD_SM_DOC in sm:
        sm = sm.replace(OLD_SM_DOC, NEW_SM_DOC, 1)
        patched.append('SM: DOC_READY replaced')
    if OLD_SM_APP in sm:
        sm = sm.replace(OLD_SM_APP, NEW_SM_APP, 1)
        patched.append('SM: APPROVED replaced')
    n['parameters']['options']['systemMessage'] = sm

    text = n['parameters'].get('text','')
    if 'INTRO_TEMPLATE_RESOLVED' in text:
        patched.append('user text: already')
    elif USER_OLD_ANCHOR not in text:
        print('!! user text anchor not found'); sys.exit(3)
    else:
        n['parameters']['text'] = text.replace(USER_OLD_ANCHOR, USER_NEW_BLOCK, 1)
        patched.append('user text: 3 RESOLVED templates added')
    break

print('\n'.join(patched))

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
