#!/usr/bin/env python3
"""
Bug: initial_message_template incluye URL de Instagram pero el bot la drops
porque el qualifying prompt dice "puedes adaptar el estilo, NO lo copies
literal". El LLM parafrasea y descarta links.

Fix:
1. Cambiar la instrucción de BLOQUE 2 — debe CITAR LITERAL cualquier URL
   o enlace que venga en el template (Instagram, web, etc.). Puede adaptar
   el wording de presentación pero NUNCA descartar links.
2. Actualizar el EJEMPLO en el prompt para incluir el Instagram URL (para
   que el LLM tenga referencia clara).
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """BLOQUE 2 — cuerpo basado en INITIAL_MESSAGE_TEMPLATE_BASE:
    Una breve presentación + las 3 preguntas cortas y amigables (fechas / personas / zona). Puedes adaptar el estilo, NO lo copies literal. SIN signos de admiración.

  BLOQUE 3 — cobertura, SIEMPRE al final:
    "🌎 Actualmente disponemos de propiedades en {{ $('config').item.json.coverage_zones_text }}."

  El mensaje completo debe verse así (ejemplo):

      Excelente noche, María

      Mi nombre es Santiago Gallego de Depaseoenfincas.com, estaré al tanto de tu reserva.⚡

      Para ayudarte a encontrar la finca ideal, por favor cuéntame:
      1. ¿Para qué fechas buscas?
      2. ¿Cuántas personas te acompañan?
      3. ¿En qué zona o municipio te gustaría?

      🌎 Actualmente disponemos de propiedades en {{ $('config').item.json.coverage_zones_text }}.

  Verifica que entre cada bloque haya una línea EN BLANCO visible. Sin signos de admiración nunca."""

NEW = """BLOQUE 2 — cuerpo basado en INITIAL_MESSAGE_TEMPLATE_BASE:
    Una breve presentación + las preguntas cortas y amigables (fechas / personas / zona). Puedes adaptar el estilo del wording, PERO:
    - SI el INITIAL_MESSAGE_TEMPLATE_BASE incluye URLs, enlaces o handles de redes sociales (Instagram, web, WhatsApp, Facebook, TikTok, etc.), DEBES incluirlos LITERAL en tu respuesta. NUNCA los descartes.
    - SI incluye notas operativas (ej. "año nuevo mínimo 5 noches", "niños mayores de 4 cuentan"), DEBES preservarlas tal cual.
    - El único campo que parafraseás es el orden/wording de la presentación y las preguntas. URLs y reglas de negocio van VERBATIM.
    SIN signos de admiración de apertura (¡).

  BLOQUE 3 — cobertura, SIEMPRE al final:
    "🌎 Actualmente disponemos de propiedades en {{ $('config').item.json.coverage_zones_text }}."

  El mensaje completo debe verse así (ejemplo, asumiendo que el INITIAL_MESSAGE_TEMPLATE_BASE incluye Instagram):

      Excelente noche, María

      Mi nombre es Santiago Gallego de Depaseoenfincas.com, estaré al tanto de tu reserva.

      Para ayudarte a encontrar la finca ideal, por favor cuéntame:
      1. Para qué fechas buscas?
      2. Cuántas personas te acompañan?
      3. En qué zona o municipio te gustaría?

      Conócenos en Instagram: https://www.instagram.com/depaseoenfincascol

      🌎 Actualmente disponemos de propiedades en {{ $('config').item.json.coverage_zones_text }}.

  Verifica que entre cada bloque haya una línea EN BLANCO visible. Sin signos de admiración de apertura (¡) nunca."""

for n in wf['nodes']:
    if n['name'] != 'Run qualifying pass': continue
    sm = n['parameters']['options']['systemMessage']
    if OLD not in sm:
        if 'URLs y reglas de negocio van VERBATIM' in sm:
            print('!! already deployed'); sys.exit(0)
        print('!! anchor not found verbatim'); sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(OLD, NEW, 1)
    print('✓ qualifying: BLOQUE 2 forced to preserve URLs verbatim + example updated')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
