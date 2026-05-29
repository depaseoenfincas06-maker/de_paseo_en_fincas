#!/usr/bin/env python3
"""Convertir TEST MODE (limitar fotos a 1) en toggle dinámico desde dashboard.

Hoy hay dos `.slice(0, 1)` hardcodeados:
1. CodeJS1.buildMediaMessages: `media_urls: [urls[0]]`, `media_count: 1`
2. Outbound Sender.Expand outbound items.resolveFolderAssets: `.slice(0, 1)`

Ambos deben respetar `agent_settings.owner_test_mode_enabled`. Cuando el
dashboard apague el toggle, automáticamente:
- CodeJS1 pasará todas las URLs (si foto_url tiene múltiples separadas por coma).
- Outbound Sender expandirá TODAS las fotos del Drive folder.

Cambios:
1. customer agent — `config` node: agregar `owner_test_mode_enabled` field.
2. customer agent — `buildMediaMessages`: leer flag desde $('config'), slice condicional.
3. customer agent — `Fire media sender` body: incluir `test_mode_enabled`.
4. outbound sender — `Normalize input`: extraer `test_mode_enabled` del body.
5. outbound sender — `Expand outbound items.resolveFolderAssets`: slice condicional.
"""
import json, subprocess, sys, uuid

JWT = open('/tmp/n8n_jwt.txt').read().strip()
CA = '2NV08zRFKENUsQVC'       # customer agent
OS = 'Bg5nl2Y26PuwF2NB'        # outbound sender

