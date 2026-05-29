#!/usr/bin/env python3
"""Prohibir nomenclatura "entre semana / fin de semana" en respuestas de precio.

El sistema solo clasifica noches en 4 categorías:
- estándar
- puente / festivo (vísperas de lunes festivo + el lunes mismo)
- semana santa
- temporada alta (Navidad, Año Nuevo)

`precio_fin_semana` del inventario es un campo LEGACY/display que el LLM
ve pero NO debe usar para cotizar — confunde al cliente porque sugiere una
tarifa que no existe. computeQuote ignora ese campo.

Fix: agregar regla en system prompt offering que prohíbe nombrar "fin de
semana", "entre semana", "viernes/sábado". El bot solo puede usar las 4
categorías del sistema. Cuando pregunte precio por noche, debe responder
con la categoría correspondiente (que viene en quote.line_items[].label).
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# Insertar regla antes del bloque de REGLA DE PRECIOS
ANCHOR = "- REGLA DE PRECIOS — el cliente puede preguntar el precio en cualquier momento. CÓMO responder:"

NEW_BLOCK = """- ⚠️ REGLA INVIOLABLE — CATEGORÍAS DE PRECIO (May 27 2026):
  El sistema solo clasifica las noches en CUATRO categorías. NO existe "tarifa de fin de semana" ni "tarifa entre semana" — eso es ficción que confunde al cliente.

  Las únicas 4 categorías que el sistema reconoce:
    1. estándar             → label "Estándar"            (campo precio_base_noche)
    2. puente / festivo     → label "Festivo / puente"    (campo precio_festivo). Incluye vísperas de lunes festivo (viernes y sábado anteriores) + el lunes festivo + algunos días entre dos festivos consecutivos.
    3. semana santa         → label "Semana Santa"        (campo precio_semana_santa_receso)
    4. temporada alta       → label "Temporada alta"      (campo precio_temporada_alta — Navidad, Año Nuevo, mid-año si aplica)

  PROHIBIDO mencionar:
  - "precio de fin de semana" / "tarifa de fin de semana" / "$X el fin de semana"
  - "precio entre semana" / "tarifa entre semana" / "$X entre semana"
  - "más caro los viernes" / "más caro los sábados"

  CORRECTO:
  - "Esa noche es estándar: $X" / "Esa noche cae en puente festivo: $X"
  - "Tus fechas tienen 2 noches estándar y 1 festivo: $X y $Y respectivamente."

  El campo `precio_fin_semana` que aparece en algunos items del inventario es legacy/display SOLO para la card de presentación. NO lo uses para cotizar ni para describir tarifas. El `quote` precalculado por BIT ya clasifica cada noche correctamente y trae el desglose en `quote.line_items[]` con su `label` y `per_night_total`.

"""

found = False
for n in wf['nodes']:
    if n.get('name') != 'Run offering pass': continue
    sm = n['parameters']['options']['systemMessage']
    if 'CATEGORÍAS DE PRECIO (May 27 2026)' in sm:
        print('!! already deployed'); sys.exit(0)
    if ANCHOR not in sm:
        print('!! anchor not found'); sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(ANCHOR, NEW_BLOCK + ANCHOR, 1)
    print('✓ offering: regla inviolable de 4 categorías (no "fin de semana")')
    found = True
    break

if not found: sys.exit(3)

ALLOWED = {'executionOrder','timezone','saveDataErrorExecution','saveDataSuccessExecution',
           'saveExecutionProgress','saveManualExecutions','errorWorkflow'}
payload_put = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
    'settings': {k:v for k,v in (wf.get('settings') or {}).items() if k in ALLOWED}}
r2 = subprocess.run(['curl','-sk','-X','PUT', URL, '-H', f'X-N8N-API-KEY: {JWT}',
                     '-H', 'Content-Type: application/json', '-d', '@-'],
                    input=json.dumps(payload_put), capture_output=True, text=True, check=True)
print(f'PUT ok. active={json.loads(r2.stdout).get("active")}')
