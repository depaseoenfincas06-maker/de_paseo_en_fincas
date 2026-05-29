#!/usr/bin/env python3
"""Punto 2 (May 28 2026): HITL ya NO debe desactivar el agente. El agente sigue
contestando y notifica al asesor; solo se desactiva cuando un humano escribe
desde Chatwoot (path ya existente en Normalize inbound payload + Upsert sync).

Fix: quitar `agente_activo: false` de los 3 nodos que aún lo setean en HITL:
- Parse QA validator (routeMode === 'HITL')
- Build unknown state payload (unsupported_state)
- Build audio transcription failure result (audio fail)
Se deja waiting_for + hitl_reason. La notificación HITL se mantiene intacta.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# Node-specific replacements
EDITS = {
    'Parse QA validator': [
        ("""routeMode === 'HITL'
          ? {
              agente_activo: false,
              waiting_for: 'CLIENT',
            }
          : {}""",
         """routeMode === 'HITL'
          ? {
              waiting_for: 'CLIENT',
            }
          : {}"""),
    ],
    'Build unknown state payload': [
        ("""post_actions: {
        agente_activo: false,
        waiting_for: 'CLIENT',
        hitl_reason: 'unsupported_state',
      },""",
         """post_actions: {
        waiting_for: 'CLIENT',
        hitl_reason: 'unsupported_state',
      },"""),
    ],
    'Build audio transcription failure result': [
        ("""post_actions: {
    agente_activo: false,
    waiting_for: 'CLIENT',
    hitl_reason: 'audio_transcription_failed',
  },""",
         """post_actions: {
    waiting_for: 'CLIENT',
    hitl_reason: 'audio_transcription_failed',
  },"""),
    ],
}

applied = []
for n in wf['nodes']:
    if n['name'] not in EDITS: continue
    code = n['parameters'].get('jsCode','')
    for old, new in EDITS[n['name']]:
        if 'agente_activo' not in old:
            continue
        if old not in code:
            print(f'!! anchor not found in {n["name"]}')
            sys.exit(2)
        code = code.replace(old, new, 1)
    n['parameters']['jsCode'] = code
    applied.append(n['name'])

if len(applied) != 3:
    print(f'!! only applied to {applied}'); sys.exit(3)
print('✓ removed agente_activo:false from:', ', '.join(applied))

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
