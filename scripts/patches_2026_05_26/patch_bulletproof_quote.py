#!/usr/bin/env python3
"""Hacer la respuesta de "cuánto sale en total" a prueba de balas.

Comportamiento requerido:
- Cliente pregunta total → bot responde EXACTAMENTE con el quote precalculado
  de BIT, sin ornamentos, sin propuestas alternas, sin preguntas extra.
- Formato fijo: "para X noches y N personas, sería $TOTAL. Incluye:
  $subtotal_noches + $deposito (reembolsable) + $limpieza + $empleada (si aplica)."
- intent=QUESTION, fincas_mostradas=[].
- NO cambiar finca, NO ofrecer otras opciones, NO promesas de visita.

Reemplaza el bloque actual de cotización completa que era abierto y permitía
floritura del LLM. Ahora la plantilla es LITERAL.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """  • Si el cliente pide la cotización COMPLETA con desglose ("cuánto sale en total?", "qué precio queda con todo?", "total para esas fechas?"), RESPONDE EN TEXTO en `respuesta`. NO emitas `fincas_mostradas` — eso re-renderiza la card+foto sin desglose y el cliente lo percibe como spam.
    - intent="QUESTION", next_stage="OFFERING".
    - fincas_mostradas=[] (vacío).
    - `respuesta` = breakdown EN TEXTO usando el `quote` del item correspondiente. Estructura sugerida:
        "FINCA_ID para X noches y N personas:
         • Tarifa por noche: $A (Y noches estándar) [+ $B (Z noches festivo/temporada si aplica)]
         • Subtotal noches: $subtotal_noches
         • Depósito (100% reembolsable): $deposito_seguridad
         • Limpieza final: $limpieza_final
         [• Servicio empleada (W días): $servicio_empleada_total — solo si > 0]

         Total: $total

         Te interesa avanzar con esta o querés ver otra opción?"
    - Usa `quote.human_summary` si ya viene armado, sino arma con los campos por componente.
    - NUNCA mostrar precios sin contexto (decir solo "$6.000.000" es ambiguo — siempre acompañar con "para X noches, N personas, depósito 100% reembolsable")."""

NEW = """  • Si el cliente pide la cotización COMPLETA / total ("cuánto sale en total?", "cuánto me queda?", "cuánto es la reserva?", "qué precio queda con todo?", "total para esas fechas?", "discrimíname el precio"), RESPONDE EN TEXTO en `respuesta` SIGUIENDO LA PLANTILLA LITERAL DE ABAJO. Sin adornos, sin propuestas alternas, sin preguntar más datos, sin cambiar de finca.
    - intent="QUESTION", next_stage="OFFERING".
    - fincas_mostradas=[] (siempre vacío — re-renderiza spam de card+foto).
    - SOURCE OF TRUTH: lee EXCLUSIVAMENTE los campos del `quote` del item correspondiente (viene precalculado por BIT). NUNCA hagas cuentas tú mismo, NUNCA inventes valores que no estén en `quote`, NUNCA agregues conceptos que no figuren en `quote`.

    PLANTILLA LITERAL (úsala tal cual, sustituyendo los valores):

        "Para [N] personas, [X] noches en [FINCA_CODIGO] sería $[TOTAL].

        Incluye:
        • Alojamiento ([X] noches): $[SUBTOTAL_NOCHES]
        • Depósito (100% reembolsable): $[DEPOSITO]
        • Limpieza final: $[LIMPIEZA]
        [• Servicio empleada ([COUNT] persona[s], [X] día[s]): $[EMPLEADA_TOTAL]]  ← SOLO si quote.servicio_empleada_total > 0

        Querés avanzar con esta finca?"

    REGLAS ESTRICTAS DE LA PLANTILLA:
    - [N] = `search_criteria.personas`.
    - [X] = `quote.total_nights`.
    - [FINCA_CODIGO] = `codigo_original` de la finca correspondiente.
    - [TOTAL] = `quote.total` formateado con separadores de miles (ej. $9.420.000).
    - [SUBTOTAL_NOCHES] = `quote.subtotal_noches`.
    - [DEPOSITO] = `quote.deposito_seguridad`.
    - [LIMPIEZA] = `quote.limpieza_final`.
    - [EMPLEADA_TOTAL] = `quote.servicio_empleada_total` (solo si > 0; si es 0 OMITE esa línea entera).
    - [COUNT] = `quote.servicio_empleada_count`.
    - NO menciones "tarifa por noche", NO desgloses categorías (festivo/estándar) en esta respuesta — el total ya las consolida.
    - NO ofrezcas alternativas, NO digas "o prefieres ver otra opción", NO sugieras visita ni videollamada. SOLO la pregunta de cierre "Querés avanzar con esta finca?".
    - Si el cliente NO especificó cuál finca (preguntó precio sin referirse a una), pídele aclaración: "¿De cuál de las opciones que te mostré te paso el total?". NO inventes ni asumas una finca.
    - Si el item de la finca NO tiene `quote` (ej. el cliente no dio fechas todavía), responde: "Para darte el total exacto necesito tus fechas. ¿Cuándo te gustaría ir?". Sin más."""

found = False
for n in wf['nodes']:
    if n.get('name') != 'Run offering pass': continue
    sm = n['parameters']['options']['systemMessage']
    if 'PLANTILLA LITERAL (úsala tal cual' in sm:
        print('!! already deployed'); sys.exit(0)
    if OLD not in sm:
        print('!! anchor not found')
        sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(OLD, NEW, 1)
    print('✓ offering: cotización total ahora con plantilla literal a prueba de balas')
    found = True
    break

if not found:
    print('!! offering not found'); sys.exit(3)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
