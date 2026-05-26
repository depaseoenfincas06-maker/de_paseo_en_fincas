#!/usr/bin/env python3
"""
B.1 reinforcement — niños umbral de 4 años (NO 2, NO 6).

Bug confirmado en Chatwoot conv 1 (real, 2026-05-26): el bot inventó
"menores de 2 años (bebés de brazos)" y dijo que niños de 2, 3 y 7 años
TODOS cuentan. La regla CORRECTA es: solo 5+ cuentan.

Causa: la regla está en `global_prompt_addendum` pero el LLM la ignora.
Fix: reforzar DIRECTAMENTE en cada prompt con lenguaje fuerte, ejemplos
numéricos, y prohibición explícita de inventar otros umbrales.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

KIDS_BLOCK = (
"- 👶 REGLA INVIOLABLE — UMBRAL DE NIÑOS = 5 AÑOS:\n"
"  - Niños de 0, 1, 2, 3 o 4 años → NO cuentan en el conteo de huéspedes, NO se cobran.\n"
"  - Niños de 5 años en adelante → SÍ cuentan como huéspedes, se cobran igual que un adulto.\n"
"  - NUNCA inventes otro umbral. NO digas \"menores de 2\", NO digas \"bebés de brazos\", NO digas \"mayores de 6\".\n"
"    El único umbral válido es 4 años cumplidos (los de 4 NO cuentan; los de 5 sí).\n"
"  - Ejemplos numéricos para que no quede duda:\n"
"    • Niños de 2, 3 y 7 → solo el de 7 cuenta. Suma 1 al grupo.\n"
"    • Niños de 4 y 6 → solo el de 6 cuenta. Suma 1.\n"
"    • Niños de 5, 8, 10 → los 3 cuentan. Suma 3.\n"
"    • Niños de 1, 2, 3, 4 → ninguno cuenta. Suma 0.\n"
"  - Si el cliente dice \"van X niños pequeños\" SIEMPRE pregunta las edades antes de sumarlos."
)

# Anchor: insert BEFORE REGLA POST-CAMBIO (existe en offering+qa+verifying+confirming)
ANCHOR = "- ⚡ REGLA POST-CAMBIO (CHANGE_FINCA / cambio fechas / cambio personas) — CASO #1.9:"
INSERT = KIDS_BLOCK + "\n" + ANCHOR

count = 0
for agent_name in ['Run offering pass','Run qa pass','Run verifying_availability pass','Run confirming_reservation pass']:
    for n in wf['nodes']:
        if n['name'] != agent_name: continue
        sm = n['parameters']['options']['systemMessage']
        if 'UMBRAL DE NIÑOS = 5 AÑOS' in sm:
            print(f'!! {agent_name}: kids rule already deployed')
            break
        if ANCHOR not in sm:
            print(f'!! {agent_name}: anchor not found')
            break
        n['parameters']['options']['systemMessage'] = sm.replace(ANCHOR, INSERT, 1)
        print(f'✓ {agent_name}: KIDS umbral 5 años reforzado')
        count += 1
        break

# Also for qualifying — using its alternate anchor (it has the SHOW_REVIEW / SAFE_ANCHOR if added, else use bigger pattern)
for n in wf['nodes']:
    if n['name'] != 'Run qualifying pass': continue
    sm = n['parameters']['options']['systemMessage']
    if 'UMBRAL DE NIÑOS = 5 AÑOS' in sm:
        print('!! qualifying: already')
        break
    # Try a known qualifying anchor — the "no use signs of admiración" rule
    alt = '- IMPORTANTE: nunca uses signos de admiración'
    if alt in sm:
        n['parameters']['options']['systemMessage'] = sm.replace(alt, KIDS_BLOCK + '\n' + alt, 1)
        print('✓ qualifying: KIDS umbral reforzado (anchor admiración)')
        count += 1
        break
    print('!! qualifying anchor missing — skipping (low impact en QUALIFYING)')
    break

if count == 0:
    print('!! nothing applied'); sys.exit(1)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
