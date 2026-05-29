#!/usr/bin/env python3
"""Fix CATASTRÓFICO de hallucination: el LLM emitió DOCUMENT_READY para
ANAPOIMA_#32 — finca que NO existe en el inventario BIT (real: #09/#23/#53).
_rehydrateFinca no encuentra finca_id, devuelve datos LLM sin
deposito_seguridad ni limpieza_final_valor → PDF con $0.

Gate determinístico: en createReservationDocumentItem, validar que la
finca tiene los campos canónicos del inventario (precio_base_noche +
deposito_seguridad + limpieza_final_valor). Si falta cualquiera, es
una finca alucinada o el cache está vacío → BLOQUEAR PDF.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

ANCHOR = """function createReservationDocumentItem(selectedFinca, toolOutputParsed, finalWhatsappText) {
  if (!toolOutputParsed || toolOutputParsed.intent !== 'DOCUMENT_READY') return null;
  var publicBase = String($('config').first().json.public_app_base_url || '').trim();
  if (!publicBase) return null;

  var finca = selectedFinca || {};"""

REPLACEMENT = """function createReservationDocumentItem(selectedFinca, toolOutputParsed, finalWhatsappText) {
  if (!toolOutputParsed || toolOutputParsed.intent !== 'DOCUMENT_READY') return null;
  var publicBase = String($('config').first().json.public_app_base_url || '').trim();
  if (!publicBase) return null;

  var finca = selectedFinca || {};

  // === Finca hallucination gate (May 26 2026) ===
  // Bug observado: LLM emite DOCUMENT_READY con selected_finca={codigo:'ANAPOIMA_#32'}
  // pero esa finca NO está en el inventario BIT. _rehydrateFinca no encuentra
  // match → devuelve datos LLM partial sin deposito_seguridad ni limpieza_final_valor.
  // Resultado: PDF con $0 en depósito y limpieza, y el bot inventa una excusa
  // ("el sistema te respeta esas condiciones sin cobros adicionales").
  //
  // Validación: una finca rehidratada desde BIT DEBE tener los campos canónicos
  // (precio_base_noche, deposito_seguridad, limpieza_final_valor). Si falta
  // cualquiera, es hallucination o cache empty → bloquear PDF y notificar.
  var __pricingFields = ['deposito_seguridad', 'limpieza_final_valor'];
  var __anyPriceField = ['precio_base_noche', 'precio_fin_semana', 'precio_festivo', 'precio_temporada_alta'];
  var __missingPricing = __pricingFields.filter(function(k) {
    var v = finca[k];
    return v == null || v === '' || (typeof v === 'number' && isNaN(v));
  });
  var __hasAnyPrice = __anyPriceField.some(function(k) {
    var v = Number(finca[k]);
    return Number.isFinite(v) && v > 0;
  });
  if (__missingPricing.length || !__hasAnyPrice) {
    console.error('[createReservationDocumentItem] HALLUCINATION: finca_id=' +
      String(finca.finca_id || finca.codigo_original || '?') +
      ' missing fields=' + __missingPricing.join(',') +
      ' hasAnyPrice=' + __hasAnyPrice +
      ' — selectedFinca probably not in BIT cache');
    return {
      type: 'text',
      content: 'Antes de generarte la confirmación necesito volver a verificar la disponibilidad y la tarifa exacta de la propiedad. Dame un segundo que reviso y te confirmo los valores correctos.',
      media_url: null,
      media_urls: undefined,
      property_title: null,
      property_id: finca.finca_id || null,
    };
  }
"""

for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    if 'Finca hallucination gate' in code:
        print('!! already deployed'); sys.exit(0)
    if ANCHOR not in code:
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(ANCHOR, REPLACEMENT, 1)
    print('✓ createReservationDocumentItem: hallucination gate added (deposito/limpieza/price check)')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
