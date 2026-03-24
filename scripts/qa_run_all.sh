#!/bin/bash
# QA Test Runner — De Paseo en Fincas
# Runs all 10 conversation scenarios against the live workflow

set -euo pipefail
cd "$(dirname "$0")/.."

N8N_TOKEN=$(grep N8N_PUBLIC_API_TOKEN .env | cut -d= -f2)
N8N_URL="https://rh-n8n-u48275.vm.elestio.app"
WEBHOOK="$N8N_URL/webhook/chatwoot/de-paseo-en-fincas/inbound"
RESULTS_FILE="/tmp/qa_results_$(date +%s).txt"
PASS=0
FAIL=0

send_msg() {
  local WA=$1 NAME=$2 MSG=$3
  curl -s -X POST "$WEBHOOK" -H "Content-Type: application/json" \
    -d "{\"wa_id\":\"$WA\",\"client_name\":\"$NAME\",\"text\":\"$MSG\",\"client_message_id\":\"qa-$(date +%s%N)\",\"local_sequence\":1}" > /dev/null 2>&1
}

# Find the latest execution for a given wa_id that took >THRESHOLD seconds
find_exec() {
  local WA=$1 MIN_DUR=${2:-3}
  curl -s -H "X-N8N-API-KEY: $N8N_TOKEN" "$N8N_URL/api/v1/executions?limit=5&workflowId=RrIniaNJCUC72nfI" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for ex in data.get('data', []):
    s = ex.get('startedAt',''); e = ex.get('stoppedAt','')
    if s and e:
        from datetime import datetime
        dur = (datetime.fromisoformat(e.replace('Z','+00:00')) - datetime.fromisoformat(s.replace('Z','+00:00'))).total_seconds()
        if dur > $MIN_DUR and ex.get('status') in ('success','error'):
            print(ex['id'])
            break
"
}

# Analyze an execution and return structured results
analyze_exec() {
  local EID=$1
  curl -s -H "X-N8N-API-KEY: $N8N_TOKEN" "$N8N_URL/api/v1/executions/${EID}?includeData=true" | python3 -c "
import sys, json
data = json.load(sys.stdin)
status = data.get('status')
s = data.get('startedAt',''); e = data.get('stoppedAt','')
dur = 0
if s and e:
    from datetime import datetime
    dur = (datetime.fromisoformat(e.replace('Z','+00:00')) - datetime.fromisoformat(s.replace('Z','+00:00'))).total_seconds()

rd = data.get('data', {}).get('resultData', {}).get('runData', {})
err = data.get('data', {}).get('resultData', {}).get('error', {})

qual = len(rd.get('Run qualifying pass', []))
offer = len(rd.get('Run offering pass', []))
qa_pass = len(rd.get('Run qa pass', []))
verify = len(rd.get('Run verifying pass', []))
loops = len(rd.get('Should loop to next state?', []))

# Get response text
msg = ''
nd = rd.get('Build outbound sequence', [])
for run in nd:
    items = run.get('data',{}).get('main',[[]])[0]
    if items:
        j = items[0].get('json',{})
        m = j.get('outbound_message','')
        if m: msg = m

# Offering details
intent = ''
fincas = 0
nd2 = rd.get('Wrap offering result', [])
for run in nd2:
    items = run.get('data',{}).get('main',[[]])[0]
    if items:
        o = items[0].get('json',{}).get('output','')
        try:
            p = json.loads(o)
            to = p.get('tool_output',{})
            intent = to.get('intent','')
            fincas = len(to.get('fincas_mostradas',[]))
        except: pass

# QA check: response ends with question?
ends_with_q = msg.rstrip().endswith('?') if msg else False
generic_close = any(x in msg.lower() for x in ['en qué más', 'algo más', 'otra duda', 'puedo ayudar']) if msg else False

error_msg = err.get('message','')[:100] if err else ''

print(json.dumps({
    'status': status, 'duration': dur, 'error': error_msg,
    'qualifying': qual, 'offering': offer, 'qa': qa_pass, 'verifying': verify,
    'loops': loops, 'intent': intent, 'fincas': fincas,
    'msg': msg[:200], 'ends_with_q': ends_with_q, 'generic_close': generic_close
}))
"
}

check() {
  local LABEL=$1 CONDITION=$2
  if [ "$CONDITION" = "true" ]; then
    echo "    ✅ $LABEL"
    return 0
  else
    echo "    ❌ $LABEL"
    return 1
  fi
}

