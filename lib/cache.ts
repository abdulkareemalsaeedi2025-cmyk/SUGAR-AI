/**
 * Unified server-side cache.
 *
 * Phase 2 replaces the ad-hoc in-memory caches scattered across route handlers
 * with one module that provides:
 *   - a process-wide TTL map (survives across requests without re-fetching),
 *   - single-flight de-duplication (N concurrent requests → 1 upstream fetch),
 *   - persistence of the last good value in SQLite, so a restart or a flaky
 *     upstream can still serve labelled, slightly-stale data instead of an
 *     empty panel.
 *
 * Usage:
 *   const { value, cached, stale, at } = await cachedWithMeta('market', 30_000, load);
 *
 * The loader must throw to signal failure; a stale value within `staleMaxMs`
 * is returned as a fallback and flagged `stale: true`.
 */
import { kvGet, kvSet, kvDel, kvIndex } from './db';

export type CacheEntry<T> = { value: T; at: number };

export type CacheResult<T> = {
  value: T;
  /** Epoch ms of when the value was produced upstream. */
  at: number;
  /** True when served without running the loader. */
  cached: boolean;
  /** True when the loader failed and an older value was served instead. */
  stale: boolean;
};

export type CacheOptions = {
  /** Persist the value in SQLite (default true). */
  persist?: boolean;
  /** How long a stale value may still be served after a loader failure (default 24h). */
  staleMaxMs?: number;
};

type CacheGlobal = typeof globalThis & {
  __sugarCacheMem?: Map<string, CacheEntry<unknown>>;
  __sugarCacheInflight?: Map<string, Promise<unknown>>;
  __sugarCacheStale?: Set<string>;
};

const g = globalThis as CacheGlobal;
const mem: Map<string, CacheEntry<unknown>> = (g.__sugarCacheMem ??= new Map());
const inflight: Map<string, Promise<unknown>> = (g.__sugarCacheInflight ??= new Map());
const staleFlags: Set<string> = (g.__sugarCacheStale ??= new Set());

const DB_PREFIX = 'cache:';
const DEFAULT_STALE_MAX = 24 * 60 * 60 * 1000;

/** Last known entry (memory first, then the DB) without invoking the loader. */
export async function peekCache<T>(key: string): Promise<CacheEntry<T> | null> {
  const inMem = mem.get(key) as CacheEntry<T> | undefined;
  if (inMem) return inMem;
  const persisted = await kvGet<CacheEntry<T>>(DB_PREFIX + key);
  if (persisted && typeof persisted.at === 'number' && 'value' in persisted) {
    mem.set(key, persisted);
    return persisted;
  }
  return null;
}

/** Value + metadata, refreshing through the loader when older than ttlMs. */
export async function cachedWithMeta<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  opts: CacheOptions = {},
): Promise<CacheResult<T>> {
  const now = Date.now();
  const fresh = await peekCache<T>(key);
  if (fresh && now - fresh.at < ttlMs) {
    return { value: fresh.value, at: fresh.at, cached: true, stale: false };
  }

  // Single-flight: join an in-progress load instead of hammering the upstream.
  const running = inflight.get(key);
  if (running) {
    const value = (await running) as T;
    const entry = await peekCache<T>(key);
    return { value, at: entry?.at ?? Date.now(), cached: true, stale: staleFlags.has(key) };
  }

  const task = (async (): Promise<T> => {
    try {
      const value = await loader();
      const entry: CacheEntry<T> = { value, at: Date.now() };
      mem.set(key, entry);
      staleFlags.delete(key);
      if (opts.persist !== false) await kvSet(DB_PREFIX + key, entry);
      return value;
    } catch (err) {
      const stale = await peekCache<T>(key);
      const max = opts.staleMaxMs ?? DEFAULT_STALE_MAX;
      if (stale && Date.now() - stale.at < max) {
        staleFlags.add(key);
        return stale.value;
      }
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, task);
  const value = await task;
  const entry = await peekCache<T>(key);
  return { value, at: entry?.at ?? Date.now(), cached: false, stale: staleFlags.has(key) };
}

/** Convenience wrapper returning just the value. */
export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  opts: CacheOptions = {},
): Promise<T> {
  return (await cachedWithMeta(key, ttlMs, loader, opts)).value;
}

/** Force the next read to refetch (e.g. after a manual refresh trigger). */
export async function invalidateCache(key?: string): Promise<void> {
  if (key === undefined) {
    for (const k of mem.keys()) await kvDel(DB_PREFIX + k);
    mem.clear();
    staleFlags.clear();
    return;
  }
  mem.delete(key);
  staleFlags.delete(key);
  await kvDel(DB_PREFIX + key);
}

/** Status view for the health endpoint: which keys exist and when they were stored. */
export async function cacheIndex(): Promise<{ key: string; updatedAt: string }[]> {
  const rows = await kvIndex(DB_PREFIX);
  return rows.map((r) => ({ key: r.key.slice(DB_PREFIX.length), updatedAt: r.updatedAt }));
}
