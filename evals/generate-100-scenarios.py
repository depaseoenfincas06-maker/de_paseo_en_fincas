#!/usr/bin/env python3
"""Genera la suite de 100 scenarios (evals/scenarios100/) para el goal:
'≥95% de 100 escenarios responden satisfactoriamente'.

Mix:
  - 40 pricing data-driven: finca + fechas + personas → total EXACTO calculado
    espejando _computeQuoteBIRP (incluye empleada obligatoria).
  - 20 availability/zonas: cada zona canónica del inventario debe dar OFFERING
    con opciones reales, sin 'no tenemos' falsos.
  - 15 preguntas factuales (amenidades, distancia, privada/condominio...).
  - 15 flujos conversacionales (HITL, visita, desiste, pago parcial...).
  - 10 edge/regression (niños <5, IG link, burst, presupuesto, cambio finca...).

Basado en patrones de los 4 chats reales (573117360736, 15617597511,
573144749908, 573112407139) + el inventario del Google Sheet.

Requiere /tmp/fincas.csv fresco (curl del gviz CSV).
"""
import csv, re, os, json, math, unicodedata

CSV = '/tmp/fincas.csv'
OUT = os.path.join(os.path.dirname(__file__), 'scenarios100')
os.makedirs(OUT, exist_ok=True)

# Fechas de test: 25-27 ago 2026 (mar→jue, 2 noches estándar, sin festivo/puente)
FECHA_TXT = 'del 25 al 27 de agosto de 2026'
NIGHTS = 2

def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFD', str(s)) if not unicodedata.combining(c))

def to_number(x, fallback=0.0):
    s = re.sub(r'[^\d.-]', '', str(x or ''))
    try: return float(s) if s else fallback
    except: return fallback

def parse_empleada(raw):
    # Mirror de parseEmpleadaObligatoria (Normalize Inventory)
    if raw is None: return {'count': 0, 'per': None}
    s = str(raw).strip()
    if not s: return {'count': 0, 'per': None}
    norm = strip_accents(s).lower()
    if re.match(r'^(no|n|0|ninguna|ningun|sin|opcional|opcionales|no obligatori\w*)$', norm):
        return {'count': 0, 'per': None}
    m = re.search(r'(\d+)\s*(?:empleadas?|emp\.?)?\s*(?:por\s+cada|cada|por|/)\s*(\d+)\s*(?:personas?|huespedes?|pax)?', norm)
    if m:
        c, ratio = int(m.group(1)), int(m.group(2))
        if c > 0 and ratio > 0:
            return {'count': 0, 'per': round(ratio / c)}
    m = re.match(r'^\s*(\d+)\s*(?:empleadas?|emp\.?)?\s*$', norm)
    if m: return {'count': int(m.group(1)), 'per': None}
    if re.match(r'^(si|s|true|y|yes|obligatori\w*)$', norm):
        return {'count': 1, 'per': None}
    m = re.search(r'(\d+)', norm)
    if m: return {'count': int(m.group(1)), 'per': None}
    return {'count': 0, 'per': None}

def emp_count(emp, personas):
    # Mirror de _resolveEmpleadaCountBIRP
    if emp['count'] > 0: return emp['count']
    if emp['per'] and personas > 0: return max(1, round(personas / emp['per']))
    return 0

def fmt_grouped(n):
    return f"{int(n):,}".replace(',', '.')

# ---------- Load inventory ----------
rows = list(csv.reader(open(CSV)))
header = rows[0]
data = []
for r in rows[1:]:
    if len(r) < len(header): continue
    d = dict(zip(header, r))
    if d.get('finca_id','').strip(): data.append(d)

def parse_finca(d):
    return {
        'id': d['finca_id'].strip(),
        'zona': d['zona'].strip(),
        'municipio': d['municipio'].strip(),
        'activa': d['activa'].upper() == 'TRUE',
        'prioridad': to_number(d.get('prioridad'), 999),
        'min_noches': to_number(d.get('min_noches'), 1),
        'dep': to_number(d.get('deposito_seguridad')),
        'limp': to_number(d.get('limpieza_final_valor')),
        'cap_min': to_number(d.get('capacidad_minima')),
        'cap_max': to_number(d.get('capacidad_max')),
        'base': to_number(d.get('precio base x noche')),
        'extra': to_number(d.get('precio noche_persona_extra')),
        'emp': parse_empleada(d.get('empleada_obligatorio')),
        'emp_valor': to_number(d.get('servicio_empleada_valor_8h')),
        'pet': d.get('pet_friendly','').upper() == 'TRUE',
        'amenidades': d.get('amenidades_csv',''),
    }

