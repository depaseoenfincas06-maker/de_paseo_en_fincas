#!/usr/bin/env python3
"""
A.9 + B.4 — Pago parcial / flexibilidad de bloqueo (caso 1.6 del feedback 25-may).

Cliente post-DOCUMENT_READY pide "puedo bloquear con un millón?" / "no tengo
el 50%" → bot original quedó en silencio. Juan dictó que el bot debe NO ser
radical con el 50% y ofrecer flexibilidad. Template aprobado:

  "[nombre], yo pienso que para generar el bloqueo podemos hacerlo con
   [monto] pesos y en los siguientes 5 días completar el 50%. ¿Crees
   que te funcionaría así?"

Cambios:
1. confirming_reservation_agent system message — agregar bloque con
   triggers de partial payment + template + regla "NO HITL".
2. QA validator — agregar rule explícita: preguntas de pago parcial van a STATE.
3. global_prompt_addendum (agent_settings) — agregar regla transversal de
   flexibilidad de pago (vía SQL UPDATE).
"""
import json, subprocess, sys, os

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# === 1. confirming_reservation_agent — agregar bloque PARTIAL_PAYMENT_NEGOTIATION ===
ANCHOR_CONFIRMING = "- Si el cliente pregunta por medios de pago, refiérete a la lista en el INTRO_TEMPLATE — ya está incluida ahí. Si insiste con detalles bancarios concretos, marca intent=\"QUESTION\" y dile que en breve un asesor le compartirá los datos exactos (no inventes datos bancarios)."

NEW_CONFIRMING = (
ANCHOR_CONFIRMING + "\n"
"- REGLA — PAGO PARCIAL / FLEXIBILIDAD DE BLOQUEO (caso real recurrente):\n"
"  Si el cliente post-DOCUMENT_READY pide bloquear con MENOS del 50% del total\n"
"  (frases trigger: \"puedo bloquear con [monto]?\", \"no tengo el 50%\", \"puedo dar menos?\",\n"
"  \"acepta pago parcial?\", \"tengo [monto] para separar\", \"podemos hacerlo con [monto]?\",\n"
"  \"un valor menor al 50%?\"):\n"
"  • NO derives a HITL. NO seas radical diciendo \"el anticipo es del 50%, no se puede menos\".\n"
"  • La empresa ACEPTA flexibilidad. Respondé con intent=\"QUESTION\" y un texto basado en este template:\n"
"      \"[nombre], yo pienso que para generar el bloqueo podemos hacerlo con [monto_sugerido] pesos\n"
"       y en los siguientes 5 días completar el 50%. ¿Crees que te funcionaría así?\"\n"
"  • Cómo elegir [monto_sugerido]:\n"
"    - Si el cliente propuso un monto concreto y es razonable (>= 20% del total), úsalo tal cual.\n"
"    - Si propuso un monto demasiado bajo o no propuso, sugerí aprox 30% del total redondeado a millón hacia abajo.\n"
"    - Nunca menos de $500.000 para reservas de varios millones (criterio de razonabilidad).\n"
"  • Si el cliente acepta el plan, agradecé y pasá la coordinación al asesor (intent=\"RESERVATION_APPROVED\" si ya hay PDF aprobado, o mantené el flujo de captura de comprobante).\n"
"  • Esta regla NO aplica si el cliente quiere ABSOLUTAMENTE no pagar nada o intenta evadir el anticipo total —\n"
"    en ese caso pedí más contexto y considerá intent=\"HITL_REQUEST\"."
)

# === 2. QA validator — agregar regla explícita ===
ANCHOR_QA = "- Devuelve QA si el mensaje es una pregunta puntual o aclaración que no debería cambiar el estado de negocio."

NEW_QA = (
ANCHOR_QA + "\n"
"- Preguntas sobre PAGO PARCIAL o flexibilidad de bloqueo (\"puedo dar menos del 50%?\", \"bloqueo con un millón?\", \"acepta pago parcial?\") SIEMPRE van a STATE, NUNCA a HITL. El agente de CONFIRMING tiene una regla específica para manejarlas con flexibilidad."
)

found_c = False
found_q = False
for n in wf['nodes']:
    if n['name'] == 'Run confirming_reservation pass':
        sm = n['parameters']['options']['systemMessage']
        if ANCHOR_CONFIRMING not in sm:
            print('!! confirming anchor not found'); sys.exit(2)
        if 'PAGO PARCIAL / FLEXIBILIDAD' in sm:
            print('!! confirming rule already present')
        else:
            n['parameters']['options']['systemMessage'] = sm.replace(ANCHOR_CONFIRMING, NEW_CONFIRMING, 1)
            print('✓ Run confirming_reservation pass: PARTIAL_PAYMENT rule added')
        found_c = True
    elif n['name'] == 'QA validator':
        sm = n['parameters']['options']['systemMessage']
        if ANCHOR_QA not in sm:
            print('!! qa_validator anchor not found'); sys.exit(2)
        if 'PAGO PARCIAL' in sm:
            print('!! qa_validator rule already present')
        else:
            n['parameters']['options']['systemMessage'] = sm.replace(ANCHOR_QA, NEW_QA, 1)
            print('✓ QA validator: PAGO PARCIAL → STATE rule added')
        found_q = True

if not (found_c and found_q):
    print('!! one or both nodes missing'); sys.exit(2)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {
    'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED},
}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL,
                     '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
out = json.loads(r2.stdout)
print(f'PUT ok. active={out.get("active")}')

# === 3. global_prompt_addendum SQL update ===
# Run via db_query.py
ADDENDUM_LINE = "FLEXIBILIDAD DE PAGO (transversal): nunca seas radical con el 50% de anticipo. Si el cliente pide bloquear con menos, sugiere un monto inicial razonable y completar el 50% en 5 días."
# Append to the existing global_prompt_addendum if not present
print('\n--- Updating agent_settings.global_prompt_addendum ---')
check_sql = "SELECT global_prompt_addendum FROM agent_settings WHERE id=1"
r3 = subprocess.run(['python3','/tmp/db_query.py', check_sql], capture_output=True, text=True)
import json as _json
try:
    current = _json.loads(r3.stdout.strip())['global_prompt_addendum'] or ''
except Exception:
    current = ''
if 'FLEXIBILIDAD DE PAGO' in current:
    print('!! addendum already contains FLEXIBILIDAD DE PAGO')
else:
    new_val = (current + ('\n\n' if current else '') + '- ' + ADDENDUM_LINE).replace("'", "''")
    update_sql = f"UPDATE agent_settings SET global_prompt_addendum='{new_val}' WHERE id=1"
    r4 = subprocess.run(['python3','/tmp/db_query.py', update_sql], capture_output=True, text=True)
    print(r4.stdout, r4.stderr)
    print('✓ global_prompt_addendum updated')
