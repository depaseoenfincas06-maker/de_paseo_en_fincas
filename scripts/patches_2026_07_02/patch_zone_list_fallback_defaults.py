#!/usr/bin/env python3
"""Alinear los fallback defaults de zonas (Jul 2 2026).

El listado de zonas de cobertura es editable desde el dashboard de settings
(campo 'Zonas que quieres comunicar como cobertura' → agent_settings.
coverage_zones_text) — fuente de verdad ÚNICA que el cliente puede ajustar.

Este patch solo alinea los DEFAULTS de fallback del nodo 'Get agent settings'
(usados únicamente si la fila de agent_settings no existe) con la lista real
actualizada, para que nunca resuciten la lista vieja sin La Mesa / Melgar /
Arbeláez.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
BASE = 'https://n8n.depaseoenfincas.raaamp.co'
WID = '2NV08zRFKENUsQVC'
URL = f'{BASE}/api/v1/workflows/{WID}'

OLD_LIST = 'Anapoima, Villeta, La Vega, Girardot, Eje cafetero, Carmen de Apicalá, Antioquia y Villavicencio'
NEW_LIST = 'Anapoima, La Mesa, Villeta, La Vega, Girardot, Melgar, Arbeláez, Carmen de Apicalá, Eje cafetero, Antioquia y Villavicencio'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

applied = False
for n in wf['nodes']:
    if n['name'] != 'Get agent settings': continue
    q = n['parameters'].get('query', '')
    cnt = q.count(OLD_LIST)
    if cnt == 0:
        print('already aligned (0 hits)'); sys.exit(0)
    n['parameters']['query'] = q.replace(OLD_LIST, NEW_LIST)
    applied = True
    print(f'✓ Get agent settings: {cnt} fallback defaults alineados')
    break
if not applied: sys.exit(2)

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
