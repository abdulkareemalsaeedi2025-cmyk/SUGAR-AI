/**
 * Server-side persistence for Smart Sugar AI — dual driver.
 *
 * LOCAL (default): Node's built-in `node:sqlite` at ./data/smart-sugar.db.
 * CLOUD  (Render + Supabase): when `DATABASE_URL` (or `SUPABASE_DB_URL`) is
 * set, every read/write goes to Postgres (Supabase) instead. The public API
 * is identical and fully async — route handlers already are.
 *
 * Schema (both drivers):
 *   kv           – JSON blob per key (inventory, vessels, caches, users, …)
 *   audit_log    – append-only trail of every write
 *   report_files – uploaded report binaries (BYTEA/BLOB) — cloud mode only;
 *                  local mode keeps them on disk under data/daily-reports.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type postgres from 'postgres';

export type DbStatus = {
  ok: boolean;
  /** File path, ':memory:', or 'postgres'. */
  path: string;
  persistent: boolean;
  driver: string;
  error?: string;
};

type PgClient = ReturnType<typeof postgres>;

type GlobalDb = typeof globalThis & {
  __sugarDb?: DatabaseSync | null;
  __sugarPg?: PgClient | null;
  __sugarDbStatus?: DbStatus;
  __sugarBoot?: Promise<void>;
};

const g = globalThis as GlobalDb;

export const CLOUD_MODE = Boolean(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL);

/* ------------------------------------------------------------ schema */

const SQLITE_SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 4000;
  CREATE TABLE IF NOT EXISTS kv (
    key       TEXT PRIMARY KEY,
    value     TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    at       TEXT NOT NULL,
    actor    TEXT,
    action   TEXT NOT NULL,
    entity   TEXT,
    entityId TEXT,
    details  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log (at DESC);
`;

const PG_DDL = `
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

/* ------------------------------------------------------------ boot */

async function bootPg(): Promise<PgClient | null> {
  if (g.__sugarPg !== undefined) return g.__sugarPg;
  const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!url) {
    g.__sugarPg = null;
    return null;
  }
  try {
    const { default: postgres } = await import('postgres');
    const sql: PgClient = postgres(url, { ssl: 'require', max: 6, idle_timeout: 30 });
    // idempotent schema — first boot only
    for (const stmt of PG_DDL.split(';').map((s) => s.trim()).filter(Boolean)) {
      await sql.unsafe(stmt);
    }
    g.__sugarPg = sql;
    g.__sugarDbStatus = { ok: true, path: 'postgres', persistent: true, driver: 'postgres.js' };
    return sql;
  } catch (err) {
    g.__sugarPg = null;
    g.__sugarDbStatus = {
      ok: false,
      path: 'postgres',
      persistent: false,
      driver: 'postgres.js',
      error: err instanceof Error ? err.message : String(err),
    };
    return null;
  }
}

function bootSqlite(): DatabaseSync | null {
  if (g.__sugarDb !== undefined) return g.__sugarDb;
  const custom = process.env.SMART_SUGAR_DB;
  const file = custom || path.join(process.cwd(), 'data', 'smart-sugar.db');
  const persistent = file !== ':memory:';
  const tryOpen = (target: string): DatabaseSync => {
    const db = new DatabaseSync(target, { timeout: 4000 });
    db.exec(SQLITE_SCHEMA);
    return db;
  };
  try {
    if (persistent) mkdirSync(path.dirname(file), { recursive: true });
    const db = tryOpen(file);
    g.__sugarDb = db;
    g.__sugarDbStatus = { ok: true, path: db.location() ?? file, persistent, driver: 'node:sqlite' };
  } catch (err) {
    try {
      const db = tryOpen(':memory:');
      g.__sugarDb = db;
      g.__sugarDbStatus = {
        ok: true, path: ':memory:', persistent: false, driver: 'node:sqlite',
        error: err instanceof Error ? err.message : String(err),
      };
    } catch (err2) {
      g.__sugarDb = null;
      g.__sugarDbStatus = {
        ok: false, path: file, persistent: false, driver: 'node:sqlite',
        error: err2 instanceof Error ? err2.message : String(err2),
      };
    }
  }
  return g.__sugarDb;
}

/** Resolve the active backend once (Postgres when configured, else SQLite). */
async function backend(): Promise<{ pg: PgClient | null; lite: DatabaseSync | null }> {
  if (CLOUD_MODE) {
    const pg = await bootPg();
    if (pg) return { pg, lite: null };
    // fall through to SQLite so the app stays alive if the URL is wrong
  }
  return { pg: null, lite: bootSqlite() };
}

export async function dbStatus(): Promise<DbStatus> {
  await backend();
  return g.__sugarDbStatus ?? { ok: false, path: ':memory:', persistent: false, driver: 'none' };
}

export async function dbAvailable(): Promise<boolean> {
  const b = await backend();
  return b.pg !== null || b.lite !== null;
}

/* ------------------------------------------------------------ key/value */

export async function kvGet<T>(key: string): Promise<T | null> {
  const { pg, lite } = await backend();
  try {
    if (pg) {
      const rows = (await pg`SELECT value FROM kv WHERE key = ${key}`) as any[];
      if (!rows.length) return null;
      return JSON.parse(String(rows[0].value)) as T;
    }
    if (!lite) return null;
    const row = lite.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  } catch {
    return null;
  }
}

