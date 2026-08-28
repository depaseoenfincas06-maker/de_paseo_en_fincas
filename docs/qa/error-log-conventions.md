# Convenciones del sheet de errores (18TKiXZ4IMw8p0Vy2eUv9fJWw3zvZ8oTaj1BNdoW2u1Q)

Para el **daily error review** (y cualquier humano leyendo el sheet). Desde
2026-08-28 el sheet recibe filas de 3 tipos:

## Tipos de fila

| `workflow_name` | Qué es | ¿Es un error? |
|---|---|---|
| `HEARTBEAT` | Fila diaria automática del watchdog del host (~08:00 Bogotá). Confirma que la tubería Apps Script→sheet está viva e incluye el estado del scheduler de n8n. | **NO** — ignorar en el conteo de errores. |
| `WATCHDOG restart n8n-main` | El watchdog detectó el scheduler de n8n muerto (>75 min sin ejecuciones del cron de follow-ups) y reinició el container automáticamente. | **Incidente auto-resuelto** — reportarlo como evento, verificar que los crons retomaron. |
| `WATCHDOG restart FALLO` | El restart automático falló. | **SÍ — crítico**, requiere intervención manual (SSH al Hetzner). |
| cualquier otro | Error real de un workflow de n8n (vía Global Error Logger). | **SÍ** — analizar como siempre. |
| `TEST*` / `*pipe-check*` / `*probe*` | Filas de prueba manual de conectividad. | NO — ignorar. |

## Regla de interpretación del silencio (fix del falso positivo de ago-2026)

- **Hay heartbeat del día + cero errores** → todo bien de verdad. NO escalar
  "logger silencioso". (En ago-2026 se escaló 57 días de silencio como
  bloqueador cuando en realidad no hubo ni un solo error que loggear.)
- **NO hay heartbeat del día** → ESO sí es alarma: el host Hetzner está caído,
  el cron del host murió, o la tubería del Apps Script se rompió. Escalar.

## Infraestructura detrás

- Watchdog: `/root/dpf-n8n-watchdog.sh` en el host 65.21.104.22, crontab
  `*/15 min`, log en `/var/log/dpf-watchdog.log`. Copia versionada (con el
  token placeholder) en `scripts/host/dpf-n8n-watchdog.sh`.
- Contexto del incidente que motivó esto: el scheduler de n8n murió en
  caliente el ~8-jul-2026 y nadie lo notó por 50 días (webhooks seguían
  funcionando; solo los Schedule Triggers dejaron de disparar).
