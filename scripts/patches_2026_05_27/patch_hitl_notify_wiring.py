#!/usr/bin/env python3
"""Cablear notificación HITL con template hitl_handoff_v1 (3 params: nombre,
teléfono, link). Dos cambios:

1. Customer agent (2NV08zRFKENUsQVC) → 'Prepare selection notifications':
   añadir rama HITL que arma batch cuando candidate.intent==='HITL_REQUEST'
   (sin requerir selectedFincaId), con template_name='hitl_handoff_v1'.

2. Selection Notification Sender (tNvfWKi1TA7O6maf) → 'Send WhatsApp selection
   template': armar processed_params con 3 params cuando template==hitl_handoff_v1.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
def get(wid):
    return json.loads(subprocess.run(['curl','-sk',f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{wid}','-H',f'X-N8N-API-KEY: {JWT}'],capture_output=True,text=True).stdout)
def put(wid, wf):
    ALLOWED={'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution','saveExecutionProgress','saveManualExecutions','errorWorkflow'}
    payload={'name':wf['name'],'nodes':wf['nodes'],'connections':wf['connections'],'settings':{k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
    r=subprocess.run(['curl','-sk','-X','PUT',f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{wid}','-H',f'X-N8N-API-KEY: {JWT}','-H','Content-Type: application/json','-d','@-'],input=json.dumps(payload),capture_output=True,text=True)
    return json.loads(r.stdout).get('active')

# ============ 1. Customer agent — Prepare selection notifications ============
CA='2NV08zRFKENUsQVC'
wf=get(CA)
OLD_BATCH = """const batch =
  settings.selection_notification_enabled === true &&
  candidate.shouldNotify === true &&
  selectedFincaId &&
  recipients.length
    ? recipients.map((recipientPhone) => ({
        conversation_id: String(engine.wa_id || ''),
        selected_finca_id: String(selectedFincaId),
        recipient_phone: recipientPhone,
        template_name:
          String(settings.selection_notification_template_name || 'staff_finca_selected_v1').trim() ||
          'staff_finca_selected_v1',
        template_language:
          String(settings.selection_notification_template_language || 'es_CO').trim() ||
          'es_CO',
        payload: {
          client_name: clientName,
          wa_id: waId || 'Sin dato',
          selected_finca_id: String(selectedFincaId),
          selected_finca_name: String(selectedFinca.nombre || selectedFincaId || 'Sin dato').trim() || 'Sin dato',
          fechas,
          personas:
            searchCriteria.personas !== undefined && searchCriteria.personas !== null
              ? String(searchCriteria.personas)
              : 'Sin dato',
          zona: String(searchCriteria.zona || 'Sin dato').trim() || 'Sin dato',
          chatwoot_link: chatwootLink || 'Sin dato',
        },
      }))
    : [];"""

NEW_BATCH = """const fincaBatch =
  settings.selection_notification_enabled === true &&
  candidate.shouldNotify === true &&
  selectedFincaId &&
  recipients.length
    ? recipients.map((recipientPhone) => ({
        conversation_id: String(engine.wa_id || ''),
        selected_finca_id: String(selectedFincaId),
        recipient_phone: recipientPhone,
        template_name:
          String(settings.selection_notification_template_name || 'staff_finca_selected_v1').trim() ||
          'staff_finca_selected_v1',
        template_language:
          String(settings.selection_notification_template_language || 'es_CO').trim() ||
          'es_CO',
        payload: {
          client_name: clientName,
          wa_id: waId || 'Sin dato',
          selected_finca_id: String(selectedFincaId),
          selected_finca_name: String(selectedFinca.nombre || selectedFincaId || 'Sin dato').trim() || 'Sin dato',
          fechas,
          personas:
            searchCriteria.personas !== undefined && searchCriteria.personas !== null
              ? String(searchCriteria.personas)
              : 'Sin dato',
          zona: String(searchCriteria.zona || 'Sin dato').trim() || 'Sin dato',
          chatwoot_link: chatwootLink || 'Sin dato',
        },
      }))
    : [];

// === Rama HITL (May 28 2026): notificar al asesor cuando el cliente pide
// humano. No requiere finca. Usa template hitl_handoff_v1 (3 params).
const _isHitl = candidate.intent === 'HITL_REQUEST';
const hitlBatch =
  settings.selection_notification_enabled === true &&
  candidate.shouldNotify === true &&
  _isHitl &&
  !selectedFincaId &&
  recipients.length
    ? recipients.map((recipientPhone) => ({
        conversation_id: String(engine.wa_id || ''),
        selected_finca_id: 'HITL',
        recipient_phone: recipientPhone,
        template_name: 'hitl_handoff_v1',
        template_language: 'es_CO',
        payload: {
          client_name: clientName,
          wa_id: waId || 'Sin dato',
          chatwoot_link: chatwootLink || 'Sin dato',
          is_hitl: true,
        },
      }))
    : [];

const batch = fincaBatch.concat(hitlBatch);"""

done=[]
for n in wf['nodes']:
    if n['name']!='Prepare selection notifications': continue
    code=n['parameters']['jsCode']
    if 'hitlBatch' in code:
        done.append('CA: already'); break
    if OLD_BATCH not in code:
        print('!! CA batch anchor not found'); sys.exit(2)
    n['parameters']['jsCode']=code.replace(OLD_BATCH,NEW_BATCH,1)
    done.append('CA: HITL batch added'); break
active=put(CA,wf)
print('\n'.join(done), f'| PUT CA active={active}')

# ============ 2. Sender — Send WhatsApp selection template ============
OS='tNvfWKi1TA7O6maf'
sw=get(OS)
OLD_PARAMS = """      processed_params: {
        body: {
          '1': clientName !== 'Sin dato' ? clientName : 'Cliente',
          '2': detail,
        },
      },"""
NEW_PARAMS = """      processed_params: {
        body: templateName === 'hitl_handoff_v1'
          ? {
              '1': clientName !== 'Sin dato' ? clientName : 'Cliente',
              '2': text(payload.wa_id),
              '3': text(payload.chatwoot_link),
            }
          : {
              '1': clientName !== 'Sin dato' ? clientName : 'Cliente',
              '2': detail,
            },
      },"""
done2=[]
for n in sw['nodes']:
    if n['name']!='Send WhatsApp selection template': continue
    code=n['parameters']['jsCode']
    if "templateName === 'hitl_handoff_v1'" in code:
        done2.append('Sender: already'); break
    if OLD_PARAMS not in code:
        print('!! Sender params anchor not found'); sys.exit(3)
    n['parameters']['jsCode']=code.replace(OLD_PARAMS,NEW_PARAMS,1)
    done2.append('Sender: 3-param HITL branch added'); break
active2=put(OS,sw)
print('\n'.join(done2), f'| PUT Sender active={active2}')