export async function kvSet(key: string, value: unknown): Promise<boolean> {
  const { pg, lite } = await backend();
  const json = JSON.stringify(value);
  try {
    if (pg) {
      await pg`
        INSERT INTO kv (key, value, "updatedAt") VALUES (${key}, ${json}, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`;
      return true;
    }
    if (!lite) return false;
    lite
      .prepare(
        `INSERT INTO kv (key, value, updatedAt) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
      )
      .run(key, json, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

export async function kvDel(key: string): Promise<void> {
  const { pg, lite } = await backend();
  try {
    if (pg) { await pg`DELETE FROM kv WHERE key = ${key}`; return; }
    lite?.prepare('DELETE FROM kv WHERE key = ?').run(key);
  } catch { /* ignore */ }
}

export async function kvKeys(prefix = ''): Promise<string[]> {
  const { pg, lite } = await backend();
  try {
    if (pg) {
      const rows = (await pg`SELECT key FROM kv WHERE key LIKE ${prefix + '%'} ORDER BY key`) as any[];
      return rows.map((r: any) => String(r.key));
    }
    if (!lite) return [];
    const rows = lite.prepare('SELECT key FROM kv WHERE key LIKE ? ORDER BY key').all(`${prefix}%`) as { key: string }[];
    return rows.map((r) => r.key);
  } catch {
    return [];
  }
}

/** Key + timestamp only — enough for a health/status view without loading blobs. */
export async function kvIndex(prefix = ''): Promise<{ key: string; updatedAt: string }[]> {
  const { pg, lite } = await backend();
  try {
    if (pg) {
      const rows = (await pg`SELECT key, "updatedAt" FROM kv WHERE key LIKE ${prefix + '%'} ORDER BY key`) as any[];
      return rows.map((r: any) => ({ key: String(r.key), updatedAt: new Date(String(r.updatedAt)).toISOString() }));
    }
    if (!lite) return [];
    return lite
      .prepare('SELECT key, updatedAt FROM kv WHERE key LIKE ? ORDER BY key')
      .all(`${prefix}%`) as { key: string; updatedAt: string }[];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------ audit log */

export type AuditEntry = {
  action: string;
  actor?: string | null;
  entity?: string | null;
  entityId?: string | null;
  details?: unknown;
};

export async function logAudit(entry: AuditEntry): Promise<void> {
  const { pg, lite } = await backend();
  const details = entry.details === undefined ? null : JSON.stringify(entry.details);
  try {
    if (pg) {
      await pg`
        INSERT INTO audit_log (actor, action, entity, "entityId", details)
        VALUES (${entry.actor ?? null}, ${entry.action}, ${entry.entity ?? null}, ${entry.entityId ?? null}, ${details})`;
      return;
    }
    lite
      ?.prepare('INSERT INTO audit_log (at, actor, action, entity, entityId, details) VALUES (?, ?, ?, ?, ?, ?)')
      .run(new Date().toISOString(), entry.actor ?? null, entry.action, entry.entity ?? null, entry.entityId ?? null, details);
  } catch { /* never let auditing break a write */ }
}

export type AuditRow = {
  id: number;
  at: string;
  actor: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  details: string | null;
};

export async function listAudit(limit = 50): Promise<AuditRow[]> {
  const { pg, lite } = await backend();
  const n = Math.max(1, Math.min(500, Math.floor(limit) || 50));
  try {
    if (pg) {
      const rows = (await pg`SELECT id, at, actor, action, entity, "entityId", details FROM audit_log ORDER BY id DESC LIMIT ${n}`) as any[];
      return rows.map((r: any) => ({
        id: Number(r.id),
        at: new Date(String(r.at)).toISOString(),
        actor: (r.actor as string) ?? null,
        action: String(r.action),
        entity: (r.entity as string) ?? null,
        entityId: (r.entityId as string) ?? null,
        details: (r.details as string) ?? null,
      }));
    }
    if (!lite) return [];
    return lite
      .prepare('SELECT id, at, actor, action, entity, entityId, details FROM audit_log ORDER BY id DESC LIMIT ?')
      .all(n) as AuditRow[];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------ report files (cloud only) */

/** Store an uploaded report binary — Postgres BYTEA in cloud mode. */
export async function filePut(id: string, name: string, mime: string, bytes: Buffer): Promise<boolean> {
  const { pg } = await backend();
  if (!pg) return false;
  try {
    await pg`
      INSERT INTO report_files (id, name, mime, bytes) VALUES (${id}, ${name}, ${mime}, ${bytes})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, mime = EXCLUDED.mime, bytes = EXCLUDED.bytes`;
    return true;
  } catch {
    return false;
  }
}

/** Fetch a report binary — null when missing or not in cloud mode. */
export async function fileGet(id: string): Promise<{ name: string; mime: string; bytes: Buffer } | null> {
  const { pg } = await backend();
  if (!pg) return null;
  try {
    const rows = (await pg`SELECT name, mime, bytes FROM report_files WHERE id = ${id}`) as any[];
    if (!rows.length) return null;
    const r = rows[0];
    const raw = r.bytes as Buffer | Uint8Array;
    return { name: String(r.name), mime: String(r.mime ?? 'application/octet-stream'), bytes: Buffer.from(raw) };
  } catch {
    return null;
  }
}
