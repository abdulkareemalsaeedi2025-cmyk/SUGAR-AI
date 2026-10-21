import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveNear } from '../../../lib/iceCalendar';
import { cachedWithMeta } from '../../../lib/cache';

export type Contract = {
  symbol: string;
  name: string;
  label: string;
  role: 'forward';
  available: boolean;
  last: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  mode: string;
  source: string;
  sourceUrl: string;
  note: string | null;
};

const YAHOO_FRONT = 'SB=F';
const BARCHART_URL = 'https://www.barchart.com/futures/quotes/SB*0/futures-prices?viewName=main';
const YAHOO_URL = `https://finance.yahoo.com/quote/${encodeURIComponent(YAHOO_FRONT)}/`;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

const delta = (last: number | null, base: number | null) =>
  last === null || base === null || base === 0 ? null : ((last - base) / base) * 100;

const firstNum = (arr: unknown): number | null => {
  if (!Array.isArray(arr)) return null;
  for (const v of arr) { const x = num(v); if (x !== null) return x; }
  return null;
};

const allNums = (arr: unknown): number[] =>
  Array.isArray(arr) ? arr.map(num).filter((v): v is number => v !== null) : [];

function unavailable(symbol: string, label: string, source: string, sourceUrl: string, note: string): Contract {
  return {
    symbol,
    name: label,
    label,
    role: 'forward',
    available: false,
    last: null, open: null, high: null, low: null, prevClose: null,
    change: null, changePct: null,
    mode: 'unavailable',
    source, sourceUrl, note,
  };
}

const SNAPSHOT_FILE = path.join(process.cwd(), 'data', 'contracts.json');
const SNAPSHOT_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

type SnapshotContract = {
  symbol: string;
  label: string;
  role?: string;
  available?: boolean;
  last?: number | null;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  prevClose?: number | null;
  change?: number | null;
  changePct?: number | null;
  volume?: number | null;
  openInterest?: number | null;
  tradeDate?: string | null;
  source?: string;
  sourceUrl?: string;
};

type Snapshot = {
  at: number;
  fetchedAt: string;
  by: Map<string, SnapshotContract>;
};

let snapshotCache: Snapshot | null = null;

async function stooqSnapshot(): Promise<Snapshot | null> {
  if (snapshotCache && Date.now() - snapshotCache.at < 30_000) return snapshotCache;
  try {
    const { readContractsSnapshot } = await import('../../../lib/contractsStore');
    const parsed = await readContractsSnapshot<any>();
    const list: SnapshotContract[] = Array.isArray(parsed?.contracts) ? parsed.contracts : [];
    if (!list.length) return null;
    snapshotCache = {
      at: Date.now(),
      fetchedAt: String(parsed?.fetchedAt ?? ''),
      by: new Map(list.map((c) => [String(c.symbol ?? '').toUpperCase(), c])),
    };
    return snapshotCache;
  } catch {
    return null;
  }
}

function fromSnapshot(c: SnapshotContract, fetchedAt: string): Contract {
  const label = c.label || c.symbol;
  const age = fetchedAt ? Date.now() - Date.parse(fetchedAt) : Number.NaN;
  const stale = Number.isFinite(age) && age > SNAPSHOT_MAX_AGE_MS;
  const last = num(c.last);
  return {
    symbol: c.symbol,
    name: label,
    label,
    role: 'forward',
    available: last !== null,
    last,
    open: num(c.open),
    high: num(c.high),
    low: num(c.low),
    prevClose: num(c.prevClose),
    change: num(c.change),
    changePct: num(c.changePct),
    mode: 'delayed',
    source: c.source ?? 'Stooq — ICE Sugar No.11',
    sourceUrl: c.sourceUrl ?? 'https://stooq.com/q/d/',
    note: stale ? `Snapshot older than 5 days (${fetchedAt.slice(0, 10)}). Re-run: npm run fetch:contracts` : null,
  };
}

