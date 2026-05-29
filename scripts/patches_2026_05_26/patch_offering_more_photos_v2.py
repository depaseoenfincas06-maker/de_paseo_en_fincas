#!/usr/bin/env python3
"""Fix v2 — corrige la regla de "más fotos" según la lógica REAL del sistema.

Descubrimiento: el workflow Chatwoot Outbound Sender (Bg5nl2Y26PuwF2NB) tiene
en `Expand outbound items` la función resolveFolderAssets() que extrae TODOS
los IDs de archivos de un Drive folder via embeddedfolderview HTML scraping.
TEST MODE actualmente limita a .slice(0,1) — cuando se quite, mandará todas.

La regla CASO B previa (que decía "esas son todas + ofrecer visita") asumía
que solo había 1 foto disponible, cosa que es INCORRECTA: el folder de Drive
tiene muchas, solo que TEST MODE las recorta.

Comportamiento correcto que se quiere:
- Cliente pide "más fotos de X (en shown_fincas)" → bot re-emite fincas_mostradas:[X].
- buildMediaMessages dispara → outbound sender expande el folder.
- En TEST MODE: manda 1 (la misma). Cuando se quite TEST MODE: manda todas.
- PROHIBIDO cambiar de finca (eso era el Error 1 original).

NO REPETIR text+enlace Drive ni texto "esas son todas" — eso es engañoso
porque sí hay más en el folder.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD_BLOCK = """  Si el cliente pide explícitamente "fotos de [X]" / "muéstrame fotos" / "imágenes de [X]" de una finca específica:
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

NEW_BLOCK = """  Si el cliente pide explícitamente "fotos de [X]" / "muéstrame fotos" / "más imágenes" / "tienes más fotos?" / "otras fotos" / "imágenes adicionales" de una finca específica:
  • NUNCA respondas con texto + enlace Drive ("acá podés ver las fotos: [link]"). El sistema bloquea links sueltos.
  • ⚠️ PROHIBIDO cambiar de finca o sugerir OTRA propiedad. El cliente quiere fotos de la finca actual.
  • ⚠️ PROHIBIDO responder con texto tipo "esas son todas las fotos disponibles" — el sistema tiene un media_group expander que extrae múltiples fotos del Drive folder; el LLM no puede saber cuántas hay.

  COMPORTAMIENTO CORRECTO (sirve igual si la finca está o no en shown_fincas):
  • intent="SHOW_OPTIONS", fincas_mostradas=[{finca_id, codigo_original, nombre, foto_url, ...}] con SOLO esa finca.
  • respuesta corta: "Claro [nombre], acá te paso las fotos de [finca_codigo]:" o equivalente. El sistema arma el media_group desde foto_url (un Drive folder) y manda las imágenes disponibles. Si actualmente solo se está mandando 1 (limitación temporal del sender), el cliente recibirá esa una — eso es comportamiento esperado del sistema, no es problema del LLM."""

found = False
for n in wf['nodes']:
    if n.get('name') != 'Run offering pass': continue
    sm = n['parameters']['options']['systemMessage']
    if 'sistema tiene un media_group expander' in sm:
        print('!! v2 already deployed'); sys.exit(0)
    if OLD_BLOCK not in sm:
        print('!! anchor (CASO A / CASO B block) not found — quizás está la regla original sin parche')
        # Try the ORIGINAL pre-v1 block
        ORIG = """  Si el cliente pide explícitamente "fotos de [X]" / "muéstrame fotos" / "más imágenes" de una finca específica:
  • NUNCA respondas con texto + enlace Drive ("acá podés ver las fotos: [link]"). El sistema bloquea links sueltos.
  • SIEMPRE emite intent="SHOW_OPTIONS" con `fincas_mostradas=[{finca_id, foto_url, ...}]` conteniendo SOLO esa finca.
  • Tu respuesta debe ser corto: "Claro [nombre], aquí están las fotos de [finca_codigo]:". El sistema arma el media_group automáticamente."""
        if ORIG in sm:
            n['parameters']['options']['systemMessage'] = sm.replace(ORIG, NEW_BLOCK, 1)
            print('✓ replaced ORIGINAL block')
            found = True
            break
        else:
            sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(OLD_BLOCK, NEW_BLOCK, 1)
    print('✓ offering: regla "más fotos" v2 — re-emitir fincas_mostradas siempre, sin texto "esas son todas"')
    found = True
    break

if not found:
    print('!! no patch applied'); sys.exit(3)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
