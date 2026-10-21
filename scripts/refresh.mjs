#!/usr/bin/env node
/**
 * Warm every market feed (and optionally the Stooq contract snapshot) by calling
 * the running app's own /api/refresh endpoint. Point a cron / Task Scheduler at
 * this so panels are already populated before anyone opens the dashboard.
 *
 *   npm run refresh                 → all feeds
 *   npm run refresh -- market,drivers
 *   npm run refresh -- all contracts
 *   PORT=3003 BASE_URL=http://host npm run refresh
 */
const port = process.env.PORT || '3003';
const base = process.env.BASE_URL || `http://localhost:${port}`;

const args = process.argv.slice(2);
const what = args.filter((a) => a !== 'contracts' && a !== 'all').join(',');
const contracts = args.includes('contracts') || args.includes('all');

const qs = new URLSearchParams();
if (what) qs.set('what', what);
if (contracts) qs.set('contracts', '1');
const url = `${base}/api/refresh${qs.toString() ? `?${qs}` : ''}`;

try {
  const r = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  const j = await r.json();
  console.log(JSON.stringify(j, null, 2));
  process.exit(j.ok ? 0 : 1);
} catch (err) {
  console.error(`refresh failed (${url}):`, err?.message ?? err);
  process.exit(2);
}
