#!/usr/bin/env node
/**
 * One-shot migration: local SQLite + JSON files  →  Supabase (Postgres).
 *
 *   1. Creates the cloud schema (idempotent DDL).
 *   2. Copies every kv row from data/smart-sugar.db.
 *   3. Copies the audit log.
 *   4. Moves JSON side-files into kv (contracts snapshot, drivers cache,
 *      reports meta + applied-updates log).
 *   5. Uploads the report binaries from data/daily-reports/ → report_files.
 *
 * Usage:  node scripts/migrate-to-supabase.mjs
 * Needs:  DATABASE_URL (or SUPABASE_DB_URL) in .env — the Supabase pooler
 *         connection string (Settings → Database → Connection string).
 * Safe to re-run: everything is upserted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = process.cwd();

// Minimal .env loader (no dependency).
try {
  const envFile = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* optional */ }

const DB_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!DB_URL) {
  console.error('[migrate] DATABASE_URL is not set. Put the Supabase connection string in .env first.');
  process.exit(2);
}

const DDL = `
  CREATE TABLE IF NOT EXISTS kv (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id         BIGSERIAL PRIMARY KEY,
    at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor      TEXT,
    action     TEXT NOT NULL,
    entity     TEXT,
    "entityId" TEXT,
    details    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log (at DESC);
  CREATE TABLE IF NOT EXISTS report_files (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    mime        TEXT,
    bytes       BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

async function main() {
  const { default: postgres } = await import('postgres');
  const sql = postgres(DB_URL, { ssl: 'require', max: 3 });

  console.log('[migrate] creating schema…');
  for (const stmt of DDL.split(';').map((s) => s.trim()).filter(Boolean)) {
    await sql.unsafe(stmt);
  }

  // ---- 1) kv rows from SQLite
  const litePath = path.join(ROOT, 'data', 'smart-sugar.db');
  let kvRows = [];
  let auditRows = [];
  if (fs.existsSync(litePath)) {
    const lite = new DatabaseSync(litePath, { readOnly: true });
    try {
      kvRows = lite.prepare('SELECT key, value, updatedAt FROM kv').all();
      auditRows = lite.prepare('SELECT at, actor, action, entity, entityId, details FROM audit_log ORDER BY id').all();
    } catch (e) {
      console.warn('[migrate] sqlite read warning:', e.message);
    }
    lite.close();
  } else {
    console.warn('[migrate] no local sqlite file — skipping kv/audit copy');
  }

  console.log(`[migrate] copying ${kvRows.length} kv rows…`);
  for (const r of kvRows) {
    await sql`
      INSERT INTO kv (key, value, "updatedAt") VALUES (${r.key}, ${r.value}, ${r.updatedAt})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = EXCLUDED."updatedAt"`;
  }

  console.log(`[migrate] copying ${auditRows.length} audit rows…`);
  for (const r of auditRows) {
    await sql`
      INSERT INTO audit_log (at, actor, action, entity, "entityId", details)
      VALUES (${r.at}, ${r.actor}, ${r.action}, ${r.entity}, ${r.entityId}, ${r.details})`;
  }

  // ---- 2) JSON side-files → kv
  const kvFromFile = async (file, key) => {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      JSON.parse(raw); // validate
      await sql`
        INSERT INTO kv (key, value, "updatedAt") VALUES (${key}, ${raw}, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`;
      console.log(`[migrate] ${path.relative(ROOT, file)} → kv:${key}`);
    } catch {
      console.log(`[migrate] (skip) ${path.relative(ROOT, file)} — not found/invalid`);
    }
  };
  await kvFromFile(path.join(ROOT, 'data', 'contracts.json'), 'contracts-snapshot');
  await kvFromFile(path.join(ROOT, 'data', 'drivers-cache.json'), 'drivers-cache');
  await kvFromFile(path.join(ROOT, 'data', 'daily-reports', 'meta.json'), 'reports-meta');
  await kvFromFile(path.join(ROOT, 'data', 'daily-reports', 'updates.json'), 'reports-updates');

  // ---- 3) report binaries → report_files
  const reportsDir = path.join(ROOT, 'data', 'daily-reports');
  let meta = [];
  try { meta = JSON.parse(fs.readFileSync(path.join(reportsDir, 'meta.json'), 'utf8')); } catch { /* none */ }
  let files = 0;
  for (const it of meta) {
    const fp = path.join(reportsDir, it.fileName);
    if (!fs.existsSync(fp)) continue;
    const bytes = fs.readFileSync(fp);
    await sql`
      INSERT INTO report_files (id, name, mime, bytes) VALUES (${it.id}, ${it.originalName}, ${it.mimeType || 'application/octet-stream'}, ${bytes})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, mime = EXCLUDED.mime, bytes = EXCLUDED.bytes`;
    files++;
  }
  console.log(`[migrate] uploaded ${files} report binaries`);

  const [{ n: kvCount }] = await sql`SELECT count(*)::int AS n FROM kv`;
  const [{ n: fileCount }] = await sql`SELECT count(*)::int AS n FROM report_files`;
  const [{ n: auditCount }] = await sql`SELECT count(*)::int AS n FROM audit_log`;
  console.log(`[migrate] done. Cloud now holds: ${kvCount} kv keys, ${fileCount} report files, ${auditCount} audit rows.`);
  await sql.end();
}

main().catch((e) => {
  console.error('[migrate] fatal:', e?.message ?? e);
  process.exit(1);
});
