-- =====================================================================
-- Widen all remaining VARCHAR(N) columns to TEXT
-- =====================================================================
-- After 20260510010000_widen_state_columns we still had length caps on
-- other columns that hit limits in production:
--
--   messages.media_url VARCHAR(500) — exec 1013 crash. The reservation
--     PDF URL (api/reservation-confirmation.docx?payload=<base64>) easily
--     exceeds 500 chars when payload includes client + finca + quote.
--
-- Same fix as the previous migration — these are not user input, they're
-- internal state machine values + URLs we generate. TEXT is the safe
-- long-term choice; Postgres stores TEXT and VARCHAR(N) the same way
-- internally, the only difference is the length check.
-- =====================================================================

ALTER TABLE public.messages
  ALTER COLUMN media_url TYPE TEXT,
  ALTER COLUMN detected_intent TYPE TEXT,
  ALTER COLUMN state_at_time TYPE TEXT,
  ALTER COLUMN agent_used TYPE TEXT;

ALTER TABLE public.conversations
  ALTER COLUMN current_state TYPE TEXT,
  ALTER COLUMN previous_state TYPE TEXT,
  ALTER COLUMN metodo_pago TYPE TEXT,
  ALTER COLUMN client_name TYPE TEXT,
  ALTER COLUMN loss_reason TYPE TEXT,
  ALTER COLUMN hitl_reason TYPE TEXT;
