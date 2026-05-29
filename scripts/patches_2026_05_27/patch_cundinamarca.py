#!/usr/bin/env python3
"""Punto 20: cuando cliente dice 'Cundinamarca', el bot pide aclarar municipio
en 9 de 10 casos. Debería tratarlo como cluster válido y buscar en TODAS las
zonas de cobertura dentro de Cundinamarca (Anapoima/Villeta/Girardot/La Vega/
La Mesa/Carmen de Apicalá).

Fix: regla explícita en qualifying que cuando la zona del cliente es un nombre
de departamento que cubre múltiples municipios de la cobertura, NO pedir más
zona — proceder con el search.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

ANCHOR = "⚠️ REGLA OBLIGATORIA — ZONA SIEMPRE ANTES DE FILTRAR (May 27 2026):"

NEW_RULE = """⚠️ REGLA — DEPARTAMENTOS COMO ZONA VÁLIDA (May 27 2026):
  Cuando el cliente da un DEPARTAMENTO o REGIÓN GENERAL que cubre varios municipios de la cobertura, NO pidas que escoja municipio específico. Esos nombres son zona válida y debes proceder con la búsqueda.

  Equivalencias automáticas (devuelve estos en search_criteria.zona):
  - "Cundinamarca" / "departamento de Cundinamarca" → guardar zona = "Cundinamarca" y proceder. El sistema buscará en Anapoima, Villeta, Girardot, La Vega, La Mesa y Carmen de Apicalá automáticamente.
  - "cerca a Bogotá" / "Bogotá" (para fincas) → equivale a Cundinamarca, mismo comportamiento.
  - "Antioquia" / "departamento de Antioquia" / "cerca a Medellín" → guardar zona = "Antioquia" y buscar en Santa Fe, San Jerónimo, Guatapé, Sopetrán, Barbosa, Rionegro.
  - "Eje cafetero" / "Risaralda" / "Quindío" / "Caldas" → guardar zona = "Eje cafetero" y buscar Pereira, Manizales, Armenia, etc.
  - "Tolima" → equivale a Carmen de Apicalá / Melgar.
  - "Llanos" / "Meta" → equivale a Villavicencio.

  Solo pide municipio específico si el cliente nombra un departamento donde NO tenemos cobertura (ej. Atlántico, Bolívar, Nariño). En esos casos, dile que no tenemos cobertura ahí y cita la lista canónica de coverage_zones_text.

  PROHIBIDO responder "En Cundinamarca tenemos fincas en Anapoima, Villeta, La Vega y Girardot. Tienes preferencia?" cuando el cliente YA dio zona+personas+fechas. En ese caso DEBES llamar al inventory_reader_tool con zona="Cundinamarca" (el tool sabe cómo expandirlo) y mostrar opciones.

"""

found = False
for n in wf['nodes']:
    if n.get('name') != 'Run qualifying pass': continue
    sm = n['parameters']['options']['systemMessage']
    if 'DEPARTAMENTOS COMO ZONA VÁLIDA (May 27 2026)' in sm:
        print('!! already deployed'); sys.exit(0)
    if ANCHOR not in sm:
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(ANCHOR, NEW_RULE + ANCHOR, 1)
    print('✓ qualifying: regla de departamentos como zona válida')
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
