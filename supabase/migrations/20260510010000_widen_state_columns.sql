-- =====================================================================
-- Widen state-machine VARCHAR(10) columns
-- =====================================================================
-- conversations.waiting_for needs to fit values like 'CLIENT_APPROVAL'
-- (15 chars) and 'HUMAN_HANDOFF' (13 chars). last_message_from is fine
-- today (CLIENT/AGENT) but lift the cap so future state names don't bite.
-- Also widen messages.direction / message_type for the same reason.
--
-- Switching to TEXT (no length cap) — these are state values, never user
-- input, so storage-bound TEXT is the safe long-term choice.
-- =====================================================================

ALTER TABLE public.conversations
  ALTER COLUMN waiting_for TYPE TEXT,
  ALTER COLUMN last_message_from TYPE TEXT;

ALTER TABLE public.messages
  ALTER COLUMN direction TYPE TEXT,
  ALTER COLUMN message_type TYPE TEXT;
