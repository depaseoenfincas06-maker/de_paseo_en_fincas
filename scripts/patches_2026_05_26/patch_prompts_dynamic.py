#!/usr/bin/env python3
"""Replace hardcoded farewell + partial_payment templates in prompts with
dynamic references to agent_settings columns."""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# A.5 farewell — old hardcoded line, new dynamic reference
OLD_FAREWELL = """  Cuando emites CUSTOMER_DECLINED, tu `respuesta` DEBE ser LITERALMENTE este texto (reemplazá [NOMBRE] por el nombre del cliente si lo tenés, o quitálo):
    \"[NOMBRE], agradezco muchísimo tu atención y esperamos que en una próxima oportunidad pienses en depaseoenfincas.com para visitar y elegirnos a la hora de tus vacaciones junto a tu familia. Un fuerte abrazo. 🌳\""""

NEW_FAREWELL = """  Cuando emites CUSTOMER_DECLINED, tu `respuesta` DEBE ser este template (configurable desde dashboard, reemplazá [NOMBRE] por el nombre del cliente si lo tenés, o quitálo):
    {{ JSON.stringify($('config').item.json.farewell_message_template || '[NOMBRE], agradezco muchísimo tu atención y esperamos que pienses en depaseoenfincas.com en una próxima oportunidad. Un fuerte abrazo. 🌳') }}"""

# A.9 partial payment
OLD_PARTIAL = """  • La empresa ACEPTA flexibilidad. Respondé con intent=\"QUESTION\" y un texto basado en este template:
      \"[nombre], yo pienso que para generar el bloqueo podemos hacerlo con [monto_sugerido] pesos
       y en los siguientes 5 días completar el 50%. ¿Crees que te funcionaría así?\""""

NEW_PARTIAL = """  • La empresa ACEPTA flexibilidad. Respondé con intent=\"QUESTION\" y usá este template (configurable desde dashboard, reemplazá [NOMBRE] por nombre y [MONTO_SUGERIDO] por el monto que vas a sugerir):
      {{ JSON.stringify($('config').item.json.partial_payment_template || '[NOMBRE], yo pienso que para generar el bloqueo podemos hacerlo con [MONTO_SUGERIDO] pesos y en los siguientes 5 días completar el 50%. ¿Crees que te funcionaría así?') }}"""

# Apply
count_far = 0
count_par = 0
for n in wf['nodes']:
    name = n['name']
    if name not in ['Run offering pass','Run qa pass','Run verifying_availability pass','Run confirming_reservation pass']:
        continue
    sm = n['parameters']['options']['systemMessage']
    if OLD_FAREWELL in sm:
        sm = sm.replace(OLD_FAREWELL, NEW_FAREWELL, 1)
        count_far += 1
        print(f'✓ {name}: farewell now dynamic')
    if name == 'Run confirming_reservation pass' and OLD_PARTIAL in sm:
        sm = sm.replace(OLD_PARTIAL, NEW_PARTIAL, 1)
        count_par += 1
        print(f'✓ {name}: partial_payment now dynamic')
    n['parameters']['options']['systemMessage'] = sm

print(f'\nTotal: {count_far} farewells + {count_par} partial_payment swapped')

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
