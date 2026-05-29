#!/usr/bin/env python3
"""Punto 2: cuando fechas caen en Año Nuevo/Semana Santa con menos noches que
el mínimo, el bot bloquea pidiendo ampliar fechas. Cliente queda mudo.

Fix: relajar la regla — el bot debe MOSTRAR las fincas que cumplen + EXPLICAR
el mínimo. Si BIT viene vacío por min_noches, el bot debe explicar pero también
ofrecer mostrar fincas con un override de fechas (ej. proponer las 5 noches
recomendadas o sugerir cambiar de zona/fecha).

Comportamiento esperado:
- Cliente: "Anapoima 10p del 27 al 30 diciembre 2026"
- Bot: "Para Año Nuevo el mínimo es 5 noches. Si querés mantener las fechas,
  te puedo mostrar las opciones más cercanas en zonas similares o ampliar
  las fechas. ¿Cuál preferís?"
- Cliente: "amplía a 5 noches" → bot muestra cards
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """  * Estándar: lo que diga la finca (item.min_noches del Sheet)
  Si las fechas del cliente caen en una de esas temporadas y la duración es menor al mínimo, las fincas vienen filtradas (matched_count=0). En ese caso, EXPLICA con claridad: "Para esas fechas (ej: Año Nuevo) el mínimo de estadía es 5 noches. ¿Querés ampliar el rango?". No muestres fincas."""

NEW = """  * Estándar: lo que diga la finca (item.min_noches del Sheet)
  Si las fechas del cliente caen en una de esas temporadas y la duración es menor al mínimo, las fincas vienen filtradas (matched_count=0). Comportamiento correcto:
  • EXPLICA el mínimo: "Para esas fechas de Año Nuevo el mínimo de estadía es 5 noches."
  • OFRECE 2 opciones concretas al cliente (NO solo pidas ampliar):
    1. "Si extiendes a [fechas con N noches mínimas], te muestro las opciones disponibles."
    2. "Si prefieres mantener las fechas actuales, podemos buscar en zonas con menos restricción de mínimo (ej. fechas estándar fuera del puente de Año Nuevo)."
  • Pregunta "¿Cuál te queda mejor?" y queda esperando respuesta.
  • Si el cliente acepta extender, vuelve a llamar al tool con las nuevas fechas y MUESTRA las opciones."""

found = False
for n in wf['nodes']:
    if n.get('name') != 'Run offering pass': continue
    sm = n['parameters']['options']['systemMessage']
    if 'OFRECE 2 opciones concretas al cliente' in sm:
        print('!! already deployed'); sys.exit(0)
    if OLD not in sm:
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(OLD, NEW, 1)
    print('✓ offering: regla min_noches ahora ofrece 2 opciones en vez de bloquear')
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
