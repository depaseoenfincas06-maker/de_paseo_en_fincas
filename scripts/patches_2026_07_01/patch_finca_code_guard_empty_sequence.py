#!/usr/bin/env python3
"""Extensión del guardrail finca-por-código (Jul 1 2026): manejar el caso
en que el LLM del offering se ATASCA en la tool call y produce output vacío.

Sintomas observados (batch 4 real-price):
- Cliente pide "Cuánto sería el total exacto de CARMEN_DE_APICALA_02?"
- Cliente pide "Cuánto sería el total exacto de PEREIRA_#03?"
- LLM llama a inventory_reader_tool pero NO produce JSON final.
- Downstream ve: tool_output_parsed vacío, intent null, outbound_sequence = [].
- Finalize offering outbound: shouldInject=false → return con
  offering_context_message: null → BOT NO ENVÍA NADA. Cliente silencio total.

Fix: cuando shouldInject sea false PERO detectamos código de finca en el
mensaje del cliente Y hay contextMessage listo (del guardrail), inyectar
ese mensaje como ÚNICO outbound. Cliente al menos recibe respuesta honesta.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
BASE = 'https://n8n.depaseoenfincas.raaamp.co'
WID = '2NV08zRFKENUsQVC'
URL = f'{BASE}/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """if (!shouldInject) {
  return [
    {
      json: {
        ...base,
        offering_context_message: null,
      },
    },
  ];
}"""

NEW = """if (!shouldInject) {
  // Layer 4-guardrail extendido (Jul 1 2026): si el offering LLM se atascó
  // en la tool call y outbound_sequence quedó vacío, PERO detectamos código
  // de finca en el mensaje del cliente y armamos contextMessage, inyectar
  // ese mensaje como único outbound. Evita silencio total del bot.
  if (codeMatch && contextMessage && (!outboundSequence || outboundSequence.length === 0)) {
    const soloItem = { type: 'text', content: contextMessage };
    return [
      {
        json: {
          ...base,
          offering_context_message: contextMessage,
          outbound_sequence: [soloItem],
          outbound_sequence_json: JSON.stringify([soloItem]),
          outbound_message: contextMessage,
          final_whatsapp_text: contextMessage,
        },
      },
    ];
  }
  return [
    {
      json: {
        ...base,
        offering_context_message: null,
      },
    },
  ];
}"""

applied = False
for n in wf['nodes']:
    if n['name'] != 'Finalize offering outbound': continue
    code = n['parameters']['jsCode']
    if 'Layer 4-guardrail extendido' in code:
        print('already deployed'); sys.exit(0)
    if OLD not in code:
        print('!! anchor missing'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    applied = True
    print('✓ Finalize offering outbound: fallback determinístico para outbound vacío')
    break
if not applied: sys.exit(3)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {
    'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED},
}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
