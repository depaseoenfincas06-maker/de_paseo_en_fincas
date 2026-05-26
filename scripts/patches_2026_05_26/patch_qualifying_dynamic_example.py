#!/usr/bin/env python3
"""
Hacer que el ejemplo del mensaje inicial en el qualifying prompt referencie
DINÁMICAMENTE el `agent_settings.initial_message_template`.

Antes: el ejemplo estaba hardcoded. Si Juan editaba el template desde el
dashboard, el ejemplo en el prompt quedaba desfasado y el LLM tendía a
seguir el hardcoded.

Ahora: el ejemplo SE GENERA del template actual usando n8n expressions.
Cualquier cambio en el dashboard se refleja inmediatamente en el ejemplo
visto por el LLM.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = """  El mensaje completo debe verse así (ejemplo, asumiendo que el INITIAL_MESSAGE_TEMPLATE_BASE incluye Instagram):

      Excelente noche, María

      Mi nombre es Santiago Gallego de Depaseoenfincas.com, estaré al tanto de tu reserva.

      Para ayudarte a encontrar la finca ideal, por favor cuéntame:
      1. Para qué fechas buscas?
      2. Cuántas personas te acompañan?
      3. En qué zona o municipio te gustaría?

      Conócenos en Instagram: https://www.instagram.com/depaseoenfincascol

      🌎 Actualmente disponemos de propiedades en {{ $('config').item.json.coverage_zones_text }}.

  Verifica que entre cada bloque haya una línea EN BLANCO visible. Sin signos de admiración de apertura (¡) nunca."""

NEW = """  El mensaje completo debe verse así (saludo personalizado + el template configurado por la empresa + cobertura):

      Excelente noche, María

      {{ $('config').item.json.initial_message_template }}

      🌎 Actualmente disponemos de propiedades en {{ $('config').item.json.coverage_zones_text }}.

  El bloque del medio es EL TEMPLATE TAL CUAL viene de agent_settings (incluye todas sus URLs, notas operativas y formato). PUEDES adaptar levemente el wording de la presentación si lo querés más natural, pero URLs/enlaces/notas operativas van VERBATIM. Verificá que entre cada bloque haya una línea EN BLANCO visible. Sin signos de admiración de apertura (¡) nunca."""

for n in wf['nodes']:
    if n['name'] != 'Run qualifying pass': continue
    sm = n['parameters']['options']['systemMessage']
    if OLD not in sm:
        if "{{ $('config').item.json.initial_message_template }}" in sm:
            print('!! already deployed'); sys.exit(0)
        print('!! anchor not found verbatim'); sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(OLD, NEW, 1)
    print('✓ qualifying: example now dynamically uses config.initial_message_template')
    break

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
