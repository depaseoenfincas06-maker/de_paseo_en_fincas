#!/usr/bin/env python3
"""Backup de workflows de n8n a backups/n8n/<id>-<slug>-<ts>.json (gitignored: contienen tokens).

Uso:  python3 scripts/n8n_backup.py [<workflow_id> ...]
Sin argumentos respalda los workflows del proyecto (customer agent, follow-up sender,
selection notification sender, owner request sender, owner inbound handler).
Credenciales: N8N_BASE_URL y N8N_PUBLIC_API_TOKEN de .env.
"""
import json, os, re, subprocess, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_IDS = ['2NV08zRFKENUsQVC', 'xxK2FfX6QMPxKaZw', 'tNvfWKi1TA7O6maf', '6RycYEsoSQbjrIpp', '92HzVlxNCjw6KHlO']

def env():
    vals = {}
    with open(os.path.join(ROOT, '.env')) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line: continue
            k, v = line.split('=', 1); vals[k] = v.strip().strip('"').strip("'")
    return vals

def main():
    e = env(); base = e['N8N_BASE_URL'].rstrip('/'); jwt = e['N8N_PUBLIC_API_TOKEN']
    ids = sys.argv[1:] or DEFAULT_IDS
    ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    out_dir = os.path.join(ROOT, 'backups', 'n8n'); os.makedirs(out_dir, exist_ok=True)
    for wid in ids:
        r = subprocess.run(['curl', '-sk', f'{base}/api/v1/workflows/{wid}', '-H', f'X-N8N-API-KEY: {jwt}'], capture_output=True, text=True, check=True)
        wf = json.loads(r.stdout)
        if 'nodes' not in wf:
            print(f'!! {wid}: respuesta inesperada: {r.stdout[:200]}'); sys.exit(2)
        slug = re.sub(r'[^a-z0-9]+', '-', wf['name'].lower()).strip('-')[:50]
        path = os.path.join(out_dir, f'{wid}-{slug}-{ts}.json')
        with open(path, 'w') as fh: json.dump(wf, fh, ensure_ascii=False, indent=1)
        print(f'ok {wid} "{wf["name"]}" nodes={len(wf["nodes"])} active={wf.get("active")} → {os.path.relpath(path, ROOT)}')

if __name__ == '__main__':
    main()
