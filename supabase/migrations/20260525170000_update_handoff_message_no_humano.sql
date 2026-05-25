-- Reemplaza el mensaje de handoff customer-facing para evitar la palabra "humano".
-- El cliente lo percibía frío/mecánico. El equipo prefiere referirse al asesor
-- humano como "mi compañero del área encargada".
--
-- Guard: solo actualiza si el texto sigue siendo el viejo, así no pisa
-- ediciones manuales del operador desde el dashboard /settings.

UPDATE public.agent_settings
SET handoff_message = 'Dame un momento, te paso con mi compañero del área encargada para continuar con tu solicitud.',
    updated_at = now()
WHERE id = 1
  AND handoff_message = 'Te voy a pasar con un asesor humano para continuar con tu solicitud.';
