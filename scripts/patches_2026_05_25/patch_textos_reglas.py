#!/usr/bin/env python3
"""
Batch A.2+A.3+A.4 + B.1+B.2+B.3 — Textos exactos + reglas de negocio dictados por Juan.

A.2 visit_offer_message_template
A.3 company_knowledge oficinas (ratificar — ya está bien)
A.4 initial_message_template — greeting con IG URL + lista de zonas
B.1 niños >4 años cobrados → global_prompt_addendum
B.2 empleada 8h → company_knowledge
B.3 jacuzzi $120k informativo → company_knowledge + global_prompt_addendum

A.4 — sin nombres específicos de asesores (Juan los puede llenar via dashboard).
"""
import subprocess, json, sys

def q(sql):
    r = subprocess.run(['python3','/tmp/db_query.py', sql], capture_output=True, text=True)
    return r.stdout.strip(), r.stderr.strip()

# === A.2 — visit_offer_message_template ===
VISIT_NEW = """Claro que sí. ¿Qué día quieres ir y a qué hora? Preferiblemente te sugeriría que fuéramos entre martes y jueves, puesto que los fines de semana normalmente están ocupadas las propiedades y lunes y viernes están en mantenimiento."""

# === A.4 — initial_message_template ===
GREETING_NEW = """Maravilloso día. Mi nombre es Santiago Gallego de depaseoenfincas.com, estaré al tanto de tu reserva.

Para encontrar la finca ideal cuéntame:
1. ¿Para qué fechas buscas?
2. ¿Cuántas personas te acompañan?
3. ¿En qué zona o municipio te gustaría? Cubrimos Anapoima, Eje Cafetero, Girardot, Carmen de Apicalá y otras zonas de Colombia.
4. ¿Tarifa aproximada por noche?

Te invito a que conozcas más de nosotros y nuestras propiedades a través de nuestras redes sociales. Síguenos: https://www.instagram.com/depaseoenfincascol"""

# === B.1 + B.2 + B.3 — Reglas de negocio (append a global_prompt_addendum + company_knowledge) ===
ADDENDUM_NEW_LINES = """- NIÑOS Y CONTEO: los niños hacen parte del conteo de huéspedes y se cobran como tal cuando su edad es superior a 4 años. Niños de 4 años o menos NO entran en el conteo. Si el cliente dice "van X niños pequeños no me los cobran", preguntá la edad antes de descartarlos del conteo.
- SERVICIO DE EMPLEADA: las señoras de servicio trabajan 8 horas y se encargan de la preparación de alimentos (los clientes compran los ingredientes) + mantenimiento de la casa durante la estadía. Su sazón es ampliamente apreciada.
- JACUZZI CLIMATIZADO DE PAGO: cuando una finca tiene "tarifa adicional" mencionada en la descripción cerca del jacuzzi, el valor es $120.000 (recargo de gas para 2 días de uso). Este costo es INFORMATIVO — NO sumarlo automático al `quote.total`. Mencionarlo como nota separada cuando el cliente pregunte por el jacuzzi de una finca con ese cargo."""

# === Build SQL updates ===
def escape(s): return s.replace("'", "''")

# Get current values to append carefully
out, err = q("SELECT global_prompt_addendum FROM agent_settings WHERE id=1")
try:
    current_addendum = json.loads(out).get('global_prompt_addendum', '') or ''
except:
    current_addendum = ''

if 'NIÑOS Y CONTEO' in current_addendum:
    new_addendum = current_addendum  # idempotent
    print('!! addendum business rules already present')
else:
    new_addendum = current_addendum + ('\n\n' if current_addendum else '') + ADDENDUM_NEW_LINES

# Run all updates
updates = [
    ('visit_offer_message_template', VISIT_NEW),
    ('initial_message_template', GREETING_NEW),
    ('global_prompt_addendum', new_addendum),
]

for col, val in updates:
    sql = f"UPDATE agent_settings SET {col}='{escape(val)}', updated_at=now() WHERE id=1"
    out, err = q(sql)
    if 'OK' in err or 'OK' in out:
        print(f'✓ {col} updated ({len(val)} chars)')
    else:
        print(f'?? {col}: out={out[:80]} err={err[:80]}')

# Verify
print('\n--- verification ---')
out, _ = q("SELECT length(visit_offer_message_template) as v_len, length(initial_message_template) as g_len, length(global_prompt_addendum) as a_len FROM agent_settings WHERE id=1")
print(out)
