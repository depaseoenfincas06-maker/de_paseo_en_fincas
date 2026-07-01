#!/usr/bin/env python3
"""Layer 5 fix (Jul 1 2026) — completa el root-cause de SOPETRAN_#20.

Bug: cuando el offering agent responde algo específico como "La finca X
actualmente no está disponible..." el downstream lo DESCARTA:

1. Code in JavaScript1 (SHOW_OPTIONS block líneas 1470-1499) NO agrega
   `respuesta` al outbound_sequence — solo cards + media + closing.
2. Run offering context pass (mini-LLM) genera un context_message genérico
   ("Encontré fincas en Antioquia con la gran capacidad que necesitas...")
   que NO conoce la respuesta específica del offering pass.
3. Finalize offering outbound prependa ese context_message como primer msg.

Resultado: 40-60% de las veces el cliente ve la respuesta correcta (cuando
el context pass LLM se apoya en offering_result.respuesta), 40-60% ve el
genérico. Es NO-DETERMINÍSTICO.

Fix: en Finalize offering outbound, detectar si `respuesta` del offering pass
contiene marcadores específicos (regex) que NO deben perderse. Cuando aplique,
se usa `respuesta` como primer mensaje (bypassing el context_message).
Determinístico, no depende del LLM del context pass.

Deploy 2026-07-01.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
BASE = 'https://n8n.depaseoenfincas.raaamp.co'
WID = '2NV08zRFKENUsQVC'
URL = f'{BASE}/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """let contextMessage = extractContextMessage(contextSource);
// Sanitize opening punctuation (¿/¡) — el offering context pass corre
// después de CodeJS1's sanitizer, así que aplicamos el mismo strip acá.
contextMessage = String(contextMessage || '').replace(/[¿¡] */g, '').replace(/  +/g, ' ');
const shouldInject =
  base.tool_chosen === 'offering_agent' &&
  base.tool_output_parsed?.intent === 'SHOW_OPTIONS' &&
  Array.isArray(base.tool_output_parsed?.fincas_mostradas) &&
  base.tool_output_parsed.fincas_mostradas.length > 0 &&
  Boolean(contextMessage) &&
  outboundSequence.length > 0;

if (!shouldInject) {
  return [
    {
      json: {
        ...base,
        offering_context_message: null,
      },
    },
  ];
}"""

NEW = """let contextMessage = extractContextMessage(contextSource);
// Sanitize opening punctuation (¿/¡) — el offering context pass corre
// después de CodeJS1's sanitizer, así que aplicamos el mismo strip acá.
contextMessage = String(contextMessage || '').replace(/[¿¡] */g, '').replace(/  +/g, ' ');

// Layer 5 fix (Jul 1 2026, bug SOPETRAN_#20): si el offering LLM emitió una
// respuesta específica sobre una finca no disponible / no encontrada /
// deshabilitada, esa respuesta DEBE preservarse como primer mensaje. El
// context_message del mini-LLM no siempre la respeta (no-determinístico), así
// que forzamos determinísticamente: si el marcador aparece, usamos respuesta.
const originalRespuesta = String(base.tool_output_parsed?.respuesta || '').trim();
const SPECIFIC_UNAVAILABLE_TRIGGERS = /(no está disponible|no est\\u00e1 disponible|no encuentro (una )?finca|no est[aá] activ|no la manejamos|no la tenemos registrada|actualmente no est\\u00e1|no aparece en (el|nuestro) (sistema|inventario))/i;
const respuestaHasSpecificTrigger =
  originalRespuesta && SPECIFIC_UNAVAILABLE_TRIGGERS.test(originalRespuesta);
if (respuestaHasSpecificTrigger) {
  contextMessage = originalRespuesta;
}

const shouldInject =
  base.tool_chosen === 'offering_agent' &&
  base.tool_output_parsed?.intent === 'SHOW_OPTIONS' &&
  Array.isArray(base.tool_output_parsed?.fincas_mostradas) &&
  base.tool_output_parsed.fincas_mostradas.length > 0 &&
  Boolean(contextMessage) &&
  outboundSequence.length > 0;

if (!shouldInject) {
  return [
    {
      json: {
        ...base,
        offering_context_message: null,
      },
    },
  ];
}"""

applied = False
for n in wf['nodes']:
    if n['name'] != 'Finalize offering outbound': continue
    code = n['parameters']['jsCode']
    if 'SPECIFIC_UNAVAILABLE_TRIGGERS' in code:
        print('already deployed'); sys.exit(0)
    if OLD not in code:
        print('!! anchor missing'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    applied = True
    print('✓ Finalize offering outbound: respuesta preservada cuando marcadores específicos')
    break
if not applied: sys.exit(3)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {
    'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED},
}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
