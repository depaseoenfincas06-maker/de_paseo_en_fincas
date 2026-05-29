#!/usr/bin/env python3
"""Punto 1 (May 28 2026): el bot a veces menciona @depaseoenfincascol sin el
link completo (confirmado en conv 573112407139 — mensaje de confianza). La
regla del prompt solo dispara cuando el cliente pregunta explícitamente por IG.

Fix determinístico en Code in JavaScript1: _ensureInstagramLink(s) añade el
link cuando el texto menciona el handle sin la URL. Corre en el mismo loop que
_stripOpeningPunctuation (ANTES del whitelist sanitizer, que mantiene la URL de
IG porque está whitelisteada). También se aplica a primaryOutboundMessage.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """function _stripOpeningPunctuation(s) {
  if (s == null) return s;
  return String(s)
    .replace(/[¿¡] */g, '')
    .replace(/  +/g, ' ');
}
for (var _sIdx = 0; _sIdx < outboundSequence.length; _sIdx++) {
  var _part = outboundSequence[_sIdx];
  if (_part && typeof _part === 'object') {
    if (typeof _part.content === 'string') _part.content = _stripOpeningPunctuation(_part.content);
    if (typeof _part.text === 'string') _part.text = _stripOpeningPunctuation(_part.text);
  }
}"""

NEW = """function _stripOpeningPunctuation(s) {
  if (s == null) return s;
  return String(s)
    .replace(/[¿¡] */g, '')
    .replace(/  +/g, ' ');
}
// === Instagram handle → link normalizer (May 28 2026) ===
// Si un mensaje menciona @depaseoenfincascol sin el link completo, se lo añade.
// Determinístico: cubre TODOS los agentes/contextos, no depende del prompt.
// La URL de IG está whitelisteada en _sanitizeMediaUrls, así que sobrevive.
function _ensureInstagramLink(s) {
  if (s == null) return s;
  var str = String(s);
  if (/@depaseoenfincascol/i.test(str) && !/instagram\\.com\\/depaseoenfincascol/i.test(str)) {
    str = str.replace(/@depaseoenfincascol/i, '@depaseoenfincascol (https://www.instagram.com/depaseoenfincascol)');
  }
  return str;
}
for (var _sIdx = 0; _sIdx < outboundSequence.length; _sIdx++) {
  var _part = outboundSequence[_sIdx];
  if (_part && typeof _part === 'object') {
    if (typeof _part.content === 'string') _part.content = _ensureInstagramLink(_stripOpeningPunctuation(_part.content));
    if (typeof _part.text === 'string') _part.text = _ensureInstagramLink(_stripOpeningPunctuation(_part.text));
  }
}"""

OLD_PRIMARY = "var _sanitizedPrimaryOutboundMessage = _stripOpeningPunctuation(primaryOutboundMessage);"
NEW_PRIMARY = "var _sanitizedPrimaryOutboundMessage = _ensureInstagramLink(_stripOpeningPunctuation(primaryOutboundMessage));"

found = False
for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    if '_ensureInstagramLink' in code:
        print('!! already deployed'); sys.exit(0)
    if OLD not in code:
        print('!! anchor (strip loop) not found'); sys.exit(2)
    code = code.replace(OLD, NEW, 1)
    if OLD_PRIMARY not in code:
        print('!! anchor (primary) not found'); sys.exit(3)
    code = code.replace(OLD_PRIMARY, NEW_PRIMARY, 1)
    n['parameters']['jsCode'] = code
    print('✓ CodeJS1: _ensureInstagramLink aplicado en loop + primary message')
    found = True
    break

if not found: sys.exit(4)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
