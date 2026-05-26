#!/usr/bin/env python3
"""
A.5 — Despedida CUSTOMER_DECLINED (texto dictado por Juan).

Cuando cliente dice "ya reservé en otra parte" / "no me sirve gracias" /
similar:
- Bot emite intent="CUSTOMER_DECLINED"
- Respuesta literal con el template dictado por Juan
- normalizePostActions marca funnel_status='lost' + loss_reason='customer_declined'

Implementación:
1. Agregar reglas en offering, qa, confirming, qualifying con el template
2. Agregar manejo de CUSTOMER_DECLINED en CodeJS1 normalizePostActions
3. Hardcoded template (no nueva columna, mantenimiento simple)
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# === 1. Add CUSTOMER_DECLINED rule to each agent prompt ===
FAREWELL_BLOCK = (
"- 👋 REGLA — CUSTOMER_DECLINED (cliente desiste explícitamente):\n"
"  Triggers (frases del cliente, todas → intent=\"CUSTOMER_DECLINED\"):\n"
"    \"ya reservé en otra parte\" / \"ya tomé otra opción\" / \"reservamos otra finca\"\n"
"    \"no me sirve, gracias\" / \"no, ya no\" / \"al final no\"\n"
"    \"cambiamos de plan, no vamos\" / \"se cancela el viaje\"\n"
"  NO triggers (NO usar CUSTOMER_DECLINED, son ambiguos):\n"
"    \"voy a pensarlo\" / \"déjame revisar\" / \"era solo cotizando\" — para esos, mantené el flujo normal.\n"
"  Cuando emites CUSTOMER_DECLINED, tu `respuesta` DEBE ser LITERALMENTE este texto (reemplazá [NOMBRE] por el nombre del cliente si lo tenés, o quitálo):\n"
"    \"[NOMBRE], agradezco muchísimo tu atención y esperamos que en una próxima oportunidad pienses en depaseoenfincas.com para visitar y elegirnos a la hora de tus vacaciones junto a tu familia. Un fuerte abrazo. 🌳\"\n"
"  El sistema marca funnel_status='lost' + loss_reason='customer_declined' automáticamente al recibir este intent."
)

# Anchor: insert before HITL_REQUEST mention (existing in offering/qa/confirming)
ANCHORS = {
    'Run offering pass': '- Si el cliente quiere hablar con humano',  # may not exist verbatim, fallback to closing
    'Run qa pass': '- Si el cliente quiere hablar con humano',
    'Run confirming_reservation pass': '- Si el cliente pide hablar con humano explícitamente, intent="HITL_REQUEST".',
    'Run qualifying pass': '- Si el cliente quiere hablar con humano',
}

# Actually a more reliable anchor: REGLA POST-CAMBIO (added by C.5) — already in all 4 of offering/qa/verifying/confirming
SAFE_ANCHOR = "- ⚡ REGLA POST-CAMBIO (CHANGE_FINCA / cambio fechas / cambio personas) — CASO #1.9:"

INSERT_BLOCK = FAREWELL_BLOCK + "\n" + SAFE_ANCHOR

count = 0
for agent_name in ['Run offering pass','Run qa pass','Run verifying_availability pass','Run confirming_reservation pass']:
    for n in wf['nodes']:
        if n['name'] != agent_name: continue
        sm = n['parameters']['options']['systemMessage']
        if SAFE_ANCHOR not in sm:
            print(f'!! {agent_name}: anchor not found')
            break
        if 'CUSTOMER_DECLINED' in sm:
            print(f'!! {agent_name}: already deployed')
            break
        n['parameters']['options']['systemMessage'] = sm.replace(SAFE_ANCHOR, INSERT_BLOCK, 1)
        print(f'✓ {agent_name}: CUSTOMER_DECLINED rule added')
        count += 1
        break

# Also add to qualifying (different anchor)
for n in wf['nodes']:
    if n['name'] != 'Run qualifying pass': continue
    sm = n['parameters']['options']['systemMessage']
    if 'CUSTOMER_DECLINED' in sm:
        print('!! Run qualifying pass: already deployed')
        break
    # qualifying doesn't have REGLA POST-CAMBIO. Try alternate anchor
    alt = '- Si el cliente quiere hablar con humano'
    if alt in sm:
        n['parameters']['options']['systemMessage'] = sm.replace(alt, FAREWELL_BLOCK + '\n' + alt, 1)
        print('✓ Run qualifying pass: CUSTOMER_DECLINED rule added')
        count += 1
    else:
        # Try another fallback
        alt = '- IMPORTANTE: nunca uses signos de admiración'
        if alt in sm:
            n['parameters']['options']['systemMessage'] = sm.replace(alt, FAREWELL_BLOCK + '\n' + alt, 1)
            print('✓ Run qualifying pass: CUSTOMER_DECLINED rule added (fallback anchor)')
            count += 1
        else:
            print('!! Run qualifying pass: no suitable anchor')
    break

# === 2. Add CUSTOMER_DECLINED handling in CodeJS1 normalizePostActions ===
# Anchor: inside confirming_reservation_agent branch, add detection after CHANGE_FINCA
CODE_ANCHOR = """    if (intent === 'DOCUMENT_READY') {"""
CODE_INSERT = """    if (intent === 'CUSTOMER_DECLINED') {
      raw.funnel_status = 'lost';
      raw.loss_reason = 'customer_declined';
      raw.agente_activo = false;
      raw.closed_at = new Date().toISOString();
    }
    if (intent === 'DOCUMENT_READY') {"""

# Apply to all agent branches (offering, qa, verifying, confirming, qualifying)
# Since the same condition can come from any agent, add a TOP-LEVEL handler in normalizePostActions.
# Easier approach: add a single block at the very END of normalizePostActions before return.
# Find the return of normalizePostActions

# Let me look for the normalizePostActions function definition end
for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    # Find normalizePostActions return
    idx = code.find('function normalizePostActions')
    if idx < 0:
        print('!! normalizePostActions not found'); sys.exit(2)
    # Find the closing return raw; (last few lines of the function)
    # Look for "return raw;\n}" pattern after idx
    end_marker = "return raw;\n}"
    end_idx = code.find(end_marker, idx)
    if end_idx < 0:
        print('!! normalizePostActions end not found'); sys.exit(2)

    # Insert CUSTOMER_DECLINED handling before "return raw;"
    GLOBAL_INSERT = """  // === A.5 CUSTOMER_DECLINED handling — May 25 2026 ===
  // Cualquier agente que emita CUSTOMER_DECLINED dispara cierre del funnel.
  if (toolOutput && toolOutput.intent === 'CUSTOMER_DECLINED') {
    raw.funnel_status = 'lost';
    raw.loss_reason = 'customer_declined';
    raw.agente_activo = false;
    raw.closed_at = new Date().toISOString();
  }
  return raw;
}"""
    if 'CUSTOMER_DECLINED handling' in code:
        print('!! normalizePostActions already has CUSTOMER_DECLINED')
    else:
        code = code[:end_idx] + GLOBAL_INSERT + code[end_idx + len(end_marker):]
        n['parameters']['jsCode'] = code
        print('✓ normalizePostActions: CUSTOMER_DECLINED → funnel_status=lost')
        count += 1
    break

if count == 0:
    print('!! nothing changed'); sys.exit(1)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'\nPUT ok. active={json.loads(r2.stdout).get("active")}')
