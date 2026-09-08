#!/usr/bin/env python3
"""Restaura un workflow de n8n desde un backup JSON (rollback).

Uso:  python3 scripts/n8n_restore.py backups/n8n/<archivo>.json [--dry-run]
Hace PUT de nodes+connections+settings del backup sobre el MISMO workflow id y lo
reactiva si quedó inactivo. Antes de restaurar, guarda un backup del estado actual
(por si el rollback hay que deshacerlo).
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOWED = {'executionOrder', 'timezone', 'saveDataErrorExecution', 'saveDataSuccessExecution',
           'saveExecutionProgress', 'saveManualExecutions', 'errorWorkflow'}

def env():
    vals = {}
    with open(os.path.join(ROOT, '.env')) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line: continue
            k, v = line.split('=', 1); vals[k] = v.strip().strip('"').strip("'")
    return vals

def main():
    if len(sys.argv) < 2: print(__doc__); sys.exit(1)
    path = sys.argv[1]; dry = '--dry-run' in sys.argv
    wf = json.load(open(path)); wid = wf['id']
    e = env(); base = e['N8N_BASE_URL'].rstrip('/'); jwt = e['N8N_PUBLIC_API_TOKEN']
    print(f'restaurando "{wf["name"]}" ({wid}) desde {path}: nodes={len(wf["nodes"])}')
    if dry: print('dry-run: no se hizo PUT'); return
    subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'n8n_backup.py'), wid], check=True)
    payload = {'name': wf['name'], 'nodes': wf['nodes'], 'connections': wf['connections'],
               'settings': {k: v for k, v in (wf.get('settings') or {}).items() if k in ALLOWED}}
    r = subprocess.run(['curl', '-sk', '-X', 'PUT', f'{base}/api/v1/workflows/{wid}', '-H', f'X-N8N-API-KEY: {jwt}',
                        '-H', 'Content-Type: application/json', '-d', '@-'], input=json.dumps(payload), capture_output=True, text=True, check=True)
    res = json.loads(r.stdout)
    if 'nodes' not in res: print('!! PUT falló:', r.stdout[:300]); sys.exit(2)
    if res.get('active') is False:
        subprocess.run(['curl', '-sk', '-X', 'POST', f'{base}/api/v1/workflows/{wid}/activate', '-H', f'X-N8N-API-KEY: {jwt}'], capture_output=True, text=True)
        print('reactivado')
    print(f'ok: {wid} restaurado (nodes={len(res["nodes"])})')

if __name__ == '__main__':
    main()
