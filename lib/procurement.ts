/**
 * Procurement & pricing engine — the executive purchase recommendation.
 *
 * Business rules (owner-defined):
 *  - Raw-sugar coverage counts stock AND cargo still en route.
 *  - Supply lead time (PO → vessel arrival) = 3 months (90 days).
 *  - Production must never stop for lack of raw sugar.
 *  - Pricing target: 50% of the TOTAL position (stock + transit) priced.
 *  - Pricing must stay opportunistic: never chase highs, seize dips.
 *
 * Everything here is a pure function of the inputs — no I/O, fully testable.
 */

export interface TransitCargo {
  name: string;
  qtyMT: number;
  etaISO: string | null;
  pricedQtyMT: number;
}

export interface ProcurementInput {
  todayISO: string;
  rawStockMT: number;
  totalStockMT: number;
  pricedStockMT: number;          // companyPriced + partnerPriced (stock)
  dailyProductionMT: number | null; // manual field — null disables the supply forecast
  transit: TransitCargo[];
  pricedCargoAvgUsdMt: number | null; // weighted avg $/MT of priced cargo (book cost)
  nyNowCLb: number | null;          // live NY #11 ¢/lb
  nyReportCLb: number | null;       // NY ¢/lb from the latest report
  reportDate: string | null;
}

export interface SupplyEvent {
  date: string;
  name: string;
  qtyMT: number;
  balanceAfterMT: number;
}

export interface SupplyPlan {
  available: boolean; // false when daily production is unknown
  coverageStockDays: number | null;
  coverageTotalDays: number | null;
  transitQtyMT: number;
  stockoutISO: string | null;
  orderDeadlineISO: string | null;   // stockout − 90d lead time
  daysToDeadline: number | null;
  recommendedQtyMT: number | null;   // one lead-time of cover
  urgency: 'critical' | 'urgent' | 'soon' | 'ok' | 'unknown';
  timeline: SupplyEvent[];
}

export interface PricingTranche {
  pct: number;
  qtyMT: number;
  triggerCLb: number | null; // null = market now
  note: 'now' | 'limit1' | 'limit2';
}

export interface PricingPlan {
  positionTotalMT: number;
  pricedTotalMT: number;
  pricedPct: number;
  targetPct: number;             // 50
  gapQtyMT: number;
  avgPricedCLb: number | null;
  nyRefCLb: number | null;
  vsBookPct: number | null;      // (ny − book)/book — negative = cheaper than book
  favorable: boolean | null;     // ny below book cost → dip
  ceilingCLb: number | null;     // do-not-chase ceiling = book avg
  tranches: PricingTranche[];
  action: 'price_now' | 'price_partial_wait' | 'wait_dip' | 'target_met' | 'no_data';
}

export interface ProcurementPlan {
  supply: SupplyPlan;
  pricing: PricingPlan;
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
}

const DAY = 86400000;
export const LEAD_TIME_DAYS = 90;
export const SAFETY_BUFFER_DAYS = 30;
export const TARGET_PRICED_PCT = 50;
/** Owner's rule: the recommended purchase order is ALWAYS one standard
 *  vessel lot of 50,000 MT (repeat orders as needed). */
export const ORDER_LOT_MT = 50_000;
const CLB_TO_USDMT = 22.0462;

const daysBetween = (aISO: string, bISO: string) =>
  Math.round((Date.parse(bISO + 'T00:00:00Z') - Date.parse(aISO + 'T00:00:00Z')) / DAY);

