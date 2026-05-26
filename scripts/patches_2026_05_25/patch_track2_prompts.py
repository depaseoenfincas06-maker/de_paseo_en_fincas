#!/usr/bin/env python3
"""
Track 2 reducido — items 2.3 + 2.4.

2.3 — CHANGE_FINCA: la infra ya existe (intent + CodeJS1 handler en
      normalizePostActions). El offering + verifying YA tienen la regla
      detallada. El confirming tiene UNA SOLA FRASE genérica. Lo endurezco
      con ejemplos + frases trigger explícitas.

2.4 — REGLA DE PRECIOS breakdown: el offering tiene el bloque completo
      (líneas 48-62) que explica cómo usar quote.line_items, quote.total,
      quote.subtotal_noches, quote.deposito_seguridad, quote.limpieza_final,
      quote.servicio_empleada_total, quote.human_summary. Los agentes qa,
      verifying, confirming solo tienen UNA LÍNEA. Copio el bloque detallado
      a los 3.
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

# === The "minimal" REGLA DE PRECIOS line that exists in qa/verifying/confirming ===
OLD_MINIMAL_PRECIOS = "- REGLA DE PRECIOS: NUNCA calcules precio tú mismo. Cada finca en la respuesta de inventory_reader_tool trae un campo `quote` pre-calculado (con la clasificación correcta de fechas: estándar/festivo/semana santa/temporada alta + extras por persona donde aplique). Para responder sobre precio cita `quote.line_items[].per_night_total` o `quote.total` o `quote.human_summary` directamente. Si `quote` no viene en el item, indica que necesitas fechas para cotizar."

# === The expanded version (adapted from offering pass) ===
NEW_DETAILED_PRECIOS = (
"- REGLA DE PRECIOS — el cliente puede preguntar el precio en cualquier momento. CÓMO responder:\n"
"  • NUNCA calcules precio tú mismo. NO hagas multiplicaciones, NO clasifiques fechas como festivo/temporada alta/etc. NO mires los campos precio_base_noche / precio_festivo / precio_temporada_alta crudos para hacer la cuenta.\n"
"  • Cada finca en la respuesta del inventory_reader_tool trae un campo `quote` PRE-CALCULADO por el sistema. Ese campo ya considera las fechas exactas del cliente, la clasificación correcta (estándar / festivo / semana santa / temporada alta) y los extras por persona donde apliquen.\n"
"  • Para responder sobre precio, COPIA del `quote` del item correspondiente:\n"
"      - `quote.line_items[0].per_night_total` → precio por noche cuando la estadía cae en una sola categoría.\n"
"      - `quote.line_items[].per_night_total` por categoría cuando la estadía cruza dos o más (ej. 2 noches estándar + 1 festivo).\n"
"      - `quote.total` → total general de la reserva (incluye noches + depósito + limpieza + servicio empleada).\n"
"      - `quote.subtotal_noches`, `quote.deposito_seguridad`, `quote.limpieza_final`, `quote.servicio_empleada_total` → desglose por componente. Úsalos cuando el cliente pida \"discrimíname el precio\" / \"qué incluye\" / \"cuánto sale en total\" / \"cuánto es el depósito\" / \"cobran limpieza?\".\n"
"      - `quote.human_summary` → string ya armado, listo para citar/parafrasear cuando quieras dar el breakdown de una sola toma.\n"
"  • Cuando el cliente pide el TOTAL o el DESGLOSE: responde con el breakdown del quote (depósito 100% reembolsable + limpieza final + servicio empleada si aplica + tarifa por noche × noches). NO fuerces al cliente a dar sus datos personales para conocer el total — ese breakdown se entrega cuando lo pide, sin condicionar.\n"
"  • Si el cliente pide UN precio simple (\"cuánto cuesta por noche?\"), responde con el `per_night_total` del primer line_item, indicando para cuántas personas.\n"
"  • Si quote NO viene en el item (cliente todavía no dio fechas), pide las fechas antes de cotizar: \"Para darte el precio exacto necesito tus fechas. ¿Tienes un fin de semana o rango pensado?\".\n"
"- Si hablas de precio, aclara siempre para cuántas personas aplica la tarifa y separa la capacidad máxima de la finca."
)

# The targeted line that follows the minimal version (line 39 in qa, etc.)
OLD_PRECIOS_FOLLOWUP = "- Si hablas de precio, aclara siempre para cuántas personas aplica la tarifa y separa la capacidad máxima de la finca."

# Apply to qa, verifying, confirming agents
ok = {}

# 2.4 — promover REGLA DE PRECIOS detallada a 3 agentes
for agent_name in ['Run qa pass', 'Run verifying_availability pass', 'Run confirming_reservation pass']:
    n = next((x for x in wf['nodes'] if x['name'] == agent_name), None)
    if not n:
        print(f'!! {agent_name} not found'); sys.exit(2)
    sm = n['parameters']['options']['systemMessage']
    if OLD_MINIMAL_PRECIOS not in sm:
        print(f'!! {agent_name}: minimal REGLA DE PRECIOS not found'); sys.exit(2)
    # The minimal line is on one line, followed by a "- Si hablas de precio..." line on the next.
    # Replace minimal block (current line + following follow-up) with the new detailed one.
    # We replace JUST the minimal line — the follow-up "Si hablas de precio..." line is included in NEW_DETAILED_PRECIOS at the end.
    old_block = OLD_MINIMAL_PRECIOS + "\n" + OLD_PRECIOS_FOLLOWUP
    if old_block not in sm:
        # Try just the minimal line
        new_sm = sm.replace(OLD_MINIMAL_PRECIOS, NEW_DETAILED_PRECIOS, 1)
    else:
        new_sm = sm.replace(old_block, NEW_DETAILED_PRECIOS, 1)
    n['parameters']['options']['systemMessage'] = new_sm
    ok[agent_name + '_precios'] = True
    print(f'✓ {agent_name}: REGLA DE PRECIOS expandida con breakdown')

# 2.3 — Endurecer CHANGE_FINCA en confirming_reservation_agent
for agent_name in ['Run confirming_reservation pass']:
    n = next((x for x in wf['nodes'] if x['name'] == agent_name), None)
    sm = n['parameters']['options']['systemMessage']
    OLD_CF = "- Si el cliente quiere cambiar de finca, devuelve intent=\"CHANGE_FINCA\"."
    NEW_CF = (
"- Si el cliente quiere CAMBIAR DE FINCA o pide ver OTRAS OPCIONES, devuelve intent=\"CHANGE_FINCA\".\n"
"  Frases trigger típicas en estado CONFIRMING_RESERVATION (todas → CHANGE_FINCA):\n"
"    - \"mejor mostrame otra\" / \"muéstrame otras\" / \"quiero ver otra opción\"\n"
"    - \"esta no me convence, dame otras\" / \"esa no me gusta\"\n"
"    - \"dame una más barata\" / \"qué tienes más económico\" / \"quiero algo de menor valor\"\n"
"    - \"quiero cambiar de finca\" / \"voy a cambiar la propiedad\"\n"
"    - \"mejor la otra que me mostraste\" (cambio a otra ya vista)\n"
"  Cuando emites CHANGE_FINCA: el sistema te devuelve a OFFERING limpio (sin la finca seleccionada) y el offering_agent muestra cards nuevas. NO sigas pidiendo datos del cliente — el sistema retoma el flujo desde cero con la nueva selección.\n"
"  IMPORTANTE: aunque el cliente ya haya dado nombre/cédula/teléfono, si pide otra finca, DESCARTA esa info parcial y emite CHANGE_FINCA. El sistema preserva los datos personales internamente (no se pierden) pero el cliente no debe sentir que tiene que repetir todo."
    )
    if OLD_CF not in sm:
        print('!! CHANGE_FINCA marker not found in confirming'); sys.exit(2)
    n['parameters']['options']['systemMessage'] = sm.replace(OLD_CF, NEW_CF, 1)
    ok['confirming_change_finca'] = True
    print('✓ Run confirming_reservation pass: CHANGE_FINCA endurecido con ejemplos + frases trigger')

if not all(ok.values()):
    print('!! not all patched:', ok); sys.exit(2)

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
