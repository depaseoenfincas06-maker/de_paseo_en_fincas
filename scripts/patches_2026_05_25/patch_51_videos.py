#!/usr/bin/env python3
"""
Track 5.1 — Videos de calificaciones por finca.

Implementación en 4 pasos:
1. Normalize Inventory: leer nueva columna `review_video_urls` del sheet
   (CSV de URLs Drive, split por coma). Pasa al objeto finca como array.
2. Build Inventory Tool Response: incluir review_video_urls en el output
   item para que el LLM lo vea.
3. Prompts: agregar intent SHOW_REVIEW a offering + qa + confirming +
   verifying con triggers de "reseñas/opiniones/videos de gente".
4. Code in JavaScript1: cuando intent=SHOW_REVIEW, emitir videos como
   items media del outboundSequence.
5. Whitelist sanitizer: agregar review_video_urls al allowlist para que
   no se filtren como [link removido].

Sin URLs en el sheet, el LLM responde con fallback genérico cuando se
detecta intent SHOW_REVIEW.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# === 1. Normalize Inventory — leer review_video_urls ===
OLD_NORM = "      foto_url: pick(row, ['foto_url', 'Foto URL']),"
NEW_NORM = (
"      foto_url: pick(row, ['foto_url', 'Foto URL']),\n"
"      review_video_urls: (function() {\n"
"        // Track 5.1 — videos de calificaciones por finca (May 25 2026)\n"
"        // Lee CSV de URLs Drive, separadas por coma. Devuelve array.\n"
"        var raw = pick(row, ['review_video_urls', 'Review Video URLs', 'videos_calificaciones']);\n"
"        if (!raw || !String(raw).trim()) return [];\n"
"        return String(raw).split(',').map(function(u){ return String(u).trim(); }).filter(Boolean);\n"
"      })(),"
)

for n in wf['nodes']:
    if n['name'] != 'Normalize Inventory': continue
    code = n['parameters']['jsCode']
    if 'review_video_urls' in code:
        print('!! Normalize Inventory already has review_video_urls')
    elif OLD_NORM not in code:
        print('!! Normalize Inventory anchor not found'); sys.exit(2)
    else:
        n['parameters']['jsCode'] = code.replace(OLD_NORM, NEW_NORM, 1)
        print('✓ Normalize Inventory: review_video_urls column reader added')
    break

# === 2. BIT — pasar review_video_urls al output item ===
OLD_BIT = "  foto_url: item.foto_url,\n  owner_nombre: item.owner_nombre,"
NEW_BIT = (
"  foto_url: item.foto_url,\n"
"  review_video_urls: Array.isArray(item.review_video_urls) ? item.review_video_urls : [],\n"
"  owner_nombre: item.owner_nombre,"
)

for n in wf['nodes']:
    if n['name'] != 'Build Inventory Tool Response': continue
    code = n['parameters']['jsCode']
    if 'review_video_urls' in code:
        print('!! BIT already has review_video_urls')
    elif OLD_BIT not in code:
        # Try to find similar anchor
        if 'foto_url:' in code:
            # Find first occurrence
            idx = code.find('foto_url: item.foto_url')
            if idx >= 0:
                # Show context
                print(f'Found foto_url at {idx} but exact anchor differs. Showing nearby:')
                print(code[max(0,idx-50):idx+200])
        print('!! BIT anchor not found'); sys.exit(2)
    else:
        n['parameters']['jsCode'] = code.replace(OLD_BIT, NEW_BIT, 1)
        print('✓ BIT: review_video_urls in output item')
    break

# === 3. Agent prompts — SHOW_REVIEW intent rule ===
SHOW_REVIEW_BLOCK = (
"- 🎬 REGLA — SHOW_REVIEW (cliente pide testimonios / reseñas / videos de gente que ha ido):\n"
"  Triggers (frases del cliente, todas → intent=\"SHOW_REVIEW\"):\n"
"    \"qué dicen los que han ido?\" / \"tienen testimonios?\" / \"tienen reseñas?\"\n"
"    \"opiniones de la finca\" / \"calificaciones\" / \"videos de gente que haya ido\"\n"
"    \"familias que han estado\" / \"comentarios reales\"\n"
"  Comportamiento al emitir SHOW_REVIEW:\n"
"  • finca_elegida_id = la finca actual seleccionada o la que el cliente esté preguntando\n"
"  • selected_finca = objeto completo de esa finca con `review_video_urls` (array de URLs Drive)\n"
"  • respuesta: \"Mira lo que nos contaron las familias que disfrutaron en [finca]:\" (el sistema adjunta los videos automáticamente)\n"
"  • Si la finca NO tiene `review_video_urls` o está vacío, NO emitas SHOW_REVIEW — responde con fallback:\n"
"    \"Aún no tengo videos específicos de esta finca, pero te puedo contar que las familias destacan [característica X]. ¿Querés ver opciones de fincas con testimonios disponibles?\""
)

SAFE_ANCHOR = "- ⚡ REGLA POST-CAMBIO (CHANGE_FINCA / cambio fechas / cambio personas) — CASO #1.9:"
INSERT = SHOW_REVIEW_BLOCK + "\n" + SAFE_ANCHOR

for agent_name in ['Run offering pass','Run qa pass','Run verifying_availability pass','Run confirming_reservation pass']:
    for n in wf['nodes']:
        if n['name'] != agent_name: continue
        sm = n['parameters']['options']['systemMessage']
        if 'SHOW_REVIEW' in sm:
            print(f'!! {agent_name}: SHOW_REVIEW already deployed')
            break
        if SAFE_ANCHOR not in sm:
            print(f'!! {agent_name}: anchor not found, skipping')
            break
        n['parameters']['options']['systemMessage'] = sm.replace(SAFE_ANCHOR, INSERT, 1)
        print(f'✓ {agent_name}: SHOW_REVIEW rule added')
        break

# === 4. CodeJS1 — buildPropertySequence handler para SHOW_REVIEW ===
# Add a new branch after the SHOW_OPTIONS handler
OLD_CJS = "  if (tool === 'offering_agent' && intent === 'SHOW_OPTIONS' && fincasMostradas.length) {"
SHOW_REVIEW_HANDLER = (
"  // Track 5.1 — SHOW_REVIEW: enviar 1-2 videos de calificaciones de la finca\n"
"  if (intent === 'SHOW_REVIEW') {\n"
"    var _reviewFinca = selectedFinca || (fincasMostradas.length ? fincasMostradas[0] : null);\n"
"    if (_reviewFinca && Array.isArray(_reviewFinca.review_video_urls) && _reviewFinca.review_video_urls.length) {\n"
"      var _intro = (toolOutputParsed?.respuesta || finalWhatsappText || 'Mira lo que nos contaron las familias que disfrutaron en ' + (_reviewFinca.codigo_original || _reviewFinca.nombre || 'esta finca'));\n"
"      var _introMsg = createTextMessage(_intro, { property_title: _reviewFinca?.codigo_original || _reviewFinca?.finca_id || null, property_id: _reviewFinca?.finca_id || null });\n"
"      if (_introMsg) sequence.push(_introMsg);\n"
"      // Limit to first 2 videos\n"
"      var _videos = _reviewFinca.review_video_urls.slice(0, 2);\n"
"      for (var _vu of _videos) {\n"
"        sequence.push({\n"
"          type: 'video',\n"
"          content: '',\n"
"          media_url: _vu,\n"
"          media_urls: [_vu],\n"
"          property_title: _reviewFinca?.codigo_original || null,\n"
"          property_id: _reviewFinca?.finca_id || null,\n"
"          media_count: 1,\n"
"        });\n"
"      }\n"
"      return sequence;\n"
"    }\n"
"    // No videos available — let the LLM fallback text be used as-is\n"
"  }\n"
"\n"
"  if (tool === 'offering_agent' && intent === 'SHOW_OPTIONS' && fincasMostradas.length) {"
)

for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    if 'SHOW_REVIEW: enviar 1-2 videos' in code:
        print('!! SHOW_REVIEW handler already deployed')
    elif OLD_CJS not in code:
        print('!! SHOW_OPTIONS anchor not found'); sys.exit(2)
    else:
        n['parameters']['jsCode'] = code.replace(OLD_CJS, SHOW_REVIEW_HANDLER, 1)
        print('✓ Code in JavaScript1: SHOW_REVIEW video handler added')
    break

# === 5. Whitelist sanitizer — allow review_video_urls ===
# The whitelist already includes Refetch.items[*].foto_url. Need to also add
# review_video_urls. Find the section in CodeJS1 that builds the whitelist.
OLD_WL = """      for (var l of lists) for (var it of (l || [])) {
        if (it && it.foto_url) allowedPrefixes.push(String(it.foto_url).split('?')[0]);
      }"""

NEW_WL = """      for (var l of lists) for (var it of (l || [])) {
        if (it && it.foto_url) allowedPrefixes.push(String(it.foto_url).split('?')[0]);
        // Track 5.1 — review videos URLs whitelisted too
        if (it && Array.isArray(it.review_video_urls)) {
          for (var _rv of it.review_video_urls) {
            if (_rv) allowedPrefixes.push(String(_rv).split('?')[0]);
          }
        }
      }"""

for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    if 'review videos URLs whitelisted' in code:
        print('!! WL already updated')
    elif OLD_WL not in code:
        print('!! WL anchor not found'); sys.exit(2)
    else:
        n['parameters']['jsCode'] = code.replace(OLD_WL, NEW_WL, 1)
        print('✓ Whitelist sanitizer: review_video_urls added to allowlist')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'\nPUT ok. active={json.loads(r2.stdout).get("active")}')
