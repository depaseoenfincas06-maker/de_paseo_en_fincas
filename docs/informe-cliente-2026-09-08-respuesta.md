# Respuesta al "Informe de fallas del agente virtual" (8-sep-2026)

Documento para De Paseo en Fincas. Resume qué encontramos al revisar cada caso reportado por
Luis Andretti y Santiago Hernández, qué se corrigió y qué necesitamos de ustedes.

## 1. Qué revisamos

- El historial completo de WhatsApp de las tres líneas que hicieron pruebas (Chatwoot conserva
  todo, aunque el bot haya recibido "Reset").
- La base de datos del agente y la configuración.
- Reproducciones controladas de cada caso contra el agente real, antes y después de los cambios.

## 2. Caso por caso

| Caso reportado | ¿Se confirmó? | Qué pasaba | Qué cambió |
|---|---|---|---|
| "Mínimo 5 noches" y luego cotiza 2 noches | Sí | El motor sabía que Año Nuevo exige 5 noches, pero cuando el cliente aceptó extender nadie capturó fechas nuevas y la cotización salió con las 2 noches originales. | El agente ya no cotiza por debajo del mínimo: explica el mínimo y pide fechas. Cuando el cliente escribe fechas ("del 30 de diciembre al 4 de enero") se guardan de inmediato. |
| Documento con fechas y personas viejas (23-26 dic, 12 personas) | Sí | El cambio de fechas/personas dependía de que la IA lo "anotara"; no lo hizo y el documento se armó con los datos anteriores, tres veces. | Las fechas y el número de personas que escribe el cliente se guardan por código, no por la IA. El documento se genera con esos datos y, si no cambió nada, no se reenvía: el bot dice qué ajustar. |
| "¿Qué te parecieron las opciones?" cada media hora | Sí | Un parámetro de configuración de seguimiento estaba en 2 minutos (debía ser 180). | Se agregaron bloqueos: nunca se envía un seguimiento si el cliente escribió hace menos de 10 minutos, si el bot escribió hace menos de 30, o si la conversación está con un asesor. El parámetro se corrige con la aprobación de Juan. |
| Después del "OK" nadie aparece y el bot repite "te paso con mi compañero" | Sí | La notificación al asesor estaba en modo prueba (se enviaba al propio cliente) y sin destinatarios. En espera de humano, cada mensaje recibía el mismo texto. | Al aprobar la reserva o pedir humano, el bot deja una nota privada en Chatwoot con el resumen completo (finca, fechas, personas, total, extras, datos del cliente, último mensaje) y etiqueta la conversación. El "te paso con mi compañero" se dice una sola vez. Falta configurar el número del asesor. |
| "Ya te mostré todas las opciones" con 3 fincas | Sí | La segunda búsqueda fallaba internamente en ~1 de cada 5 intentos y la IA respondía con esa frase sin consultar. | La consulta de inventario ya no depende de que la IA la ejecute bien: si falla, el sistema la ejecuta por código y muestra las siguientes opciones. El inventario le informa a la IA cuántas fincas quedan. |
| Señoras de servicio cotizadas pero ausentes en el documento | Sí | No existía dónde guardar un extra opcional; la IA decía "ya lo anoté" sin que nada pasara. | Las empleadas solicitadas quedan guardadas, se calculan con el valor de la finca y entran al total y al documento. |
| "Se me enredaron los mensajes", bloqueos con varios mensajes seguidos | Sí | Mismo fallo interno de la consulta de inventario. | Resuelto con la ejecución por código. En pruebas con 5 mensajes seguidos ya no aparece. |
| Cotiza 15 personas en finca de máximo 12 | Sí | No había validación de capacidad. | El sistema bloquea elegir o cotizar una finca cuando el grupo supera la capacidad máxima, y lo explica. |
| Mesa de Yeguas: "las otras casas son de máximo 8" | Sí | Las casas de Mesa de Yeguas tienen el nombre del municipio solo en el código, y las amenidades con texto pegado. | El buscador reconoce Mesa de Yeguas como destino. Ver ajustes de datos abajo. |
| Descripción antes de preguntar fechas | Sí, intermitente | La IA saltaba a mostrar opciones sin fechas ni personas. | No se muestran opciones sin fechas y número de personas, salvo que el cliente pida una finca concreta. |
| Recargo 5 % tarjeta | Regla nueva | Estaba en los medios de pago pero la IA no la mencionaba. | Regla explícita en el agente. |

Además detectamos un lead real sin respuesta desde mayo (Javier Plata, +57 323 4878588) por un
identificador de conversación antiguo. Ya está corregido para futuros mensajes; recomendamos que
un asesor lo contacte.

## 3. Ajustes de datos en el archivo de propiedades (los hace De Paseo en Fincas)

1. **Mesa de Yeguas**: en las 8 filas `MESA DE YEGUAS CASA APxx`, poner `municipio = Mesa de
   Yeguas`, un `finca_id` canónico (por ejemplo `MESA_DE_YEGUAS_#06`) y llenar
   `amenidades_csv` solo con amenidades (hoy tiene la descripción completa pegada).
2. **LA_MESA_#07**: `capacidad_minima = 1` y `precio noche_persona_extra = 3.000.000` (igual al
   precio base). Revisar: así, la casa se cotiza igual para 2 que para 25 personas.
3. **GIRARDOT11 y GIRARDOT12**: columna `activa` en blanco (el sistema las trata como activas).
4. Valores con decimales (`116.666,67`, `128.571,43`) producen totales como `$2.386.667`.
   Recomendamos redondear a miles.

## 4. Cómo se verifica

Siete escenarios automáticos reproducen exactamente los casos del informe y se corren contra el
agente real después de cada cambio. Adicionalmente se corre la suite de 100 escenarios de
regresión (precios, zonas, flujos) para confirmar que nada más se afectó.
