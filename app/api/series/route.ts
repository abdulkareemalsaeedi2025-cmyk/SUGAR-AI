import { NextResponse } from 'next/server';
import { parseContract, monthsUntil, resolveNear, type ContractRef } from '../../../lib/iceCalendar';

const SYMBOL = 'SB=F';
const MAX_BARS = 1600;
const SNAPSHOT_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

export type Granularity = 'intraday' | 'hourly' | 'daily';

const PRESETS = ['1d', '5d', '1mo', '3mo', '1y', '5y'] as const;
type Preset = (typeof PRESETS)[number];

const RANGE_CONFIG: Record<Preset, { yahoo: string; interval: string; granularity: Granularity }> = {
  '1d': { yahoo: 'range=1d', interval: '5m', granularity: 'intraday' },
  '5d': { yahoo: 'range=5d', interval: '1h', granularity: 'hourly' },
  '1mo': { yahoo: 'range=1mo', interval: '1d', granularity: 'daily' },
  '3mo': { yahoo: 'range=3mo', interval: '1d', granularity: 'daily' },
  '1y': { yahoo: 'range=1y', interval: '1d', granularity: 'daily' },
  '5y': { yahoo: 'range=5y', interval: '1d', granularity: 'daily' },
};

const HORIZON: Record<Granularity, number> = { intraday: 24, hourly: 12, daily: 12 };

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

const allNums = (arr: unknown): number[] =>
  Array.isArray(arr) ? arr.map(num).filter((v): v is number => v !== null) : [];

function intervalForSpan(days: number): string {
  if (days <= 1) return '5m';
  if (days <= 7) return '1h';
  if (days <= 60) return '1d';
  if (days <= 730) return '1wk';
  return '1mo';
}

function granularityFor(interval: string): Granularity {
  if (/m$/.test(interval) && interval !== '1mo') return 'intraday';
  if (interval === '1h') return 'hourly';
  return 'daily';
}

type CacheEntry = { at: number; body: unknown };
const cache = new Map<string, CacheEntry>();

const TTL: Record<Granularity, number> = { intraday: 20_000, hourly: 120_000, daily: 600_000 };
const STALE_MAX = 30 * 60_000;

const SNAPSHOT_CACHE_MS = 60_000;
let snap: { at: number; data: any } | null = null;

async function readSnapshot() {
  if (snap && Date.now() - snap.at < SNAPSHOT_CACHE_MS) return snap.data;
  const { readContractsSnapshot } = await import('../../../lib/contractsStore');
  const data = await readContractsSnapshot();
  if (!data) throw new Error('contracts snapshot unavailable');
  snap = { at: Date.now(), data };
  return data;
}

const SNAPSHOT_RANGE_DAYS: Record<string, number> = {
  '1d': 1, '5d': 5, '1mo': 31, '3mo': 92, '1y': 366, '5y': 1830,
};

function snapshotWindow(range: string, from: string | null, to: string | null) {
  const validDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
  if (validDate(from) && validDate(to)) {
    return { startMs: Date.parse(from as string), endMs: Date.parse(to as string) + 86_400_000, label: `${from} → ${to}` };
  }
  const days = SNAPSHOT_RANGE_DAYS[range.toLowerCase()];
  if (!days) return { startMs: null as number | null, endMs: null as number | null, label: range };
  return { startMs: Date.now() - days * 86_400_000, endMs: null as number | null, label: range };
}

type SnapshotBar = { t: number; c: number | null; o: number | null; h: number | null; l: number | null };

/**
 * A specific delivery month, served from the Stooq snapshot history.
 *
 * XML/Yahoo 404s on individual No.11 months, so the snapshot is the only honest
 * source for "give me SBH27, not the continuous proxy". History is daily; when a
 * sub-daily range has fewer than two bars we return the full available series
 * and label it, rather than drawing a one-point chart.
 */
