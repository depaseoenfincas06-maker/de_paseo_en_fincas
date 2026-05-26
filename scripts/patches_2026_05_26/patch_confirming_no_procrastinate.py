#!/usr/bin/env python3
"""Refuerzo en confirming_reservation_agent: cuando emite CHANGE_FINCA,
NO debe procrastinar con "dame un momento y te las comparto" porque el
sistema dispara automáticamente el offering loop que envía los cards.

El respuesta del confirming debe ser CORTA y NO prometer mostrar cards
(el offering del próximo loop sí lo hace).
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# Find the existing CHANGE_FINCA rule in confirming and reinforce
ANCHOR = "- Si el cliente quiere CAMBIAR DE FINCA o pide ver OTRAS OPCIONES, devuelve intent=\"CHANGE_FINCA\"."

INSERT_AFTER = "- Si el cliente quiere CAMBIAR DE FINCA o pide ver OTRAS OPCIONES, devuelve intent=\"CHANGE_FINCA\".\n  ⚠️ REGLA RESPUESTA (May 26 2026): cuando emites CHANGE_FINCA, tu `respuesta` debe ser CORTA y SIN promesas de mostrar cards.\n  • PROHIBIDO: \"dame un momento y te las comparto\" / \"te paso unas opciones\" / \"un segundito y te muestro\". El sistema automáticamente dispara al offering_agent en el mismo turno que va a enviar los cards.\n  • CORRECTO: una sola frase de acknowledgment + lo que sigue. Ejemplos:\n      - \"Listo jd, busquemos en Melgar para tus fechas.\"\n      - \"Dale, vamos a ver opciones más económicas.\"\n      - \"Perfecto, miremos otras alternativas.\"\n  • Si vos prometés mostrar las cards, el cliente piensa que el bot dejó de funcionar (porque los cards vienen del offering del loop, NO de tu respuesta). Que tu mensaje sea autocontenido como acknowledgment."

for n in wf['nodes']:
    if n['name'] != 'Run confirming_reservation pass': continue
    sm = n['parameters']['options']['systemMessage']
    if 'REGLA RESPUESTA (May 26 2026)' in sm:
        print('!! already deployed'); sys.exit(0)
    if ANCHOR not in sm:
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(ANCHOR, INSERT_AFTER, 1)
    print('✓ confirming: respuesta corta en CHANGE_FINCA (sin procrastinar)')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
