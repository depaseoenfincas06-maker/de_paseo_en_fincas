-- =====================================================================
-- Follow-up message for clients sitting on CLIENT_APPROVAL (PDF sent,
-- waiting for OK)
-- =====================================================================
-- Cuando el bot envía el PDF de confirmación, la conversación queda en:
--   current_state = 'CONFIRMING_RESERVATION'
--   waiting_for = 'CLIENT_APPROVAL'
-- Si el cliente no responde con un OK en 3 horas, queremos disparar un
-- follow-up persuasivo pero amable. Hasta ahora ese estado caía al
-- fallback msg_qualifying (genérico) y ademas el guard de
-- 'Agregar follow on' solo programaba cuando waiting_for='CLIENT', así
-- que de hecho NUNCA se programaba en este estado.
-- =====================================================================

ALTER TABLE public.agent_settings
  ADD COLUMN IF NOT EXISTS followup_message_confirming_reservation TEXT;

UPDATE public.agent_settings
SET followup_message_confirming_reservation =
  'Hola (NOMBRE) 👋 ¿Pudiste revisar la confirmación de reserva que te envié? Para asegurar tus fechas solo necesitamos tu OK por aquí. Si hay algo que quieras ajustar me cuentas y lo modificamos al momento ☀️'
WHERE id = 1
  AND (followup_message_confirming_reservation IS NULL OR followup_message_confirming_reservation = '');

-- Reemplazo el doble salto por uno solo en el doc-ready template,
-- alineado a como el usuario lo describió.
UPDATE public.agent_settings
SET confirming_document_ready_message_template = REPLACE(
    confirming_document_ready_message_template,
    E'OK\n\nEl valor',
    E'OK\nEl valor'
  )
WHERE id = 1;
