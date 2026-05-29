#!/usr/bin/env python3
"""Punto 9: bot dispara VISIT_REQUEST (template visita finca) cuando cliente
pregunta por la oficina con frases como 'donde queda', 'como llego', 'donde
puedo encontrarlos'. Solo acierta cuando dice 'sede' o 'oficina física'.

Fix: expandir triggers de OFFICE_QUERY + desambiguación clara:
- Si mencionan 'oficina', 'sede', 'ustedes/empresa' → OFFICE rule (citar 2 oficinas)
- Si mencionan 'la finca', 'la propiedad' → VISIT_REQUEST
- 'Como llego', 'donde puedo encontrarlos' SIN palabra oficina/finca → asumir oficina si está en QUALIFYING (greeting), VISIT si ya hay finca seleccionada
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """- 🏢 REGLA — PREGUNTAS SOBRE OFICINAS / SEDE / DÓNDE QUEDAN (May 26 2026):
  Triggers (cliente): "tienen oficinas?" / "dónde queda la sede?" / "dónde están ubicados?" / "dónde tienen oficinas?" / "puedo ir a su oficina?".
  Comportamiento OBLIGATORIO:"""

NEW = """- 🏢 REGLA — PREGUNTAS SOBRE OFICINAS / SEDE / DÓNDE QUEDAN (May 27 2026, expandido):
  Triggers (cualquiera de estas frases es OFFICE_QUERY, NO VISIT_REQUEST):
  - "tienen oficinas?" / "tienen oficina física?" / "tienen sede?"
  - "dónde queda la oficina?" / "dónde queda la sede?" / "dónde están las oficinas?"
  - "dónde están ubicados?" / "dónde están ubicados ustedes?" / "dónde están los de la empresa?"
  - "cuál es la dirección de la sede?" / "cuál es la dirección de la oficina?" / "cuál es su dirección?"
  - "cómo llego a la oficina?" / "cómo llego a la sede?" / "cómo llego a ustedes?"
  - "a dónde puedo ir a sus oficinas?" / "a qué oficina puedo ir?"
  - "dónde puedo encontrarlos en persona?" / "dónde los puedo visitar?" (refiriéndose a la empresa, no a una finca)
  - "tienen oficinas en Bogotá?" / "tienen oficina en X ciudad?"

  Desambiguación crítica: si la pregunta MENCIONA "la finca", "la propiedad", "esa casa" → es VISIT_REQUEST. Si MENCIONA "oficina", "sede", "ustedes/empresa", o usa demostrativos sin referencia a finca → es OFFICE_QUERY. En caso de duda y NO hay selected_finca seleccionada, asume OFFICE_QUERY.

  Comportamiento OBLIGATORIO para OFFICE_QUERY:"""

found = False
for n in wf['nodes']:
    if n.get('name') != 'Run offering pass': continue
    sm = n['parameters']['options']['systemMessage']
    if 'OFICINAS / SEDE / DÓNDE QUEDAN (May 27 2026' in sm:
        print('!! already deployed'); sys.exit(0)
    if OLD not in sm:
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(OLD, NEW, 1)
    print('✓ offering: triggers OFFICE_QUERY expandidos + desambiguación')
    found = True
    break

if not found: sys.exit(3)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