async function snapshotSeries(symbol: string, range: string, from: string | null, to: string | null) {
  const sym = symbol.toUpperCase();
  const ref = parseContract(sym);
  const data = await readSnapshot();
  const list: any[] = Array.isArray(data?.contracts) ? data.contracts : [];
  const snapshotAt: string | null = data?.fetchedAt ?? null;
  const hit = list.find((c) => String(c?.symbol ?? '').toUpperCase() === sym);

  const base = {
    updatedAt: new Date().toISOString(),
    source: 'Stooq snapshot — ICE Sugar No.11',
    sourceUrl: 'https://stooq.com/q/d/',
    symbol: sym,
    currency: 'USX',
    exchange: 'ICE Futures U.S.',
    range,
    rangeLabel: ref ? `${ref.labelEn} (${sym})` : sym,
    granularity: 'daily' as Granularity,
    intervalMinutes: '1d',
    snapshotFetchedAt: snapshotAt,
  };

  if (!hit || !Array.isArray(hit.history) || hit.history.length === 0) {
    return {
      ...base,
      bars: 0,
      points: [],
      trend: null,
      error: `No snapshot history for ${sym}. Run: npm run fetch:contracts`,
    };
  }

  const all: SnapshotBar[] = hit.history
    .map((b: any) => ({
      t: Math.floor(Date.parse(`${String(b?.t)}T00:00:00Z`) / 1000),
      c: num(b?.c),
      o: num(b?.o),
      h: num(b?.h),
      l: num(b?.l),
    }))
    .filter((b: any): b is SnapshotBar => Number.isFinite(b.t) && b.c !== null)
    .sort((a: SnapshotBar, b: SnapshotBar) => a.t - b.t);

  const { startMs, endMs, label } = snapshotWindow(range, from, to);
  let windowed = all;
  if (startMs !== null) windowed = windowed.filter((b) => b.t * 1000 >= startMs);
  if (endMs !== null) windowed = windowed.filter((b) => b.t * 1000 <= endMs);

  const usedAll = windowed.length < 2;
  const points = (usedAll ? all : windowed).slice(-MAX_BARS);
  const values = points.map((p) => p.c as number);

  const last = values[values.length - 1];
  const prev = values.length >= 2 ? values[values.length - 2] : null;
  const change = prev !== null ? last - prev : null;
  const changePct = prev ? ((last - prev) / prev) * 100 : null;

  const fit = leastSquares(values);
  const horizon = HORIZON.daily;
  const trend = fit
    ? {
        method: 'least-squares linear regression on daily closes',
        slopePerBar: fit.slope,
        r2: fit.r2,
        stdErr: fit.stdErr,
        horizonBars: horizon,
        projectedLast: fit.slope * (values.length - 1 + horizon) + fit.intercept,
        band: {
          lower: fit.slope * (values.length - 1 + horizon) + fit.intercept - fit.stdErr,
          upper: fit.slope * (values.length - 1 + horizon) + fit.intercept + fit.stdErr,
        },
      }
    : null;

  const pricedSymbols = list
    .filter((c) => c?.role !== 'cash' && num(c.last) !== null && typeof c?.symbol === 'string')
    .map((c) => String(c.symbol));
  const near = resolveNear(pricedSymbols);
  const next = ref
    ? pricedSymbols
        .map(parseContract)
        .filter((r): r is ContractRef => r !== null && monthsUntil(r.deliveryISO) > monthsUntil(ref.deliveryISO))
        .sort((a, b) => monthsUntil(a.deliveryISO) - monthsUntil(b.deliveryISO))[0] ?? null
    : null;
  const monthsOut = ref ? monthsUntil(ref.deliveryISO) : null;
  const contract = ref ? { ...ref, monthsOut, expired: (monthsOut ?? 0) < 0, next } : null;

  const ageMs = snapshotAt ? Date.now() - Date.parse(snapshotAt) : Number.NaN;
  const stale = Number.isFinite(ageMs) && ageMs > SNAPSHOT_MAX_AGE_MS;

  return {
    ...base,
    rangeLabel: ref ? `${ref.labelEn} (${sym})` : label,
    bars: points.length,
    prevClose: prev,
    periodOpen: points[0]?.o ?? points[0]?.c ?? null,
    periodHigh: Math.max(...points.map((p) => (p.h ?? p.c) as number)),
    periodLow: Math.min(...points.map((p) => (p.l ?? p.c) as number)),
    last,
    change,
    changePct,
    points,
    trend,
    stale,
    note: usedAll
      ? `نطاق ${label} يحتوي أقل من عمودين — أُظهرت كامل السلسلة اليومية المتاحة للعقد ${sym}.`
      : `سلسلة يومية من لقطة Stooq للعقد ${sym} (لا تتوفر أعمدة لحظية لهذا العقد).`,
    ...(contract ? { contract } : {}),
    ...(near ? { rollHint: `أقرب عقد في اللقطة: ${near.labelEn} (${near.symbol})` } : {}),
  };
}

