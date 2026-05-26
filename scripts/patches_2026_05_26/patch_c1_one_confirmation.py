#!/usr/bin/env python3
"""
Fix de bug encontrado en conversación real (Chatwoot conv 1, 26-may):
- Turn 4: bot emite REQUEST_CONFIRMATION_DATA + search_criteria_update={personas:16}, pide confirmación
- Turn 5: cliente dice "Si dale"
- Turn 6: bot DEBE emitir DOCUMENT_READY pero emite REQUEST_CONFIRMATION_DATA otra vez con
  texto "regálame un momento mientras el sistema actualiza"

Causa: el LLM cree que necesita esperar un "quote rehidratado" antes de emitir
DOCUMENT_READY. Pero createReservationDocumentItem recomputa el quote on-the-fly
con el search_criteria actualizado — el LLM no necesita esperar.

Fix: clarificar en el prompt del confirming_reservation_agent que:
1. UNA confirmación es suficiente (no dos)
2. DOCUMENT_READY automáticamente recomputa el quote
3. NUNCA decir "regálame un momento" / "ya mismo te genero" — TOMAR ACCIÓN AHORA
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# Find current C.1 rule (was added earlier) and reinforce step 3
OLD_RULE = """- REGLA CRÍTICA — drift de personas / noches / fechas (May 25 2026):
  Si en cualquiera de los ÚLTIMOS 3 TURNOS del cliente hubo una mención que cambie #personas, #noches o las fechas (frases tipo \"ahora somos 19\", \"van 3 niños más\", \"mejor 5 noches\", \"cambiemos al 22 de diciembre\"), ANTES de emitir DOCUMENT_READY tienes que:
  1. Reconocer el cambio explícitamente en tu respuesta. Ejemplo: \"Listo Luis, entonces serían 19 personas del 28 dic al 3 ene (5 noches)\".
  2. En el mismo turno, devolver intent=\"REQUEST_CONFIRMATION_DATA\" (NO DOCUMENT_READY todavía) con `search_criteria_update` poblado con los valores nuevos. El sistema re-corre el inventario y rehidrata el `quote` antes del próximo turno.
  3. Cuando el cliente confirme (\"sí\", \"correcto\", \"dale\"), entonces sí emite DOCUMENT_READY con los datos actualizados. El PDF saldrá con los valores correctos porque el sistema ya recalculó.
  NUNCA emitas DOCUMENT_READY en el mismo turno donde el cliente cambió personas/noches/fechas — el PDF saldría con los valores viejos. Esto es la causa #1 de PDFs incorrectos en producción.
  Si emites DOCUMENT_READY igual, el sistema tiene un safety-net determinístico que detecta el drift, BLOQUEA tu PDF y devuelve un mensaje pidiendo confirmación al cliente. Para evitar ese bloqueo (que se siente robótico), TÚ debes manejar el flujo bien desde el LLM."""

NEW_RULE = """- REGLA CRÍTICA — drift de personas / noches / fechas (May 25 2026, ajustada May 26):
  Si en cualquiera de los ÚLTIMOS 3 TURNOS del cliente hubo una mención que cambie #personas, #noches o las fechas (frases tipo \"ahora somos 19\", \"van 3 niños más\", \"mejor 5 noches\", \"cambiemos al 22 de diciembre\"), ANTES de emitir DOCUMENT_READY tienes que:
  1. Reconocer el cambio explícitamente en tu respuesta. Ejemplo: \"Listo Luis, entonces serían 19 personas del 28 dic al 3 ene (5 noches)\".
  2. En el mismo turno, devolver intent=\"REQUEST_CONFIRMATION_DATA\" (NO DOCUMENT_READY todavía) con `search_criteria_update` poblado con los valores nuevos. Pregunta UNA SOLA VEZ: \"Me confirmas?\".
  3. Cuando el cliente confirme en el siguiente turno (\"sí\", \"correcto\", \"dale\", \"perfecto\", \"ok\"), en TU PRÓXIMO TURNO (sin pedir más confirmaciones) emite DIRECTAMENTE intent=\"DOCUMENT_READY\".
     - El PDF se regenera automáticamente con los valores actualizados de `search_criteria` (el sistema recomputa el quote on-the-fly con `criteria.personas` actualizado — NO necesitas esperar un \"quote rehidratado\").
     - PROHIBIDO decir \"regálame un momento mientras el sistema actualiza\" / \"ya mismo te genero\" / \"un momento que recalculo\". Esas frases procrastinan y dejan al cliente esperando. SÉ DIRECTO: emite DOCUMENT_READY y el sistema dispara el PDF.
     - Tu `respuesta` para este turno DOC_READY debe ser similar a: \"Listo [nombre], te comparto la confirmación actualizada con [N] personas. Por favor me autorizas con un OK\". El PDF se adjunta automáticamente.
  4. UNA confirmación basta. NO pidas dos confirmaciones seguidas. Si el cliente ya dijo \"si dale\" o equivalente, AVANZA — no preguntes \"me confirmas otra vez?\".
  5. NUNCA emitas DOCUMENT_READY en el mismo turno donde el cliente acaba de cambiar personas/noches/fechas — primero confirma (paso 1+2). Pero después de UNA confirmación del cliente, NO esperes más.
  6. Si emites DOCUMENT_READY antes de confirmar, el sistema tiene un safety-net determinístico que detecta drift, BLOQUEA tu PDF y devuelve un mensaje pidiendo confirmación. Para evitar ese bloqueo, manejá el flujo: cambio detectado → REQUEST_CONFIRMATION → confirmación cliente → DOCUMENT_READY."""

for n in wf['nodes']:
    if n['name'] != 'Run confirming_reservation pass': continue
    sm = n['parameters']['options']['systemMessage']
    if OLD_RULE not in sm:
        if 'ajustada May 26' in sm:
            print('!! already updated')
            sys.exit(0)
        print('!! old rule not found verbatim — partial may have updated'); sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(OLD_RULE, NEW_RULE, 1)
    print('✓ confirming_reservation_agent: drift rule reinforced (one confirmation only)')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
