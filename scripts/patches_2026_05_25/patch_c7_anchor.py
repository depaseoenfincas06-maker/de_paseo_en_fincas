#!/usr/bin/env python3
"""
C.7 — Anchor finca anterior (caso 1.7 sub-bug).

Bug: cliente en CONFIRMING con selected_finca=SANTA_FE_9. Pregunta "y la
SAN_JERÓNIMO_02, cómo es?". Bot responde con datos de Santa Fe 9 (queda
anclado).

Fix: regla en offering, qa, verifying, confirming prompts:
- Si el mensaje del cliente menciona EXPLÍCITAMENTE un código de finca
  (ej. "ANAPOIMA_#10", "Anapoima 10", "SAN_JERÓNIMO 02"), responde sobre
  ESA finca, NO sobre selected_finca.
- NO cambies selected_finca silenciosamente. Solo cambiar si el cliente
  dice explícitamente "elijo X" / "me quedo con X".
- Después de responder sobre la finca mencionada, ofrecé cambiar: "¿te
  interesa cambiarte a [X] o seguimos con [selected]?"
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# Use REGLA POST-CAMBIO as anchor (added in C.5) — insert NEW rule before it
ANCHOR = "- ⚡ REGLA POST-CAMBIO (CHANGE_FINCA / cambio fechas / cambio personas) — CASO #1.9:"

NEW_RULE = (
"- 🎯 REGLA — FINCA MENCIONADA POR CÓDIGO en el mensaje del cliente (caso 1.7 sub-bug):\n"
"  Si el mensaje ACTUAL del cliente menciona EXPLÍCITAMENTE un código de finca distinto al `selected_finca` del contexto:\n"
"    Frases trigger: \"la ANAPOIMA_#10\" / \"Anapoima 10\" / \"SAN_JERÓNIMO 02\" / \"y la del primer mensaje\" / \"la que tenía wifi\" cuando es claramente otra.\n"
"  • RESPONDE sobre la finca MENCIONADA, no sobre `selected_finca`. Usa los datos del item desde `last_inventory_items.items[]`.\n"
"  • NO cambies `selected_finca` automáticamente. Mantenelo igual.\n"
"  • Después de responder, ofrecé clarificación: \"¿Te interesa cambiarte a [X] o seguimos con [selected_finca]?\".\n"
"  • Si el cliente entonces dice \"sí, cambiémonos a X\" / \"prefiero X\" / \"me quedo con X\", recién ahí emites CHANGE_FINCA o actualizas selected_finca según el flujo.\n"
"  Esta regla previene el caso reportado donde el bot seguía hablando de Santa Fe 9 aunque el cliente preguntaba por San Jerónimo 02 y 06.\n"
+ ANCHOR
)

count = 0
for agent_name in ['Run offering pass','Run qa pass','Run verifying_availability pass','Run confirming_reservation pass']:
    for n in wf['nodes']:
        if n['name'] != agent_name: continue
        sm = n['parameters']['options']['systemMessage']
        if ANCHOR not in sm:
            print(f'!! {agent_name}: anchor not found')
            break
        if 'FINCA MENCIONADA POR CÓDIGO' in sm:
            print(f'!! {agent_name}: already deployed')
            break
        n['parameters']['options']['systemMessage'] = sm.replace(ANCHOR, NEW_RULE, 1)
        print(f'✓ {agent_name}: anchor finca rule added')
        count += 1
        break

if count == 0:
    print('!! no nodes updated'); sys.exit(2)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
