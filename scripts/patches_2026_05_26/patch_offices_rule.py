#!/usr/bin/env python3
"""Cuando el cliente pregunta por oficinas/sede/dónde quedan, el bot DEBE
citar las 2 oficinas de company_knowledge (Anapoima Villa Paola + Pereira
El Paraíso) + ofrecer visita o videollamada. NUNCA decir "100% digital"
ni inventar respuestas sobre la sede.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OFFICES_RULE = (
"- 🏢 REGLA — PREGUNTAS SOBRE OFICINAS / SEDE / DÓNDE QUEDAN (May 26 2026):\n"
"  Triggers (cliente): \"tienen oficinas?\" / \"dónde queda la sede?\" / \"dónde están ubicados?\" / \"dónde tienen oficinas?\" / \"puedo ir a su oficina?\".\n"
"  Comportamiento OBLIGATORIO:\n"
"  • CITA las 2 oficinas de `company_knowledge` literalmente:\n"
"    - Anapoima (Cundinamarca) — Finca Villa Paola, sector Alto del Cobre.\n"
"    - Pereira (Risaralda) — Finca El Paraíso, sector Altagracia.\n"
"  • Ofrecé visita presencial (martes a jueves) O videollamada desde cualquiera de las 2 oficinas.\n"
"  • PROHIBIDO inventar respuestas tipo \"operamos 100% digital\" / \"todo es digital\" / \"solo virtual\". TENEMOS oficinas físicas. La empresa SÍ tiene sede.\n"
"  • NUNCA confundas la dirección de la EMPRESA (oficinas) con la dirección de una FINCA específica. Son cosas distintas.\n"
"  Ejemplo de respuesta correcta:\n"
"    \"jd, sí tenemos oficinas físicas en 2 ubicaciones: Finca Villa Paola en Anapoima (Cundinamarca, sector Alto del Cobre) y Finca El Paraíso en Pereira (Risaralda, sector Altagracia). Si quieres conocer alguna o reunirte con un asesor, podemos agendar una visita entre martes y jueves, o si prefieres, hacemos videollamada desde cualquiera de las 2.\""
)

ANCHOR = "- 🚪 REGLA — VISIT_REQUEST vs HITL_REQUEST"

for agent in ['Run qualifying pass','Run offering pass','Run qa pass','Run confirming_reservation pass','Run verifying_availability pass']:
    for n in wf['nodes']:
        if n['name'] != agent: continue
        sm = n['parameters']['options']['systemMessage']
        if 'PREGUNTAS SOBRE OFICINAS / SEDE' in sm:
            print(f'!! {agent}: offices rule already')
            break
        if ANCHOR in sm:
            n['parameters']['options']['systemMessage'] = sm.replace(ANCHOR, OFFICES_RULE + '\n' + ANCHOR, 1)
            print(f'✓ {agent}: offices rule added (before VISIT_REQUEST anchor)')
        else:
            # qualifying may not have visit anchor — try another
            alt = '- IMPORTANTE: nunca uses signos de admiración'
            if alt in sm:
                n['parameters']['options']['systemMessage'] = sm.replace(alt, OFFICES_RULE + '\n' + alt, 1)
                print(f'✓ {agent}: offices rule added (fallback anchor)')
            else:
                print(f'!! {agent}: no anchor found, skipping')
        break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
