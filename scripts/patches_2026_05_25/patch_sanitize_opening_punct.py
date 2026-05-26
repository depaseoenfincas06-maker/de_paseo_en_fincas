#!/usr/bin/env python3
"""
Red de seguridad determinística: en CodeJS1, antes de emitir el outbound,
strip-eamos los signos de apertura '¿' y '¡' del texto que va a Chatwoot/
WhatsApp. Esto cubre los casos en que el LLM se salta la regla del prompt
("REGLA UNIVERSAL E INVIOLABLE") por presión semántica de otra parte del
system message.

Aplicamos a:
  - cada item de outboundSequence (campos `content` y `text`)
  - primaryOutboundMessage (usado en final_whatsapp_text y outbound_message
    del return)

Como outbound_sequence_json se computa DESPUÉS del strip (JSON.stringify
sobre la secuencia ya mutada en-place), la serialización también queda
limpia.

Estrategia del strip:
  - .replace(/[¿¡] */g, '')   strip el símbolo + el espacio inmediatamente
                              después si lo hay (evita "¿Qué tal?" → " Qué tal?")
  - .replace(/  +/g, ' ')     colapsa cualquier double-space accidental
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']

    # Insert the sanitizer BEFORE the final return statement.
    # The marker is the line "return [" right at the end of the file.
    # We anchor on the existing `const primaryOutboundMessage =` block to find
    # the right place — sanitize AFTER outboundSequence + primaryOutboundMessage
    # are computed, BEFORE they're used in the return.
    MARKER_BEFORE = (
"return [\n"
"  {\n"
"    json: {\n"
"      parsed,\n"
"      tool_output_parsed: toolOutputParsed,\n"
    )
    INSERT = (
"// === Hard guard: strip Spanish opening punctuation (¿ / ¡) ===\n"
"// Última línea de defensa por debajo de la regla del system prompt.\n"
"// Mutamos outboundSequence en-place (afecta también a outbound_sequence_json\n"
"// que se serializa después). primaryOutboundMessage se re-bind a la versión\n"
"// limpia y se usa para final_whatsapp_text + outbound_message del return.\n"
"function _stripOpeningPunctuation(s) {\n"
"  if (s == null) return s;\n"
"  return String(s)\n"
"    .replace(/[¿¡] */g, '')\n"
"    .replace(/  +/g, ' ');\n"
"}\n"
"for (var _sIdx = 0; _sIdx < outboundSequence.length; _sIdx++) {\n"
"  var _part = outboundSequence[_sIdx];\n"
"  if (_part && typeof _part === 'object') {\n"
"    if (typeof _part.content === 'string') _part.content = _stripOpeningPunctuation(_part.content);\n"
"    if (typeof _part.text === 'string') _part.text = _stripOpeningPunctuation(_part.text);\n"
"  }\n"
"}\n"
"var _sanitizedPrimaryOutboundMessage = _stripOpeningPunctuation(primaryOutboundMessage);\n"
"\n"
"return [\n"
"  {\n"
"    json: {\n"
"      parsed,\n"
"      tool_output_parsed: toolOutputParsed,\n"
    )

    if MARKER_BEFORE not in code:
        print('!! return marker not found'); sys.exit(2)
    if '_stripOpeningPunctuation' in code:
        print('!! already patched (idempotent skip)'); sys.exit(0)
    code = code.replace(MARKER_BEFORE, INSERT, 1)

    # Now swap the two references in the return statement that used
    # primaryOutboundMessage for the user-facing fields.
    SWAP_OLD = (
"      final_whatsapp_text: primaryOutboundMessage,\n"
"      outbound_message: primaryOutboundMessage,\n"
    )
    SWAP_NEW = (
"      final_whatsapp_text: _sanitizedPrimaryOutboundMessage,\n"
"      outbound_message: _sanitizedPrimaryOutboundMessage,\n"
    )
    if SWAP_OLD not in code:
        print('!! return-fields marker not found'); sys.exit(2)
    code = code.replace(SWAP_OLD, SWAP_NEW, 1)

    n['parameters']['jsCode'] = code
    print('✓ CodeJS1: sanitizer ¿/¡ inyectado + return bindings actualizados')
    break
else:
    print('!! Code in JavaScript1 not found'); sys.exit(2)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload = {
    'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED},
}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL,
                     '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload), capture_output=True, text=True, check=True)
out = json.loads(r2.stdout)
print(f'PUT ok. active={out.get("active")}')
if not out.get('active'):
    subprocess.run(['curl','-sk','-X','POST', URL+'/activate', '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True)