fincas = [parse_finca(d) for d in data]

def quote_total(f, personas, nights=NIGHTS):
    extras = max(0, personas - f['cap_min']) if f['cap_min'] > 0 else 0
    if f['cap_max'] > 0 and personas > f['cap_max']:
        extras = min(extras, max(0, f['cap_max'] - f['cap_min']))
    per_night = f['base'] + f['extra'] * extras
    subtotal = per_night * nights
    ec = emp_count(f['emp'], personas)
    empleada = ec * f['emp_valor'] * nights if ec > 0 else 0
    total = subtotal + f['dep'] + f['limp'] + empleada
    return total, per_night, subtotal, empleada, ec, extras

# Eligibility para pricing tests
def eligible_pricing(f):
    if not f['activa'] or f['base'] <= 0: return False
    if f['cap_min'] < 4 or f['cap_max'] < f['cap_min']: return False
    if f['extra'] >= f['base'] * 0.8 and f['extra'] > 0: return False   # data quirk (8 fincas)
    if f['min_noches'] > NIGHTS: return False
    if 'MESA DE YEGUAS' in f['id']: return False                        # IDs irregulares extremos
    if not re.match(r'^[A-ZÑa-z_ #\d]+$', f['id']): return False
    return True

zona_pregunta = {
    'Anapoima': 'Anapoima', 'ANAPOIMA': 'Anapoima',
    'Antioquia': 'Antioquia', 'Antioquía': 'Antioquia',
    'Arbelaez': 'Arbeláez',
    'Carmen de Apicala': 'Carmen de Apicalá',
    'Carmen de Apicala Impero A32': 'Carmen de Apicalá',
    'Eje cafetero': 'el Eje Cafetero',
    'Girardot': 'Girardot', 'GIRARDOT': 'Girardot',
    'La Mesa': 'La Mesa', 'La Vega': 'La Vega',
    'Villavicencio': 'Villavicencio', 'Villeta': 'Villeta',
    'melgar': 'Melgar',
}

def yaml_escape(s):
    return s.replace("'", "''")

def write_scenario(fname, yml):
    with open(os.path.join(OUT, fname), 'w') as fh:
        fh.write(yml)

count = 0

# ============================================================
# 1) 40 PRICING data-driven
# ============================================================
elig = sorted([f for f in fincas if eligible_pricing(f)], key=lambda f: (f['prioridad'], f['id']))
# dedup por id
seen = set(); elig = [f for f in elig if not (f['id'] in seen or seen.add(f['id']))]

pricing = []
for f in elig:
    # preferir personas=cap_min (extras=0, total entero garantizado)
    for personas in [int(f['cap_min']), int(f['cap_min']) + 2]:
        if personas > f['cap_max']: continue
        total, per_night, subtotal, empleada, ec, extras = quote_total(f, personas)
        if total != int(total):  # exigir total entero → sin ambigüedad de rounding
            continue
        pricing.append((f, personas, total, empleada, ec, extras))
        break

# balance de zonas: máximo 8 por zona
from collections import defaultdict
by_zone_count = defaultdict(int)
selected = []
for f, personas, total, empleada, ec, extras in pricing:
    z = f['zona']
    if by_zone_count[z] >= 8: continue
    by_zone_count[z] += 1
    selected.append((f, personas, total, empleada, ec, extras))
    if len(selected) >= 40: break

