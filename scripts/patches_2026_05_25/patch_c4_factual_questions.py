#!/usr/bin/env python3
"""
C.4 — Preguntas factuales en CONFIRMING no van a HITL (caso 1.7).

Bug: cliente en CONFIRMING preguntó:
- "¿Cuánto tiempo está el pueblo?"
- "¿Cómo es la carretera?"
- "¿Es conjunto cerrado o privada? Por seguridad queremos conjunto"
→ Bot respondió "Te voy a pasar a ser humano" (HITL prematuro).

Estas son preguntas factuales sobre la finca con datos disponibles en el
item del inventario (tiempo_en_vehiculo, descripcion_corta, "privada o
condominio", amenidades). Deben ser respondidas por qa_pass con datos,
NO derivadas.

Fix:
1. QA validator — agregar regla explícita con ejemplos de preguntas
   factuales que SIEMPRE van a STATE.
2. qa_agent system message — agregar enumeración de qué campos del item
   responder según el tema (carretera→tiempo_en_vehiculo+descripción,
   conjunto→privada o condominio, etc.)
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# === 1. QA validator — agregar regla con ejemplos factuales ===
ANCHOR_QA = "- Preguntas sobre PAGO PARCIAL o flexibilidad de bloqueo (\"puedo dar menos del 50%?\", \"bloqueo con un millón?\", \"acepta pago parcial?\") SIEMPRE van a STATE, NUNCA a HITL. El agente de CONFIRMING tiene una regla específica para manejarlas con flexibilidad."

NEW_QA = (
ANCHOR_QA + "\n"
"- PREGUNTAS FACTUALES SOBRE LA FINCA — SIEMPRE van a STATE, NUNCA a HITL, en CUALQUIER estado (incluido CONFIRMING_RESERVATION):\n"
"  Ejemplos: \"¿cómo es la carretera?\" / \"¿es conjunto cerrado o privada?\" / \"¿cuánto tiempo al pueblo?\" / \"¿tiene wifi?\" / \"¿hay aire acondicionado?\" / \"¿permiten mascotas?\" / \"¿cómo es la distribución?\" / \"¿cuántas habitaciones?\" / \"¿el jacuzzi tiene costo?\".\n"
"  Estas son preguntas con datos disponibles en el inventario (campos: tiempo_en_vehiculo, privada o condominio, amenidades, descripcion_corta, pet_friendly, habitaciones, capacidad_max). El agente de STATE las responde — NO requieren humano.\n"
"  Solo HITL si el cliente pide explícitamente humano (\"dame un asesor\") o si la pregunta es de naturaleza administrativa que excede el alcance del agente (políticas de cancelación complejas, disputas, cambios contractuales)."
)

# === 2. qa_agent (Run qa pass) — agregar enumeración de campos ===
# Find the existing qa pass prompt for an anchor
ANCHOR_QAAGENT = "REGLA DE PRECIOS"  # generic, will use first occurrence

# Add a new block ABOVE REGLA DE PRECIOS so it's prominently in the prompt
NEW_QAAGENT_BLOCK = (
"- REGLA — PREGUNTAS FACTUALES SOBRE LA FINCA (caso 1.7 del feedback):\n"
"  El cliente puede preguntar sobre características de la finca SELECCIONADA en cualquier estado, incluyendo post-DOCUMENT_READY. Cómo responder:\n"
"  • \"¿Cómo es la carretera?\" / \"¿cuánto al pueblo?\" → cita `tiempo_en_vehiculo` + parafrasea descripcion_corta si menciona carretera/acceso.\n"
"  • \"¿Es conjunto cerrado o privada?\" / \"¿está en conjunto?\" → cita campo `privada o condominio` del item (valores: 'privada' o 'condominio').\n"
"  • \"¿Tiene wifi?\" / \"¿hay aire?\" / \"¿permiten mascotas?\" → busca en `amenidades` (wifi, aire_acondicionado, pet_friendly).\n"
"  • \"¿Cuántas habitaciones?\" / \"¿cuántas camas?\" / \"¿cómo es la distribución?\" → cita `habitaciones`, `capacidad_max`, y `especificacion_acomodacion_habitaciones` si la traes.\n"
"  • \"¿Cobran el jacuzzi?\" → revisa `descripcion_corta` por mención de \"tarifa adicional\" y, si aplica, mencioná el cargo de $120.000 (recargo de gas para 2 días de uso).\n"
"  • \"¿Tienen empleada?\" / \"¿cuánto cuesta?\" → cita amenidades (empleada presente?) + si empleada_obligatorio, mencioná el costo $servicio_empleada_valor_8h por día (8h).\n"
"  NUNCA respondas \"te paso con un asesor humano\" a estas preguntas — los datos están en el item. Si dudas, pide aclaración pero NO derives.\n"
)

found = {}
for n in wf['nodes']:
    if n['name'] == 'QA validator':
        sm = n['parameters']['options']['systemMessage']
        if ANCHOR_QA not in sm:
            print('!! QA validator anchor not found'); sys.exit(2)
        if 'PREGUNTAS FACTUALES SOBRE LA FINCA' in sm:
            print('!! QA validator factual rule already present')
        else:
            n['parameters']['options']['systemMessage'] = sm.replace(ANCHOR_QA, NEW_QA, 1)
            print('✓ QA validator: factual STATE rule added')
        found['qa_validator'] = True
    elif n['name'] == 'Run qa pass':
        sm = n['parameters']['options']['systemMessage']
        if ANCHOR_QAAGENT not in sm:
            print('!! qa_pass anchor not found'); sys.exit(2)
        if 'REGLA — PREGUNTAS FACTUALES SOBRE LA FINCA' in sm:
            print('!! qa_pass factual rule already present')
        else:
            # Insert BEFORE REGLA DE PRECIOS
            n['parameters']['options']['systemMessage'] = sm.replace(
                '- ' + ANCHOR_QAAGENT,
                NEW_QAAGENT_BLOCK + '- ' + ANCHOR_QAAGENT, 1)
            print('✓ Run qa pass: factual fields rule added')
        found['qa_pass'] = True

if not (found.get('qa_validator') and found.get('qa_pass')):
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
print(f'\nPUT ok. active={out.get("active")}')
