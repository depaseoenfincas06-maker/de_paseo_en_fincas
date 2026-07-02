#!/usr/bin/env python3
"""g100-flow-11 fix (Jul 1 2026): '¿dónde quedan sus oficinas? quiero ir en
persona' como PRIMER mensaje disparó HITL directo (el validator leyó 'en
persona' como pedido de humano). El bot mandó el handoff sin responder las
direcciones — pregunta que el QA agent responde perfectamente (tiene las 2
oficinas en company_knowledge).

Fix: regla explícita en el QA validator: preguntas por oficinas/dirección de
la empresa → QA, NUNCA HITL, incluso si mencionan 'ir en persona' (ir a la
OFICINA no es pedir un humano por chat).
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
BASE = 'https://n8n.depaseoenfincas.raaamp.co'
WID = '2NV08zRFKENUsQVC'
URL = f'{BASE}/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

ANCHOR = "- Devuelve QA si el mensaje es una pregunta puntual o aclaración que no debería cambiar el estado de negocio."
NEW = """- PREGUNTAS POR OFICINAS / DIRECCIÓN DE LA EMPRESA → SIEMPRE QA, NUNCA HITL:
  "dónde quedan sus oficinas?" / "tienen oficina física?" / "puedo ir a su oficina?" / "quiero ir en persona (a la oficina)" / "dónde los encuentro?".
  Que el cliente quiera IR a la oficina NO es pedir un asesor humano por chat — el QA agent responde con las direcciones. Solo HITL si además pide explícitamente que un humano lo atienda por este chat.
- Devuelve QA si el mensaje es una pregunta puntual o aclaración que no debería cambiar el estado de negocio."""

applied = False
for n in wf['nodes']:
    if n['name'] != 'QA validator': continue
    sm = n['parameters'].get('options', {}).get('systemMessage', '')
    if 'PREGUNTAS POR OFICINAS' in sm:
        print('already deployed'); sys.exit(0)
    if ANCHOR not in sm:
        print('!! anchor missing'); sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(ANCHOR, NEW, 1)
    applied = True
    print('✓ QA validator: oficinas → QA, nunca HITL')
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
