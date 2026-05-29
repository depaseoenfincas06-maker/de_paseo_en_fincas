#!/usr/bin/env python3
"""Fix Error 1 (May 26 2026): cuando cliente pide "más fotos" de una finca,
LLM cambia de finca y ofrece otra propiedad.

Caso real: cliente preguntó "tienes más fotos de esa opción?" (sobre ANAPOIMA_#04).
Bot respondió "No tengo más fotos de esa opción, pero encontré esta otra
alternativa..." y mandó card+foto de ANAPOIMA_#05. El cliente nunca pidió otra
finca.

Fix: regla explícita — cuando piden MÁS fotos de finca ya mostrada, NO cambiar
de finca. Decir que esas son todas las disponibles + OFRECER visita/videollamada
en texto. intent=QUESTION, fincas_mostradas=[].

Reemplaza la regla actual (línea 96-99 del prompt) que dice "siempre emite
SHOW_OPTIONS con fincas_mostradas=[esa finca]" — esa regla disparaba re-render
de la misma card con la misma foto, que el cliente percibía como spam.

No toca:
- Regla cotización (línea 64) — patch_quote_text_response.py
- Regla "tienes más?" — patch_offering_more_options_rule.py
- Regla VISIT_REQUEST / oficinas — esa es para visita explícita
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """  Si el cliente pide explícitamente "fotos de [X]" / "muéstrame fotos" / "más imágenes" de una finca específica:
  • NUNCA respondas con texto + enlace Drive ("acá podés ver las fotos: [link]"). El sistema bloquea links sueltos.
  • SIEMPRE emite intent="SHOW_OPTIONS" con `fincas_mostradas=[{finca_id, foto_url, ...}]` conteniendo SOLO esa finca.
  • Tu respuesta debe ser corto: "Claro [nombre], aquí están las fotos de [finca_codigo]:". El sistema arma el media_group automáticamente."""

NEW = """  Si el cliente pide explícitamente "fotos de [X]" / "muéstrame fotos" / "imágenes de [X]" de una finca específica:
  • NUNCA respondas con texto + enlace Drive ("acá podés ver las fotos: [link]"). El sistema bloquea links sueltos.

  CASO A — la finca AÚN NO ha sido mostrada (NO está en context.shown_fincas):
  • Emite intent="SHOW_OPTIONS" con `fincas_mostradas=[{finca_id, foto_url, ...}]` conteniendo SOLO esa finca.
  • respuesta corta: "Claro [nombre], acá están las fotos de [finca_codigo]:". El sistema arma el media_group.

  CASO B — la finca YA fue mostrada (está en context.shown_fincas) y el cliente pide MÁS fotos / fotos adicionales / OTRAS fotos ("tienes más fotos?", "más imágenes", "otras fotos", "fotos diferentes"):
  • ⚠️ PROHIBIDO re-emitir la misma finca en fincas_mostradas — re-renderiza la misma card+foto y el cliente lo percibe como spam.
  • ⚠️ PROHIBIDO cambiar de finca / sugerir otra propiedad. El cliente quiere MÁS fotos de la finca actual, no otra finca.
  • CORRECTO: intent="QUESTION", fincas_mostradas=[], respuesta EN TEXTO:
    "[nombre], esas son todas las fotos que tengo disponibles de [finca_codigo] en este momento. Si querés conocer más detalles de la propiedad, podemos agendarte una visita presencial (entre martes y jueves) o videollamada desde una de nuestras oficinas. ¿Cuál te queda mejor?"
  • Si el cliente luego confirma "sí, agendemos visita" o da fecha → ahí sí emite VISIT_REQUEST. Pero en este paso es QUESTION solamente."""

found = False
for n in wf['nodes']:
    if n.get('name') != 'Run offering pass': continue
    sm = n['parameters']['options']['systemMessage']
    if 'CASO B — la finca YA fue mostrada' in sm:
        print('!! already deployed'); sys.exit(0)
    if OLD not in sm:
        print('!! anchor not found in offering prompt')
        sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(OLD, NEW, 1)
    print('✓ offering: regla "más fotos" — distingue CASO A (nueva finca) vs CASO B (ya mostrada)')
    found = True
    break

if not found:
    print('!! offering not found'); sys.exit(3)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
