#!/usr/bin/env node
/**
 * One-off SQL migration applier for prod Supabase.
 *
 * Usage:
 *   SUPABASE_DB_URL='postgres://...sslmode=require' \
 *     node scripts/apply_migrations_oneoff.mjs supabase/migrations/<file1>.sql ...
 *
 * Or — if you already have a DATABASE_URL line in a local .env (commented or
 * not), point this script at it via env var SOURCE_ENV (defaults to ".env"
 * in the project root). The script will pull DATABASE_URL or SUPABASE_DB_URL
 * from that file.
 *
 * Why this and not a regular migration runner? The Supabase pooler presents
 * a self-signed cert in the chain that Node's default validation rejects.
 * This script strips the `sslmode=require` from the URL (so pg's
 * connection-string parser doesn't override our explicit ssl option) and
 * uses `rejectUnauthorized: false` to talk to the pooler.
 *
 * Each SQL file is executed inside its own BEGIN/COMMIT — a syntax error
 * in one file aborts that file only, leaving previously-run migrations
 * intact.
 */
import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

async function loadDatabaseUrl() {
  // 1) explicit env var
  const fromEnv = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;

  // 2) fall back to the .env file
  const envPath = process.env.SOURCE_ENV
    ? path.resolve(process.env.SOURCE_ENV)
    : path.resolve(projectRoot, '.env');
  let envText = '';
  try {
    envText = await fs.readFile(envPath, 'utf8');
  } catch {
    // also try the v2 monorepo .env (legacy, while we still have it)
    const legacy = '/Users/jd/Desktop/Proyectos/depaseoenfincas-agent/.env';
    try { envText = await fs.readFile(legacy, 'utf8'); } catch {}
  }
  for (const line of envText.split('\n')) {
    const m = line.match(/^#?\s*(SUPABASE_DB_URL|DATABASE_URL)=(.+supabase\.com.+)$/);
    if (m) return m[2].trim();
  }
  throw new Error('No SUPABASE_DB_URL or DATABASE_URL pointing at supabase.com found');
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node scripts/apply_migrations_oneoff.mjs <file1.sql> [<file2.sql> ...]');
  process.exit(1);
}

const url = await loadDatabaseUrl();
const cleaned = url
  .replace(/[?&]sslmode=[^&]*/g, (m) => (m.startsWith('?') ? '?' : '&'))
  .replace(/[?&]$/, '');
console.log('connecting to:', cleaned.replace(/:[^:@]+@/, ':<pwd>@'));

const client = new pg.Client({
  connectionString: cleaned,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

let failedAny = false;
for (const f of files) {
  const abs = path.resolve(f);
  let sql;
  try {
    sql = await fs.readFile(abs, 'utf8');
  } catch (e) {
    console.error(`\n=== ${f} ===\n  ❌ cannot read file: ${e.message}`);
    failedAny = true;
    continue;
  }
  console.log(`\n=== applying ${f} ===`);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('  ✅ ok');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`  ❌ ${e.message}`);
    failedAny = true;
  }
}

await client.end();
process.exit(failedAny ? 2 : 0);