for i, (f, personas, total, empleada, ec, extras) in enumerate(selected, 1):
    zq = zona_pregunta.get(f['zona'], f['zona'])
    tg = fmt_grouped(total)
    tg_comma = f"{int(total):,}"
    emp_note = f" (incluye {ec} empleada(s) obligatoria(s): ${fmt_grouped(empleada)})" if empleada else ""
    yml = f"""id: g100-price-{i:02d}-{re.sub(r'[^a-z0-9]+','-',f['id'].lower()).strip('-')}
title: 'Precio exacto {f["id"]} — {personas} px, 2 noches estándar'
category: g100 / pricing

# Sheet: base=${fmt_grouped(f['base'])}, extra=${fmt_grouped(f['extra'])}, cap {int(f['cap_min'])}/{int(f['cap_max'])},
# dep=${fmt_grouped(f['dep'])}, limp=${fmt_grouped(f['limp'])}, extras={extras}{emp_note}
# TOTAL esperado: ${tg}

turns:
  - user: 'Hola, busco finca en {zq} para {personas} personas {FECHA_TXT}'
    assert:
      - state_equals: OFFERING
      - not_contains: 'no tenemos'
      - not_contains: 'te paso con mi compañero'

  - user: 'De {f["id"]} dame el total ya sumado con todo incluido (las 2 noches, depósito y limpieza), no me des solo el desglose'
    assert:
      - not_contains: 'te paso con mi compañero'
      - contains: '$'
      - bot_recognized_finca: '{f["id"]}'
      - contains_any:
          - '{tg}'
          - '{tg_comma}'
"""
    write_scenario(f"g100-price-{i:02d}.yaml", yml)
    count += 1

print(f"pricing: {len(selected)}")

# ============================================================
# 2) 20 AVAILABILITY / ZONAS
# ============================================================
avail_cases = [
    ('Anapoima', 8), ('Anapoima', 20), ('Villeta', 10), ('Villeta', 15),
    ('Girardot', 8), ('La Mesa', 10), ('La Vega', 12), ('Villavicencio', 10),
    ('Melgar', 10), ('Carmen de Apicalá', 10), ('el Eje Cafetero', 12),
    ('Pereira', 15), ('Antioquia', 15), ('Santa Fe de Antioquia', 20),
    ('San Jerónimo', 12), ('Anapoima', 40),
]
extra_avail = [
    ("cerca de Bogotá", 15, 'zonas de Cundinamarca'),
    ("el Quindío", 10, 'eje cafetero'),
]
i = 0
for zona, px in avail_cases:
    i += 1
    yml = f"""id: g100-avail-{i:02d}-{re.sub(r'[^a-z0-9]+','-',strip_accents(zona).lower()).strip('-')}-{px}px
title: 'Disponibilidad {zona} — {px} personas'
category: g100 / availability

turns:
  - user: 'Hola, busco finca en {zona} para {px} personas {FECHA_TXT}'
    assert:
      - state_equals: OFFERING
      - not_contains: 'no tenemos'
      - not_contains: 'no encontramos'
      - not_contains: 'no manejamos'
      - not_contains: 'te paso con mi compañero'
"""
    write_scenario(f"g100-avail-{i:02d}.yaml", yml)
    count += 1
for zona, px, note in extra_avail:
    i += 1
    yml = f"""id: g100-avail-{i:02d}-{re.sub(r'[^a-z0-9]+','-',strip_accents(zona).lower()).strip('-')}
title: 'Disponibilidad {zona} ({note}) — {px} px'
category: g100 / availability

turns:
  - user: 'Hola, busco finca {zona} para {px} personas {FECHA_TXT}'
    assert:
      - state_equals: OFFERING
      - not_contains: 'no tenemos'
      - not_contains: 'te paso con mi compañero'
"""
    write_scenario(f"g100-avail-{i:02d}.yaml", yml)
    count += 1
# 2 más: grupo grande y grupo pequeño
for zona, px, label in [('Antioquia', 60, 'grupo-60'), ('Anapoima', 4, 'grupo-4')]:
    i += 1
    yml = f"""id: g100-avail-{i:02d}-{label}
title: 'Disponibilidad {zona} — {label}'
category: g100 / availability / capacity-edge

turns:
  - user: 'Hola, busco finca en {zona} para {px} personas {FECHA_TXT}'
    assert:
      - not_contains: 'te paso con mi compañero'
      - state_equals: OFFERING
"""
    write_scenario(f"g100-avail-{i:02d}.yaml", yml)
    count += 1

print(f"availability: {i}")

