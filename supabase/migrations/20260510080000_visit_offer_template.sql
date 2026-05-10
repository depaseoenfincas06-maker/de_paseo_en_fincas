-- =====================================================================
-- Add visit_offer_message_template — May 2026
-- =====================================================================
-- Cuando el cliente pide visitar la propiedad antes de reservar, antes
-- el bot caia directo a HITL. Ahora respondemos con un mensaje
-- ofreciendo agendar visita o videollamada, y SOLO si el cliente da
-- una fecha/horario especifico transferimos a humano.
--
-- El texto literal viene del usuario.
-- =====================================================================

ALTER TABLE public.agent_settings
  ADD COLUMN IF NOT EXISTS visit_offer_message_template TEXT;

UPDATE public.agent_settings
SET visit_offer_message_template =
  E'Claro que si, dime cuando quieres conocer la propiedad y nosotros agendamos la visita con nuestro agentes de zona para que la conozcoas personalmente👌\n\nTambién recuerda que si sete dificulta el viajar para la vista,  podemos hacer videollamada desde cualquiera de nuestros propiedades para que así las conozcas ✅'
WHERE id = 1
  AND (visit_offer_message_template IS NULL OR visit_offer_message_template = '');
