import { NextResponse } from 'next/server';
import { cachedWithMeta } from '../../../lib/cache';

const SYMBOL = '^GSPC';

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

async function buildSp500() {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(SYMBOL)}?range=1d&interval=5m`;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Yahoo HTTP ${r.status}`);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result) throw new Error('empty chart');

  const meta = result.meta ?? {};
  const q = result.indicators?.quote?.[0] ?? {};
  const closes: number[] = (q.close ?? []).filter((v: unknown): v is number => typeof v === 'number');
  const last = num(meta.regularMarketPrice) ?? closes[closes.length - 1] ?? null;
  const prevClose = num(meta.previousClose);
  const change = last != null && prevClose != null ? last - prevClose : null;
  const changePct = change != null && prevClose ? (change / prevClose) * 100 : null;
  const highs = (q.high ?? []).filter((v: unknown): v is number => typeof v === 'number');
  const lows = (q.low ?? []).filter((v: unknown): v is number => typeof v === 'number');
  const opens = (q.open ?? []).filter((v: unknown): v is number => typeof v === 'number');

  return {
    updatedAt: new Date().toISOString(),
    available: true,
    symbol: SYMBOL,
    name: meta.shortName || meta.longName || 'S&P 500',
    currency: meta.currency || 'USD',
    last,
    open: opens[0] ?? null,
    high: highs.length ? Math.max(...highs) : null,
    low: lows.length ? Math.min(...lows) : null,
    prevClose,
    change,
    changePct,
    source: 'Yahoo Finance',
    mode: 'delayed',
  };
}

export async function GET() {
  const now = new Date().toISOString();
  try {
    const { value, cached, at } = await cachedWithMeta('sp500', 60_000, buildSp500, { staleMaxMs: 6 * 3600_000 });
    return NextResponse.json(
      { ...value, cached, fetchedAt: new Date(at).toISOString() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return NextResponse.json({
      updatedAt: now,
      available: false,
      error: e instanceof Error ? e.message : 'fetch failed',
      symbol: SYMBOL,
      name: 'S&P 500',
    }, { status: 200 });
  }
}
