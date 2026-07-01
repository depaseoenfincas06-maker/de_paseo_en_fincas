#!/usr/bin/env python3
"""
Complemento obs #1: agregar emojis contextuales al ejemplo literal del
mensaje de transición qualifying → OFFERING.

El prompt del Run qualifying pass tiene un ejemplo LITERAL que el modelo
copia casi tal cual. Sin emojis en el ejemplo, el bot emite el mensaje
sin emojis (verified: "Listo, buscamos entonces..." con 0 emojis).

Cambio: agregar 📍 al final del Bloque 1 (contextual con la zona) y ☀️
al final del Bloque 2 (warmth), MÁS explicit rule permitiendo hasta
2 emojis contextuales en la transición.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

qp = next(n for n in wf['nodes'] if n['name'] == 'Run qualifying pass')
sm = qp['parameters']['options']['systemMessage']

OLD = (
"  Bloque 2 (una frase corta, no pregunta): \"Dame un momento mientras consulto disponibilidad y te envío las mejores alternativas\"\n"
"  Ejemplo literal:\n"
"    Entendido Juan, buscamos entonces una propiedad en Girardot del 16 al 18 de mayo para 15 personas.\n"
"    \n"
"    Dame un momento mientras consulto disponibilidad y te envío las mejores alternativas\n"
"  NO uses signos de admiración invertidos. NO hagas preguntas en este turno. NO menciones que vas a consultar al propietario."
)
NEW = (
"  Bloque 2 (una frase corta, no pregunta): \"Dame un momento mientras consulto disponibilidad y te envío las mejores alternativas ☀️\"\n"
"  Ejemplo literal:\n"
"    Entendido Juan, buscamos entonces una propiedad en Girardot del 16 al 18 de mayo para 15 personas 📍\n"
"    \n"
"    Dame un momento mientras consulto disponibilidad y te envío las mejores alternativas ☀️\n"
"  Podés incluir 1-2 emojis contextuales para calidez: 📍 (zona), 📅 (fechas), ☀️ (vibe/cierre), 🏡 (propiedad), 👥 (grupo).\n"
"  NO uses signos de admiración invertidos. NO hagas preguntas en este turno. NO menciones que vas a consultar al propietario."
)

if OLD not in sm:
    print('!! transition block marker not found'); sys.exit(2)

qp['parameters']['options']['systemMessage'] = sm.replace(OLD, NEW, 1)
print('✓ Qualifying transition: emojis en ejemplo literal + regla permisiva agregada')

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload = {
    'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED},
}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL,
                     '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload), capture_output=True, text=True, check=True)
out = json.loads(r2.stdout)
print(f'PUT ok. active={out.get("active")}')
if not out.get('active'):
    subprocess.run(['curl','-sk','-X','POST', URL+'/activate', '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True)
