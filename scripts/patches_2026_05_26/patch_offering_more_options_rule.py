#!/usr/bin/env python3
"""Fix Error 3 (May 26 2026): cuando cliente pide "tienes más?", LLM cambia
zona unilateralmente en lugar de buscar más en la zona actual.

Caso real: cliente pidió Anapoima 28p. Bot mostró 3 fincas. Cliente: "Tienes más?".
LLM llamó inventory_reader_tool con zona="Villeta" y dijo "las 3 son las únicas en
Anapoima". Pero hay 41 fincas Anapoima en el inventario, no se exploró el resto.

Fix: agregar regla explícita en offering prompt — cuando el cliente pide más
opciones SIN cambiar zona, MANTENER zona actual y pasar shown_fincas_json al tool
para excluir las ya vistas. Solo si BIT devuelve vacío, OFRECER (no decidir)
ampliar a zonas cercanas.

No toca:
- Regla de cotización (línea 64)
- Regla de fotos (línea 96-99) — la mejoro en patch separado
- Regla VISIT_REQUEST / oficinas (línea 117+)
- Regla nombre real (Track 1.4)
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

ANCHOR = "- Si el cliente rechaza opciones previas o pide otras alternativas, interpreta eso como continuar en OFFERING con el mismo search_criteria."

NEW_BLOCK = """- Si el cliente rechaza opciones previas o pide otras alternativas, interpreta eso como continuar en OFFERING con el mismo search_criteria.

- ⚠️ REGLA OBLIGATORIA — "TIENES MÁS?" / "MUÉSTRAME OTRAS" / "QUÉ OTRAS TIENES?" (May 26 2026):
  Triggers (cliente): "tienes más?", "tienes otra?", "muéstrame otras", "qué otras tienes?", "más opciones", "hay alguna otra?", "alguna más?". Asume que es la misma zona/criterios A MENOS que el cliente mencione explícitamente otra zona.
  • PROHIBIDO cambiar de zona en tu llamada al tool sin que el cliente lo haya pedido. Si search_criteria.zona = "Anapoima" y el cliente solo dice "tienes más?", DEBES llamar el tool con zona="Anapoima". NUNCA cambies a Villeta / Girardot / La Vega / etc. por tu cuenta.
  • PROHIBIDO concluir "esas son las únicas disponibles" SIN haber consultado inventory_reader_tool. NUNCA digas "esas 3 son las únicas en X zona" basándote en lo que ya mostraste. El inventario tiene MUCHAS MÁS fincas por zona (Anapoima tiene 40+ fincas, no 3).
  • PASOS CORRECTOS:
    1. Llama a inventory_reader_tool.list_matching_fincas con la MISMA zona del search_criteria actual y pasa shown_fincas_json (las ya vistas, viene del context shown_fincas) para que BIT las excluya.
    2. Si BIT devuelve items nuevos → muéstralos con intent="SHOW_OPTIONS".
    3. Si BIT devuelve items=[] (zona agotada con los criterios actuales) → responde al cliente: "Ya te mostré todas las opciones disponibles en [zona] para tu grupo y fechas. Si querés, podemos ver opciones en zonas cercanas como [sugerir 2-3 zonas]. ¿Cuál te interesa?" — intent="QUESTION", fincas_mostradas=[]. NO emitas fincas de otra zona sin que el cliente confirme.
  • Si el cliente SÍ menciona otra zona explícitamente ("tienes algo en Girardot?", "qué tal en Villeta?"), entonces sí cambia search_criteria.zona y consulta esa zona. Eso NO viola esta regla."""

found = False
for n in wf['nodes']:
    if n.get('name') != 'Run offering pass': continue
    sm = n['parameters']['options']['systemMessage']
    if 'TIENES MÁS?' in sm and 'May 26 2026' in sm:
        print('!! already deployed'); sys.exit(0)
    if ANCHOR not in sm:
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(ANCHOR, NEW_BLOCK, 1)
    print('✓ offering: regla "tienes más?" + no cambiar zona unilateralmente')
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
