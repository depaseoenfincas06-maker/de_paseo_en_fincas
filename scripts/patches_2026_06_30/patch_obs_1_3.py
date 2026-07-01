#!/usr/bin/env python3
"""
Fixes para observaciones del reviewer (screenshots):

Obs #1 — Tono, más emojis:
  Los 3 tone presets (calido_profesional / premium_cercano / directo_eficiente)
  decían "máximo 2 emojis" (o 1). El reviewer pidió más emojis para hacer
  el chat divertido. Cambio a rangos generosos por preset con emojis del
  brand (☀️🌴🏡✨).

Obs #3 — "Perfecto (NOMBRE)" con wa_id en lugar del nombre:
  Bug en Code in JavaScript1 líneas 1699-1703. Leía de
  $('Get Context-conversations1').first().json.context.extracted_data.nombre
  — path que NO existe en el SQL de Get Context. Siempre caía al fallback
  Merge Sets1.client_name, que puede ser wa_id o dominio si Chatwoot no
  tenía nombre real.

  Fix:
  - Path REAL a nombres extraídos: ctx.extras.confirming_reservation.nombre
    (donde el confirming pass persiste los datos)
  - Fallback a titular_data.nombre (para RESERVATION_APPROVED)
  - Fallback a client_name PERO sanitizado — rechaza valores que
    parezcan teléfono (^\\+?\\d{6,}$) o dominio (\\.(com|co|net|org|io)$).
  - Si nada aplica → fullName='' → _renderTemplate remueve "(NOMBRE) "
    → "Perfecto, en minutos..." (sin nombre, pero sin basura).
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

ok = {'emojis_calido': False, 'emojis_premium': False, 'emojis_directo': False, 'name_lookup': False}

# ==== Obs #1: tono — más emojis en los 3 presets ====

config = next(n for n in wf['nodes'] if n['name'] == 'config')
tono_assign = next(a for a in config['parameters']['assignments']['assignments'] if a['name'] == 'tono')
tono_val = tono_assign['value']

# calido_profesional: "máximo 2 emojis" -> "2-4 emojis del brand"
OLD_C = "Tuteo, tono amigable, máximo 2 emojis."
NEW_C = "Tuteo, tono amigable, con emojis para hacer el chat divertido: usá 2-4 por mensaje, distribuidos con naturalidad. Priorizá los del brand: ☀️🌴🏡✨ y contextuales según el contenido (📍 para zona, 📅 para fechas, 👥 para personas, 💰 para precios, 🏊 piscina, 🍳 empleada, etc.)."
if OLD_C in tono_val:
    tono_val = tono_val.replace(OLD_C, NEW_C, 1)
    ok['emojis_calido'] = True
    print('✓ calido_profesional: emojis 2 → 2-4 con guidance de brand')
else:
    print('!! calido_profesional marker not found')

# premium_cercano: "máximo 2 emojis" -> "2-3 emojis sutiles"
OLD_P = "Tuteo, máximo 2 emojis."
NEW_P = "Tuteo, con emojis usados con criterio: 2-3 por mensaje, elegantes y sutiles. Priorizá ☀️🌴✨ y contextuales sin exagerar."
if OLD_P in tono_val:
    tono_val = tono_val.replace(OLD_P, NEW_P, 1)
    ok['emojis_premium'] = True
    print('✓ premium_cercano: emojis 2 → 2-3 sutiles')
else:
    print('!! premium_cercano marker not found')

# directo_eficiente: "máximo 1 emoji" -> "1-2 emojis funcionales"
OLD_D = "Tuteo, máximo 1 emoji."
NEW_D = "Tuteo, 1-2 emojis funcionales por mensaje (✅ ✓ 📍 📅 💰) — sin decorativos."
if OLD_D in tono_val:
    tono_val = tono_val.replace(OLD_D, NEW_D, 1)
    ok['emojis_directo'] = True
    print('✓ directo_eficiente: emojis 1 → 1-2 funcionales')
else:
    print('!! directo_eficiente marker not found')

tono_assign['value'] = tono_val

# ==== Obs #3: fix _confirmingTemplateOverride's fullName resolution ====

cj = next(n for n in wf['nodes'] if n['name'] == 'Code in JavaScript1')
code = cj['parameters']['jsCode']

# Old code (broken path + unsafe fallback):
OLD_NAME = (
"  var fullName = '';\n"
"  try { fullName = (($('Get Context-conversations1').first().json.context || {}).extracted_data || {}).nombre || ''; } catch (e) {}\n"
"  if (!fullName) {\n"
"    try { fullName = $('Merge Sets1').first().json.client_name || ''; } catch (e) {}\n"
"  }"
)

NEW_NAME = (
"  var fullName = '';\n"
"  // PATH REAL: el confirming_reservation_agent persiste el nombre extraído en\n"
"  // conversations.extras.confirming_reservation.nombre. El path viejo\n"
"  // (context.extracted_data.nombre) NO existe en el SQL de Get Context, siempre\n"
"  // era undefined y siempre caía al fallback client_name (que puede ser\n"
"  // wa_id o dominio si Chatwoot no tenía nombre real).\n"
"  try {\n"
"    var _ctx = $('Get Context-conversations1').first().json || {};\n"
"    fullName = (_ctx.extras && _ctx.extras.confirming_reservation && _ctx.extras.confirming_reservation.nombre) || '';\n"
"    if (!fullName && _ctx.titular_data && _ctx.titular_data.nombre) fullName = _ctx.titular_data.nombre;\n"
"  } catch (e) {}\n"
"  if (!fullName) {\n"
"    // Fallback SANITIZADO a Chatwoot's client_name. Chatwoot a veces devuelve\n"
"    // el wa_id como sender.name (contacto sin nombre real) o el nombre del\n"
"    // inbox (\"DEPASEOENFINCAS.COM\"). Rechazamos esos casos — es peor renderizar\n"
"    // \"Perfecto 573112407139\" que \"Perfecto,\" (sin nombre).\n"
"    try {\n"
"      var _raw = String($('Merge Sets1').first().json.client_name || '').trim();\n"
"      var _phoneish = /^\\+?\\d{6,}$/.test(_raw.replace(/\\s+/g, ''));\n"
"      var _domainish = /\\.(com|co|net|org|io)$/i.test(_raw);\n"
"      if (_raw && !_phoneish && !_domainish) fullName = _raw;\n"
"    } catch (e) {}\n"
"  }"
)

if OLD_NAME in code:
    code = code.replace(OLD_NAME, NEW_NAME, 1)
    cj['parameters']['jsCode'] = code
    ok['name_lookup'] = True
    print('✓ CodeJS1 fullName lookup: path correcto + fallback sanitizado')
else:
    print('!! CodeJS1 old fullName block not found')

if not all(ok.values()):
    print('!! not all patched:', ok); sys.exit(2)

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
