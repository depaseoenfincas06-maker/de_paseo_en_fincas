#!/usr/bin/env python3
"""Revertir hallucination gate: atacaba síntoma equivocado.
La causa real es que last_inventory_items se sobreescribe en cada llamada
a BIT (turn-to-turn). ANAPOIMA_#32 SÍ existe en el inventario y SÍ se ofreció
en cards — pero un turno posterior con otra query pisó el cache.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

GATE_BLOCK = """  var finca = selectedFinca || {};

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

CLEAN = """  var finca = selectedFinca || {};
"""

for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    if 'Finca hallucination gate' not in code:
        print('!! gate not present, nothing to revert'); sys.exit(0)
    if GATE_BLOCK not in code:
        print('!! gate block not matched verbatim'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(GATE_BLOCK, CLEAN, 1)
    print('✓ hallucination gate reverted')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
