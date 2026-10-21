import { NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { invalidateCache } from '../../../lib/cache';
import { sessionFromRequest } from '../../../lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Cron-safe access: an admin session cookie, or ?token=/header matching the
 *  REFRESH_TOKEN env secret (what the scheduler uses). */
async function refreshAllowed(req: Request): Promise<boolean> {
  const sess = await sessionFromRequest(req);
  if (sess?.role === 'admin') return true;
  const t = process.env.REFRESH_TOKEN;
  if (!t) return false;
  const url = new URL(req.url);
  return url.searchParams.get('token') === t || req.headers.get('x-refresh-token') === t;
}

/**
 * Snapshot / news refresh endpoint (Phase 2 cron target).
 *
 * A scheduled job (Render cron, Windows Task Scheduler, uptime pinger, …) hits
 * GET /api/refresh every few minutes. It re-warms every market feed through the
 * app's own HTTP surface so it stays deployment-agnostic: no cross-route
 * imports, no assumption about where the process runs.
 *
 *   ?what=market,drivers   → refresh only those feeds
 *   ?contracts=1           → also run scripts/fetch-contracts.mjs (Stooq curve)
 */
const ALL = ['market', 'london', 'recommend', 'sp500', 'weather', 'drivers'] as const;
type Feed = (typeof ALL)[number];

function runContracts(): Promise<{ ok: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const script = path.join(process.cwd(), 'scripts', 'fetch-contracts.mjs');
    execFile(process.execPath, [script], { timeout: 120_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, error: String(stderr || err.message).slice(0, 400) });
      else resolve({ ok: true, output: String(stdout).slice(-400) });
    });
  });
}

export async function GET(req: Request) {
  if (!(await refreshAllowed(req))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const origin = url.origin;
  const wanted = (url.searchParams.get('what') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Feed => (ALL as readonly string[]).includes(s));
  const feeds = wanted.length ? wanted : [...ALL];

  // ?force=1 drops the shared cache first so the cron produces genuinely fresh
  // values (drivers keeps its own specialised disk cache).
  const force = url.searchParams.get('force') === '1';
  if (force) for (const f of feeds) if (f !== 'drivers') await invalidateCache(f);

  const started = Date.now();
  const results = await Promise.all(
    feeds.map(async (feed) => {
      const t0 = Date.now();
      try {
        const r = await fetch(`${origin}/api/${feed}`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(90_000),
          headers: {
            'x-refresh': '1',
            ...(process.env.REFRESH_TOKEN ? { 'x-refresh-token': process.env.REFRESH_TOKEN } : {}),
          },
        });
        return { feed, ok: r.ok, status: r.status, ms: Date.now() - t0 };
      } catch (err) {
        return { feed, ok: false, status: 0, ms: Date.now() - t0, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  let contracts: { ok: boolean; output?: string; error?: string } | undefined;
  if (url.searchParams.get('contracts') === '1') {
    contracts = await runContracts();
  }

  return NextResponse.json(
    {
      ok: results.every((r) => r.ok),
      at: new Date().toISOString(),
      totalMs: Date.now() - started,
      feeds: results,
      contracts,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(req: Request) {
  return GET(req);
}
