-- The follow-up sender cron decides the message text at dispatch time
-- (either via LLM or via WhatsApp template rendering), not at scheduling
-- time. So follow_on.message must be nullable: when Agregar follow on
-- inserts a new pending row, message=NULL until the cron fills it in.

ALTER TABLE public.follow_on
  ALTER COLUMN message DROP NOT NULL;
