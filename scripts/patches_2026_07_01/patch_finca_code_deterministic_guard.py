#!/usr/bin/env python3
"""Fix determinístico finca-por-código (Jul 1 2026) — completa el root-cause.

Bug observado: cuando el cliente nombra una finca por código (ej. "Sopetrán 20"),
el offering LLM a veces:
  a) Cumple la regla: llama get_finca_details, emite respuesta específica
     ("SOPETRAN_#20 no disponible") — funciona ✓
  b) NO cumple: se queda en list_matching_fincas default, retorna 2-3 fincas
     genéricas que NO incluyen SOPETRAN_#20, y el `respuesta` no la menciona
     → el cliente NUNCA se entera de que su finca específica no existe.

El caso (b) es no-determinístico (variabilidad del LLM). Peor: cuando el LLM
se atasca en la tool call sin producir output final (visto en exec 14866),
el sistema envía VACÍO al cliente — el bot desaparece.

Fix (en Finalize offering outbound): regex determinístico sobre el mensaje
del cliente para detectar código de finca (`ZONA #NN`). Si el código está
presente Y NO aparece en fincas_mostradas ni en respuesta original, forzamos
un mensaje "La finca X no aparece disponible en este momento" como primer
outbound. Zero flakiness — corre siempre después del LLM.

También: si outbound_sequence quedó vacío (LLM atascado en tool call), y
detectamos código de finca, aún así podemos entregar el mensaje de "no
disponible" — evita que el cliente se quede sin respuesta.
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

// Layer 4-guardrail (Jul 1 2026): fix determinístico para cuando el LLM se
// olvida de mencionar la finca específica que el cliente nombró por código.
// Detecta el código en el mensaje del cliente y verifica que aparezca en
// fincas_mostradas o en respuesta. Si no aparece, inyecta acknowledgement
// honesto — cubre tanto (a) LLM emitió options sin mencionar la finca, como
// (b) LLM se atascó en tool call sin generar output final.
const _stripAccents = (s) => String(s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
let clientLastMsg = '';
try {
  clientLastMsg = String($('Merge Sets1').first().json['last-message'] || '');
} catch (e) { clientLastMsg = ''; }
const FINCA_CODE_RE = /\\b([A-ZÑ_]{3,})[\\s_#-]{0,3}(\\d{1,3})\\b/i;
const codeMatch = clientLastMsg.match(FINCA_CODE_RE);
if (codeMatch) {
  const zone = _stripAccents(codeMatch[1]).toUpperCase().replace(/_$/, '').replace(/\\s+/g, '_');
  const num = String(parseInt(codeMatch[2], 10)).padStart(2, '0');
  const targetFincaId = `${zone}_#${num}`;
  const targetKey = (zone + num).replace(/[^A-Z0-9]/g, '');

  const mostradas = base.tool_output_parsed?.fincas_mostradas;
  const shownIds = (Array.isArray(mostradas) ? mostradas : [])
    .map((f) => _stripAccents(String(f?.finca_id || f?.codigo_original || '')).toUpperCase())
    .filter(Boolean);
  const isNamedShownAsCard = shownIds.some((id) => id.replace(/[^A-Z0-9]/g, '') === targetKey);

  const respuestaMentionsIt =
    originalRespuesta &&
    new RegExp(`${zone}\\\\s*[#_\\\\s-]*0*${parseInt(num, 10)}\\\\b`, 'i').test(_stripAccents(originalRespuesta));

  if (!isNamedShownAsCard && !respuestaMentionsIt) {
    // Cliente nombró finca por código pero no aparece ni en cards ni en
    // respuesta. Sobrescribimos context_message determinísticamente.
    contextMessage = `La finca ${targetFincaId} no aparece disponible en este momento en nuestra plataforma. Te comparto las alternativas que sí están disponibles para tus fechas:`;
  }
}"""

applied = False
for n in wf['nodes']:
    if n['name'] != 'Finalize offering outbound': continue
    code = n['parameters']['jsCode']
    if 'FINCA_CODE_RE' in code:
        print('already deployed'); sys.exit(0)
    if OLD not in code:
        print('!! anchor missing'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    applied = True
    print('✓ Finalize offering outbound: guardrail finca-por-código añadido')
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
