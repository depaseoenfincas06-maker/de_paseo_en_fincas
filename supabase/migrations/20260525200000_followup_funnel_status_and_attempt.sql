-- Follow-up system v4 — schema changes.
--
-- 1) conversations.funnel_status: marca cuando un cliente alcanzó el
--    3er follow-up sin respuesta (y no reactivó). Útil para reporting.
--    Cuando el cliente vuelve a escribir, actualizar contexto1 lo resetea
--    a 'active'.
--
-- 2) follow_on.attempt_number: cuál de los 3 follow-ups del ciclo es este
--    row (1, 2 o 3). Determina qué template/path usa el cron.
--
-- 3) agent_settings.followup_first_offset_minutes: cuánto tiempo (en
--    minutos) entre la respuesta del bot y el FU #1. Default 180 (3h).
--    Durante pruebas se baja a 1 con:
--       UPDATE agent_settings SET followup_first_offset_minutes = 1 WHERE id = 1;
--    En producción se sube de vuelta a 180.
--
-- 4) follow_on_pending_idx: índice parcial sobre rows pendientes para
--    que el SELECT del cron sea eficiente cuando la tabla crezca.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS funnel_status text NOT NULL DEFAULT 'active'
    CHECK (funnel_status IN ('active','lost'));

ALTER TABLE public.follow_on
  ADD COLUMN IF NOT EXISTS attempt_number int NOT NULL DEFAULT 1;

ALTER TABLE public.agent_settings
  ADD COLUMN IF NOT EXISTS followup_first_offset_minutes int NOT NULL DEFAULT 180;

CREATE INDEX IF NOT EXISTS follow_on_pending_idx
  ON public.follow_on (status, scheduled_for)
  WHERE status = 'pendiente';
