#!/usr/bin/env python3
"""A.5 — Despedida CUSTOMER_DECLINED. Solo deploy en los 4 agentes principales
(offering/qa/verifying/confirming). qualifying no aplica (cliente apenas
empieza, raro que dijera "ya reservé otra parte" en QUALIFYING).

DB update (funnel_status=lost) → separado: se hace en otra iteración o el
asesor lo marca en Chatwoot UI."""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

FAREWELL_BLOCK = (
"- 👋 REGLA — CUSTOMER_DECLINED (cliente desiste explícitamente):\n"
"  Triggers (frases del cliente, todas → intent=\"CUSTOMER_DECLINED\"):\n"
"    \"ya reservé en otra parte\" / \"ya tomé otra opción\" / \"reservamos otra finca\"\n"
"    \"no me sirve, gracias\" / \"no, ya no\" / \"al final no\"\n"
"    \"cambiamos de plan, no vamos\" / \"se cancela el viaje\"\n"
"  NO triggers (NO usar CUSTOMER_DECLINED, son ambiguos):\n"
"    \"voy a pensarlo\" / \"déjame revisar\" / \"era solo cotizando\" — para esos, mantené el flujo normal.\n"
"  Cuando emites CUSTOMER_DECLINED, tu `respuesta` DEBE ser LITERALMENTE este texto (reemplazá [NOMBRE] por el nombre del cliente si lo tenés, o quitálo):\n"
"    \"[NOMBRE], agradezco muchísimo tu atención y esperamos que en una próxima oportunidad pienses en depaseoenfincas.com para visitar y elegirnos a la hora de tus vacaciones junto a tu familia. Un fuerte abrazo. 🌳\""
)

SAFE_ANCHOR = "- ⚡ REGLA POST-CAMBIO (CHANGE_FINCA / cambio fechas / cambio personas) — CASO #1.9:"
INSERT_BLOCK = FAREWELL_BLOCK + "\n" + SAFE_ANCHOR

count = 0
for agent_name in ['Run offering pass','Run qa pass','Run verifying_availability pass','Run confirming_reservation pass']:
    for n in wf['nodes']:
        if n['name'] != agent_name: continue
        sm = n['parameters']['options']['systemMessage']
        if SAFE_ANCHOR not in sm:
            print(f'!! {agent_name}: anchor not found, skipping')
            break
        if 'CUSTOMER_DECLINED' in sm:
            print(f'!! {agent_name}: already deployed')
            break
        n['parameters']['options']['systemMessage'] = sm.replace(SAFE_ANCHOR, INSERT_BLOCK, 1)
        print(f'✓ {agent_name}: CUSTOMER_DECLINED rule added')
        count += 1
        break

if count == 0:
    print('!! nothing to deploy'); sys.exit(0)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
