#!/usr/bin/env python3
"""Inyectar LAST_FINCA_QUOTE en user prompt + regla obligatoria.

Problema observado caso 3 (CARMEN_DE_APICALA_#11):
- Cliente dio fechas y eligió finca via "Me dejas ver la 11".
- Bot mostró card (BIT call para get_finca_details devolvió quote).
- Cliente preguntó "cuánto me queda en total".
- LLM NO llamó inventory_reader_tool de nuevo → respondió "necesito tus fechas"
  aunque las fechas YA estaban en search_criteria.

Causa: el quote precalculado vive en `last_inventory_items.selected_finca.quote`
(persistido por BIT en su última corrida). Pero ese campo no se inyecta al user
prompt del LLM → el LLM "olvidó" el quote entre turnos.

Fix:
1. Inyectar LAST_FINCA_QUOTE en el user prompt de Run offering pass — leído
   desde Refetch.last_inventory_items.selected_finca (que persiste entre turnos).
2. Agregar regla obligatoria en system prompt: "Si LAST_FINCA_QUOTE existe y
   coincide con la finca a la que se refiere el cliente, USA ESE QUOTE directo
   sin llamar a inventory_reader_tool. Si no existe, llama get_finca_details
   ANTES de responder precio. NUNCA digas 'necesito fechas' si search_criteria
   ya las trae."
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# 1. Inject LAST_FINCA_QUOTE into user prompt of offering
OLD_TEXT_ANCHOR = """CURRENT_MESSAGE:
{{ JSON.stringify($('Merge Sets1').first().json['last-message'] || null, null, 2) }}"""

NEW_TEXT_ANCHOR = """CURRENT_MESSAGE:
{{ JSON.stringify($('Merge Sets1').first().json['last-message'] || null, null, 2) }}

LAST_FINCA_QUOTE:
{{ (() => {
  try {
    var ref = $('Refetch last_inventory_items').first().json;
    var cache = ref && ref.last_inventory_items;
    if (typeof cache === 'string') { try { cache = JSON.parse(cache); } catch(e){ cache=null; } }
    if (!cache) return 'no_quote_cached';
    var sf = cache.selected_finca;
    if (sf && sf.quote) {
      return JSON.stringify({
        finca_id: sf.finca_id,
        codigo_original: sf.codigo_original,
        quote: sf.quote
      }, null, 2);
    }
    // also try items[0] if no selected_finca
    var items = Array.isArray(cache.items) ? cache.items : [];
    var withQuote = items.filter(function(it){ return it && it.quote; });
    if (withQuote.length === 1) {
      return JSON.stringify({
        finca_id: withQuote[0].finca_id,
        codigo_original: withQuote[0].codigo_original,
        quote: withQuote[0].quote
      }, null, 2);
    }
    return 'no_quote_cached';
  } catch (e) { return 'no_quote_cached'; }
})() }}"""

# 2. Reinforce system message rule
OLD_SM_RULE = """      - Si quote NO viene en el item (cliente todavía no dio fechas), pide las fechas antes de cotizar: "Para darte el precio exacto necesito tus fechas. ¿Tienes un fin de semana o rango pensado?"."""

NEW_SM_RULE = """      - Si quote NO viene en el item PERO search_criteria YA TIENE fecha_inicio y fecha_fin: llama OBLIGATORIAMENTE a `inventory_reader_tool.get_finca_details(finca_id=X)` ANTES de responder. NUNCA digas "necesito fechas" cuando search_criteria ya las trae.
      - Si quote NO viene en el item Y search_criteria NO tiene fechas: pide las fechas. "Para darte el precio exacto necesito tus fechas. ¿Tienes un fin de semana o rango pensado?".
      - Si en el user prompt llega `LAST_FINCA_QUOTE` con datos (no es 'no_quote_cached') y matchea la finca de la pregunta, ESE ES TU SOURCE OF TRUTH — úsalo sin volver a llamar al tool. Si no matchea o está vacío, llama get_finca_details."""

found_text = False
found_sm = False
for n in wf['nodes']:
    if n.get('name') != 'Run offering pass': continue
    # text param
    text = n['parameters'].get('text','')
    if 'LAST_FINCA_QUOTE:' in text:
        print('!! LAST_FINCA_QUOTE already injected')
    elif OLD_TEXT_ANCHOR not in text:
        print('!! text anchor not found')
        print(text[:1500])
        sys.exit(2)
    else:
        n['parameters']['text'] = text.replace(OLD_TEXT_ANCHOR, NEW_TEXT_ANCHOR, 1)
        print('✓ user prompt: LAST_FINCA_QUOTE injected')
        found_text = True
    # system message
    sm = n['parameters']['options']['systemMessage']
    if 'LAST_FINCA_QUOTE` con datos' in sm:
        print('!! SM rule already deployed')
    elif OLD_SM_RULE not in sm:
        print('!! SM rule anchor not found')
        sys.exit(3)
    else:
        n['parameters']['options']['systemMessage'] = sm.replace(OLD_SM_RULE, NEW_SM_RULE, 1)
        print('✓ system prompt: regla obligatoria de cotización reforzada')
        found_sm = True
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
