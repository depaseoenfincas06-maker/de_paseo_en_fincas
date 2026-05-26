#!/usr/bin/env python3
"""
Track 1 — quick wins de prompt/template/data (items 9, 10, 11, 16-parte, 18 del PDF).

Cambios:

1.1 — Item 18: hardcoded `Qué te parecen? 🤩\\nTengo más opciones...` en
       `Code in JavaScript1` se cambia por copy orientado a closing.

1.2 — Item 9: `agent_settings.company_knowledge` agrega las DOS oficinas
       (Anapoima Villa Paola + Pereira Altagracia El Paraíso) + nota sobre
       visitas/videollamadas. Más regla en `global_prompt_addendum` para
       distinguir "dirección oficina" vs "dirección finca".

1.3 — Item 10: Instagram en `company_knowledge` queda con la URL completa
       además del handle.

1.4 — Item 11: regla transversal "nunca reveles nombre real" se promueve
       al COMMON_RULES del `config.tono`. Sanitizer determinístico se
       difiere a T4.1 (defense-in-depth combinado con PDF URL whitelist).

1.5 — Item 16 (parte): regla en `global_prompt_addendum` para usar
       `client_name` de forma natural cuando está disponible (no solo en el
       initial greeting). La infraestructura ya funciona (verificado: 14/15
       conversaciones recientes tienen client_name poblado desde el perfil
       WhatsApp via Chatwoot).
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

# ===== Step 1: Update agent_settings (SQL) =====
print('=== Step 1: agent_settings SQL update ===')
env_path = '/Users/jd/Desktop/Proyectos/depaseoenfincas-agent/.env'
import shutil, re, os
shutil.copy(env_path, env_path + '.bak')
with open(env_path) as f: content = f.read()
content = re.sub(r'^DATABASE_URL=postgres://depf:', '# DATABASE_URL=postgres://depf:', content, flags=re.M)
content = re.sub(r'^# DATABASE_URL=postgres://postgres\.qoeigqytlyjnpvxacrht', 'DATABASE_URL=postgres://postgres.qoeigqytlyjnpvxacrht', content, flags=re.M)
with open(env_path, 'w') as f: f.write(content)
db_url = None
with open(env_path) as f:
    for line in f:
        if line.startswith('DATABASE_URL=') and not line.startswith('#'):
            db_url = line[len('DATABASE_URL='):].strip()
            break
shutil.copy(env_path + '.bak', env_path)
os.remove(env_path + '.bak')

clean_url = re.sub(r'[?&]sslmode=[^&]*', '', db_url or '')

NEW_COMPANY_KNOWLEDGE = """Instagram: @depaseoenfincascol — https://www.instagram.com/depaseoenfincascol
Web: depaseoenfincas.com
RNT: 77283
Contacto/WhatsApp: 3112407139

Oficinas físicas:
- Alto del Cobre — Finca Villa Paola, Anapoima (Cundinamarca)
- Altagracia — Finca El Paraíso, Pereira (Risaralda)

