#!/usr/bin/env python3
"""Fix "NOCHES_#04" (Ago 27 2026) — falso positivo del guardrail finca-por-código.

Bug observado en conv real 573112407139 (26-ago): el cliente escribió en
ráfaga "No / 6 noches / 4 podría?" (= ¿podrían ser 4 noches?). El burst-merge
produjo "...6 noches\n4 podría?" y el regex del guardrail
(`([A-ZÑ_]{3,})[\\s_#-]{0,3}(\\d{1,3})`) matcheó "noches\n4" → inventó la
finca NOCHES_#04 y respondió "La finca NOCHES_#04 por ahora no está
disponible..." — sin sentido y visible al cliente.

Causa: el regex acepta CUALQUIER palabra de 3+ letras seguida de número.
Palabras comunes + números son frecuentes: "6 noches 4", "somos 10",
"personas 12", "junio 10".

Fix: validar el token de zona capturado contra (a) whitelist estática de
zonas reales del inventario y (b) dinámicamente contra los finca_ids del
cache last_inventory_items. Si no valida → codeMatch = null → el guardrail
y el fallback de secuencia-vacía quedan intactos pero inertes para palabras
comunes. Cero cambios en el resto del flujo.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
BASE = 'https://n8n.depaseoenfincas.raaamp.co'
WID = '2NV08zRFKENUsQVC'
URL = f'{BASE}/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """const FINCA_CODE_RE = /\\b([A-ZÑ_]{3,})[\\s_#-]{0,3}(\\d{1,3})\\b/i;
const codeMatch = _clientLastMsgNormalized.match(FINCA_CODE_RE);"""

NEW = """const FINCA_CODE_RE = /\\b([A-ZÑ_]{3,})[\\s_#-]{0,3}(\\d{1,3})\\b/i;
let codeMatch = _clientLastMsgNormalized.match(FINCA_CODE_RE);
// Whitelist de zonas (Ago 27 2026, bug "NOCHES_#04"): el regex matchea
// cualquier palabra+número ("6 noches 4", "somos 10", "junio 12"...). Solo
// tokens de zona del inventario REAL activan el guardrail. Validación doble:
// estática (zonas conocidas) + dinámica (finca_ids del cache de la zona).
if (codeMatch) {
  const _zt = _stripAccents(codeMatch[1]).toUpperCase().replace(/_$/, '').replace(/\\s+/g, '_');
  const _ZONE_TOKENS = ['ANAPOIMA','VILLETA','GIRARDOT','MELGAR','SANTAFE','SOPETRAN','PEREIRA','QUINDIO','MESA','LA_MESA','VEGA','LA_VEGA','VILLAVICENCIO','CARMEN','APICALA','CARMEN_DE_APICALA','JERONIMO','SAN_JERONIMO','ARBELAEZ','GUATAPE','YEGUAS','MESITAS','RICAURTE'];
  let _zoneOk = _ZONE_TOKENS.some((t) => _zt === t || _zt.endsWith('_' + t));
  if (!_zoneOk) {
    try {
      const _zc = $('Refetch last_inventory_items').first().json.last_inventory_items;
      const _zl = _zc && Array.isArray(_zc.items) ? _zc.items : [];
      _zoneOk = _zl.some((it) => _stripAccents(String(it?.finca_id || '')).toUpperCase().replace(/\\s+/g, '_').startsWith(_zt));
    } catch (e) { /* sin cache → queda inválido */ }
  }
  if (!_zoneOk) codeMatch = null;
}"""

applied = False
for n in wf['nodes']:
    if n['name'] != 'Finalize offering outbound': continue
    code = n['parameters']['jsCode']
    if '_ZONE_TOKENS' in code:
        print('already deployed'); sys.exit(0)
    if OLD not in code:
        print('!! anchor missing'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    applied = True
    print('✓ Finalize offering outbound: whitelist de zonas en guardrail')
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