async function yahooFrontData(): Promise<{
  last: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
} | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(YAHOO_FRONT)}?range=1d&interval=5m`;
  // Hard 4s ceiling — a hanging Yahoo must not stall the whole dashboard;
  // the Stooq snapshot fallback is one line below.
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(4_000) });
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
  const result = (await r.json())?.chart?.result?.[0];
  if (!result) return null;
  const meta = result.meta ?? {};
  const q = result.indicators?.quote?.[0] ?? {};
  const closes = (q.close ?? []).filter((v: unknown): v is number => num(v) !== null) as number[];
  const last = num(meta.regularMarketPrice) ?? closes[closes.length - 1] ?? null;
  const prevClose = num(meta.previousClose);
  if (last === null) return null;
  const highs = allNums(q.high);
  const lows = allNums(q.low);
  const change = last !== null && prevClose !== null ? last - prevClose : null;
  return {
    last,
    open: firstNum(q.open) ?? highs[0] ?? null,
    high: highs.length ? Math.max(...highs) : null,
    low: lows.length ? Math.min(...lows) : null,
    prevClose,
    change,
    changePct: delta(last, prevClose),
  };
}

async function buildMarket() {
  const now = new Date().toISOString();
  const providers = { barchart: false, stooq: false, yahoo: false };

  const snapshot = await stooqSnapshot();
  const pricedSymbols: string[] = [];
  if (snapshot?.by) {
    for (const [sym, sc] of snapshot.by) {
      if (sc.role !== 'cash' && num(sc.last) !== null) pricedSymbols.push(sym);
    }
  }

  const nearRef = resolveNear(pricedSymbols);
  if (!nearRef) {
    return {
      updatedAt: now,
      source: 'No data',
      mode: 'unavailable',
      providers,
      note: 'No priced delivery month found in snapshot. Run: npm run fetch:contracts',
      snapshotFetchedAt: snapshot?.fetchedAt ?? null,
      contracts: [unavailable('SBH27', 'Mar 2027', 'none', BARCHART_URL, 'Run npm run fetch:contracts')],
      spreads: [],
      coverage: { total: 1, priced: 0 },
    };
  }

  const nearSymbol = nearRef.symbol;
  const nearLabel = nearRef.labelEn;

  let contract: Contract | null = null;

  // 1) Live front-month from Yahoo — maps to the current contract
  try {
    const d = await yahooFrontData();
    if (d) {
      providers.yahoo = true;
      contract = {
        symbol: nearSymbol,
        name: nearLabel,
        label: nearLabel,
        role: 'forward',
        available: true,
        ...d,
        mode: 'delayed',
        source: 'Yahoo Finance — ICE Sugar No.11 front month (SB=F)',
        sourceUrl: YAHOO_URL,
        note: `السعر من المؤشر المستمر SB=F (العقد الأمامي) ويعكس ${nearLabel} تقريباً — ليس تسعير ICE الرسمي لهذا الشهر. للتفصيل الرسمي: Barchart/ICE.`,
      };
    }
  } catch {
    /* fall through to snapshot */
  }

  // 2) Fallback to Stooq snapshot for the exact month
  if (!contract) {
    const sc = snapshot?.by.get(nearSymbol);
    if (sc && num(sc.last) !== null) {
      contract = fromSnapshot(sc, snapshot?.fetchedAt ?? '');
      providers.stooq = true;
    }
  }

  if (!contract) {
    return {
      updatedAt: now,
      source: 'No live feed',
      mode: 'unavailable',
      providers,
      note: 'Run `npm run fetch:contracts` to refresh the snapshot.',
      snapshotFetchedAt: snapshot?.fetchedAt ?? null,
      contracts: [unavailable(nearSymbol, nearLabel, 'none', BARCHART_URL, 'No price available')],
      spreads: [],
      coverage: { total: 1, priced: 0 },
    };
  }

  return {
    updatedAt: now,
    source: contract.source,
    mode: contract.mode,
    providers,
    note: null,
    snapshotFetchedAt: snapshot?.fetchedAt ?? null,
    contracts: [contract],
    spreads: [],
    coverage: { total: 1, priced: 1 },
  };
}

export async function GET() {
  // The dashboard and the assistant both poll this every minute; one shared 30s
  // cache means Yahoo is hit at most twice a minute regardless of open clients.
  const { value, cached, at, stale } = await cachedWithMeta('market', 30_000, buildMarket, {
    staleMaxMs: 30 * 60_000,
  });
  return NextResponse.json(
    { ...value, cached, fetchedAt: new Date(at).toISOString(), stale },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