const addDays = (iso: string, d: number) => {
  const t = new Date(iso + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};

export function computeSupply(inp: ProcurementInput): SupplyPlan {
  const transitQtyMT = inp.transit.reduce((s, v) => s + v.qtyMT, 0);
  const base: SupplyPlan = {
    available: false,
    coverageStockDays: null,
    coverageTotalDays: null,
    transitQtyMT,
    stockoutISO: null,
    orderDeadlineISO: null,
    daysToDeadline: null,
    recommendedQtyMT: null,
    urgency: 'unknown',
    timeline: [],
  };
  const dp = inp.dailyProductionMT;
  if (!dp || dp <= 0) return base;

  const coverageStockDays = Math.floor(inp.rawStockMT / dp);

  // event-driven simulation: consume production day by day, add cargo on ETA
  const events = inp.transit
    .filter((v) => v.etaISO && Date.parse(v.etaISO) >= Date.parse(inp.todayISO))
    .sort((a, b) => (a.etaISO! < b.etaISO! ? -1 : 1));

  let available = inp.rawStockMT;
  let cursor = inp.todayISO;
  let stockout: string | null = null;
  const timeline: SupplyEvent[] = [];

  for (const ev of events) {
    const gap = daysBetween(cursor, ev.etaISO!);
    const need = gap * dp;
    if (need >= available) {
      stockout = addDays(cursor, Math.floor(available / dp));
      break;
    }
    available -= need;
    available += ev.qtyMT;
    timeline.push({ date: ev.etaISO!, name: ev.name, qtyMT: ev.qtyMT, balanceAfterMT: Math.round(available) });
    cursor = ev.etaISO!;
  }
  if (!stockout) stockout = addDays(cursor, Math.floor(available / dp));

  const coverageTotalDays = daysBetween(inp.todayISO, stockout);
  const orderDeadline = addDays(stockout, -LEAD_TIME_DAYS);
  const daysToDeadline = daysBetween(inp.todayISO, orderDeadline);

  // recommended order = always one standard vessel lot (owner's rule)
  const recommendedQtyMT = ORDER_LOT_MT;

  const firstArrivalDays = events.length ? daysBetween(inp.todayISO, events[0].etaISO!) : Infinity;
  const urgency: SupplyPlan['urgency'] =
    stockout < (events[0]?.etaISO ?? '9999') || coverageStockDays < firstArrivalDays
      ? 'critical'                                            // stockout BEFORE the next arrival
      : daysToDeadline <= 0
        ? 'urgent'                                            // deadline already here → order now
        : daysToDeadline <= 14 || coverageTotalDays <= LEAD_TIME_DAYS + SAFETY_BUFFER_DAYS
          ? 'soon'
          : 'ok';

  return {
    available: true,
    coverageStockDays,
    coverageTotalDays,
    transitQtyMT,
    stockoutISO: stockout,
    orderDeadlineISO: orderDeadline,
    daysToDeadline,
    recommendedQtyMT,
    urgency,
    timeline,
  };
}

export function computePricing(inp: ProcurementInput): PricingPlan {
  const transitQtyMT = inp.transit.reduce((s, v) => s + v.qtyMT, 0);
  const transitPricedMT = inp.transit.reduce((s, v) => s + v.pricedQtyMT, 0);
  const positionTotalMT = inp.totalStockMT + transitQtyMT;
  const pricedTotalMT = inp.pricedStockMT + transitPricedMT;
  const pricedPct = positionTotalMT > 0 ? (pricedTotalMT / positionTotalMT) * 100 : 0;
  const targetQty = (TARGET_PRICED_PCT / 100) * positionTotalMT;
  const gapQtyMT = Math.max(0, Math.round(targetQty - pricedTotalMT));

  const avgPricedCLb = inp.pricedCargoAvgUsdMt ? inp.pricedCargoAvgUsdMt / CLB_TO_USDMT : null;
  const nyRefCLb = inp.nyNowCLb ?? inp.nyReportCLb ?? null;
  const vsBookPct = nyRefCLb != null && avgPricedCLb ? ((nyRefCLb - avgPricedCLb) / avgPricedCLb) * 100 : null;
  const favorable = vsBookPct != null ? vsBookPct <= 0 : null;
  const ceilingCLb = avgPricedCLb ? +avgPricedCLb.toFixed(2) : null;

  if (gapQtyMT <= 0) {
    return {
      positionTotalMT, pricedTotalMT, pricedPct, targetPct: TARGET_PRICED_PCT, gapQtyMT: 0,
      avgPricedCLb, nyRefCLb, vsBookPct, favorable, ceilingCLb, tranches: [], action: 'target_met',
    };
  }
  if (nyRefCLb == null) {
    return {
      positionTotalMT, pricedTotalMT, pricedPct, targetPct: TARGET_PRICED_PCT, gapQtyMT,
      avgPricedCLb, nyRefCLb, vsBookPct, favorable, ceilingCLb, tranches: [], action: 'no_data',
    };
  }

  // Opportunistic ladder: 40% at market (only if not above book), then two
  // resting limit tranches below the market — never chase highs.
  const t1Qty = Math.round(gapQtyMT * 0.4);
  const t2Qty = Math.round(gapQtyMT * 0.3);
  const t3Qty = gapQtyMT - t1Qty - t2Qty;
  const l1 = +(nyRefCLb - 0.5).toFixed(2);
  const l2 = +(nyRefCLb - 1.0).toFixed(2);
  const tranches: PricingTranche[] = [
    { pct: 40, qtyMT: t1Qty, triggerCLb: null, note: 'now' },
    { pct: 30, qtyMT: t2Qty, triggerCLb: l1, note: 'limit1' },
    { pct: 30, qtyMT: t3Qty, triggerCLb: l2, note: 'limit2' },
  ];

  const action: PricingPlan['action'] =
    favorable === true ? 'price_now' : favorable === false && vsBookPct! <= 3 ? 'price_partial_wait' : 'wait_dip';

  return {
    positionTotalMT, pricedTotalMT, pricedPct, targetPct: TARGET_PRICED_PCT, gapQtyMT,
    avgPricedCLb, nyRefCLb, vsBookPct, favorable, ceilingCLb, tranches, action,
  };
}

export function computePlan(inp: ProcurementInput): ProcurementPlan {
  const supply = computeSupply(inp);
  const pricing = computePricing(inp);
  const notes: string[] = [];
  if (!supply.available) notes.push('no_production_input');
  if (inp.nyNowCLb == null) notes.push(inp.nyReportCLb != null ? 'ny_from_report' : 'ny_missing');
  const confidence: ProcurementPlan['confidence'] =
    supply.available && inp.nyNowCLb != null ? 'high' : inp.nyNowCLb != null || supply.available ? 'medium' : 'low';
  return { supply, pricing, confidence, notes };
}
