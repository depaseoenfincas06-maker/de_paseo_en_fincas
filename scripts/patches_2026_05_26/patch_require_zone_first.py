#!/usr/bin/env python3
"""Regla explícita: pedir zona ANTES de filtrar por amenidad (jacuzzi,
piscina, sauna, lago, cancha, etc.).

Comportamiento deseado: si el cliente menciona solo amenidad SIN especificar
zona, el bot debe preguntar la zona primero, luego filtrar con BIT.

Ya hoy funciona así de hecho (casos 11/12/17/20 pidieron zona). Pero
formalizo la regla en qualifying prompt para que sea robusta.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

ANCHOR = "datos mínimos del cliente:"

NEW_RULE_AFTER = """datos mínimos del cliente:
1) fechas (fecha_inicio y fecha_fin)
2) número de personas (personas)
3) zona/destino (zona)

⚠️ REGLA OBLIGATORIA — ZONA SIEMPRE ANTES DE FILTRAR (May 27 2026):
Si el cliente menciona SOLO amenidades (jacuzzi, piscina, sauna, lago, cancha de fútbol, BBQ, wifi, etc.) o características de la propiedad SIN especificar zona/destino, NO consultes el inventario todavía. Pide la zona primero.

Triggers que requieren zona antes de seguir:
- "tienes finca con jacuzzi?" / "necesito una con piscina" / "quiero algo con cancha de fútbol" / "alguna con sauna?" / "que tenga lago"
- "quiero algo para 15 personas con jacuzzi" (tiene capacidad pero falta zona)

Respuesta correcta del bot cuando faltan zona:
"Listo, tomamos nota de [amenidad/capacidad/fechas]. Para encontrar la mejor opción, en qué zona te gustaría ubicarte? Tenemos propiedades en COVERAGE_ZONES."

PROHIBIDO devolver fincas cross-zona sin que el cliente haya elegido una.

"""

OLD_BLOCK = """datos mínimos del cliente:
1) fechas (fecha_inicio y fecha_fin)
2) número de personas (personas)
3) zona/destino (zona)"""

found = False
for n in wf['nodes']:
    if n.get('name') != 'Run qualifying pass': continue
    sm = n['parameters']['options']['systemMessage']
    if 'ZONA SIEMPRE ANTES DE FILTRAR (May 27 2026)' in sm:
        print('!! already deployed'); sys.exit(0)
    if OLD_BLOCK not in sm:
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(OLD_BLOCK, NEW_RULE_AFTER, 1)
    print('✓ qualifying: regla "zona siempre antes de filtrar"')
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
