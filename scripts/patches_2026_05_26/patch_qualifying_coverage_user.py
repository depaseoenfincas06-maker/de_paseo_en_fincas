#!/usr/bin/env python3
"""El qualifying agent inventa la lista de zonas. Causa probable: el
systemMessage de LangChain no interpola templates {{ }} dentro de él
correctamente (igual que vimos con offering).

Fix: inyectar COVERAGE_ZONES en el user prompt (text) que sí se interpola,
y reforzar la regla en SM como texto plano referenciando ese bloque.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# Inject in user prompt right after the date line
USER_OLD = "=Hoy es (fecha_actual): {{ \n  new Date().toLocaleString(\"sv-SE\", { \n    timeZone: \"America/Bogota\" \n  }).slice(0, 10) \n}}"

USER_NEW = "=Hoy es (fecha_actual): {{ \n  new Date().toLocaleString(\"sv-SE\", { \n    timeZone: \"America/Bogota\" \n  }).slice(0, 10) \n}}\n\nCOVERAGE_ZONES (lista LITERAL de zonas con propiedades, NO inventes otras):\n{{ $('config').first().json.coverage_zones_text }}"

# Also update the rule we put in system message to point to user prompt
SM_OLD = """- ⚠️ REGLA INVIOLABLE — COBERTURA DE ZONAS (May 27 2026):
  Antes de decirle al cliente "no tenemos en X zona" o "no contamos con propiedades en X", DEBES verificar contra `coverage_zones_text` que viene en config:
  - VALOR LITERAL de la lista: {{ $('config').first().json.coverage_zones_text }}
  Reglas:
  • Si la zona que pide el cliente APARECE en esa lista (literal o por sinónimo razonable — ej. "Pereira" = "Eje cafetero", "Santa Fe" = "Antioquia"), DEBES proceder con la búsqueda llamando inventory_reader_tool. NO digas que no hay cobertura.
  • Si la zona NO aparece, decílo al cliente y CITA TEXTUALMENTE la lista de coverage_zones_text — NUNCA inventes una lista distinta. Pega `coverage_zones_text` tal cual.
  • PROHIBIDO inventar zonas que no estén en la lista (ej. no decir "Cundinamarca, Tolima y Melgar" si esos términos NO aparecen en coverage_zones_text).
  • PROHIBIDO omitir zonas reales de la lista. Si coverage incluye Villavicencio, JAMÁS digas que no tenemos en Villavicencio.

"""

SM_NEW = """- ⚠️ REGLA INVIOLABLE — COBERTURA DE ZONAS (May 27 2026):
  La lista LITERAL de zonas con propiedades viene en el user prompt bajo "COVERAGE_ZONES". USA SOLO ESA LISTA.
  Reglas:
  • Si la zona del cliente APARECE en COVERAGE_ZONES (literal o por sinónimo razonable — ej. "Pereira" / "Quindío" / "Manizales" / "Armenia" = "Eje cafetero", "Santa Fe" / "Guatapé" / "San Jerónimo" = "Antioquia", "Melgar" = "Carmen de Apicalá" según contexto), DEBES proceder con la búsqueda llamando inventory_reader_tool. NUNCA digas que no hay cobertura cuando la zona SÍ está en COVERAGE_ZONES.
  • Si la zona NO aparece en COVERAGE_ZONES, decílo al cliente y CITA TEXTUALMENTE el contenido de COVERAGE_ZONES del user prompt — NUNCA inventes una lista distinta. NUNCA digas "Cundinamarca, Tolima y Melgar" ni nombres de departamentos que no aparezcan en COVERAGE_ZONES.
  • PROHIBIDO omitir zonas que SÍ están en COVERAGE_ZONES. Si COVERAGE_ZONES incluye Villavicencio, JAMÁS digas "no tenemos en Villavicencio".
  • Antes de responder "no hay cobertura", lee COVERAGE_ZONES del user prompt completo y verifica.

"""

patched = []
for n in wf['nodes']:
    if n.get('name') != 'Run qualifying pass': continue

    # Patch user text
    text = n['parameters'].get('text','')
    if 'COVERAGE_ZONES' in text:
        patched.append('user text: already')
    elif USER_OLD not in text:
        print('!! user text anchor not found')
        sys.exit(2)
    else:
        n['parameters']['text'] = text.replace(USER_OLD, USER_NEW, 1)
        patched.append('user text: COVERAGE_ZONES injected')

    # Patch system message
    sm = n['parameters']['options']['systemMessage']
    if 'lista LITERAL de zonas con propiedades viene en el user prompt bajo "COVERAGE_ZONES"' in sm:
        patched.append('SM: already')
    elif SM_OLD not in sm:
        print('!! SM anchor not found')
        sys.exit(3)
    else:
        n['parameters']['options']['systemMessage'] = sm.replace(SM_OLD, SM_NEW, 1)
        patched.append('SM: regla pointing to COVERAGE_ZONES in user prompt')

for p in patched: print('  -', p)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
