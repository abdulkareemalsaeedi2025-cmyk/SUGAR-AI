/**
 * Shared shapes and validators for user-owned data (inventory, vessels).
 *
 * Kept free of any Node-only import so the exact same module runs in the
 * browser (client components) and on the server (route handlers). Every value
 * that arrives from the network is run through a sanitiser before it is
 * persisted, so a malformed payload can never corrupt the stored record.
 */

export const INVENTORY_KEY = 'inventory';
export const VESSELS_KEY = 'vessels';

export interface InventoryData {
  total: number;
  rawSugar: number;
  refinedSugar: number;
  companyPriced: number;
  partnerPriced: number;
  unpriced: number;
  /** null = never edited: values are factory samples, not company data. */
  updatedAt: string | null;
  /** Daily production (MT/day), editable manual */
  dailyProductionMT?: number | null;
  /** Monthly sales (MT/month), editable manual */
  monthlySalesMT?: number | null;
  /** Days of raw stock coverage (auto-calculated) */
  rawCoverageDays?: number | null;
  /** Days of total stock coverage vs sales (auto-calculated) */
  totalCoverageDays?: number | null;
  /** Estimated date when raw stock ends (auto-calculated, ISO date) */
  rawStockEndDate?: string | null;
  /** Estimated date when total stock ends (sales basis, auto-calculated, ISO date) */
  totalStockEndDate?: string | null;
  /** Date of last production considered */
  lastProductionDate?: string | null;
}

export interface Vessel {
  id: string;
  name: string;
  status: string;
  destination: string;
  eta: string;
  /** Manual position (AIS not connected). null = not recorded yet. */
  pos: { lat: number; lng: number } | null;
  posAt: string | null;
  /** Optional AIS identifiers — used to match live positions when the
   *  VesselFinder key is configured. Empty = not enrolled. */
  imo?: string;
  mmsi?: string;
  /** Vessel capacity/quantity in MT (optional, user-editable). */
  quantityMT?: number | null;
  /** Loading date (ISO date string, optional). */
  loadedAt?: string | null;
  /** Estimated time of arrival (ISO string, optional). */
  etaAt?: string | null;
  /** Pricing status: priced/unpriced */
  priced?: 'priced' | 'unpriced' | 'unknown';
  /** Priced quantity from shipment (MT) */
  pricedQtyMT?: number | null;
  /** Market average used (e.g., NY/London) */
  marketAvg?: string;
  /** White premium reference/avg */
  whitePremiumAvg?: number | null;
  /** Final weighted average price ($/MT or ¢/lb context) */
  finalAvgPrice?: number | null;
  /** Provisional / invoice price ($/MT) from the report */
  invoicePrice?: number | null;
  /** Total C&F cargo value (US$) from the report */
  cargoValueUsd?: number | null;
  /** Notes about pricing */
  pricingNotes?: string;
}

/** Sample layout only — replaced as soon as the user saves real figures. */
export const SAMPLE_INVENTORY: InventoryData = {
  total: 120000,
  rawSugar: 85000,
  refinedSugar: 35000,
  companyPriced: 50000,
  partnerPriced: 34000,
  unpriced: 36000,
  updatedAt: null,
  dailyProductionMT: null,
  monthlySalesMT: null,

  rawCoverageDays: null,
  totalCoverageDays: null,
  rawStockEndDate: null,
  totalStockEndDate: null,
  lastProductionDate: null,
};

export const DEFAULT_VESSELS: Vessel[] = [
  { id: 'v1', name: 'MV TK ORTAKOY', status: 'قيد الملاحة', destination: 'سانتوس', eta: '15 أكتوبر', pos: null, posAt: null, quantityMT: null, loadedAt: null, etaAt: null, priced: 'unknown', pricedQtyMT: null, marketAvg: '', whitePremiumAvg: null, finalAvgPrice: null, pricingNotes: '' },
  { id: 'v2', name: 'MV DIAMOND STAR II', status: 'راسية', destination: 'جدة', eta: '22 أكتوبر', pos: null, posAt: null, quantityMT: null, loadedAt: null, etaAt: null, priced: 'unknown', pricedQtyMT: null, marketAvg: '', whitePremiumAvg: null, finalAvgPrice: null, pricingNotes: '' },
];

const nonNeg = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[, ]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const str = (v: unknown, fallback = '', max = 120): string => {
  const s = typeof v === 'string' ? v : '';
  const clean = s.replace(/\s+/g, ' ').trim().slice(0, max);
  return clean || fallback;
};

const strShort = (v: unknown, fallback = '', max = 40): string => {
  const s = typeof v === 'string' ? v : '';
  const clean = s.replace(/\s+/g, ' ').trim().slice(0, max);
  return clean || fallback;
};

const isoOrNull = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

const isoDateOrNull = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = Date.parse(s);
    if (!Number.isFinite(t)) return null;
    return new Date(t).toISOString().slice(0, 10);
  }
  return s;
};

const nonNegInt = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[, ]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
};

