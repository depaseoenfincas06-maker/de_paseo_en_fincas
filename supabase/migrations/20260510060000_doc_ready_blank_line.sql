-- Add a blank line between the two sentences of the doc_ready template.
UPDATE public.agent_settings
SET confirming_document_ready_message_template =
  '(NOMBRE) te comparto confirmación de reserva por favor me autorizas la información con un OK' || E'\n\n' ||
  'El valor correspondiente al depósito es 100% reembolsable 👌'
WHERE id = 1;
