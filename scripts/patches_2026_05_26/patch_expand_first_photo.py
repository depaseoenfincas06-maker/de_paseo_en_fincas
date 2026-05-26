#!/usr/bin/env python3
"""
TEST MODE — Limit resolveFolderAssets to first photo only.

El parche anterior limitó `media_urls: [urls[0]]` en CodeJS1, pero `urls[0]`
es la URL del FOLDER de Drive. El Outbound Sender (Bg5nl2Y26PuwF2NB) lo
expande a TODOS los archivos del folder en `resolveFolderAssets`.

Fix: limitar resolveFolderAssets a 1 archivo. Para revertir, quitar el
`.slice(0, 1)` o cambiar a un número mayor.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = 'Bg5nl2Y26PuwF2NB'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """  return uniqueStrings(matches.map((match) => directDriveDownloadUrl(match[1]))).map((downloadUrl) => ({
    source_url: folderUrl,
    download_url: downloadUrl,
  }));
}"""

NEW = """  // TEST MODE — solo primera foto del folder (May 25 2026).
  // Para revertir: quitar `.slice(0, 1)`.
  return uniqueStrings(matches.map((match) => directDriveDownloadUrl(match[1]))).slice(0, 1).map((downloadUrl) => ({
    source_url: folderUrl,
    download_url: downloadUrl,
  }));
}"""

for n in wf['nodes']:
    if n['name'] != 'Expand outbound items': continue
    code = n['parameters']['jsCode']
    if 'TEST MODE — solo primera foto del folder' in code:
        print('!! already in test mode'); sys.exit(0)
    if OLD not in code:
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    print('✓ Expand outbound items: resolveFolderAssets limited to first photo')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
