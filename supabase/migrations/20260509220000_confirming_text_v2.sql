-- =====================================================================
-- Update confirming_document_ready_message_template — May 2026
-- =====================================================================
-- Mensaje que se envia junto con el PDF de confirmacion de reserva.
-- Ahora explicita que el deposito es 100% reembolsable.
-- =====================================================================

UPDATE public.agent_settings
SET confirming_document_ready_message_template =
  '(NOMBRE) te comparto confirmación de reserva por favor me autorizas la información con un OK' || E'\n\n' ||
  'El valor correspondiente al depósito es 100% reembolsable 👌'
WHERE id = 1;
