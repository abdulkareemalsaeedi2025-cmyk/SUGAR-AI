import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseContract, monthsUntil, resolveNear } from '../../../lib/iceCalendar';
import { cachedWithMeta } from '../../../lib/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/contracts
 *
 * The full Sugar No.11 delivery curve as priced in the Stooq snapshot. This is
 * what feeds the dashboard's contract selector, so the user can pin any priced
 * delivery month (not just the nearest one) into the price card, the chart and
 * the White Premium calculation.
 *
 * Honest by construction: no snapshot → an empty curve with a clear note, never
 * invented contracts.
 */

const SNAPSHOT_FILE = path.join(process.cwd(), 'data', 'contracts.json');
const SNAPSHOT_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

type SnapshotContract = {
  symbol?: unknown;
  label?: unknown;
  role?: unknown;
  last?: unknown;
  change?: unknown;
  changePct?: unknown;
  source?: unknown;
  sourceUrl?: unknown;
};

export type ContractOption = {
  symbol: string;
  label: string;
  labelAr: string;
  labelEn: string;
  monthsOut: number | null;
  last: number | null;
  change: number | null;
  changePct: number | null;
  near: boolean;
  source: string;
  sourceUrl: string;
};

const LONDON_OPTIONS = [
  {
    symbol: 'SW*0',
    label: 'London No.5 — White Sugar (continuous)',
    labelAr: 'لندن رقم 5 — السكر الأبيض (مستمر)',
    labelEn: 'London No.5 — White Sugar (continuous)',
    source: 'ICE / Barchart',
    sourceUrl: 'https://www.theice.com/products/29696643/White-Sugar-Futures',
  },
];

async function build() {
  let parsed: any = null;
  let readError: string | null = null;
  try {
    const { readContractsSnapshot } = await import('../../../lib/contractsStore');
    parsed = await readContractsSnapshot();
    if (!parsed) readError = 'snapshot unavailable';
  } catch (e) {
    readError = e instanceof Error ? e.message : 'snapshot unavailable';
  }

  const list: SnapshotContract[] = Array.isArray(parsed?.contracts) ? parsed.contracts : [];
  const priced = list.filter(
    (c) => c?.role !== 'cash' && typeof c?.symbol === 'string' && num(c.last) !== null,
  );
  const near = resolveNear(priced.map((c) => String(c.symbol)));

  const fetchedAt = String(parsed?.fetchedAt ?? '');
  const ageMs = fetchedAt ? Date.now() - Date.parse(fetchedAt) : Number.NaN;
  const stale = Number.isFinite(ageMs) && ageMs > SNAPSHOT_MAX_AGE_MS;

  const ny: ContractOption[] = priced
    .map((c) => {
      const symbol = String(c.symbol).toUpperCase();
      const ref = parseContract(symbol);
      const monthsOut = ref ? monthsUntil(ref.deliveryISO) : null;
      const label = typeof c.label === 'string' && c.label ? c.label : symbol;
      return {
        symbol,
        label,
        labelAr: ref?.labelAr ?? label,
        labelEn: ref?.labelEn ?? label,
        monthsOut,
        last: num(c.last),
        change: num(c.change),
        changePct: num(c.changePct),
        near: near ? near.symbol === symbol : false,
        source: typeof c.source === 'string' ? c.source : 'Stooq snapshot — ICE Sugar No.11',
        sourceUrl: typeof c.sourceUrl === 'string' ? c.sourceUrl : 'https://stooq.com/q/d/',
      };
    })
    .sort((a, b) => (a.monthsOut ?? 9999) - (b.monthsOut ?? 9999));

  return {
    updatedAt: new Date().toISOString(),
    snapshotFetchedAt: fetchedAt || null,
    stale,
    source: 'Stooq snapshot — ICE Sugar No.11',
    sourceUrl: 'https://stooq.com/q/d/',
    note: readError
      ? 'لا توجد لقطة عقود محلية. شغّل: npm run fetch:contracts'
      : stale
        ? `اللقطة أقدم من 5 أيام (${fetchedAt.slice(0, 10)}). شغّل: npm run fetch:contracts`
        : null,
    nearSymbol: near?.symbol ?? null,
    ny,
    london: LONDON_OPTIONS,
  };
}

export async function GET() {
  try {
    const { value, cached, at } = await cachedWithMeta('contracts', 30_000, build, {
      staleMaxMs: 24 * 60 * 60 * 1000,
    });
    return NextResponse.json(
      { ...value, ok: true, cached, servedAt: new Date(at).toISOString() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: 'contracts_unavailable',
        updatedAt: new Date().toISOString(),
        snapshotFetchedAt: null,
        stale: false,
        source: 'Stooq snapshot — ICE Sugar No.11',
        sourceUrl: 'https://stooq.com/q/d/',
        note: 'لا توجد لقطة عقود محلية. شغّل: npm run fetch:contracts',
        nearSymbol: null,
        ny: [],
        london: LONDON_OPTIONS,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