# ============================================================
# 3) 15 FACTUALES
# ============================================================
factual = [
    ("Cuáles de estas tienen piscina?", ["piscina", "Piscina"]),
    ("Alguna tiene jacuzzi?", ["jacuzzi", "Jacuzzi", "no"]),
    ("Aceptan mascotas? Tengo un perro pequeño", ["mascota", "pet", "perro", "acepta"]),
    ("La primera tiene wifi?", ["wifi", "Wifi", "WiFi", "no"]),
    ("Cuántas habitaciones tiene la primera opción?", ["habitacion", "Habitacion", "habitaciones"]),
    ("Qué tan lejos queda la primera del pueblo?", ["min", "MIN", "minuto", "pueblo", "cerca"]),
    ("La primera es privada o está en un condominio?", ["privada", "condominio", "conjunto", "independiente"]),
    ("Alguna tiene servicio de empleada o cocinera?", ["empleada", "cocinera", "servicio"]),
    ("Se puede hacer fiesta o poner música en la primera?", ["fiesta", "evento", "música", "musica", "ruido", "familiar", "vacacional"]),
    ("Cómo es la acomodación de las habitaciones de la primera?", ["habitacion", "cama", "acomoda", "persona"]),
    ("La primera tiene BBQ o zona de asado?", ["BBQ", "bbq", "asado", "parrilla", "no"]),
    ("Tienen cancha o zonas de juego para niños?", ["cancha", "juego", "parque", "niño", "zona"]),
    ("Cuál es la más cercana al pueblo de las que me mostraste?", ["min", "MIN", "cerca", "pueblo"]),
    ("La primera opción tiene piscina para niños?", ["piscina", "niño", "infantil", "no"]),
    ("Qué incluye el precio de la primera opción?", ["$", "noche", "incluye"]),
]
for i, (q, opts) in enumerate(factual, 1):
    opts_yaml = '\n'.join(f"          - '{yaml_escape(o)}'" for o in opts)
    yml = f"""id: g100-fact-{i:02d}
title: 'Factual: {yaml_escape(q[:60])}'
category: g100 / factual

turns:
  - user: 'Hola, busco finca en Anapoima para 10 personas {FECHA_TXT}'
    assert:
      - state_equals: OFFERING
      - not_contains: 'te paso con mi compañero'

  - user: '{yaml_escape(q)}'
    assert:
      - not_contains: 'te paso con mi compañero'
      - contains_any:
{opts_yaml}
"""
    write_scenario(f"g100-fact-{i:02d}.yaml", yml)
    count += 1

print(f"factual: {len(factual)}")