# ============================================================
# Customer agent
# ============================================================
URL_CA = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{CA}'
r = subprocess.run(['curl','-sk', URL_CA, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf_ca = json.loads(r.stdout)
patched_ca = []

# 1. config node — agregar owner_test_mode_enabled
for n in wf_ca['nodes']:
    if n.get('name') != 'config': continue
    assigns = n['parameters']['assignments']['assignments']
    if any(a['name'] == 'owner_test_mode_enabled' for a in assigns):
        patched_ca.append('config.owner_test_mode_enabled: already')
        break
    assigns.append({
        "id": str(uuid.uuid4()),
        "name": "owner_test_mode_enabled",
        "value": "={{ $('Get agent settings').first().json.owner_test_mode_enabled === true }}",
        "type": "boolean"
    })
    patched_ca.append('config: added owner_test_mode_enabled')
    break

# 2. CodeJS1 buildMediaMessages — slice dinámico
for n in wf_ca['nodes']:
    if n.get('name') != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    OLD_BMM = """function buildMediaMessages(finca) {
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
    NEW_BMM = """function buildMediaMessages(finca) {
  const urls = parseUrls(finca?.foto_url);
  if (!urls.length) return [];
  const title = finca?.codigo_original || finca?.finca_id || 'la finca';
  // TEST MODE dinámico — leído desde agent_settings.owner_test_mode_enabled via config node.
  // ON  → solo primera foto (acelera testing).
  // OFF → todas las URLs en foto_url (típicamente 1 URL de folder que el outbound sender expande).
  var __testMode = false;
  try { __testMode = $('config').first().json.owner_test_mode_enabled === true; } catch (e) {}
  const _urls = __testMode ? urls.slice(0, 1) : urls;
  return [
    {
      type: 'media_group',
      content: '',
      media_url: _urls[0],
      media_urls: _urls,
      property_title: title,
      property_id: finca?.finca_id || null,
      media_count: _urls.length,
    },
  ];
}"""
    if 'TEST MODE dinámico' in code:
        patched_ca.append('CodeJS1.buildMediaMessages: already')
        break
    if OLD_BMM not in code:
        print('!! anchor buildMediaMessages not found in CodeJS1')
        sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD_BMM, NEW_BMM, 1)
    patched_ca.append('CodeJS1.buildMediaMessages: dynamic slice via $(config).owner_test_mode_enabled')
    break

# 3. Fire media sender body — agregar test_mode_enabled
for n in wf_ca['nodes']:
    if n.get('name') != 'Fire media sender': continue
    p = n['parameters']
    body_field = 'jsonBody' if 'jsonBody' in p else 'body'
    body = p.get(body_field, '')
    if 'test_mode_enabled' in body:
        patched_ca.append('Fire media sender: already')
        break
    OLD_BODY_FRAG = ", whatsapp_phone_number_id: '__WHATSAPP_PHONE_NUMBER_ID__' })"
    NEW_BODY_FRAG = ", whatsapp_phone_number_id: '__WHATSAPP_PHONE_NUMBER_ID__', test_mode_enabled: $('config').first().json.owner_test_mode_enabled === true })"
    if OLD_BODY_FRAG not in body:
        print('!! anchor in Fire media sender body not found')
        print('body:', body[:800])
        sys.exit(3)
    p[body_field] = body.replace(OLD_BODY_FRAG, NEW_BODY_FRAG, 1)
    patched_ca.append('Fire media sender: included test_mode_enabled in payload')
    break

print('Customer agent patches:')
for p in patched_ca: print('  -', p)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf_ca['name'], 'nodes': wf_ca['nodes'], 'connections': wf_ca['connections'],
    'settings': {k:v for k,v in (wf_ca.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL_CA, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT customer agent. active={json.loads(r2.stdout).get("active")}')

# ============================================================
# Outbound Sender
# ============================================================
URL_OS = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{OS}'
r = subprocess.run(['curl','-sk', URL_OS, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf_os = json.loads(r.stdout)
patched_os = []

# 4. Normalize input — extract test_mode_enabled
for n in wf_os['nodes']:
    if n.get('name') != 'Normalize input': continue
    code = n['parameters']['jsCode']
    if 'test_mode_enabled' in code:
        patched_os.append('Normalize input: already')
        break
    OLD_NI = """      final_whatsapp_text: compact(input.final_whatsapp_text || input.outbound_message || input.message || ''),
    },
  },
];"""
    NEW_NI = """      final_whatsapp_text: compact(input.final_whatsapp_text || input.outbound_message || input.message || ''),
      test_mode_enabled: input.test_mode_enabled === true,
    },
  },
];"""
    if OLD_NI not in code:
        print('!! anchor Normalize input not found')
        sys.exit(4)
    n['parameters']['jsCode'] = code.replace(OLD_NI, NEW_NI, 1)
    patched_os.append('Normalize input: extracts test_mode_enabled')
    break

# 5. Expand outbound items — dynamic slice in resolveFolderAssets
for n in wf_os['nodes']:
    if n.get('name') != 'Expand outbound items': continue
    code = n['parameters']['jsCode']
    if 'TEST MODE dinámico' in code:
        patched_os.append('Expand outbound items: already')
        break
    OLD_EOI = """async function resolveFolderAssets(folderUrl) {
  const folderId = extractDriveFolderId(folderUrl);
  if (!folderId) {
    throw new Error('drive_folder_id_not_found');
  }

  const embedUrl = 'https://drive.google.com/embeddedfolderview?id=' + folderId + '#list';
  const html = await fetchText(embedUrl);
  const matches = Array.from(html.matchAll(/https:\\/\\/drive\\.google\\.com\\/file\\/d\\/([a-zA-Z0-9_-]+)\\/view/gi));

  // TEST MODE — solo primera foto del folder (May 25 2026).
  // Para revertir: quitar `.slice(0, 1)`.
  return uniqueStrings(matches.map((match) => directDriveDownloadUrl(match[1]))).slice(0, 1).map((downloadUrl) => ({
    source_url: folderUrl,
    download_url: downloadUrl,
  }));
}"""
    NEW_EOI = """async function resolveFolderAssets(folderUrl, testMode) {
  const folderId = extractDriveFolderId(folderUrl);
  if (!folderId) {
    throw new Error('drive_folder_id_not_found');
  }

  const embedUrl = 'https://drive.google.com/embeddedfolderview?id=' + folderId + '#list';
  const html = await fetchText(embedUrl);
  const matches = Array.from(html.matchAll(/https:\\/\\/drive\\.google\\.com\\/file\\/d\\/([a-zA-Z0-9_-]+)\\/view/gi));

  // TEST MODE dinámico — controlado por agent_settings.owner_test_mode_enabled.
  // ON  → solo primera foto (testing).
  // OFF → todas las fotos del folder.
  const _all = uniqueStrings(matches.map((match) => directDriveDownloadUrl(match[1])));
  const _selected = testMode ? _all.slice(0, 1) : _all;
  return _selected.map((downloadUrl) => ({
    source_url: folderUrl,
    download_url: downloadUrl,
  }));
}"""
    if OLD_EOI not in code:
        print('!! anchor resolveFolderAssets not found')
        print('---hint---')
        idx = code.find('resolveFolderAssets')
        if idx>0: print(code[idx-50:idx+1200])
        sys.exit(5)
    code2 = code.replace(OLD_EOI, NEW_EOI, 1)
    # Now patch the caller — resolveFolderAssets called inside resolveSequenceAssets
    OLD_CALL = "      const resolved = await resolveFolderAssets(url);"
    NEW_CALL = "      const resolved = await resolveFolderAssets(url, _testMode);"
    if OLD_CALL not in code2:
        print('!! caller of resolveFolderAssets not found')
        sys.exit(6)
    code3 = code2.replace(OLD_CALL, NEW_CALL, 1)
    # And resolveSequenceAssets signature
    OLD_SIG = "async function resolveSequenceAssets(item) {"
    NEW_SIG = "async function resolveSequenceAssets(item, _testMode) {"
    if OLD_SIG not in code3:
        print('!! resolveSequenceAssets signature not found')
        sys.exit(7)
    code4 = code3.replace(OLD_SIG, NEW_SIG, 1)
    # And caller of resolveSequenceAssets — find it
    if 'resolveSequenceAssets(' not in code4:
        print('!! no caller of resolveSequenceAssets')
        sys.exit(8)
    # Find call pattern
    import re
    callers = re.findall(r'resolveSequenceAssets\([^)]*\)', code4)
    print('callers of resolveSequenceAssets:', callers)
    # Replace each
    code5 = code4
    for caller in callers:
        if caller == 'resolveSequenceAssets(item)':
            code5 = code5.replace('resolveSequenceAssets(item)', 'resolveSequenceAssets(item, _testMode)')
        elif caller == 'resolveSequenceAssets(payload)':
            code5 = code5.replace('resolveSequenceAssets(payload)', 'resolveSequenceAssets(payload, _testMode)')
    # Now inject _testMode read at top of code (right after const prevData = ...)
    OLD_PREV = "const prevData = $input.first().json || {};"
    NEW_PREV = """const prevData = $input.first().json || {};
const _testMode = prevData.test_mode_enabled === true;"""
    if OLD_PREV not in code5:
        print('!! prevData anchor not found')
        sys.exit(9)
    code6 = code5.replace(OLD_PREV, NEW_PREV, 1)
    n['parameters']['jsCode'] = code6
    patched_os.append('Expand outbound items: dynamic slice via prevData.test_mode_enabled')
    break

print('\nOutbound sender patches:')
for p in patched_os: print('  -', p)

payload_put = {'name': wf_os['name'], 'nodes': wf_os['nodes'], 'connections': wf_os['connections'],
    'settings': {k:v for k,v in (wf_os.get('settings') or {}).items() if k in ALLOWED}}
r3 = subprocess.run(['curl','-sk','-X','PUT', URL_OS, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT outbound sender. active={json.loads(r3.stdout).get("active")}')