async function getJSON(url: string, tries = 2): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6_000) });
      if (r.status === 429) throw new Error('Yahoo rate limited');
      if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((res) => setTimeout(res, 350 * (i + 1)));
    }
  }
  throw lastErr;
}

function leastSquares(ys: number[]) {
  const n = ys.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxy += i * ys[i]; sxx += i * i; }
  const d = n * sxx - sx * sx;
  if (d === 0) return null;
  const slope = (n * sxy - sx * sy) / d;
  const intercept = (sy - slope * sx) / n;
  const ybar = sy / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const fit = slope * i + intercept;
    ssRes += (ys[i] - fit) ** 2;
    ssTot += (ys[i] - ybar) ** 2;
  }
  return { slope, intercept, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot, stdErr: Math.sqrt(ssRes / Math.max(1, n - 2)) };
}

function buildParams(raw: string, from: string | null, to: string | null): {
  mode: Preset | 'custom';
  interval: string;
  granularity: Granularity;
  query: string;
  label: string;
} {
  const validDate = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
  if (from && to && validDate(from) && validDate(to)) {
    const t1 = Date.parse(from);
    const t2 = Date.parse(to);
    const days = (t2 - t1) / 86400000;
    const interval = intervalForSpan(days);
    const granularity = granularityFor(interval);
    const p1 = t1 - Math.min(days * 0.02 * 86400000, 6 * 3600000);
    const p2 = t2 + Math.min(days * 0.02 * 86400000, 6 * 3600000);
    return {
      mode: 'custom',
      interval,
      granularity,
      query: `period1=${Math.floor(p1 / 1000)}&period2=${Math.floor(p2 / 1000)}&interval=${interval}`,
      label: `${from} → ${to}`,
    };
  }
  const mode: Preset = (PRESETS as readonly string[]).includes(raw) ? (raw as Preset) : '1d';
  const cfg = RANGE_CONFIG[mode];
  return {
    mode,
    interval: cfg.interval,
    granularity: cfg.granularity,
    query: `${cfg.yahoo}&interval=${cfg.interval}`,
    label: raw,
  };
}

type SeriesMeta = {
  symbol: string;
  source: string;
  sourceUrl: string;
  rangeLabel?: string;
  contract?: any;
  rollHint?: string;
  snapshotFetchedAt?: string | null;
};

