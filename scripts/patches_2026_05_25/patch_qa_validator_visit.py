#!/usr/bin/env python3
"""
Fix: QA validator routea TODO request de visita a HITL, cortocircuitando
los agentes que tienen la lógica nueva de VISIT_REQUEST + template.

Antes:
  - Devuelve HITL si el cliente pide humano, asesor, visita, llamada,
    tiene frustración crítica, insultos fuertes, amenaza o disputa de pagos.

Después:
  - HITL solo si: (a) pide humano/asesor explícito, (b) propone fecha/hora
    específica para visita/videollamada, (c) frustración crítica.
  - STATE si pide visita/videollamada SIN dar fecha. Los agentes downstream
    emiten intent=VISIT_REQUEST con el template de oferta.

Esto resuelve los tests T01–T05, T08–T10 que actualmente caen en HITL
inmediato cuando el cliente solo expresa interés en visitar.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = "- Devuelve HITL si el cliente pide humano, asesor, visita, llamada, tiene frustración crítica, insultos fuertes, amenaza o disputa de pagos."
NEW = (
    "- Devuelve HITL solo si el cliente:\n"
    "    (a) pide explícitamente humano o asesor (\"dame un asesor\", \"necesito hablar con alguien\", \"me pasas con una persona\"),\n"
    "    (b) propone una fecha u hora específica para una visita o videollamada (\"el sábado a las 3pm\", \"mañana en la tarde\", \"el 20 a las 10am\"),\n"
    "    (c) tiene frustración crítica, insultos fuertes, amenaza o disputa de pagos.\n"
    "- Devuelve STATE si el cliente expresa interés en visitar / conocer / ver la propiedad (presencial o por videollamada) SIN proponer fecha u hora específica (\"puedo conocerla?\", \"se puede visitar?\", \"voy a viajar para verla\", \"este finde?\", \"puedo verla antes de pagar?\"). Los agentes downstream lo manejarán emitiendo intent=VISIT_REQUEST con el template de oferta de visita/videollamada."
)

for n in wf['nodes']:
    if n['name'] != 'QA validator': continue
    sm = n['parameters']['options']['systemMessage']
    if OLD not in sm:
        print('!! marker not found in QA validator system message'); sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(OLD, NEW, 1)
    print('✓ QA validator: regla de HITL/visita reescrita')
    break
else:
    print('!! QA validator node not found'); sys.exit(2)

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
