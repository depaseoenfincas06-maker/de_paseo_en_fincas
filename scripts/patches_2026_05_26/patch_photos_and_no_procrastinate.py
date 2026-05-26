#!/usr/bin/env python3
"""3 fixes en uno:

1. Whitelist: incluir foto_urls de toolOutputParsed.fincas_mostradas y
   selected_finca. Si el LLM emite la foto_url, viene de BIT en alguna
   ronda anterior y se debe permitir.

2. Prompt rule (offering+qa+confirming): cuando cliente pide "fotos de X",
   emitir intent=SHOW_OPTIONS con fincas_mostradas=[X] para que el sistema
   construya media_group propiamente. NUNCA responder con texto +
   enlace ("acá tienes el link" → sanitizer lo bloquea).

3. Prompt rule offering: si dice "te muestro alternativas", DEBE llamar
   inventory_reader_tool + emitir fincas_mostradas en el MISMO turno. No
   procrastinar con "dame un momento" y esperar otro mensaje del cliente.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# === Fix 1: Whitelist incluir toolOutputParsed fincas + selected_finca ===
OLD_WL = """  // URLs corporativas siempre permitidas (depaseoenfincas web + IG oficial).
  // Cualquier URL que empiece con estos prefijos pasa, sin importar deep path.
  allowedPrefixes.push('https://www.instagram.com/depaseoenfincascol');
  allowedPrefixes.push('https://instagram.com/depaseoenfincascol');
  allowedPrefixes.push('https://www.depaseoenfincas.com');
  allowedPrefixes.push('https://depaseoenfincas.com');
  allowedPrefixes.push('http://www.depaseoenfincas.com');
  allowedPrefixes.push('http://depaseoenfincas.com');"""

NEW_WL = """  // URLs corporativas siempre permitidas (depaseoenfincas web + IG oficial).
  // Cualquier URL que empiece con estos prefijos pasa, sin importar deep path.
  allowedPrefixes.push('https://www.instagram.com/depaseoenfincascol');
  allowedPrefixes.push('https://instagram.com/depaseoenfincascol');
  allowedPrefixes.push('https://www.depaseoenfincas.com');
  allowedPrefixes.push('https://depaseoenfincas.com');
  allowedPrefixes.push('http://www.depaseoenfincas.com');
  allowedPrefixes.push('http://depaseoenfincas.com');
  // foto_urls de fincas en toolOutputParsed (el LLM las recibió de BIT
  // en algún momento — son legítimas aunque no estén en Refetch cache).
  try {
    if (toolOutputParsed && Array.isArray(toolOutputParsed.fincas_mostradas)) {
      for (var _fm of toolOutputParsed.fincas_mostradas) {
        if (_fm && _fm.foto_url) allowedPrefixes.push(String(_fm.foto_url).split('?')[0]);
      }
    }
    if (toolOutputParsed && toolOutputParsed.selected_finca && toolOutputParsed.selected_finca.foto_url) {
      allowedPrefixes.push(String(toolOutputParsed.selected_finca.foto_url).split('?')[0]);
    }
  } catch (e) {}"""

for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    if OLD_WL not in code:
        if 'foto_urls de fincas en toolOutputParsed' in code:
            print('!! whitelist fix already deployed')
        else:
            print('!! whitelist anchor not found'); sys.exit(2)
    else:
        n['parameters']['jsCode'] = code.replace(OLD_WL, NEW_WL, 1)
        print('✓ whitelist: include toolOutputParsed fincas + selected_finca foto_urls')
    break

# === Fix 2 + 3: Prompt rules en offering ===
OLD_OFF = "- 🎯 REGLA — FINCA MENCIONADA POR CÓDIGO en el mensaje del cliente (caso 1.7 sub-bug):"

NEW_OFF = (
"- 📷 REGLA — CLIENTE PIDE FOTOS DE UNA FINCA (May 26 2026):\n"
"  Si el cliente pide explícitamente \"fotos de [X]\" / \"muéstrame fotos\" / \"más imágenes\" de una finca específica:\n"
"  • NUNCA respondas con texto + enlace Drive (\"acá podés ver las fotos: [link]\"). El sistema bloquea links sueltos.\n"
"  • SIEMPRE emite intent=\"SHOW_OPTIONS\" con `fincas_mostradas=[{finca_id, foto_url, ...}]` conteniendo SOLO esa finca.\n"
"  • Tu respuesta debe ser corto: \"Claro [nombre], aquí están las fotos de [finca_codigo]:\". El sistema arma el media_group automáticamente.\n"
"  • Si no tienes los datos de la finca en tu contexto, llama inventory_reader_tool con operation=get_finca_details para obtenerla, luego emite SHOW_OPTIONS.\n"
"- 🚫 REGLA — NO PROCRASTINAR con \"dame un momento\":\n"
"  Si te comprometiste a mostrar alternativas (\"te muestro otras opciones\" / \"busquemos algo más económico\"), DEBES llamar inventory_reader_tool + emitir fincas_mostradas en el MISMO turno.\n"
"  • PROHIBIDO decir \"dame un momento y te muestro\" sin emitir las cards en seguida. El cliente espera y se cansa.\n"
"  • Si necesitás reformular criterios primero, hacelo en una frase corta + igual emite las opciones nuevas.\n"
+ OLD_OFF
)

for n in wf['nodes']:
    if n['name'] != 'Run offering pass': continue
    sm = n['parameters']['options']['systemMessage']
    if 'NO PROCRASTINAR con \"dame un momento\"' in sm:
        print('!! offering rules already deployed')
        break
    if OLD_OFF not in sm:
        print('!! offering anchor not found'); sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(OLD_OFF, NEW_OFF, 1)
    print('✓ offering: photos rule + no procrastinate rule added')
    break

# Also for qa + confirming (cliente puede pedir fotos en CONFIRMING)
NEW_QA_CONFIRMING = (
"- 📷 REGLA — CLIENTE PIDE FOTOS DE UNA FINCA (May 26 2026):\n"
"  Si el cliente pide \"fotos de [X]\" / \"muéstrame fotos\" / \"más imágenes\":\n"
"  • NUNCA respondas con texto + enlace Drive (\"acá podés ver: [link]\"). El sistema bloquea links sueltos.\n"
"  • Emite intent=\"SHOW_OPTIONS\" con `fincas_mostradas=[{finca_id, foto_url, codigo_original, ...}]` conteniendo SOLO la finca pedida (usa la selected_finca del contexto si aplica).\n"
"  • Respuesta corta: \"Claro [nombre], aquí están las fotos de [finca_codigo]:\". El sistema adjunta las fotos.\n"
+ OLD_OFF
)

for agent_name in ['Run qa pass','Run confirming_reservation pass']:
    for n in wf['nodes']:
        if n['name'] != agent_name: continue
        sm = n['parameters']['options']['systemMessage']
        if 'CLIENTE PIDE FOTOS DE UNA FINCA' in sm:
            print(f'!! {agent_name}: photos rule already deployed')
            break
        if OLD_OFF not in sm:
            print(f'!! {agent_name}: anchor not found')
            break
        n['parameters']['options']['systemMessage'] = sm.replace(OLD_OFF, NEW_QA_CONFIRMING, 1)
        print(f'✓ {agent_name}: photos rule added')
        break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
