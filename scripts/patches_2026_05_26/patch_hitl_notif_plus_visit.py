#!/usr/bin/env python3
"""2 fixes:

1. shouldNotify: agregar HITL_REQUEST (cuando el bot transfiere al asesor
   explícitamente, el asesor debe ser notificado para tomar control).
   Igual mecanismo que RESERVATION_APPROVED — staff_finca_selected_v1 vía
   Chatwoot account 1 → +57.

2. Reforzar offering+confirming: cuando cliente quiere visitar/conocer SIN
   fecha específica, emitir VISIT_REQUEST (no HITL_REQUEST). Hoy el LLM
   estaba emitiendo HITL aunque la regla VISIT_REQUEST ya existe — falta
   prioridad explícita.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# === Fix 1: shouldNotify also fires on HITL_REQUEST ===
OLD = """    shouldNotify:
      // SOLO RESERVATION_APPROVED dispara la notif al asesor (May 26 2026).
      // Antes también disparaba en CLIENT_CHOSE pero se removió porque el
      // asesor solo necesita enterarse cuando el cliente aprueba el PDF
      // (no cuando selecciona finca — todavía puede cambiar de opinión).
      (toolChosen === 'confirming_reservation_agent' &&
        intent === 'RESERVATION_APPROVED' &&
        Boolean(selectedFincaId)),"""

NEW = """    shouldNotify:
      // RESERVATION_APPROVED dispara la notif al asesor (cliente aprobó PDF).
      (toolChosen === 'confirming_reservation_agent' &&
        intent === 'RESERVATION_APPROVED' &&
        Boolean(selectedFincaId)) ||
      // HITL_REQUEST (May 26 2026): cuando el bot transfiere al asesor
      // explícitamente, también notificamos. No requiere selectedFincaId.
      (intent === 'HITL_REQUEST'),"""

for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    if OLD not in code:
        if "intent === 'HITL_REQUEST'" in code and 'shouldNotify' in code:
            print('!! HITL_REQUEST already in shouldNotify')
        else:
            print('!! anchor not found'); sys.exit(2)
    else:
        n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
        print('✓ shouldNotify: ahora dispara también en HITL_REQUEST')
    break

# === Fix 2: prompt rule prioritizing VISIT_REQUEST over HITL_REQUEST ===
VISIT_RULE = (
"- 🚪 REGLA — VISIT_REQUEST vs HITL_REQUEST (May 26 2026, refuerzo):\n"
"  Si el cliente pide visitar / conocer la propiedad / reunirse / verse en persona / oficinas:\n"
"  • SIN fecha+hora específica (ej: \"puedo conocerla?\", \"se puede visitar?\", \"quiero ir a ver\", \"quiero visitarlos\", \"me gustaría reunirme\", \"hablar en persona\"):\n"
"    → intent=\"VISIT_REQUEST\" — el sistema responde con el template configurado en visit_offer_message_template ofreciéndole agendar entre martes-jueves o por videollamada. NUNCA HITL_REQUEST aquí.\n"
"  • CON fecha y hora específica (ej: \"el sábado a las 3pm\", \"mañana en la tarde\", \"el 20 a las 10\"):\n"
"    → intent=\"HITL_REQUEST\" — el sistema notifica al asesor para coordinar.\n"
"  • Si el cliente dice \"transfiéreme con un asesor\" / \"pásame un humano\" / \"quiero hablar con alguien\" directamente, sin contexto de visita:\n"
"    → intent=\"HITL_REQUEST\".\n"
"  PROHIBIDO emitir HITL_REQUEST cuando el cliente solo expresa interés en visitar sin dar fecha. Eso bota al cliente al asesor en falso. VISIT_REQUEST permite que el bot ofrezca el espacio primero.\n"
)

# Anchor: insert before the existing FINCA MENCIONADA POR CÓDIGO rule
ANCHOR_FOR_VISIT = "- 🎯 REGLA — FINCA MENCIONADA POR CÓDIGO en el mensaje del cliente (caso 1.7 sub-bug):"

for agent in ['Run offering pass','Run qa pass','Run confirming_reservation pass','Run verifying_availability pass']:
    for n in wf['nodes']:
        if n['name'] != agent: continue
        sm = n['parameters']['options']['systemMessage']
        if 'VISIT_REQUEST vs HITL_REQUEST' in sm:
            print(f'!! {agent}: visit-vs-hitl rule already')
            break
        if ANCHOR_FOR_VISIT not in sm:
            print(f'!! {agent}: anchor not found')
            break
        n['parameters']['options']['systemMessage'] = sm.replace(ANCHOR_FOR_VISIT, VISIT_RULE + ANCHOR_FOR_VISIT, 1)
        print(f'✓ {agent}: VISIT_REQUEST priority rule added')
        break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
