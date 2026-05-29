#!/usr/bin/env python3
"""Fix offering prompt: cuando piden cotización completa, NO re-emitir card.

Síntoma: cliente pregunta "cuánto me quedaría el total de esta?" → LLM
emite intent=SHOW_OPTIONS con fincas_mostradas=[finca] → engine renderiza
card+foto otra vez SIN incluir el breakdown del total. Cliente percibe spam
sin la info que pidió.

Causa: la regla del prompt decía "RE-EMITE la finca via fincas_mostradas y
deja que el engine arme la ficha completa". El engine NO arma breakdown;
solo arma card básica con "desde $X/noche". Mismatch entre asunción del
prompt y comportamiento real del engine.

Fix: para preguntas de cotización completa, el LLM debe poner el desglose
EN TEXTO en `respuesta` usando los campos del quote, e intent=QUESTION
(NO SHOW_OPTIONS). No emitir fincas_mostradas — evita re-render de cards.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = "  • Si el cliente pide la cotización COMPLETA con desglose, RE-EMITE la finca via `fincas_mostradas: [\"FINCA_ID\"]` y deja que el engine arme la ficha completa. Tu outbound_text es preámbulo corto."

NEW = """  • Si el cliente pide la cotización COMPLETA con desglose ("cuánto sale en total?", "qué precio queda con todo?", "total para esas fechas?"), RESPONDE EN TEXTO en `respuesta`. NO emitas `fincas_mostradas` — eso re-renderiza la card+foto sin desglose y el cliente lo percibe como spam.
    - intent="QUESTION", next_stage="OFFERING".
    - fincas_mostradas=[] (vacío).
    - `respuesta` = breakdown EN TEXTO usando el `quote` del item correspondiente. Estructura sugerida:
        "FINCA_ID para X noches y N personas:
         • Tarifa por noche: $A (Y noches estándar) [+ $B (Z noches festivo/temporada si aplica)]
         • Subtotal noches: $subtotal_noches
         • Depósito (100% reembolsable): $deposito_seguridad
         • Limpieza final: $limpieza_final
         [• Servicio empleada (W días): $servicio_empleada_total — solo si > 0]

         Total: $total

         Te interesa avanzar con esta o querés ver otra opción?"
    - Usa `quote.human_summary` si ya viene armado, sino arma con los campos por componente.
    - NUNCA mostrar precios sin contexto (decir solo "$6.000.000" es ambiguo — siempre acompañar con "para X noches, N personas, depósito 100% reembolsable")."""

found = False
for n in wf['nodes']:
    if n.get('name') != 'Run offering pass': continue
    sm = n['parameters']['options']['systemMessage']
    if 'NO emitas `fincas_mostradas`' in sm:
        print('!! already deployed'); sys.exit(0)
    if OLD not in sm:
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(OLD, NEW, 1)
    print('✓ offering prompt: cotización completa ahora se responde EN TEXTO sin re-emitir card')
    found = True
    break

if not found:
    print('!! Run offering pass not found'); sys.exit(3)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
