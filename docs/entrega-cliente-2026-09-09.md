# Entrega — Asistente virtual de WhatsApp, De Paseo en Fincas

Fecha: 9 de septiembre de 2026. Preparado por raaamp para De Paseo en Fincas.

## 1. Acción requerida esta semana: método de pago en Meta

**Qué vimos.** En WhatsApp Manager, la cuenta **De Paseo En Fincas raaamp** muestra la alerta
"Se requiere un método de pago válido: tu método de pago caducó o no es válido". Este mes van
163 mensajes enviados, todos dentro de las 1.000 conversaciones gratuitas mensuales.

**Qué pasa si no se corrige.**

- Al agotarse las 1.000 conversaciones gratuitas del mes, Meta bloquea el envío y el asistente
  deja de responder a los clientes.
- Los mensajes con plantilla (seguimientos después de 24 horas y avisos al asesor) se cobran
  por conversación y no salen sin un método de pago válido.

**Dónde agregarlo (lo hace un administrador del negocio en Meta; raaamp no tiene acceso a la
facturación).**

1. Entrar a `business.facebook.com` con el usuario administrador del negocio
   De Paseo En Fincas raaamp.
2. Menú (☰) → Todas las herramientas → **WhatsApp Manager**. Alternativa: Configuración del
   negocio → Cuentas → Cuentas de WhatsApp.
3. Elegir la cuenta **De Paseo En Fincas raaamp** y hacer clic en **Ir a configuración** dentro
   de la alerta amarilla. Alternativa: Configuración de la cuenta → **Configuración de pagos**.
4. **Agregar método de pago**: tarjeta de crédito o débito vigente a nombre de la empresa, moneda
   y datos de facturación. Guardar.
5. Verificar que la alerta desaparezca en "Información general". Al día siguiente, escribir
   "hola" a la línea del asistente y confirmar que responde.

Ruta alternativa: Configuración del negocio → **Facturación y pagos** → Métodos de pago
(`business.facebook.com/billing_hub`).

**Líneas de la cuenta.** La línea que atiende a los clientes es **+1 201-701-8810**. La línea
+57 310 5639334 está en la misma cuenta y también depende del mismo método de pago.

## 2. Qué se entregó

Se corrigieron los casos del "Informe de fallas del agente virtual" (Luis Andretti y Santiago
Hernández). El detalle caso por caso está en el documento "Respuesta al informe de fallas".

- Consultas de inventario que fallaban en 1 de cada 5 intentos (silencio o "se me enredaron los
  mensajes") ahora se ejecutan por código cuando la IA falla.
- Fechas y número de personas que escribe el cliente se guardan por código y el documento de
  confirmación se genera con esos datos; no se reenvía un documento idéntico.
- Nunca se cotiza ni se reserva por encima de la capacidad de la finca ni por debajo del mínimo
  de noches de la temporada. El total que dice el asistente es siempre el calculado por el sistema.
- Las empleadas solicitadas por el cliente entran al total y al documento.
- Seguimientos: solo después de 3 horas y nunca mientras el cliente está escribiendo o un
  asesor atiende.
- Al pedir asesor o aprobar una reserva, queda una nota privada en Chatwoot con el resumen
  completo y la conversación se etiqueta (`handoff` / `reserva-aprobada`).
- Mesa de Yeguas se reconoce como destino; recargo del 5 % con tarjeta; sin fichas antes de
  tener fechas y personas.

Validación: 7 escenarios que reproducen exactamente los casos del informe (7 de 7 pasan) y una
regresión de 102 escenarios de precios, zonas y flujos.

## 3. Lo que De Paseo en Fincas debe mantener al día

| Qué | Dónde | Por qué importa |
|---|---|---|
| Método de pago de Meta vigente | WhatsApp Manager → Configuración de pagos | Sin él, el asistente deja de enviar mensajes al agotar la cuota gratuita |
| Plantillas de WhatsApp aprobadas | WhatsApp Manager → Plantillas de mensajes | Seguimientos fuera de 24 h y avisos al asesor usan plantillas |
| Número del asesor que recibe alertas | Entregar a raaamp | Hasta tenerlo, las alertas de "cliente eligió finca / aprobó reserva" no llegan a nadie por WhatsApp; la nota en Chatwoot sí queda |
| Archivo de propiedades (Google Sheet) | Ajustes indicados en la respuesta al informe | Mesa de Yeguas con municipio e IDs canónicos; LA_MESA_#07 (capacidad mínima 1 y extra igual al precio base); GIRARDOT11 y GIRARDOT12 con `activa` vacío; redondear valores con decimales |
| Comando "Reset" | Solo para pruebas | Reinicia la conversación; el historial queda archivado para auditoría |

## 4. Soporte

Cualquier conversación con un comportamiento extraño se puede revisar completa (aunque se haya
usado "Reset"). Reportar a raaamp el número de WhatsApp del cliente, la fecha y la hora del
mensaje.