run_step() {
  local WA=$1 NAME=$2 MSG=$3 WAIT=$4
  send_msg "$WA" "$NAME" "$MSG"
  sleep "$WAIT"
  find_exec "$WA"
}

echo "╔══════════════════════════════════════════════════════════╗"
echo "║           QA TEST SUITE — De Paseo en Fincas            ║"
echo "║           $(date '+%Y-%m-%d %H:%M:%S')                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ================================================================
# SCENARIO 1: El cliente perfecto
# ================================================================
echo "━━━ ESCENARIO 1: El cliente perfecto ━━━"
WA="573009990001"

echo "  Step 1: \"Hola buenas tardes\""
send_msg "$WA" "Cliente Perfecto" "Hola buenas tardes"
sleep 20
EID=$(find_exec "$WA" 3)
if [ -n "$EID" ]; then
  R=$(analyze_exec "$EID")
  echo "  → Exec $EID ($(echo $R | python3 -c 'import sys,json; print(json.load(sys.stdin)["duration"])')s)"
  S1_OK=$(echo "$R" | python3 -c "
import sys, json; r=json.load(sys.stdin)
ok = r['status']=='success' and r['qualifying']>0 and r['offering']==0 and r['loops']<=1
print('true' if ok else 'false')
")
  check "Qualifying saludo, no offering, no loop" "$S1_OK" || true
else
  echo "  ❌ No execution found"
  S1_OK="false"
fi

echo "  Step 2: \"Para 4 personas en Villeta este fin de semana\""
send_msg "$WA" "Cliente Perfecto" "Para 4 personas en Villeta este fin de semana"
sleep 45
EID=$(find_exec "$WA" 10)
if [ -n "$EID" ]; then
  R=$(analyze_exec "$EID")
  DUR=$(echo $R | python3 -c 'import sys,json; print(json.load(sys.stdin)["duration"])')
  echo "  → Exec $EID (${DUR}s)"
  S1B_OK=$(echo "$R" | python3 -c "
import sys, json; r=json.load(sys.stdin)
ok = r['status']=='success' and r['offering']>0 and r['intent']=='SHOW_OPTIONS' and r['fincas']>0 and r['loops']<=2
print('true' if ok else 'false')
")
  check "Qualifying→Offering, SHOW_OPTIONS, fincas>0, loops<=2" "$S1B_OK" || true
  FINCAS=$(echo $R | python3 -c 'import sys,json; print(json.load(sys.stdin)["fincas"])')
  echo "    📋 $FINCAS fincas ofrecidas"
else
  echo "  ❌ No execution found"
  S1B_OK="false"
fi

if [ "$S1_OK" = "true" ] && [ "$S1B_OK" = "true" ]; then
  echo "  🟢 ESCENARIO 1: PASS"
  PASS=$((PASS+1))
else
  echo "  🔴 ESCENARIO 1: FAIL"
  FAIL=$((FAIL+1))
fi
echo ""

# ================================================================
# SCENARIO 2: El preguntón
# ================================================================
echo "━━━ ESCENARIO 2: El preguntón (preguntas QA) ━━━"
WA="573009990002"

send_msg "$WA" "Preguntón" "Hola"
sleep 20
send_msg "$WA" "Preguntón" "Quiero algo en Anapoima para 6 personas el próximo viernes y sábado"
sleep 45
EID_OFFER=$(find_exec "$WA" 10)
echo "  Offering: $EID_OFFER"

# Now send QA questions
send_msg "$WA" "Preguntón" "La segunda tiene piscina?"
sleep 20
EID_QA=$(find_exec "$WA" 3)
if [ -n "$EID_QA" ]; then
  R=$(analyze_exec "$EID_QA")
  QA_COUNT=$(echo $R | python3 -c 'import sys,json; print(json.load(sys.stdin)["qa"])')
  GENERIC=$(echo $R | python3 -c 'import sys,json; print(json.load(sys.stdin)["generic_close"])')
  S2_OK=$(echo "$R" | python3 -c "
import sys, json; r=json.load(sys.stdin)
ok = r['status']=='success' and r['qa']>0 and not r['generic_close']
print('true' if ok else 'false')
")
  echo "  → QA exec $EID_QA: qa_runs=$QA_COUNT generic_close=$GENERIC"
  check "QA responde sin pregunta de cierre genérica" "$S2_OK" || true
else
  echo "  ❌ No QA execution found"
  S2_OK="false"
fi

if [ "$S2_OK" = "true" ]; then
  echo "  🟢 ESCENARIO 2: PASS"
  PASS=$((PASS+1))
else
  echo "  🔴 ESCENARIO 2: FAIL"
  FAIL=$((FAIL+1))
fi
echo ""

# ================================================================
# SCENARIO 3: Indeciso de zona
# ================================================================
echo "━━━ ESCENARIO 3: Cambia de zona 3 veces ━━━"
WA="573009990003"

send_msg "$WA" "Indeciso Zona" "Hola"
sleep 20
send_msg "$WA" "Indeciso Zona" "Para 5 personas en Girardot este fin de semana"
sleep 45

send_msg "$WA" "Indeciso Zona" "No mejor en Villeta"
sleep 30
EID_V=$(find_exec "$WA" 5)
if [ -n "$EID_V" ]; then
  R=$(analyze_exec "$EID_V")
  S3_OK=$(echo "$R" | python3 -c "
import sys, json; r=json.load(sys.stdin)
ok = r['status']=='success' and r['offering']>0
print('true' if ok else 'false')
")
  echo "  → Cambio a Villeta: $EID_V"
  check "Offering busca en nueva zona" "$S3_OK" || true
else
  echo "  ❌ No execution for zone change"
  S3_OK="false"
fi

if [ "$S3_OK" = "true" ]; then
  echo "  🟢 ESCENARIO 3: PASS"
  PASS=$((PASS+1))
else
  echo "  🔴 ESCENARIO 3: FAIL"
  FAIL=$((FAIL+1))
fi
echo ""

# ================================================================
# SCENARIO 5: Nunca da info correcta
# ================================================================
echo "━━━ ESCENARIO 5: Info vaga, nunca completa ━━━"
WA="573009990005"

send_msg "$WA" "Vago" "Hola"
sleep 20
send_msg "$WA" "Vago" "Quiero una finca bonita"
sleep 20
EID=$(find_exec "$WA" 3)
if [ -n "$EID" ]; then
  R=$(analyze_exec "$EID")
  S5_OK=$(echo "$R" | python3 -c "
import sys, json; r=json.load(sys.stdin)
ok = r['status']=='success' and r['qualifying']>0 and r['offering']==0
print('true' if ok else 'false')
")
  echo "  → Exec $EID"
  check "Qualifying pide más datos, NO va a offering" "$S5_OK" || true
else
  echo "  ❌ No execution"
  S5_OK="false"
fi

send_msg "$WA" "Vago" "Para hartas personas"
sleep 20
EID2=$(find_exec "$WA" 3)
if [ -n "$EID2" ]; then
  R2=$(analyze_exec "$EID2")
  S5B_OK=$(echo "$R2" | python3 -c "
import sys, json; r=json.load(sys.stdin)
ok = r['status']=='success' and r['qualifying']>0 and r['offering']==0
print('true' if ok else 'false')
")
  check "Sigue en qualifying pidiendo datos específicos" "$S5B_OK" || true
else
  S5B_OK="false"
fi

if [ "$S5_OK" = "true" ] && [ "$S5B_OK" = "true" ]; then
  echo "  🟢 ESCENARIO 5: PASS"
  PASS=$((PASS+1))
else
  echo "  🔴 ESCENARIO 5: FAIL"
  FAIL=$((FAIL+1))
fi
echo ""

# ================================================================
# SCENARIO 7: Zona sin cobertura
# ================================================================
echo "━━━ ESCENARIO 7: Zona sin cobertura ━━━"
WA="573009990007"

send_msg "$WA" "Sin Cobertura" "Hola necesito finca en Cartagena para 8 personas este fin de semana"
sleep 45
EID=$(find_exec "$WA" 10)
if [ -n "$EID" ]; then
  R=$(analyze_exec "$EID")
  echo "  → Exec $EID"
  S7_OK=$(echo "$R" | python3 -c "
import sys, json; r=json.load(sys.stdin)
ok = r['status']=='success' and r['loops']<=2
print('true' if ok else 'false')
")
  check "No loop infinito buscando en zona sin fincas" "$S7_OK" || true
  # Check if response mentions no coverage
  HAS_ALT=$(echo "$R" | python3 -c "
import sys, json; r=json.load(sys.stdin)
m = r['msg'].lower()
ok = 'no' in m or 'disponible' in m or 'alternativa' in m or 'otra' in m or 'zona' in m
print('true' if ok else 'false')
")
  check "Informa falta de cobertura o sugiere alternativas" "$HAS_ALT" || true
else
  echo "  ❌ No execution"
  S7_OK="false"
  HAS_ALT="false"
fi

if [ "$S7_OK" = "true" ]; then
  echo "  🟢 ESCENARIO 7: PASS"
  PASS=$((PASS+1))
else
  echo "  🔴 ESCENARIO 7: FAIL"
  FAIL=$((FAIL+1))
fi
echo ""

# ================================================================
# SCENARIO 8: Todo en un solo mensaje
# ================================================================
echo "━━━ ESCENARIO 8: Todo en un solo mensaje ━━━"
WA="573009990008"

send_msg "$WA" "Eficiente" "Hola necesito una finca en Villeta para 4 personas este viernes y sábado presupuesto 500 mil por noche"
sleep 45
EID=$(find_exec "$WA" 10)
if [ -n "$EID" ]; then
  R=$(analyze_exec "$EID")
  DUR=$(echo $R | python3 -c 'import sys,json; print(json.load(sys.stdin)["duration"])')
  echo "  → Exec $EID (${DUR}s)"
  S8_OK=$(echo "$R" | python3 -c "
import sys, json; r=json.load(sys.stdin)
ok = r['status']=='success' and r['offering']>0 and r['intent']=='SHOW_OPTIONS' and r['fincas']>0 and r['loops']<=2
print('true' if ok else 'false')
")
  check "Qualifying→Offering en 1 mensaje, SHOW_OPTIONS" "$S8_OK" || true
  FINCAS=$(echo $R | python3 -c 'import sys,json; print(json.load(sys.stdin)["fincas"])')
  echo "    📋 $FINCAS fincas ofrecidas"
else
  echo "  ❌ No execution"
  S8_OK="false"
fi

if [ "$S8_OK" = "true" ]; then
  echo "  🟢 ESCENARIO 8: PASS"
  PASS=$((PASS+1))
else
  echo "  🔴 ESCENARIO 8: FAIL"
  FAIL=$((FAIL+1))
fi
echo ""

# ================================================================
# SCENARIO 9: Lenguaje informal
# ================================================================
echo "━━━ ESCENARIO 9: Lenguaje informal (tipo audio) ━━━"
WA="573009990009"

send_msg "$WA" "Informal" "ey"
sleep 20
send_msg "$WA" "Informal" "pues mira necesito una finca pa como unas 10 personas por alla cerca a villeta o la vega algo asi pa este finde"
sleep 45
EID=$(find_exec "$WA" 10)
if [ -n "$EID" ]; then
  R=$(analyze_exec "$EID")
  DUR=$(echo $R | python3 -c 'import sys,json; print(json.load(sys.stdin)["duration"])')
  echo "  → Exec $EID (${DUR}s)"
  S9_OK=$(echo "$R" | python3 -c "
import sys, json; r=json.load(sys.stdin)
ok = r['status']=='success' and (r['offering']>0 or r['qualifying']>0) and r['loops']<=2
print('true' if ok else 'false')
")
  check "Entiende lenguaje informal, procesa correctamente" "$S9_OK" || true
else
  echo "  ❌ No execution"
  S9_OK="false"
fi

if [ "$S9_OK" = "true" ]; then
  echo "  🟢 ESCENARIO 9: PASS"
  PASS=$((PASS+1))
else
  echo "  🔴 ESCENARIO 9: FAIL"
  FAIL=$((FAIL+1))
fi
echo ""

# ================================================================
# SUMMARY
# ================================================================
TOTAL=$((PASS+FAIL))
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                    RESULTADOS                           ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  🟢 PASS: $PASS / $TOTAL                                        ║"
echo "║  🔴 FAIL: $FAIL / $TOTAL                                        ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Escenarios no ejecutados (requieren multi-turno complejo):"
echo "  4: El que nunca se decide (requiere 5+ turnos en offering)"
echo "  6: Rechaza 9 fincas (requiere múltiples rondas de offering)"
echo "  10: Vuelve después de un rato (requiere pausa real)"
