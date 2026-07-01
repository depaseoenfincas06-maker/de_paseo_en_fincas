#!/usr/bin/env node
// CLI: load scenarios from disk, run each against a simulator instance, and
// write a JSON+MD report to evals/runs/<utc-timestamp>/.
//
// Usage:
//   node evals/run.mjs                          # all scenarios, default base http://127.0.0.1:3101
//   node evals/run.mjs scenarios/foo.yaml       # single scenario
//   node evals/run.mjs --base-url https://x ... # remote simulator
//   node evals/run.mjs --workers 4              # concurrent scenarios
//
// Exit code: 0 if all scenarios pass; 1 if any fails (handy for CI gate).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const yaml = createRequire(import.meta.url)('js-yaml');
import { runScenario } from './lib/runner.mjs';

function parseArgs(argv) {
  const out = { paths: [], baseUrl: 'http://127.0.0.1:3101', workers: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base-url') { out.baseUrl = argv[++i]; }
    else if (a === '--workers') { out.workers = Math.max(1, Number(argv[++i]) || 1); }
    else if (a.startsWith('--')) { /* ignore unknown */ }
    else out.paths.push(a);
  }
  return out;
}

function loadScenario(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file).toLowerCase();
  if (ext === '.json') return JSON.parse(raw);
  return yaml.load(raw);
}

function collectScenarioFiles(paths) {
  if (paths.length) return paths.map((p) => path.resolve(p));
  const dir = path.resolve('evals/scenarios');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /\.(ya?ml|json)$/i.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

async function pool(items, n, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function spawn() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, spawn));
  return results;
}

function md(report) {
  const lines = [];
  lines.push(`# Eval run — ${report.started_at}`);
  lines.push('');
  lines.push(`**Base URL**: \`${report.base_url}\``);
  lines.push(`**Scenarios**: ${report.scenarios.length} (${report.passed} passed, ${report.failed} failed)`);
  lines.push(`**Duration**: ${(report.duration_ms / 1000).toFixed(1)}s`);
  lines.push('');
  lines.push('| id | ok | failed assertions | conv_id |');
  lines.push('|---|---|---|---|');
  for (const s of report.scenarios) {
    const failedAsserts = s.turns.flatMap((t) => t.assertions.filter((a) => !a.ok));
    lines.push(`| ${s.id} | ${s.ok ? '✅' : '❌'} | ${failedAsserts.length} | \`${s.conversation_id || '(n/a)'}\` |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  for (const s of report.scenarios) {
    lines.push(`## ${s.ok ? '✅' : '❌'} ${s.id} — ${s.title || ''}`);
    if (s.category) lines.push(`_category_: ${s.category}`);
    lines.push(`_conv_id_: \`${s.conversation_id || s.error || '(none)'}\``);
    if (s.error) {
      lines.push('');
      lines.push(`> **ERROR**: ${s.error}`);
      lines.push('');
      continue;
    }
    for (const t of s.turns) {
      lines.push('');
      lines.push(`### Turn ${t.turn_index + 1} — state after: \`${t.state_after || '(null)'}\`${t.timed_out ? ' ⏱️ TIMEOUT' : ''}`);
      lines.push(`**USER**: ${t.user_text}`);
      for (const m of t.new_bot_messages) {
        const tag = m.agent_used ? ` _(${m.agent_used})_` : '';
        lines.push(`**BOT**${tag}: ${m.content?.replace(/\n/g, ' / ')}`);
      }
      for (const a of t.assertions) {
        const argRepr = a.arg === undefined ? '' : ` = ${JSON.stringify(a.arg)}`;
        lines.push(`- ${a.ok ? '✅' : '❌'} \`${a.name}${argRepr}\`${a.detail ? `  _${a.detail}_` : ''}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = collectScenarioFiles(args.paths);
  if (!files.length) {
    console.error('no scenarios found.');
    process.exit(2);
  }

  console.log(`▶ running ${files.length} scenario(s) against ${args.baseUrl} (workers=${args.workers})`);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const scenarios = files.map((f) => {
    try { return { file: f, scenario: loadScenario(f), loadErr: null }; }
    catch (e) { return { file: f, scenario: null, loadErr: e.message }; }
  });

  const results = await pool(scenarios, args.workers, async ({ file, scenario, loadErr }) => {
    const rel = path.relative(process.cwd(), file);
    if (loadErr) {
      console.log(`✗ ${rel} — load error: ${loadErr}`);
      return { id: rel, ok: false, error: `load error: ${loadErr}`, turns: [] };
    }
    try {
      const res = await runScenario(scenario, { baseUrl: args.baseUrl });
      console.log(`${res.ok ? '✓' : '✗'} ${res.id}${res.ok ? '' : '  → ' + res.turns.flatMap((t) => t.assertions.filter((a) => !a.ok).map((a) => a.name)).join(', ')}`);
      return res;
    } catch (e) {
      console.log(`✗ ${rel} — runtime error: ${e.message}`);
      return { id: scenario?.id || rel, ok: false, error: e.message, turns: [] };
    }
  });

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const report = {
    started_at: startedAt,
    duration_ms: Date.now() - t0,
    base_url: args.baseUrl,
    passed,
    failed,
    scenarios: results,
  };

  const stamp = startedAt.replace(/[:.]/g, '-');
  const outDir = path.resolve('evals/runs', stamp);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, 'report.md'), md(report));

  console.log(`\n▶ ${passed}/${results.length} passed in ${(report.duration_ms / 1000).toFixed(1)}s`);
  console.log(`  report: ${path.relative(process.cwd(), outDir)}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('fatal:', e); process.exit(2); });
