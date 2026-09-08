"""Helpers compartidos para patches de n8n (lee credenciales de .env, respalda, PUT + reactivar)."""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOWED = {'executionOrder', 'timezone', 'saveDataErrorExecution', 'saveDataSuccessExecution',
           'saveExecutionProgress', 'saveManualExecutions', 'errorWorkflow'}

def _env():
    vals = {}
    with open(os.path.join(ROOT, '.env')) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line: continue
            k, v = line.split('=', 1); vals[k] = v.strip().strip('"').strip("'")
    return vals

def _creds():
    e = _env(); return e['N8N_BASE_URL'].rstrip('/'), e['N8N_PUBLIC_API_TOKEN']

def get_workflow(wid):
    base, jwt = _creds()
    r = subprocess.run(['curl', '-sk', f'{base}/api/v1/workflows/{wid}', '-H', f'X-N8N-API-KEY: {jwt}'], capture_output=True, text=True, check=True)
    wf = json.loads(r.stdout)
    if 'nodes' not in wf: raise SystemExit(f'GET {wid} inesperado: {r.stdout[:200]}')
    return wf

def backup(wid):
    subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'n8n_backup.py'), wid], check=True)

def put_workflow(wid, wf):
    base, jwt = _creds()
    payload = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
               'settings': {k: v for k, v in (wf.get('settings') or {}).items() if k in ALLOWED}}
    r = subprocess.run(['curl', '-sk', '-X', 'PUT', f'{base}/api/v1/workflows/{wid}', '-H', f'X-N8N-API-KEY: {jwt}',
                        '-H', 'Content-Type: application/json', '-d', '@-'], input=json.dumps(payload), capture_output=True, text=True, check=True)
    res = json.loads(r.stdout)
    if 'nodes' not in res: raise SystemExit(f'PUT {wid} falló: {r.stdout[:400]}')
    active = res.get('active')
    if active is False:
        subprocess.run(['curl', '-sk', '-X', 'POST', f'{base}/api/v1/workflows/{wid}/activate', '-H', f'X-N8N-API-KEY: {jwt}'], capture_output=True, text=True)
        active = 'reactivated'
    return active

def node(wf, name):
    for n in wf['nodes']:
        if n['name'] == name: return n
    raise SystemExit(f'nodo no encontrado: {name}')

def replace_once(text, old, new, label):
    if new in text and old not in text: return text  # ya aplicado
    if old not in text: raise SystemExit(f'!! ancla no encontrada ({label}): {old[:80]!r}')
    if text.count(old) != 1: raise SystemExit(f'!! ancla ambigua ({label}): {text.count(old)} ocurrencias')
    return text.replace(old, new, 1)
