#!/usr/bin/env python3
"""
C.6 — Dedup fincas duplicadas en buildPropertySequence (caso 1.11).

Bug: LLM ocasionalmente emite la misma finca dos veces en
`fincas_mostradas`. El loop arma card + media por cada repetición → cliente
ve 2 cards con misma descripción Y las fotos de la siguiente finca quedan
pegadas a la card duplicada (fotos trocadas).

Fix: agregar paso de dedup determinístico justo después de la rehydration.
- Comparar por finca_id || codigo_original (uppercase + trim).
- Mantener la PRIMERA aparición, descartar las posteriores.
- console.error con finca_id descartado para diagnóstico futuro en exec logs.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """  const fincasMostradas = (Array.isArray(toolOutputParsed?.fincas_mostradas)
    ? toolOutputParsed.fincas_mostradas.filter((item) => item && typeof item === 'object')
    : []
  ).map(function(it) { return _rehydrateFinca(it, _bitIndex); });"""

NEW = """  const fincasMostradas = (function() {
    var arr = Array.isArray(toolOutputParsed?.fincas_mostradas)
      ? toolOutputParsed.fincas_mostradas.filter((item) => item && typeof item === 'object')
      : [];
    var rehydrated = arr.map(function(it) { return _rehydrateFinca(it, _bitIndex); });
    // === DEDUP (T-C.6 — May 25 2026) ===
    // LLM a veces emite misma finca 2 veces → fotos trocadas (caso 1.11).
    // Mantener primera aparición, descartar duplicates con log.
    var _seen = new Set();
    return rehydrated.filter(function(f) {
      var id = String((f && (f.finca_id || f.codigo_original)) || '').trim().toUpperCase();
      if (!id) return true;
      if (_seen.has(id)) {
        console.error('[buildPropertySequence] DEDUP: removed duplicate finca_id=' + id);
        return false;
      }
      _seen.add(id);
      return true;
    });
  })();"""

found = False
for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    if OLD not in code:
        print('!! anchor not found'); sys.exit(2)
    if 'DEDUP (T-C.6' in code:
        print('!! already deployed'); sys.exit(0)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    print('✓ C.6 dedup deployed in buildPropertySequence')
    found = True
    break

if not found:
    print('!! node not found'); sys.exit(2)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
