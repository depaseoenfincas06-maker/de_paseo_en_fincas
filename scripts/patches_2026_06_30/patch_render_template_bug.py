#!/usr/bin/env python3
"""
Fix segundo bug en _renderTemplate (mismo flow del obs #3):

Los templates guardados en agent_settings SIEMPRE traen coma post-NOMBRE:
  "Perfecto (NOMBRE), en minutos..."
  "Te entiendo (NOMBRE), muy responsable..."

El _renderTemplate actual hacía `first + ','` que agregaba OTRA coma:
  "Perfecto Juan," → resultado "Perfecto Juan,, en minutos..."
  (esa es la doble coma del screenshot original)

Y sin nombre dejaba `\s*` en la limpieza pero no consumía el espacio
PREVIO, resultando en "Te entiendo , muy responsable" (espacio antes
de la coma).

Fix:
- Si hay nombre: reemplazar (NOMBRE) por el nombre SIN coma extra
  (el template ya la trae).
- Si no hay nombre: consumir también el espacio previo con /\s+\(NOMBRE\)/,
  quedando "Te entiendo, muy responsable" (natural).
- Limpiar dobles espacios residuales por seguridad.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

cj = next(n for n in wf['nodes'] if n['name'] == 'Code in JavaScript1')
code = cj['parameters']['jsCode']

OLD = (
"function _renderTemplate(template, fullName) {\n"
"  var s = String(template == null ? '' : template);\n"
"  if (!s.trim()) return '';\n"
"  var first = String(fullName || '').trim().split(/\\s+/)[0];\n"
"  if (first) {\n"
"    // Replace \"(NOMBRE)\" → \"<first>,\"\n"
"    s = s.replace(/\\(NOMBRE\\)/g, first + ',');\n"
"  } else {\n"
"    // Remove \"(NOMBRE) \" (with trailing space) when name unknown\n"
"    s = s.replace(/\\(NOMBRE\\)\\s*/g, '');\n"
"  }\n"
"  return s;\n"
"}"
)

NEW = (
"function _renderTemplate(template, fullName) {\n"
"  var s = String(template == null ? '' : template);\n"
"  if (!s.trim()) return '';\n"
"  var first = String(fullName || '').trim().split(/\\s+/)[0];\n"
"  if (first) {\n"
"    // Los templates guardados YA traen coma post-NOMBRE (\"(NOMBRE), en minutos...\").\n"
"    // No agregamos coma extra — antes producía \"Juan,, en minutos...\".\n"
"    s = s.replace(/\\(NOMBRE\\)/g, first);\n"
"  } else {\n"
"    // Consume también el espacio PREVIO al (NOMBRE) para no dejar \"Te entiendo , muy\".\n"
"    s = s.replace(/\\s+\\(NOMBRE\\)/g, '').replace(/\\(NOMBRE\\)/g, '');\n"
"  }\n"
"  // Cleanup dobles espacios residuales.\n"
"  s = s.replace(/  +/g, ' ');\n"
"  return s;\n"
"}"
)

if OLD not in code:
    print('!! _renderTemplate marker not found'); sys.exit(2)

cj['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
print('✓ _renderTemplate: no más doble coma + limpieza de espacio previo')

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
