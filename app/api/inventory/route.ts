import { NextResponse } from 'next/server';
import { kvGet, kvSet, dbStatus, logAudit } from '../../../lib/db';
import { requireAdmin, unauthorized, forbidden, sessionFromRequest } from '../../../lib/auth';
import { INVENTORY_KEY, VESSELS_KEY, DEFAULT_VESSELS, sanitizeInventory, sanitizeVessels, SAMPLE_INVENTORY, type InventoryData } from '../../../lib/userData';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export interface PositionTotals {
  totalMT: number;
  pricedMT: number;
  unpricedMT: number;
  pricedPct: number;
  unpricedPct: number;
  transitMT: number;
  /** manual: quantity priced for others/partner — deducted from priced. */
  forOthersMT: number;
  /** priced before the for-others deduction. */
  grossPricedMT: number;
  /** 'vessels' = computed like the vessel-pricing table (stock + en route);
   *  'inventory' = fallback to stored figures when no vessel quantities exist. */
  basis: 'vessels' | 'inventory';
}

/** "Priced for others" and "partner priced" are the SAME concept — one
 *  manual field (partnerPriced), never summed twice. */
const forOthersOf = (inv: InventoryData): number => inv.partnerPriced ?? 0;

async function computePosition(inv: InventoryData): Promise<PositionTotals> {
  const vessels = sanitizeVessels((await kvGet<unknown>(VESSELS_KEY)) ?? DEFAULT_VESSELS);
  const forOthers = forOthersOf(inv);
  let totalMT = 0, grossPricedMT = 0, transitMT = 0;
  for (const v of vessels) {
    const q = v.quantityMT ?? 0;
    if (q <= 0) continue;
    totalMT += q; // in-stock vessels ARE the stock; transit adds on top — same
    // arithmetic as the vessel-pricing table (52,020+21,576+52,500+51,896)
    const pq = v.pricedQtyMT ?? (v.priced === 'unpriced' ? 0 : 0);
    grossPricedMT += pq;
    if (v.status === 'قيد الملاحة') transitMT += q;
  }
  if (totalMT <= 0) {
    const gross = inv.companyPriced + inv.partnerPriced;
    const p = Math.max(0, gross - forOthers);
    return {
      totalMT: inv.total, pricedMT: p, unpricedMT: Math.max(0, inv.total - p),
      pricedPct: inv.total > 0 ? (p / inv.total) * 100 : 0,
      unpricedPct: inv.total > 0 ? 100 - (p / inv.total) * 100 : 0,
      transitMT: 0, forOthersMT: forOthers, grossPricedMT: gross, basis: 'inventory',
    };
  }
  // net priced = gross priced − priced-for-others (owner's coverage only)
  const pricedMT = Math.max(0, grossPricedMT - forOthers);
  return {
    totalMT, pricedMT, unpricedMT: Math.max(0, totalMT - pricedMT),
    pricedPct: (pricedMT / totalMT) * 100,
    unpricedPct: 100 - (pricedMT / totalMT) * 100,
    transitMT, forOthersMT: forOthers, grossPricedMT, basis: 'vessels',
  };
}

/** GET /api/inventory → the company's saved books, or the honest sample layout. */
export async function GET() {
  const status = await dbStatus();
  const stored = await kvGet<InventoryData>(INVENTORY_KEY);
  const data = stored ?? SAMPLE_INVENTORY;
  return NextResponse.json(
    {
      ok: true,
      storage: status.persistent ? 'server' : status.ok ? 'memory' : 'unavailable',
      persistent: status.persistent,
      isSample: !stored?.updatedAt,
      source: stored ? 'db' : 'default',
      data,
      position: await computePosition(data),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/** PUT /api/inventory → validate and persist the real company figures. (admin only) */
export async function PUT(req: Request) {
  if (!(await requireAdmin(req))) return (await sessionFromRequest(req)) ? forbidden() : unauthorized();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const payload = (body as { data?: unknown })?.data ?? body;
  const clean = sanitizeInventory(payload);
  if (!clean) {
    return NextResponse.json({ ok: false, error: 'invalid_inventory' }, { status: 422 });
  }

  const saved = await kvSet(INVENTORY_KEY, clean);
  if (!saved) {
    // DB unavailable (read-only host) → tell the client to keep its local copy.
    return NextResponse.json({ ok: false, error: 'storage_unavailable', storage: 'unavailable' }, { status: 503 });
  }

  await logAudit({ action: 'inventory.update', entity: 'inventory', details: { total: clean.total } });
  return NextResponse.json({ ok: true, storage: 'server', data: clean }, { headers: { 'Cache-Control': 'no-store' } });
}
