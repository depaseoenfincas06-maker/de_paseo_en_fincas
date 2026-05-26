#!/usr/bin/env python3
"""TEST MODE — limitar buildMediaMessages a la primera foto de cada finca.
Comentario de testing — para revertir, restaurar media_urls: urls original."""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """function buildMediaMessages(finca) {
  const urls = parseUrls(finca?.foto_url);
  if (!urls.length) return [];
  const title = finca?.codigo_original || finca?.finca_id || 'la finca';
  return [
    {
      type: 'media_group',
      content: '',
      media_url: urls[0],
      media_urls: urls,
      property_title: title,
      property_id: finca?.finca_id || null,
      media_count: urls.length,
    },
  ];
}"""

NEW = """function buildMediaMessages(finca) {
  const urls = parseUrls(finca?.foto_url);
  if (!urls.length) return [];
  const title = finca?.codigo_original || finca?.finca_id || 'la finca';
  // TEST MODE — sólo primera foto (para acelerar testing E2E).
  // Para revertir: cambiar a `media_urls: urls` y `media_count: urls.length`.
  return [
    {
      type: 'media_group',
      content: '',
      media_url: urls[0],
      media_urls: [urls[0]],
      property_title: title,
      property_id: finca?.finca_id || null,
      media_count: 1,
    },
  ];
}"""

for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    if OLD not in code:
        if 'TEST MODE — sólo primera foto' in code:
            print('!! already in test mode'); sys.exit(0)
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    print('✓ buildMediaMessages: limited to first photo (TEST MODE)')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
