#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import pg from 'pg';

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(rootDir, '.env') });

const migrationPath = path.join(
  rootDir,
  'supabase',
  'migrations',
  '20260327113000_add_owner_test_mode_to_agent_settings.sql',
);

function firstPresent(...values) {
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function buildClientConfig() {
  const connectionString = firstPresent(
    process.env.SUPABASE_DB_URL,
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.POSTGRES_PRISMA_URL,
    process.env.POSTGRES_URL_NON_POOLING,
  );

  if (connectionString) {
    return {
      connectionString,
      ssl: {
        rejectUnauthorized: false,
      },
    };
  }

  const host = firstPresent(process.env.SUPABASE_DB_HOST);
  const database = firstPresent(process.env.SUPABASE_DB_NAME);
  const user = firstPresent(process.env.SUPABASE_DB_USER);
  const password = firstPresent(process.env.SUPABASE_DB_PASSWORD);
  const port = Number(process.env.SUPABASE_DB_PORT || 0) || 5432;

  if (!host || !database || !user || !password) {
    throw new Error(
      'Missing database connection settings. Define SUPABASE_DB_URL, DATABASE_URL, POSTGRES_URL or SUPABASE_DB_* in .env.',
    );
  }

  return {
    host,
    port,
    database,
    user,
    password,
    ssl: {
      rejectUnauthorized: false,
    },
  };
}

const sql = await fs.readFile(migrationPath, 'utf8');
const client = new Client(buildClientConfig());

try {
  await client.connect();
  await client.query(sql);
  console.log(
    JSON.stringify(
      {
        ok: true,
        migration: path.basename(migrationPath),
      },
      null,
      2,
    ),
  );
} finally {
  await client.end().catch(() => {});
}