async function yahooSeries(range: string, from: string | null, to: string | null, meta: SeriesMeta) {
  const { mode, interval, granularity, query, label } = buildParams(range, from, to);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(SYMBOL)}?${query}`;
  const key = `${meta.symbol}|${mode}|${from ?? ''}|${to ?? ''}`;
  const ttl = TTL[granularity];
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.body;

  try {
    const payload = await getJSON(url);
    const result = (payload as any)?.chart?.result?.[0];
    if (!result) throw new Error('empty chart payload');

    const chartMeta = result.meta ?? {};
    const q = result.indicators?.quote?.[0] ?? {};
    const stamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
    const closes: unknown[] = Array.isArray(q.close) ? q.close : [];

    const all: { t: number; c: number; o: number | null; h: number | null; l: number | null }[] = [];
    const rawOpen: unknown[] = Array.isArray(q.open) ? q.open : [];
    const rawHigh: unknown[] = Array.isArray(q.high) ? q.high : [];
    const rawLow: unknown[] = Array.isArray(q.low) ? q.low : [];
    for (let i = 0; i < stamps.length; i++) {
      const c = num(closes[i]);
      if (c !== null) all.push({ t: stamps[i], c, o: num(rawOpen[i]), h: num(rawHigh[i]), l: num(rawLow[i]) });
    }
    const points = all.slice(-MAX_BARS);
    const values = points.map((x) => x.c);
    if (!values.length) throw new Error('no price bars in range');

    const prevClose = granularity === 'intraday' ? num(chartMeta.previousClose) : null;
    const highs = allNums(q.high);
    const lows = allNums(q.low);
    const opens = allNums(q.open);
    const last = num(chartMeta.regularMarketPrice) ?? values[values.length - 1];
    const base = granularity === 'intraday' ? prevClose : values[0];
    const change = base !== null ? last - base : null;
    const changePct = base ? ((last - base) / base) * 100 : null;

    const fit = leastSquares(values);
    const horizon = HORIZON[granularity];
    const trend = fit
      ? {
          method: 'least-squares linear regression on closes',
          slopePerBar: fit.slope,
          r2: fit.r2,
          stdErr: fit.stdErr,
          horizonBars: horizon,
          projectedLast: fit.slope * (values.length - 1 + horizon) + fit.intercept,
          band: {
            lower: fit.slope * (values.length - 1 + horizon) + fit.intercept - fit.stdErr,
            upper: fit.slope * (values.length - 1 + horizon) + fit.intercept + fit.stdErr,
          },
        }
      : null;

    const body = {
      updatedAt: new Date().toISOString(),
      source: meta.source,
      sourceUrl: meta.sourceUrl,
      symbol: meta.symbol,
      currency: chartMeta.currency ?? 'USX',
      exchange: chartMeta.fullExchangeName ?? 'ICE Futures',
      range: mode,
      rangeLabel: meta.rangeLabel ?? label,
      granularity,
      intervalMinutes: interval,
      bars: points.length,
      prevClose,
      periodOpen: opens.length ? opens[0] : null,
      periodHigh: highs.length ? Math.max(...highs) : null,
      periodLow: lows.length ? Math.min(...lows) : null,
      last,
      change,
      changePct,
      points,
      trend,
      stale: false,
      ...(meta.contract ? { contract: meta.contract } : {}),
      ...(meta.rollHint ? { rollHint: meta.rollHint } : {}),
      ...(meta.snapshotFetchedAt ? { snapshotFetchedAt: meta.snapshotFetchedAt } : {}),
    };

    cache.set(key, { at: Date.now(), body });
    if (cache.size > 40) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    return body;
  } catch (e) {
    const fresh = cache.get(key);
    if (fresh && Date.now() - fresh.at < STALE_MAX) {
      return { ...(fresh.body as object), stale: true, error: e instanceof Error ? e.message : 'fetch failed' };
    }
    return {
      updatedAt: new Date().toISOString(),
      source: meta.source,
      sourceUrl: meta.sourceUrl,
      symbol: meta.symbol,
      range: mode,
      rangeLabel: meta.rangeLabel ?? label,
      granularity,
      bars: 0,
      points: [],
      trend: null,
      error: e instanceof Error ? e.message : 'fetch failed',
    };
  }
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const raw = (p.get('range') ?? '1d').toLowerCase();
  const from = p.get('from');
  const to = p.get('to');
  const contract = p.get('contract');

  if (contract && contract !== 'near') {
    const body = await snapshotSeries(contract, raw, from, to);
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (contract === 'near') {
    const data = await readSnapshot();
    const priced = (data.contracts ?? []).filter((c: any) => c.role !== 'cash' && c.available && Array.isArray(c.history) && c.history.length);
    const near = resolveNear(priced.map((c: any) => c.symbol));
    if (!near) {
      return NextResponse.json(
        { error: 'No priced delivery month in the snapshot. Run: npm run fetch:contracts', updatedAt: new Date().toISOString(), points: [] },
        { status: 503 },
      );
    }
    // The Stooq snapshot is the only HONEST source for a specific delivery
    // month — Yahoo's continuous SB=F is NOT that month (and is currently
    // slow/failing). The snapshot also answers in ~5 ms instead of seconds.
    const body = await snapshotSeries(near.symbol, raw, from, to);
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  }

  const body = await yahooSeries(raw, from, to, {
    symbol: SYMBOL,
    source: 'Yahoo Finance — ICE Sugar No.11',
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(SYMBOL)}/`,
  });
  return NextResponse.json(body);
}