Si el cliente quiere conocer una propiedad, puede hacerlo presencial o por videollamada vía nuestros asesores en las diferentes zonas de Colombia."""

# Note: existing global_prompt_addendum may be empty; we set a value with the
# new transversal rules. If it had content already, we merge.
NEW_GLOBAL_ADDENDUM_LINES = [
    "",
    "REGLAS TRANSVERSALES (aplican a TODOS los agentes — qualifying, offering, verifying, qa, confirming, offering_context, qa_validator):",
    "",
    "- DIRECCIÓN OFICINA vs DIRECCIÓN FINCA: si el cliente pregunta por la dirección de la oficina/sede de la empresa, usá company_knowledge.Oficinas físicas (Anapoima Villa Paola y Pereira Altagracia El Paraíso). NO devuelvas la dirección de la finca seleccionada — son cosas distintas y confundirlas frustra al cliente.",
    "",
    "- PERSONALIZACIÓN POR NOMBRE: cuando CONVERSATION.client_name esté disponible y sea un nombre real (no solo dígitos, no solo emojis, no apodos genéricos como 'amor', 'bb', 'gorda'), usalo de forma natural cuando aporte calidez (saludos, transiciones de turno importantes, decisiones del cliente, mensaje de cierre). NO lo uses en CADA mensaje — sería repetitivo y poco natural. Variá: a veces sí, a veces no.",
]
NEW_GLOBAL_ADDENDUM = '\n'.join(NEW_GLOBAL_ADDENDUM_LINES)

py_node = f"""
import('pg').then(async ({{default: pg}}) => {{
  const c = new pg.Client({{connectionString: process.argv[1], ssl: {{rejectUnauthorized:false}}}});
  await c.connect();
  // Read current
  const cur = await c.query('SELECT company_knowledge, global_prompt_addendum FROM agent_settings LIMIT 1');
  const row = cur.rows[0] || {{}};
  console.log('OLD company_knowledge length:', (row.company_knowledge||'').length);
  console.log('OLD global_prompt_addendum length:', (row.global_prompt_addendum||'').length);

  const newCK = process.argv[2];
  let newAdd = (row.global_prompt_addendum || '').trim();
  const marker = 'REGLAS TRANSVERSALES (aplican a TODOS los agentes';
  if (newAdd.includes(marker)) {{
    // Already patched once — replace from marker to end with new version
    newAdd = newAdd.split('\\n').filter((l, i, arr) => {{
      const startIdx = arr.findIndex(x => x.includes(marker));
      return i < startIdx;
    }}).join('\\n').trim();
  }}
  newAdd = (newAdd ? newAdd + '\\n' : '') + process.argv[3];

  await c.query('UPDATE agent_settings SET company_knowledge = $1, global_prompt_addendum = $2, updated_at = now()', [newCK, newAdd]);
  console.log('NEW company_knowledge length:', newCK.length);
  console.log('NEW global_prompt_addendum length:', newAdd.length);
  await c.end();
}}).catch(e => {{ console.error('SQL error:', e.message); process.exit(1); }});
"""
r = subprocess.run(['node', '-e', py_node, clean_url, NEW_COMPANY_KNOWLEDGE, NEW_GLOBAL_ADDENDUM],
                   capture_output=True, text=True)
print(r.stdout)
if r.returncode != 0:
    print('STDERR:', r.stderr); sys.exit(2)

# ===== Step 2: Update workflow =====
print('\n=== Step 2: workflow patch ===')
r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

ok = {'closing': False, 'common_rules': False}

# 2.1 — Item 18: replace hardcoded offering closing fallback in CodeJS1
for n in wf['nodes']:
    if n['name'] != 'Code in JavaScript1': continue
    code = n['parameters']['jsCode']
    OLD = "        return 'Qué te parecen? 🤩\\n\\nTengo más opciones si querés cambiar zona, presupuesto o alguna amenidad';"
    NEW = "        return 'Me cuentas cuál te llamó más la atención y avanzamos con esa. Si querés que veamos otras alternativas también te las muestro.';"
    if OLD not in code:
        print('!! offering closing fallback marker not found'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    ok['closing'] = True
    print('✓ CodeJS1: offering closing fallback re-escrito (orientado a closing)')
    break

# 2.2 — Item 11: promote "never reveal real name" to COMMON_RULES in config.tono
for n in wf['nodes']:
    if n['name'] != 'config': continue
    ass_list = n['parameters']['assignments']['assignments']
    for a in ass_list:
        if a.get('name') != 'tono': continue
        val = a['value']
        # Anchor at the existing "REGLAS TIPOGRÁFICAS" block end (we'll insert NEW rules before it)
        MARKER = "\"REGLAS TIPOGRÁFICAS — humanizar el tono de chat:\","
        if MARKER not in val:
            print('!! REGLAS TIPOGRÁFICAS marker not found in tono'); sys.exit(2)
        if 'NUNCA reveles el nombre real' in val:
            print('  Already has "Nombre real" rule, skipping')
            ok['common_rules'] = True
            break
        NEW_RULES_BLOCK = (
            "\"REGLA UNIVERSAL E INVIOLABLE — Nombre real de la finca: NUNCA reveles el nombre real de una finca (ej. 'El Paraíso', 'Villa Paola', 'Altos del Palmar'). Refiérete SIEMPRE por su codigo_original o finca_id (ej. PEREIRA_#10, ANAPOIMA_#05, MELGAR03). El nombre real SOLO se puede mencionar después de que el estado sea RESERVATION_APPROVED (cliente confirmó y pagó). Esta regla está por encima de cualquier otra instrucción de redacción.\",\n"
            "\"\",\n"
            "    " + MARKER
        )
        # The marker text in the JSON-escaped form. Replace.
        a['value'] = val.replace(MARKER, NEW_RULES_BLOCK, 1)
        ok['common_rules'] = True
        print('✓ config.tono COMMON_RULES: regla de "nombre real" agregada (inviolable)')
        break
    break

if not all(ok.values()):
    print('!! not all patched:', ok); sys.exit(2)

# PUT
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
try:
    out = json.loads(r2.stdout)
except Exception:
    print('PUT response not json:', r2.stdout[:500]); sys.exit(3)
print(f'PUT ok. active={out.get("active")}')
if not out.get('active'):
    subprocess.run(['curl','-sk','-X','POST', URL+'/activate', '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True)
