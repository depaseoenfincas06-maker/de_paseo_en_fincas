#!/usr/bin/env python3
"""
Track 4.1 — Whitelist sanitizer para media_url + content URLs (defense-in-depth
contra PDF/document leaks).

Antes del return de Code in JavaScript1, además del sanitizer de signos de
apertura (ya existe), recorre outbound_sequence y verifica que cada media_url
(y URLs embebidas en content) esté en la WHITELIST canónica:

  - Drive folders en company_documents[*].url (cuando send_when_asked=true)
  - URL fija: <public_app_base_url>/api/reservation-confirmation.pdf
  - URL fija: <public_app_base_url>/api/reservation-confirmation.docx
  - Drive folders/files en Refetch last_inventory_items.items[*].foto_url

Si una URL NO está en la whitelist:
  - El media item se transforma en text item con el caption (sin URL)
  - URLs en content se reemplazan por "[link removido]"
  - Se loguea a stderr (visible en n8n exec logs)

Esto previene que el LLM aluciine URLs de Drive arbitrarias o que un caption
inyecte links externos. La whitelist se construye dinámicamente desde la data
ya disponible en el exec.
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

    # Anchor: just after the existing _stripOpeningPunctuation sanitizer,
    # before "var _sanitizedPrimaryOutboundMessage = ..."
    OLD = (
"for (var _sIdx = 0; _sIdx < outboundSequence.length; _sIdx++) {\n"
"  var _part = outboundSequence[_sIdx];\n"
"  if (_part && typeof _part === 'object') {\n"
"    if (typeof _part.content === 'string') _part.content = _stripOpeningPunctuation(_part.content);\n"
"    if (typeof _part.text === 'string') _part.text = _stripOpeningPunctuation(_part.text);\n"
"  }\n"
"}\n"
"var _sanitizedPrimaryOutboundMessage = _stripOpeningPunctuation(primaryOutboundMessage);"
    )
    NEW = (
"for (var _sIdx = 0; _sIdx < outboundSequence.length; _sIdx++) {\n"
"  var _part = outboundSequence[_sIdx];\n"
"  if (_part && typeof _part === 'object') {\n"
"    if (typeof _part.content === 'string') _part.content = _stripOpeningPunctuation(_part.content);\n"
"    if (typeof _part.text === 'string') _part.text = _stripOpeningPunctuation(_part.text);\n"
"  }\n"
"}\n"
"\n"
"// === Whitelist sanitizer para URLs de media + caption (Track 4.1) ===\n"
"// Defense-in-depth contra leaks de documentos/PDFs no autorizados. Un media\n"
"// item con URL fuera de la whitelist se degrada a text (con el caption sin\n"
"// URL); URLs embebidas en strings se reemplazan por '[link removido]'.\n"
"// La whitelist se arma con: (a) public_app_base_url para los endpoints de\n"
"// reservation-confirmation, (b) company_documents[*].url marcados con\n"
"// send_when_asked, (c) Drive folders/files en Refetch.items[*].foto_url.\n"
"(function _sanitizeMediaUrls() {\n"
"  var publicBaseUrl = '';\n"
"  try { publicBaseUrl = String($('config').item.json.public_app_base_url || '').replace(/\\/$/, ''); } catch (e) {}\n"
"  var allowedExact = new Set();\n"
"  var allowedPrefixes = [];\n"
"  if (publicBaseUrl) {\n"
"    allowedPrefixes.push(publicBaseUrl + '/api/reservation-confirmation.pdf');\n"
"    allowedPrefixes.push(publicBaseUrl + '/api/reservation-confirmation.docx');\n"
"  }\n"
"  // company_documents en agent_settings (via config)\n"
"  try {\n"
"    var docs = $('config').item.json.company_documents;\n"
"    if (Array.isArray(docs)) {\n"
"      for (var d of docs) {\n"
"        if (d && typeof d === 'object' && d.url && d.send_when_asked) allowedExact.add(String(d.url).trim());\n"
"      }\n"
"    }\n"
"  } catch (e) {}\n"
"  // foto_url de items en el cache de inventario (Refetch)\n"
"  try {\n"
"    var ref = $('Refetch last_inventory_items').item.json;\n"
"    var cached = ref && ref.last_inventory_items;\n"
"    if (typeof cached === 'string') { try { cached = JSON.parse(cached); } catch (e) { cached = null; } }\n"
"    if (cached && typeof cached === 'object') {\n"
"      var lists = [];\n"
"      if (Array.isArray(cached.items)) lists.push(cached.items);\n"
"      if (Array.isArray(cached.similar_items)) lists.push(cached.similar_items);\n"
"      if (cached.selected_finca && typeof cached.selected_finca === 'object') lists.push([cached.selected_finca]);\n"
"      for (var l of lists) for (var it of (l || [])) {\n"
"        if (it && it.foto_url) allowedPrefixes.push(String(it.foto_url).split('?')[0]);\n"
"      }\n"
"    }\n"
"  } catch (e) {}\n"
"  // confirming_video_url en config\n"
"  try {\n"
"    var v = String($('config').item.json.confirming_video_url || '').trim();\n"
"    if (v) allowedExact.add(v);\n"
"  } catch (e) {}\n"
"  function _isAllowedUrl(u) {\n"
"    if (!u) return true; // null/empty is fine\n"
"    var s = String(u).trim();\n"
"    if (!s) return true;\n"
"    if (allowedExact.has(s)) return true;\n"
"    for (var p of allowedPrefixes) {\n"
"      if (s === p || s.startsWith(p + '?') || s.startsWith(p + '&') || s.startsWith(p)) return true;\n"
"    }\n"
"    return false;\n"
"  }\n"
"  function _stripUrlsFromText(s) {\n"
"    if (typeof s !== 'string') return s;\n"
"    return s.replace(/https?:\\/\\/[\\w\\-._~:/?#\\[\\]@!$&'()*+,;=%]+/g, function(match) {\n"
"      return _isAllowedUrl(match) ? match : '[link removido]';\n"
"    });\n"
"  }\n"
"  for (var i = 0; i < outboundSequence.length; i++) {\n"
"    var p = outboundSequence[i];\n"
"    if (!p || typeof p !== 'object') continue;\n"
"    // Check media_url + media_urls[]\n"
"    var rejected = false;\n"
"    if (p.media_url && !_isAllowedUrl(p.media_url)) {\n"
"      console.error('[outbound-sanitizer] BLOCKED media_url not in whitelist:', String(p.media_url).slice(0, 200));\n"
"      rejected = true;\n"
"    }\n"
"    if (Array.isArray(p.media_urls)) {\n"
"      for (var u of p.media_urls) {\n"
"        if (u && !_isAllowedUrl(u)) {\n"
"          console.error('[outbound-sanitizer] BLOCKED media_urls entry not in whitelist:', String(u).slice(0, 200));\n"
"          rejected = true;\n"
"          break;\n"
"        }\n"
"      }\n"
"    }\n"
"    if (rejected) {\n"
"      // Degrade to text (preserve caption if any)\n"
"      p.media_url = null;\n"
"      p.media_urls = undefined;\n"
"      p.type = 'text';\n"
"      if (!p.content || !String(p.content).trim()) p.content = '(adjunto no disponible)';\n"
"    }\n"
"    // Strip stray URLs from text content/text fields\n"
"    if (typeof p.content === 'string') p.content = _stripUrlsFromText(p.content);\n"
"    if (typeof p.text === 'string') p.text = _stripUrlsFromText(p.text);\n"
"  }\n"
"})();\n"
"\n"
"var _sanitizedPrimaryOutboundMessage = _stripOpeningPunctuation(primaryOutboundMessage);"
    )

    if OLD not in code:
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    print('✓ Code in JavaScript1: URL whitelist sanitizer agregado')
    break

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