# ============================================================
# 4) 15 FLUJOS
# ============================================================
flows = []
flows.append(("hitl-explicito", "Cliente pide humano explícito", [
    ("Hola, busco finca en Villeta para 8 personas " + FECHA_TXT, ["- state_equals: OFFERING"]),
    ("Necesito hablar con un asesor humano por favor", ["- contains: 'te paso con mi compañero'"]),
]))
flows.append(("hitl-no-loop", "Después de HITL sigue respondiendo", [
    ("Quiero hablar con una persona real", ["- contains: 'te paso con mi compañero'"]),
    ("Bueno mientras tanto dime si tienen fincas con piscina en Anapoima", ["- not_contains: 'te paso con mi compañero'", "- no_handoff_loop: true"]),
]))
flows.append(("visita-sin-fecha", "Visita sin fecha → no HITL", [
    ("Hola, busco finca en La Mesa para 10 personas " + FECHA_TXT, ["- state_equals: OFFERING"]),
    ("Puedo ir a conocer la finca antes de reservar?", ["- not_contains: 'te paso con mi compañero'"]),
]))
flows.append(("visita-con-fecha", "Visita con fecha → HITL/coordinar", [
    ("Hola, busco finca en La Mesa para 10 personas " + FECHA_TXT, ["- state_equals: OFFERING"]),
    ("Quiero visitarla este sábado a las 3pm, se puede?", ["- contains_any:\n          - 'te paso con mi compañero'\n          - 'coordinar'\n          - 'compañero'\n          - 'confirmar'"]),
]))
flows.append(("cliente-desiste", "Desiste → farewell", [
    ("Hola, busco finca en Girardot para 8 personas " + FECHA_TXT, ["- state_equals: OFFERING"]),
    ("Muchas gracias pero ya reservamos con otra agencia", ["- contains_any:\n          - 'abrazo'\n          - 'gracias'\n          - 'próxima'\n          - 'esperamos'\n          - 'agradezco'"]),
]))
flows.append(("pago-parcial", "Pago parcial → no HITL", [
    ("Hola, busco finca en Anapoima para 12 personas " + FECHA_TXT, ["- state_equals: OFFERING"]),
    ("Puedo apartar la reserva con menos del 50%?", ["- not_contains: 'te paso con mi compañero'"]),
]))
flows.append(("descuento", "Descuento → responde sin evadir", [
    ("Hola, busco finca en Villeta para 10 personas " + FECHA_TXT, ["- state_equals: OFFERING"]),
    ("Me puedes dar un descuento? está caro", ["- contains_any:\n          - 'descuento'\n          - 'precio'\n          - 'económica'\n          - 'compañero'"]),
]))
flows.append(("cambio-finca", "Cambio de finca fluido", [
    ("Hola, busco finca en Anapoima para 8 personas " + FECHA_TXT, ["- state_equals: OFFERING"]),
    ("Me gusta la primera... aunque no, mejor dime el precio de la segunda", ["- not_contains: 'te paso con mi compañero'", "- contains: '$'"]),
]))
flows.append(("presupuesto", "Presupuesto → alternativa económica", [
    ("Hola, busco finca en Anapoima para 10 personas " + FECHA_TXT, ["- state_equals: OFFERING"]),
    ("Todas están muy caras, tienes algo más económico?", ["- not_contains: 'te paso con mi compañero'", "- contains_any:\n          - 'económica'\n          - 'económico'\n          - 'opción'\n          - 'alternativa'\n          - 'presupuesto'"]),
]))
flows.append(("confianza-ig", "Confianza → IG con link", [
    ("Hola, antes de nada: ustedes son confiables? me han estafado antes", ["- ig_link_present: true", "- not_contains: 'te paso con mi compañero'"]),
]))
flows.append(("oficinas", "Oficinas físicas", [
    ("Hola, dónde quedan sus oficinas? quiero ir en persona", ["- contains_any:\n          - 'Medellín'\n          - 'Medellin'\n          - 'Bogotá'\n          - 'Bogota'\n          - 'oficina'", "- not_contains: 'te paso con mi compañero'"]),
]))
flows.append(("empresa-rut", "Reserva empresarial → RUT/facturación", [
    ("Hola, busco finca en Anapoima para 15 personas " + FECHA_TXT, ["- state_equals: OFFERING"]),
    ("La reserva es a nombre de mi empresa, tienen RUT y facturan?", ["- contains_any:\n          - 'RUT'\n          - 'factur'\n          - 'empresa'\n          - 'compañero'", "- not_contains: 'no tenemos'"]),
]))
flows.append(("cancelacion", "Política cancelación", [
    ("Hola, busco finca en Villeta para 8 personas " + FECHA_TXT, ["- state_equals: OFFERING"]),
    ("Si me toca cancelar, me devuelven la plata?", ["- contains_any:\n          - 'cancel'\n          - 'reembols'\n          - 'devolución'\n          - 'devolucion'\n          - 'política'\n          - 'politica'\n          - 'compañero'"]),
]))
flows.append(("reservar-proceso", "Cómo reservar → pide datos", [
    ("Hola, busco finca en Anapoima para 8 personas " + FECHA_TXT, ["- state_equals: OFFERING"]),
    ("La primera me encanta, cómo hago para reservarla?", ["- not_contains: 'te paso con mi compañero'", "- contains_any:\n          - 'nombre'\n          - 'datos'\n          - 'reserv'\n          - 'documento'\n          - 'correo'\n          - 'proceso'"]),
]))
flows.append(("multi-tema", "Multi-pregunta en un turno", [
    ("Hola, busco finca en Anapoima para 8 personas " + FECHA_TXT, ["- state_equals: OFFERING"]),
    ("De la primera: tiene piscina? cuánto queda del pueblo? y el precio por noche?", ["- not_contains: 'te paso con mi compañero'", "- contains: '$'", "- contains_any:\n          - 'piscina'\n          - 'Piscina'"]),
]))

for i, (slug, title, turns) in enumerate(flows, 1):
    turns_yaml = ''
    for user, asserts in turns:
        asserts_yaml = '\n      '.join(asserts)
        turns_yaml += f"""
  - user: '{yaml_escape(user)}'
    assert:
      {asserts_yaml}
"""
    yml = f"""id: g100-flow-{i:02d}-{slug}
title: '{yaml_escape(title)}'
category: g100 / flows

turns:{turns_yaml}"""
    write_scenario(f"g100-flow-{i:02d}.yaml", yml)
    count += 1

