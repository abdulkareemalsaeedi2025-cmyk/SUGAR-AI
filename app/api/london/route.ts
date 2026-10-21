import { NextResponse } from 'next/server';
import { cachedWithMeta } from '../../../lib/cache';
import { kvGet } from '../../../lib/db';

const BARCHART_KEY = process.env.BARCHART_API_KEY;
const BARCHART_URL = 'https://ondemand.websol.barchart.com/getQuote.json';
const YAHOO_SYMBOLS = ['SW=F', 'SBW=F', 'LBS=F'];

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

async function fromBarchart(): Promise<any | null> {
  if (!BARCHART_KEY) return null;
  try {
    const url = `${BARCHART_URL}?apikey=${encodeURIComponent(BARCHART_KEY)}&symbols=SWK27,SWH27,SW*0`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    const results = j?.results ?? [];
    const row = results[0];
    if (!row) return null;
    const last = num(row.lastPrice);
    const prev = num(row.previousClose);
    const change = last != null && prev != null ? last - prev : null;
    return {
      symbol: row.symbol,
      name: String(row.name || '').replace('Sugar ', '') || 'White Sugar',
      last,
      open: num(row.open),
      high: num(row.high),
      low: num(row.low),
      prevClose: prev,
      change,
      changePct: num(row.percentChange) ?? (change != null && prev ? (change / prev) * 100 : null),
      source: 'Barchart OnDemand',
      mode: String(row.mode || 'delayed').toLowerCase(),
    };
  } catch {
    return null;
  }
}

async function fromYahoo(): Promise<any | null> {
  for (const sym of YAHOO_SYMBOLS) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=5m`;
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) continue;
      const j = await r.json();
      const result = j?.chart?.result?.[0];
      if (!result) continue;
      const meta = result.meta ?? {};
      const q = result.indicators?.quote?.[0] ?? {};
      const closes: number[] = (q.close ?? []).filter((v: unknown): v is number => typeof v === 'number');
      const last = num(meta.regularMarketPrice) ?? closes[closes.length - 1] ?? null;
      if (last == null) continue;
      const prev = num(meta.previousClose);
      const change = last != null && prev != null ? last - prev : null;
      const highs = (q.high ?? []).filter((v: unknown): v is number => typeof v === 'number');
      const lows = (q.low ?? []).filter((v: unknown): v is number => typeof v === 'number');
      const opens = (q.open ?? []).filter((v: unknown): v is number => typeof v === 'number');
      return {
        symbol: sym,
        name: 'White Sugar (London)',
        last,
        open: opens[0] ?? null,
        high: highs.length ? Math.max(...highs) : null,
        low: lows.length ? Math.min(...lows) : null,
        prevClose: prev,
        change,
        changePct: change != null && prev ? (change / prev) * 100 : null,
        source: 'Yahoo Finance',
        mode: 'delayed',
      };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Alternative when no free London feed exists: derive London #5 from the
 * live NY #11 price + the White Premium from the latest uploaded report.
 *   London($/MT) ≈ NY(¢/lb) × 22.0462 + WhitePremium($/MT)
 * Cross-check on 08-10-26: derived 543.71 vs report print 541.10 (∼0.5%).
 */
const CLB_TO_USDMT = 22.0462;

async function fromDerivation(): Promise<any | null> {
  try {
    const refs = await kvGet<any>('refined-prices');
    const wp: number | null = refs?.whitePremium?.value ?? null;
    const marketRaw = await kvGet<any>('cache:market');
    const market = marketRaw?.value ?? marketRaw;
    const nyCLb: number | null = typeof market?.contracts?.[0]?.last === 'number' ? market.contracts[0].last : null;
    const nyUsdMt = nyCLb != null ? nyCLb * CLB_TO_USDMT : (refs?.nyFront?.usdMt ?? null);
    const reportLdn = refs?.londonFront ?? null;
    if (nyUsdMt == null && reportLdn == null) return null;

    const last = nyUsdMt != null && wp != null ? +(nyUsdMt + wp).toFixed(2) : reportLdn.usdMt;
    // report's own LDN print serves as the reference close for change display
    const prevClose: number | null = reportLdn?.usdMt ?? null;
    const change = prevClose != null ? +(last - prevClose).toFixed(2) : null;
    return {
      symbol: reportLdn?.contract ?? 'LDN#5',
      name: 'White Sugar No.5 (derived)',
      last,
      open: null,
      high: null,
      low: null,
      prevClose,
      change,
      changePct: change != null && prevClose ? +((change / prevClose) * 100).toFixed(2) : null,
      source: `Derived — live NY + report white premium${refs?.reportDate ? ` (${refs.reportDate})` : ''}`,
      mode: 'estimated',
      derived: {
        nyCLb,
        nyUsdMt: nyUsdMt != null ? +nyUsdMt.toFixed(2) : null,
        whitePremium: wp,
        reportLondon: reportLdn,
        reportDate: refs?.reportDate ?? null,
      },
    };
  } catch {
    return null;
  }
}

async function loadFeed(): Promise<{ data: any | null; source: string }> {
  // 1) Barchart (authoritative, needs key)
  let data = await fromBarchart();
  let source = 'Barchart OnDemand';
  // 2) Yahoo fallback
  if (!data) {
    data = await fromYahoo();
    source = 'Yahoo Finance';
  }
  // 3) Derived fallback: live NY + report white premium (always available
  //    once a daily report has been uploaded)
  if (!data) {
    data = await fromDerivation();
    source = 'Derived (NY + White Premium)';
  }
  return { data, source };
}

export async function GET() {
  // London #5 is polled by the dashboard and by the assistant, so one shared
  // 60s cache avoids hammering Barchart/Yahoo (and survives a restart via SQLite).
  const { value, cached, at } = await cachedWithMeta('london', 60_000, loadFeed, { staleMaxMs: 6 * 3600_000 });
  const { data, source } = value;

  if (!data) {
    return NextResponse.json({
      updatedAt: new Date(at).toISOString(),
      available: false,
      source: 'No live feed',
      cached,
      error: BARCHART_KEY
        ? 'Barchart key present but London Sugar quote unavailable. Symbol may be SWK27, SWH27 or SW*0.'
        : 'Add BARCHART_API_KEY to .env for London Sugar quotes, or check Yahoo manually.',
      note: 'London Sugar No.5 (White Sugar) is not available on free public feeds.',
      data: null,
    }, { status: 200 });
  }

  return NextResponse.json({
    updatedAt: new Date(at).toISOString(),
    available: true,
    source,
    cached,
    data,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
