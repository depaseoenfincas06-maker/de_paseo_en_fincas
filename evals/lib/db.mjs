// Minimal pg pool that mirrors simulator/server.mjs:createPool() so evals can
// read from the same prod DB the simulator uses, without dragging in the whole
// Express server.
//
// Reads SUPABASE_DB_URL / DATABASE_URL first, falls back to SUPABASE_DB_HOST +
// NAME + USER + PASSWORD discrete vars. Always uses ssl.rejectUnauthorized=false
// (Supabase self-signed in pooler mode).
//
// IMPORTANT: this is READ-ONLY usage downstream. Evals never write to prod
// tables — they create synthetic conversations via the simulator API which
// goes through n8n's normal write path.

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

function firstPresent(...values) {
  for (const v of values) {
    const s = (v == null ? '' : String(v)).trim();
    if (s) return s;
  }
  return '';
}

let _pool = null;
export function getPool() {
  if (_pool) return _pool;
  const cs = firstPresent(
    process.env.SUPABASE_DB_URL,
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  );
  if (cs) {
    _pool = new Pool({
      connectionString: cs,
      ssl: { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    });
    return _pool;
  }
  if (
    process.env.SUPABASE_DB_HOST &&
    process.env.SUPABASE_DB_NAME &&
    process.env.SUPABASE_DB_USER &&
    process.env.SUPABASE_DB_PASSWORD
  ) {
    _pool = new Pool({
      host: process.env.SUPABASE_DB_HOST,
      port: Number(process.env.SUPABASE_DB_PORT || 6543),
      database: process.env.SUPABASE_DB_NAME,
      user: process.env.SUPABASE_DB_USER,
      password: process.env.SUPABASE_DB_PASSWORD,
      ssl: { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
    });
    return _pool;
  }
  throw new Error('No DB connection config found in env (need SUPABASE_DB_URL or SUPABASE_DB_* discrete vars)');
}

export async function query(text, params = []) {
  const c = await getPool().connect();
  try {
    return await c.query(text, params);
  } finally {
    c.release();
  }
}

export async function close() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
