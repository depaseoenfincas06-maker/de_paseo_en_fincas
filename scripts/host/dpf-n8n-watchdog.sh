#!/usr/bin/env bash
# ============================================================================
# dpf-n8n-watchdog — vive en el HOST Hetzner (root@65.21.104.22), fuera de n8n.
#
# Problema que resuelve (incidente 2026-07-08 → 2026-08-27): el scheduler
# interno de n8n puede morir en caliente sin tumbar el proceso — los webhooks
# siguen respondiendo pero los Schedule Triggers (follow-ups, reminders) dejan
# de disparar en silencio. healthz devuelve 200, así que un healthcheck normal
# no lo detecta. Estuvo 50 días muerto sin que nadie lo notara.
#
# Qué hace:
#   1. WATCHDOG (cada corrida): consulta la API de n8n por la última ejecución
#      del Follow-up Sender (corre cada 30 min). Si la más reciente tiene más
#      de STALE_MIN minutos (default 75 = 2 ticks perdidos + margen):
#        → docker restart del container n8n-main
#        → fila de ALERTA en el sheet de errores (visible al daily review)
#      Anti-loop: mínimo 2h entre restarts (state file).
#   2. HEARTBEAT (1 vez al día, hora HB_HOUR UTC): escribe una fila
#      "HEARTBEAT" en el sheet de errores con el estado del scheduler.
#      → El daily review siempre ve ≥1 fila/día: el silencio de errores deja
#        de ser ambiguo. Si un día NO hay heartbeat → problema real (host o
#        pipe caídos).
#
# Instalación (ya hecha 2026-08-27, este archivo es la copia versionada):
#   scp scripts/host/dpf-n8n-watchdog.sh root@65.21.104.22:/root/
#   chmod 700 /root/dpf-n8n-watchdog.sh
#   # editar N8N_TOKEN abajo (no va al repo)
#   crontab: */15 * * * * /root/dpf-n8n-watchdog.sh >> /var/log/dpf-watchdog.log 2>&1
# ============================================================================
set -u

# --- config ---
N8N_BASE="https://n8n.depaseoenfincas.raaamp.co"
N8N_TOKEN="__REEMPLAZAR_EN_EL_HOST__"   # token API de n8n; solo en la copia del host
FOLLOWUP_WF="xxK2FfX6QMPxKaZw"          # Follow-up Sender (cron cada 30 min)
CONTAINER="n8n-main-wh3uh0vp48nxg9i27wagfler"
SHEET_WEBHOOK="https://script.google.com/macros/s/AKfycbzP5gPvB7z3p2uZdvyUetTbXom6EyWprQqH1DVhTxMVCsxk5aP8lgiErER4eSiYFLUQKg/exec"
STALE_MIN=75          # minutos sin ejecución del cron para considerarlo muerto
RESTART_COOLDOWN=7200 # segundos mínimos entre restarts (anti-loop)
HB_HOUR="13"          # hora UTC del heartbeat diario (13 UTC = 08:00 Bogotá)
STATE_DIR="/var/lib/dpf-watchdog"
mkdir -p "$STATE_DIR"

now_epoch=$(date +%s)
today=$(date -u +%Y-%m-%d)
log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] $*"; }

post_sheet_row() {
  # $1 = workflow_name, $2 = error_message
  curl -sL -X POST "$SHEET_WEBHOOK" -H "Content-Type: application/json" \
    --max-time 20 -o /dev/null \
    -d "{\"timestamp\":\"$(date -u '+%d/%m/%Y %H:%M:%S')\",\"workflow_name\":\"$1\",\"node\":\"host-watchdog\",\"error_message\":\"$2\"}" || true
}

# --- 1. consultar última ejecución del cron ---
last_exec_iso=$(curl -sk --max-time 20 \
  "$N8N_BASE/api/v1/executions?workflowId=$FOLLOWUP_WF&limit=1" \
  -H "X-N8N-API-KEY: $N8N_TOKEN" | jq -r '.data[0].startedAt // empty')

if [ -z "$last_exec_iso" ]; then
  age_min=99999   # sin ejecuciones visibles = tratar como muerto
  log "sin ejecuciones visibles del Follow-up Sender"
else
  last_epoch=$(date -d "$last_exec_iso" +%s 2>/dev/null || echo 0)
  age_min=$(( (now_epoch - last_epoch) / 60 ))
fi

# --- 2. watchdog: restart si está muerto ---
scheduler_status="OK (última ejecución hace ${age_min} min)"
if [ "$age_min" -gt "$STALE_MIN" ]; then
  scheduler_status="MUERTO (última hace ${age_min} min)"
  last_restart=$(cat "$STATE_DIR/last_restart" 2>/dev/null || echo 0)
  if [ $(( now_epoch - last_restart )) -gt "$RESTART_COOLDOWN" ]; then
    log "scheduler muerto (${age_min} min sin cron) → docker restart $CONTAINER"
    if docker restart "$CONTAINER"; then
      echo "$now_epoch" > "$STATE_DIR/last_restart"
      post_sheet_row "WATCHDOG restart n8n-main" "Scheduler de n8n muerto: ${age_min} min sin ejecuciones del Follow-up Sender. Reinicie n8n-main automaticamente. Verificar que los crons retomaron en ~30 min."
      log "restart OK + alerta enviada al sheet"
    else
      post_sheet_row "WATCHDOG restart FALLO" "docker restart $CONTAINER fallo. Intervencion manual requerida."
      log "restart FALLÓ"
    fi
  else
    log "scheduler muerto pero en cooldown post-restart ($(( (now_epoch - last_restart) / 60 )) min de $((RESTART_COOLDOWN/60)))"
  fi
else
  log "scheduler OK (última ejecución hace ${age_min} min)"
fi

# --- 3. heartbeat diario ---
hb_sent=$(cat "$STATE_DIR/last_heartbeat" 2>/dev/null || echo "")
if [ "$hb_sent" != "$today" ] && [ "$(date -u +%H)" -ge "$HB_HOUR" ]; then
  post_sheet_row "HEARTBEAT" "Pipeline de errores vivo. Scheduler n8n: ${scheduler_status}. Fila diaria automatica del watchdog del host — NO es un error."
  echo "$today" > "$STATE_DIR/last_heartbeat"
  log "heartbeat diario enviado"
fi
