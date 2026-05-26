#!/usr/bin/env python3
"""
Track 4.3 — Item 20: "No encuentra nada en Cundinamarca".

Bug: zoneAliasDefinitions tiene un cluster "cerca a Bogotá" cuyos targets son
todos los municipios de Cundinamarca + Melgar, PERO el array `keys` no incluye
'cundinamarca' / 'departamento de cundinamarca'. Si el usuario dice
"Cundinamarca", resolveZoneAlias returns null → zoneTargets=['cundinamarca']
→ ningún zona/municipio del inventario contiene esa string → 0 resultados.

Fix:
  - Agregar 'cundinamarca', 'departamento de cundinamarca' a keys del cluster Bogotá.
  - Agregar 'antioquia', 'departamento de antioquia' a keys del cluster Medellín.
  - Agregar 'tolima', 'departamento de tolima' al cluster Bogotá (Melgar, Carmen de Apicalá).
  - Agregar 'risaralda', 'caldas', 'quindio' como departamentos al cluster Eje Cafetero
    (ya están en keys como ciudades, pero formalizar como deptos).
  - Agregar 'arbelaez' a targets del cluster Bogotá (existe en inventario, faltaba).
"""
import json, subprocess, sys

JWT = open('/tmp/n8n_jwt.txt').read().strip()
WID = '2NV08zRFKENUsQVC'
URL = f'https://n8n.depaseoenfincas.raaamp.co/api/v1/workflows/{WID}'

r = subprocess.run(['curl','-sk', URL, '-H', f'X-N8N-API-KEY: {JWT}'],
                   capture_output=True, text=True, check=True)
wf = json.loads(r.stdout)

OLD = (
"const zoneAliasDefinitions = [\n"
"  {\n"
"    keys: ['cerca a bogota', 'cerca de bogota', 'bogota y alrededores', 'bogota', 'alrededores de bogota'],\n"
"    label: 'cerca a Bogotá',\n"
"    targets: ['anapoima', 'villeta', 'la vega', 'girardot', 'carmen de apicala', 'la mesa', 'mesitas del colegio', 'ricaurte', 'melgar'],\n"
"  },\n"
"  {\n"
"    keys: ['cerca a medellin', 'cerca de medellin', 'medellin o cerca', 'medellin', 'alrededores de medellin'],\n"
"    label: 'cerca a Medellín',\n"
"    targets: ['antioquia', 'santa fe de antioquia', 'santafe de antioquia', 'guatape', 'el penol', 'san jeronimo', 'sopetran', 'barbosa', 'rionegro'],\n"
"  },\n"
"  {\n"
"    keys: ['eje cafetero', 'quindio', 'armenia', 'pereira', 'manizales', 'salento', 'filandia', 'calarca', 'risaralda', 'caldas'],\n"
"    label: 'Eje Cafetero',\n"
"    targets: ['eje cafetero', 'quindio', 'armenia', 'pereira', 'manizales', 'salento', 'filandia', 'calarca', 'risaralda', 'caldas'],\n"
"  },\n"
"];"
)

NEW = (
"const zoneAliasDefinitions = [\n"
"  {\n"
"    // Cluster Cundinamarca/Bogotá. 'cundinamarca' agregado para que cuando el\n"
"    // cliente diga el departamento (ej. \"opciones en Cundinamarca\"), el matcher\n"
"    // expanda a los municipios reales del inventario. 'tolima' incluido porque\n"
"    // Melgar/Carmen de Apicalá están aquí.\n"
"    keys: ['cerca a bogota', 'cerca de bogota', 'bogota y alrededores', 'bogota', 'alrededores de bogota',\n"
"           'cundinamarca', 'departamento de cundinamarca', 'depto de cundinamarca', 'depto cundinamarca',\n"
"           'tolima', 'departamento de tolima', 'depto de tolima'],\n"
"    label: 'Cundinamarca (cerca a Bogotá)',\n"
"    targets: ['anapoima', 'villeta', 'la vega', 'girardot', 'carmen de apicala', 'la mesa', 'mesitas del colegio',\n"
"              'ricaurte', 'melgar', 'arbelaez', 'fusagasuga'],\n"
"  },\n"
"  {\n"
"    keys: ['cerca a medellin', 'cerca de medellin', 'medellin o cerca', 'medellin', 'alrededores de medellin',\n"
"           'antioquia', 'departamento de antioquia', 'depto de antioquia', 'depto antioquia'],\n"
"    label: 'Antioquia (cerca a Medellín)',\n"
"    targets: ['antioquia', 'santa fe de antioquia', 'santafe de antioquia', 'guatape', 'el penol', 'san jeronimo', 'sopetran', 'barbosa', 'rionegro'],\n"
"  },\n"
"  {\n"
"    keys: ['eje cafetero', 'quindio', 'armenia', 'pereira', 'manizales', 'salento', 'filandia', 'calarca', 'risaralda', 'caldas',\n"
"           'departamento del quindio', 'departamento de risaralda', 'departamento de caldas',\n"
"           'depto del quindio', 'depto de risaralda', 'depto de caldas'],\n"
"    label: 'Eje Cafetero',\n"
"    targets: ['eje cafetero', 'quindio', 'armenia', 'pereira', 'manizales', 'salento', 'filandia', 'calarca', 'risaralda', 'caldas'],\n"
"  },\n"
"];"
)

found = False
for n in wf['nodes']:
    if n['name'] != 'Build Inventory Tool Response': continue
    code = n['parameters']['jsCode']
    if OLD not in code:
        print('!! zoneAliasDefinitions block not found verbatim'); sys.exit(2)
    n['parameters']['jsCode'] = code.replace(OLD, NEW, 1)
    print('✓ Build Inventory Tool Response: zoneAliasDefinitions actualizado con departamentos')
    found = True
    break

if not found:
    print('!! BIT node not found'); sys.exit(2)

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
