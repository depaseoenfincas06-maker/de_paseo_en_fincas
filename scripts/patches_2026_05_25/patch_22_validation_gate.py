#!/usr/bin/env python3
"""
Track 2.2 — Validation gate antes de DOCUMENT_READY (createReservationDocumentItem).

El confirming_reservation_agent a veces emite DOCUMENT_READY sin haber
recolectado todos los datos del cliente. Resultado: PDF se genera con
celdas en blanco (name, doc, phone, email, address vacíos).

Fix: en createReservationDocumentItem, después de armar el payload pero
ANTES de encodear la URL, validar campos críticos. Si falta alguno,
NO devuelve el media_group del PDF — devuelve un mensaje de texto que
le pide al cliente los campos faltantes específicos.

Campos críticos (todos deben estar no-vacíos):
  - client_name
  - client_document_type + client_document_number
  - client_phone
  - client_email
  - client_address
  - fecha_inicio + fecha_fin
  - tarifa_noche (> 0)
  - total (> 0)
  - property_code

Campos NO críticos (pueden ser 0 / vacíos legítimamente):
  - limpieza_final (algunas fincas no cobran)
  - deposito (raro pero posible)
  - servicio_empleada_* (solo aplica si la finca lo requiere)
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

    # Anchor: right BEFORE the encodeBase64UrlJson(payload) call
    OLD = (
"  var encoded = encodeBase64UrlJson(payload);\n"
"  var pdfUrl = publicBase.replace(/\\/$/, '') + '/api/reservation-confirmation.pdf?payload=' + encoded;"
    )
    NEW = (
"  // === Validation gate (Track 2.2 — May 26 2026) ===\n"
"  // Antes de emitir el PDF, validamos que los campos CRÍTICOS estén\n"
"  // poblados. El LLM (confirming_reservation_agent) a veces dispara\n"
"  // DOCUMENT_READY sin haber recolectado todos los datos del cliente —\n"
"  // el PDF resultante queda con celdas en blanco. Este gate determinístico\n"
"  // bloquea esa salida y devuelve un mensaje pidiendo los datos faltantes.\n"
"  //\n"
"  // Críticos (deben ser no-vacíos / positivos):\n"
"  //   client_name, client_document_*, client_phone, client_email,\n"
"  //   client_address, fecha_inicio, fecha_fin, tarifa_noche>0, total>0,\n"
"  //   property_code\n"
"  // NO críticos (pueden ser 0 / vacíos legítimamente):\n"
"  //   limpieza_final, deposito, servicio_empleada_*\n"
"  var __isNonEmpty = function(v) {\n"
"    if (v == null) return false;\n"
"    return String(v).trim() !== '';\n"
"  };\n"
"  var __isPositiveNumber = function(v) {\n"
"    var n = Number(v);\n"
"    return Number.isFinite(n) && n > 0;\n"
"  };\n"
"  var __missing = [];\n"
"  if (!__isNonEmpty(payload.client_name)) __missing.push('nombre completo');\n"
"  if (!__isNonEmpty(payload.client_document_type) || !__isNonEmpty(payload.client_document_number)) __missing.push('tipo y número de documento (ej. CC 1234567890)');\n"
"  if (!__isNonEmpty(payload.client_phone)) __missing.push('número de celular');\n"
"  if (!__isNonEmpty(payload.client_email)) __missing.push('correo electrónico');\n"
"  if (!__isNonEmpty(payload.client_address)) __missing.push('dirección');\n"
"  if (!__isNonEmpty(payload.fecha_inicio) || !__isNonEmpty(payload.fecha_fin)) __missing.push('fechas de la reserva');\n"
"  if (!__isPositiveNumber(payload.tarifa_noche)) __missing.push('tarifa por noche');\n"
"  if (!__isPositiveNumber(payload.total)) __missing.push('cotización total');\n"
"  if (!__isNonEmpty(payload.property_code)) __missing.push('propiedad seleccionada');\n"
"  if (__missing.length > 0) {\n"
"    console.error('[createReservationDocumentItem] DOCUMENT_READY blocked, missing:', __missing.join(', '));\n"
"    var __list = __missing.map(function(m) { return '• ' + m; }).join('\\n');\n"
"    return {\n"
"      type: 'text',\n"
"      content: 'Antes de generar tu confirmación necesito completar estos datos:\\n\\n' + __list + '\\n\\nMe los compartes y te armo el PDF',\n"
"      media_url: null,\n"
"      media_urls: undefined,\n"
"      property_title: null,\n"
"      property_id: finca.finca_id || null,\n"
"    };\n"
"  }\n"
"\n"
"  var encoded = encodeBase64UrlJson(payload);\n"
"  var pdfUrl = publicBase.replace(/\\/$/, '') + '/api/reservation-confirmation.pdf?payload=' + encoded;"
    )

    if OLD not in code:
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    print('✓ createReservationDocumentItem: validation gate agregado')
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
