#!/usr/bin/env python3
"""Issue 1: bot dice 'no contamos en Villavicencio' pese a tener 10 fincas.
Causa: el qualifying prompt solo refuerza coverage_zones_text en el saludo
inicial. Cuando el cliente pide una zona, el LLM inventa una respuesta sin
consultar la lista canónica.

Fix: regla explícita en qualifying:
- Antes de decir "no tenemos en X zona", DEBES consultar config.coverage_zones_text.
- Si la zona del cliente aparece (literal o por sinónimo común) en coverage_zones_text,
  DEBES proceder con la búsqueda — NO inventar que no hay cobertura.
- Solo si la zona NO está en coverage_zones_text, decirle al cliente que no
  tenemos cobertura y SUGERIR las zonas reales de la lista, NUNCA inventar la lista.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# Insertar regla antes del bloque "BLOQUE 3 — cobertura"
ANCHOR = "  BLOQUE 3 — cobertura, SIEMPRE al final:"

NEW_RULE = """- ⚠️ REGLA INVIOLABLE — COBERTURA DE ZONAS (May 27 2026):
  Antes de decirle al cliente "no tenemos en X zona" o "no contamos con propiedades en X", DEBES verificar contra `coverage_zones_text` que viene en config:
  - VALOR LITERAL de la lista: {{ $('config').first().json.coverage_zones_text }}
  Reglas:
  • Si la zona que pide el cliente APARECE en esa lista (literal o por sinónimo razonable — ej. "Pereira" = "Eje cafetero", "Santa Fe" = "Antioquia"), DEBES proceder con la búsqueda llamando inventory_reader_tool. NO digas que no hay cobertura.
  • Si la zona NO aparece, decílo al cliente y CITA TEXTUALMENTE la lista de coverage_zones_text — NUNCA inventes una lista distinta. Pega `coverage_zones_text` tal cual.
  • PROHIBIDO inventar zonas que no estén en la lista (ej. no decir "Cundinamarca, Tolima y Melgar" si esos términos NO aparecen en coverage_zones_text).
  • PROHIBIDO omitir zonas reales de la lista. Si coverage incluye Villavicencio, JAMÁS digas que no tenemos en Villavicencio.

"""

found = False
for n in wf['nodes']:
    if n.get('name') != 'Run qualifying pass': continue
    sm = n['parameters']['options']['systemMessage']
    if 'COBERTURA DE ZONAS (May 27 2026)' in sm:
        print('!! already deployed'); sys.exit(0)
    if ANCHOR not in sm:
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(ANCHOR, NEW_RULE + ANCHOR, 1)
    print('✓ qualifying: regla inviolable de cobertura de zonas')
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
