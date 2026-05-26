#!/usr/bin/env python3
"""
Track C.1 — Companion del drift detection determinístico.

Agrega regla de prompt en confirming_reservation_agent para que ANTES de
emitir DOCUMENT_READY, si el cliente mencionó un cambio en personas /
noches / fechas en los últimos turnos, primero:
1. Reconozca verbalmente el cambio ("Listo, entonces serían N personas").
2. Re-llame inventory_reader_tool con search_criteria_update.
3. Solo después emita DOCUMENT_READY con el quote recalculado.

Esta es la capa primaria (LLM understands the flow). El drift detection
en CodeJS1 es la safety net si el LLM olvida.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = "- NUNCA devuelvas DOCUMENT_READY si falta un dato. NUNCA devuelvas RESERVATION_APPROVED antes de DOCUMENT_READY."
NEW = (
"- NUNCA devuelvas DOCUMENT_READY si falta un dato. NUNCA devuelvas RESERVATION_APPROVED antes de DOCUMENT_READY.\n"
"- REGLA CRÍTICA — drift de personas / noches / fechas (May 25 2026):\n"
"  Si en cualquiera de los ÚLTIMOS 3 TURNOS del cliente hubo una mención que cambie #personas, #noches o las fechas (frases tipo \"ahora somos 19\", \"van 3 niños más\", \"mejor 5 noches\", \"cambiemos al 22 de diciembre\"), ANTES de emitir DOCUMENT_READY tienes que:\n"
"  1. Reconocer el cambio explícitamente en tu respuesta. Ejemplo: \"Listo Luis, entonces serían 19 personas del 28 dic al 3 ene (5 noches)\".\n"
"  2. En el mismo turno, devolver intent=\"REQUEST_CONFIRMATION_DATA\" (NO DOCUMENT_READY todavía) con `search_criteria_update` poblado con los valores nuevos. El sistema re-corre el inventario y rehidrata el `quote` antes del próximo turno.\n"
"  3. Cuando el cliente confirme (\"sí\", \"correcto\", \"dale\"), entonces sí emite DOCUMENT_READY con los datos actualizados. El PDF saldrá con los valores correctos porque el sistema ya recalculó.\n"
"  NUNCA emitas DOCUMENT_READY en el mismo turno donde el cliente cambió personas/noches/fechas — el PDF saldría con los valores viejos. Esto es la causa #1 de PDFs incorrectos en producción.\n"
"  Si emites DOCUMENT_READY igual, el sistema tiene un safety-net determinístico que detecta el drift, BLOQUEA tu PDF y devuelve un mensaje pidiendo confirmación al cliente. Para evitar ese bloqueo (que se siente robótico), TÚ debes manejar el flujo bien desde el LLM."
)

found = False
for n in wf['nodes']:
    if n['name'] != 'Run confirming_reservation pass': continue
    sm = n['parameters']['options']['systemMessage']
    if OLD not in sm:
        print('!! anchor for DOCUMENT_READY rule not found verbatim'); sys.exit(2)
    if 'drift de personas / noches / fechas' in sm:
        print('!! drift rule already present — skipping')
    else:
        n['parameters']['options']['systemMessage'] = sm.replace(OLD, NEW, 1)
        print('✓ Run confirming_reservation pass: drift-of-personas-noches-fechas rule added')
    found = True
    break

if not found:
    print('!! Run confirming_reservation pass not found'); sys.exit(2)

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
if not out.get('active'):
    subprocess.run(['curl','-sk','-X','POST', URL+'/activate', '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True)