const nonNegNum = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[, ]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** Returns a complete, trustworthy inventory record, or null if unusable. */
export function sanitizeInventory(input: unknown): InventoryData | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const raw = o.total;
  // `total` is mandatory: undefined / null / blank must be rejected, not read as 0.
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return null;
  const rawTotal = typeof raw === 'number' ? raw : Number(String(raw).replace(/[, ]/g, ''));
  if (!Number.isFinite(rawTotal) || rawTotal < 0) return null;
  const total = rawTotal;

  const companyPriced = nonNeg(o.companyPriced);
  const partnerPriced = nonNeg(o.partnerPriced);
  const data: InventoryData = {
    total,
    rawSugar: nonNeg(o.rawSugar),
    refinedSugar: nonNeg(o.refinedSugar),
    companyPriced,
    partnerPriced,
    // always derived — never trusted from the client
    unpriced: Math.max(0, total - (companyPriced + partnerPriced)),
    updatedAt: isoOrNull(o.updatedAt) ?? new Date().toISOString(),
    dailyProductionMT: nonNegNum(o.dailyProductionMT, 0) || null,
    monthlySalesMT: nonNegNum(o.monthlySalesMT, 0) || null,

    rawCoverageDays: nonNegNum(o.rawCoverageDays, 0) || null,
    totalCoverageDays: nonNegNum(o.totalCoverageDays, 0) || null,
    rawStockEndDate: isoDateOrNull(o.rawStockEndDate),
    totalStockEndDate: isoDateOrNull(o.totalStockEndDate),
    lastProductionDate: isoDateOrNull(o.lastProductionDate),
  };
  return data;
}

export function sanitizeVessel(input: unknown): Vessel | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const id = str(o.id, '', 64);
  if (!id) return null;

  let pos: Vessel['pos'] = null;
  const rawPos = o.pos as { lat?: unknown; lng?: unknown } | null | undefined;
  if (rawPos && typeof rawPos === 'object') {
    const lat = Number(rawPos.lat);
    const lng = Number(rawPos.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      pos = { lat, lng };
    }
  }

  const priced = str(o.priced, 'unknown', 10);
  return {
    id,
    name: str(o.name, '—', 120),
    status: str(o.status, '—', 60),
    destination: str(o.destination, '—', 80),
    eta: str(o.eta, '—', 60),
    pos,
    posAt: pos ? isoOrNull(o.posAt) : null,
    imo: str(o.imo, '', 16),
    mmsi: str(o.mmsi, '', 16),
    quantityMT: nonNegInt(o.quantityMT, 0) || null,
    loadedAt: isoDateOrNull(o.loadedAt),
    etaAt: isoDateOrNull(o.etaAt),
    priced: (priced === 'priced' || priced === 'unpriced' || priced === 'unknown') ? priced : 'unknown',
    pricedQtyMT: nonNegInt(o.pricedQtyMT, 0) || null,
    marketAvg: strShort(o.marketAvg, '', 40),
    whitePremiumAvg: nonNegNum(o.whitePremiumAvg, 0) || null,
    finalAvgPrice: nonNegNum(o.finalAvgPrice, 0) || null,
    invoicePrice: nonNegNum(o.invoicePrice, 0) || null,
    cargoValueUsd: nonNegNum(o.cargoValueUsd, 0) || null,
    pricingNotes: str(o.pricingNotes, '', 120),
  };
}

export function sanitizeVessels(input: unknown): Vessel[] {
  if (!Array.isArray(input)) return [];
  return input
    .map(sanitizeVessel)
    .filter((v): v is Vessel => v !== null)
    .slice(0, 200);
}

/** Normalise a localStorage / API payload without throwing. */
export function coerceInventory(input: unknown): InventoryData {
  const o = (input ?? {}) as Record<string, unknown>;
  const total = nonNeg(o.total);
  const companyPriced = nonNeg(o.companyPriced);
  const partnerPriced = nonNeg(o.partnerPriced);
  return {
    total,
    rawSugar: nonNeg(o.rawSugar),
    refinedSugar: nonNeg(o.refinedSugar),
    companyPriced,
    partnerPriced,
    unpriced: Math.max(0, total - (companyPriced + partnerPriced)),
    updatedAt: isoDateOrNull(o.updatedAt) as any,
    dailyProductionMT: nonNegNum(o.dailyProductionMT, 0) || null,
    monthlySalesMT: nonNegNum(o.monthlySalesMT, 0) || null,

    rawCoverageDays: nonNegNum(o.rawCoverageDays, 0) || null,
    totalCoverageDays: nonNegNum(o.totalCoverageDays, 0) || null,
    rawStockEndDate: isoDateOrNull(o.rawStockEndDate),
    totalStockEndDate: isoDateOrNull(o.totalStockEndDate),
    lastProductionDate: isoDateOrNull(o.lastProductionDate),
  };
}

export function coerceVessels(input: unknown): Vessel[] {
  if (!Array.isArray(input) || input.length === 0) return DEFAULT_VESSELS;
  const out = input.map((v, i) => {
    const s = sanitizeVessel({ id: `v${i + 1}`, ...(v as object) });
    return s ?? DEFAULT_VESSELS[i % DEFAULT_VESSELS.length];
  });
  return out;
}
