#!/usr/bin/env python3
"""
Track C.3 — Reply context consecutivo bug (caso 1.8 del feedback 25-may).

Bug: cliente hace reply a card de finca A, bot responde bien. Cliente hace
reply consecutivo a card de finca B, bot responde con datos de A.

Causa raíz identificada en investigación:
1. `replied_to_finca_id` SOLO está expuesto al `qualifying` + `offering`
   prompts. Los demás (qa, verifying, confirming, offering_context) no lo
   ven en su `text` parameter.
2. La regla actual en offering/qualifying es débil ("asume que se refiere
   a esa finca") y NO establece prioridad explícita sobre selected_finca.
   El LLM puede confundirse cuando hay selected_finca + replied_to_finca
   diferentes.

Fix:
A) Reforzar la regla en offering + qualifying con PRIORIDAD EXPLÍCITA:
   replied_to_finca_id GANA sobre selected_finca para THIS turn (salvo que
   el mensaje del cliente diga explícitamente "elijo X").
B) Agregar el mismo bloque REPLY_CONTEXT a qa_pass, verifying, confirming,
   offering_context. Mismo helper `{{ () => {} }}`.

Las 4 ramas comparten el mismo lookup desde Merge reply context.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# === Reforzar mensaje de prioridad en la versión que ya tienen offering/qualifying ===
OLD_RULE = (
"if (m.replied_to_finca_id) parts.push('Cliente respondió a un mensaje del bot sobre la finca ' + m.replied_to_finca_id + ' (kind=' + (m.replied_to_message_kind || 'unknown') + '). Si su mensaje no menciona código, asume que se refiere a esa finca.');"
)
NEW_RULE = (
"if (m.replied_to_finca_id) parts.push('⚡ Cliente respondió (reply en WhatsApp) a un mensaje del bot sobre la finca ' + m.replied_to_finca_id + ' (kind=' + (m.replied_to_message_kind || 'unknown') + '). REGLA DE PRIORIDAD: tu respuesta de ESTE turno DEBE ser sobre ' + m.replied_to_finca_id + ', incluso si selected_finca en el contexto es otra. NO cambies selected_finca a menos que el cliente diga explícitamente \"elijo X\" / \"esta me sirve\" / \"vamos con X\". Si el mensaje del cliente no menciona código, asume que pregunta por ' + m.replied_to_finca_id + '. Esta prioridad rige incluso si hay 2 replies consecutivos a fincas distintas — el último reply manda.');"
)

# === REPLY_CONTEXT block to inject in agents that lack it ===
REPLY_BLOCK_SUFFIX = (
"\nREPLY_CONTEXT:\n"
"{{ (() => {\n"
"  const m = $('Merge reply context').item.json;\n"
"  if (!m || !m.replied_to_chatwoot_message_id) return 'no_reply_context';\n"
"  const parts = [];\n"
"  if (m.replied_to_finca_id) parts.push('⚡ Cliente respondió (reply en WhatsApp) a un mensaje del bot sobre la finca ' + m.replied_to_finca_id + ' (kind=' + (m.replied_to_message_kind || 'unknown') + '). REGLA DE PRIORIDAD: tu respuesta de ESTE turno DEBE ser sobre ' + m.replied_to_finca_id + ', incluso si selected_finca en el contexto es otra. NO cambies selected_finca a menos que el cliente diga explícitamente \"elijo X\" / \"esta me sirve\" / \"vamos con X\". Si el mensaje del cliente no menciona código, asume que pregunta por ' + m.replied_to_finca_id + '. Esta prioridad rige incluso si hay 2 replies consecutivos a fincas distintas — el último reply manda.');\n"
"  if (m.replied_to_original_text) parts.push('Texto del mensaje al que respondió: ' + JSON.stringify(m.replied_to_original_text));\n"
"  if (m.replied_to_original_attachments) parts.push('Adjuntos del mensaje al que respondió: ' + JSON.stringify(m.replied_to_original_attachments));\n"
"  if (m.replied_to_original_sender) parts.push('Quien envió el mensaje original: ' + m.replied_to_original_sender);\n"
"  if (parts.length === 0) parts.push('El cliente respondió a un mensaje pero no encontramos su contenido. Trata su mensaje como continuación de una conversación, no como pregunta aislada.');\n"
"  return parts.join('\\n');\n"
"})() }}"
)

# 1. Reinforce in offering + qualifying
for agent_name in ['Run offering pass', 'Run qualifying pass']:
    for n in wf['nodes']:
        if n['name'] != agent_name: continue
        t = n['parameters'].get('text', '')
        if OLD_RULE not in t:
            print(f'!! {agent_name}: anchor not found for reinforcement'); sys.exit(2)
        if 'REGLA DE PRIORIDAD' in t:
            print(f'!! {agent_name}: rule already reinforced')
        else:
            n['parameters']['text'] = t.replace(OLD_RULE, NEW_RULE, 1)
            print(f'✓ {agent_name}: reply rule reinforced with explicit priority')
        break

# 2. Add REPLY_CONTEXT block to agents that lack it
for agent_name in ['Run qa pass', 'Run verifying_availability pass', 'Run confirming_reservation pass', 'Run offering context pass']:
    for n in wf['nodes']:
        if n['name'] != agent_name: continue
        t = n['parameters'].get('text', '')
        if 'replied_to_finca' in t:
            print(f'!! {agent_name}: already has reply block, skipping')
            break
        n['parameters']['text'] = t + REPLY_BLOCK_SUFFIX
        print(f'✓ {agent_name}: REPLY_CONTEXT block appended to text param')
        break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {
    'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED},
}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL,
                     '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
out = json.loads(r2.stdout)
print(f'\nPUT ok. active={out.get("active")}')
