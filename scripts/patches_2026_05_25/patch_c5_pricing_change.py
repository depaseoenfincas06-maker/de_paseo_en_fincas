#!/usr/bin/env python3
"""
C.5 — Pricing post-CHANGE_FINCA / cambio de fechas (caso 1.9 del feedback).

Bug: cuando el cliente cambia de finca o fechas, el LLM inicialmente cita
tarifa de temporada baja (probablemente porque toma precio_base_noche del
item viejo en memoria, o porque el quote del item rehidratado todavía no
llegó). Cliente luego pregunta "esas son las tarifas reales?" y bot rectifica.

Fix: reforzar las 4 prompts (offering, verifying, confirming, qa) con
una regla específica post-CHANGE que dice:
- Después de CHANGE_FINCA o cambio fechas/personas, NUNCA cites precio basado
  en quote anterior del contexto.
- La quote válida es la del PRÓXIMO inventory_reader_tool response.
- Si todavía no la tenés, NO inventes — decí "dame un momento que recalculo"
  y emití intent=QUESTION con search_criteria_update.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# Anchor: end of REGLA DE PRECIOS block, just before "- Si hablas de precio, aclara siempre"
ANCHOR = "- Si hablas de precio, aclara siempre para cuántas personas aplica la tarifa y separa la capacidad máxima de la finca."

REINFORCEMENT = (
"- ⚡ REGLA POST-CAMBIO (CHANGE_FINCA / cambio fechas / cambio personas) — CASO #1.9:\n"
"  Si en ESTE turno o en los 2 turnos anteriores el cliente cambió de FINCA, FECHAS o número de PERSONAS:\n"
"  • NO cites tarifa basada en una `quote` anterior — esa quote es STALE (corresponde a la finca/fechas viejas).\n"
"  • La quote VÁLIDA es la del PRÓXIMO response de inventory_reader_tool, después del cambio.\n"
"  • NUNCA mires precio_base_noche / precio_festivo / precio_temporada_alta del item viejo en contexto para responder.\n"
"  • Si en ESTE turno emites el cambio (CHANGE_FINCA o search_criteria_update), tu respuesta NO debe incluir tarifa.\n"
"    Decí algo como: \"Dame un momento que recalculo con [finca/fechas/personas] nuevas y te paso el detalle\".\n"
"  • SOLO podés citar tarifa cuando el siguiente turno traiga una quote rehidratada con la nueva configuración.\n"
"  • Si el cliente pregunta precio EN el mismo turno del cambio (\"cámbiame las fechas, cuánto sale ahora?\"), respondé el reconocimiento del cambio + el recálculo pending, NO inventes.\n"
"  Esta regla previene el caso reportado donde el bot inicialmente dio tarifa de temporada baja en fechas de fin de año y tuvo que rectificar."
)

NEW_BLOCK = REINFORCEMENT + "\n" + ANCHOR

for agent_name in ['Run offering pass', 'Run qa pass', 'Run verifying_availability pass', 'Run confirming_reservation pass']:
    found = False
    for n in wf['nodes']:
        if n['name'] != agent_name: continue
        sm = n['parameters']['options']['systemMessage']
        if ANCHOR not in sm:
            print(f'!! {agent_name}: anchor not found'); sys.exit(2)
        if 'REGLA POST-CAMBIO (CHANGE_FINCA' in sm:
            print(f'!! {agent_name}: already has post-cambio rule')
        else:
            n['parameters']['options']['systemMessage'] = sm.replace(ANCHOR, NEW_BLOCK, 1)
            print(f'✓ {agent_name}: post-cambio pricing rule added')
        found = True
        break
    if not found:
        print(f'!! {agent_name} not found'); sys.exit(2)

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
