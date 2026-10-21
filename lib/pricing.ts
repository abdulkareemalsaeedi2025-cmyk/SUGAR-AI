/**
 * Pricing ledger — the company's priced purchase lots.
 *
 * A "lot" is one priced slice of sugar: how many tonnes, against which contract,
 * at what price, with whom. Raw sugar (ICE No.11) is quoted in US¢/lb; white
 * sugar (London No.5) in US$/tonne. To compare or average across the two we
 * normalise everything to US$/tonne (1 ¢/lb = 22.0462262 $/MT).
 *
 * Shared by the client component and the route handler; no Node-only imports.
 */

export const PRICING_KEY = 'pricing';

/** 1 US¢/lb expressed in US$/tonne. */
export const CENTS_LB_TO_USD_MT = 22.0462262;

export type PricingMarket = 'NY' | 'London';

export interface PricingLot {
  id: string;
  /** Trade / pricing date, ISO yyyy-mm-dd. */
  date: string;
  /** NY = Sugar No.11 raw (¢/lb) · London = No.5 white ($/MT). */
  market: PricingMarket;
  /** Contract symbol, e.g. SBH27 or SWH27. Empty = unpinned. */
  contract: string;
  quantityMT: number;
  /** NY: US¢/lb · London: US$/tonne. */
  price: number;
  counterparty: string;
  reference: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface PricingSummary {
  count: number;
  totalMT: number;
  /** Total MT normalised to US$/tonne, market by market. */
  byMarket: Record<PricingMarket, { count: number; totalMT: number; notionalUsd: number; avgUsdPerMT: number | null }>;
  /** Quantity-weighted average across both markets, US$/tonne. */
  avgUsdPerMT: number | null;
  /** Notional value of the whole book, US$. */
  notionalUsd: number;
}

export const isMarket = (v: unknown): v is PricingMarket => v === 'NY' || v === 'London';

export const unitFor = (m: PricingMarket): string => (m === 'NY' ? 'US¢/lb' : 'US$/MT');

/** Normalise a lot's price to US$/tonne for cross-market maths. */
export function priceToUsdPerMT(market: PricingMarket, price: number): number {
  return market === 'NY' ? price * CENTS_LB_TO_USD_MT : price;
}

const num = (v: unknown, fallback = NaN): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : fallback;
};

const str = (v: unknown, max = 160): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

const isoDay = (v: unknown, fallback: string): string => {
  if (typeof v === 'string') {
    const m = /^\d{4}-\d{2}-\d{2}/.exec(v.trim());
    if (m && Number.isFinite(Date.parse(m[0]))) return m[0];
    const t = Date.parse(v);
    if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  }
  return fallback;
};

const isoStamp = (v: unknown, fallback: string): string => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
};

/** Validate an inbound lot. `partial` merges over `base` (for PUT). */
export function sanitizePricingLot(input: unknown, base?: PricingLot): PricingLot | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const today = new Date().toISOString().slice(0, 10);

  const market = isMarket(o.market) ? o.market : base?.market ?? 'NY';
  const quantityMT = num(o.quantityMT, base?.quantityMT ?? NaN);
  if (!Number.isFinite(quantityMT) || quantityMT <= 0 || quantityMT > 5_000_000) return null;
  const price = num(o.price, base?.price ?? NaN);
  if (!Number.isFinite(price) || price < 0 || price > 100_000) return null;

  const now = new Date().toISOString();
  return {
    id: str(o.id, 64) || base?.id || '',
    date: isoDay(o.date ?? base?.date, today),
    market,
    contract: str(o.contract ?? base?.contract, 24).toUpperCase(),
    quantityMT: Math.round(quantityMT * 1000) / 1000,
    price: Math.round(price * 10000) / 10000,
    counterparty: str(o.counterparty ?? base?.counterparty, 120),
    reference: str(o.reference ?? base?.reference, 120),
    notes: str(o.notes ?? base?.notes, 400),
    createdAt: base?.createdAt ?? isoStamp(o.createdAt, now),
    updatedAt: now,
  };
}

export function coercePricingLots(input: unknown): PricingLot[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((l) => sanitizePricingLot(l))
    .filter((l): l is PricingLot => l !== null && l.id !== '')
    .slice(0, 2000);
}

export function summarizePricing(lots: PricingLot[]): PricingSummary {
  const empty = (): PricingSummary['byMarket'][PricingMarket] => ({ count: 0, totalMT: 0, notionalUsd: 0, avgUsdPerMT: null });
  const byMarket: PricingSummary['byMarket'] = { NY: empty(), London: empty() };
  let totalMT = 0;
  let notionalUsd = 0;

  for (const l of lots) {
    const usdPerMT = priceToUsdPerMT(l.market, l.price);
    const notional = usdPerMT * l.quantityMT;
    const b = byMarket[l.market];
    b.count += 1;
    b.totalMT += l.quantityMT;
    b.notionalUsd += notional;
    totalMT += l.quantityMT;
    notionalUsd += notional;
  }
  for (const k of ['NY', 'London'] as PricingMarket[]) {
    const b = byMarket[k];
    b.avgUsdPerMT = b.totalMT > 0 ? b.notionalUsd / b.totalMT : null;
  }
  return {
    count: lots.length,
    totalMT,
    byMarket,
    avgUsdPerMT: totalMT > 0 ? notionalUsd / totalMT : null,
    notionalUsd,
  };
}