print(f"flows: {len(flows)}")

# ============================================================
# 5) 10 EDGE / REGRESSION
# ============================================================
edges = []
edges.append(("ninos-menores", "Niños <5 no cuentan", [
    ("Hola, busco finca en Anapoima para 10 adultos y 3 niños de 2, 3 y 8 años " + FECHA_TXT,
     ["- state_equals: OFFERING", "- not_contains: 'te paso con mi compañero'", "- not_contains: 'menores de 2'", "- not_contains: 'de brazos'"]),
]))
edges.append(("finca-inactiva", "Finca inactiva nombrada → honesto sin 'no existe'", [
    ("Hola, busco finca en Antioquia para 50 personas " + FECHA_TXT, ["- state_equals: OFFERING"]),
    ("Me muestras la finca Sopetrán 20?", ["- not_contains: 'no existe'", "- not_contains: 'no tenemos registrada'", "- bot_recognized_finca: 'SOPETRAN_#20'"]),
]))
edges.append(("finca-inexistente", "Finca inventada → aclara sin inventar", [
    ("Hola, busco finca en Anapoima para 8 personas " + FECHA_TXT, ["- state_equals: OFFERING"]),
    ("Quiero la finca ANAPOIMA_#99", ["- not_contains: 'te paso con mi compañero'", "- contains_any:\n          - 'no'\n          - 'verificar'\n          - 'disponible'\n          - 'alternativa'"]),
]))
edges.append(("burst-mensajes", "Mensajes en ráfaga", [
    ("Hola", ["- not_contains: 'te paso con mi compañero'"]),
    ("Soy Pedro", ["- not_contains: 'te paso con mi compañero'"]),
    ("Busco finca en Girardot para 8 personas " + FECHA_TXT, ["- state_equals: OFFERING"]),
]))
edges.append(("zona-inexistente", "Zona sin cobertura → honesto + alternativas", [
    ("Hola, busco finca en Cartagena para 10 personas " + FECHA_TXT,
     ["- not_contains: 'te paso con mi compañero'", "- contains_any:\n          - 'no'\n          - 'zona'\n          - 'alternativa'\n          - 'manejamos'\n          - 'opciones'"]),
]))
edges.append(("fechas-largas", "Estadía larga 5 noches", [
    ("Hola, busco finca en Anapoima para 10 personas del 24 al 29 de agosto de 2026",
     ["- state_equals: OFFERING", "- not_contains: 'te paso con mi compañero'"]),
]))
edges.append(("una-noche", "1 sola noche", [
    ("Hola, busco finca en Girardot para 8 personas del 25 al 26 de agosto de 2026",
     ["- not_contains: 'te paso con mi compañero'"]),
]))
edges.append(("mascotas-filtro", "Filtro pet friendly", [
    ("Hola, busco finca pet friendly en Anapoima para 8 personas " + FECHA_TXT + ", voy con mi perro",
     ["- state_equals: OFFERING", "- not_contains: 'te paso con mi compañero'"]),
]))
edges.append(("jacuzzi-filtro", "Filtro jacuzzi", [
    ("Hola, busco finca con jacuzzi en Villeta para 10 personas " + FECHA_TXT,
     ["- state_equals: OFFERING", "- not_contains: 'te paso con mi compañero'"]),
]))
edges.append(("mas-opciones", "Pide más opciones tras primera tanda", [
    ("Hola, busco finca en Anapoima para 10 personas " + FECHA_TXT, ["- state_equals: OFFERING"]),
    ("Muéstrame otras opciones diferentes", ["- not_contains: 'te paso con mi compañero'", "- not_contains: 'no tenemos'"]),
]))

for i, (slug, title, turns) in enumerate(edges, 1):
    turns_yaml = ''
    for user, asserts in turns:
        asserts_yaml = '\n      '.join(asserts)
        turns_yaml += f"""
  - user: '{yaml_escape(user)}'
    assert:
      {asserts_yaml}
"""
    yml = f"""id: g100-edge-{i:02d}-{slug}
title: '{yaml_escape(title)}'
category: g100 / edge

turns:{turns_yaml}"""
    write_scenario(f"g100-edge-{i:02d}.yaml", yml)
    count += 1

print(f"edges: {len(edges)}")
print(f"\nTOTAL scenarios: {count}")
