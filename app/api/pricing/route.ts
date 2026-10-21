import { NextResponse } from 'next/server';
import { kvGet, kvSet, dbStatus, logAudit } from '../../../lib/db';
import { requireAdmin, unauthorized, forbidden, sessionFromRequest } from '../../../lib/auth';
import {
  PRICING_KEY,
  coercePricingLots,
  sanitizePricingLot,
  summarizePricing,
  type PricingLot,
} from '../../../lib/pricing';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Read the stored ledger, always normalised so a corrupt blob can't leak out. */
async function readLots(): Promise<PricingLot[]> {
  return coercePricingLots(await kvGet<unknown>(PRICING_KEY));
}

function byDateDesc(a: PricingLot, b: PricingLot): number {
  return (b.date || '').localeCompare(a.date || '') || (b.updatedAt || '').localeCompare(a.updatedAt || '');
}

function newId(): string {
  return `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const noStore = { 'Cache-Control': 'no-store' } as const;

/** GET /api/pricing → the pricing ledger + weighted summary. */
export async function GET() {
  const status = await dbStatus();
  const lots = (await readLots()).sort(byDateDesc);
  return NextResponse.json(
    {
      ok: true,
      storage: status.persistent ? 'server' : status.ok ? 'memory' : 'unavailable',
      persistent: status.persistent,
      count: lots.length,
      lots,
      summary: summarizePricing(lots),
    },
    { headers: noStore },
  );
}

/** POST /api/pricing → create one priced lot. (admin only) */
export async function POST(req: Request) {
  if (!(await requireAdmin(req))) return (await sessionFromRequest(req)) ? forbidden() : unauthorized();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const payload = (body as { lot?: unknown; data?: unknown })?.lot ?? (body as { data?: unknown })?.data ?? body;
  const clean = sanitizePricingLot(payload);
  if (!clean) {
    return NextResponse.json({ ok: false, error: 'invalid_pricing_lot' }, { status: 422 });
  }

  const lot: PricingLot = { ...clean, id: newId() };
  const lots = await readLots();
  lots.push(lot);

  if (!(await kvSet(PRICING_KEY, lots))) {
    return NextResponse.json({ ok: false, error: 'storage_unavailable', storage: 'unavailable' }, { status: 503 });
  }

  await logAudit({
    action: 'pricing.create',
    entity: 'pricing',
    entityId: lot.id,
    details: { market: lot.market, contract: lot.contract, quantityMT: lot.quantityMT, price: lot.price },
  });

  return NextResponse.json({ ok: true, storage: 'server', lot, summary: summarizePricing(lots) }, { headers: noStore });
}

/** PUT /api/pricing → update an existing lot by id. (admin only) */
export async function PUT(req: Request) {
  if (!(await requireAdmin(req))) return (await sessionFromRequest(req)) ? forbidden() : unauthorized();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const payload = (body as { lot?: unknown; data?: unknown })?.lot ?? (body as { data?: unknown })?.data ?? body;
  const id = typeof (payload as { id?: unknown })?.id === 'string' ? String((payload as { id: string }).id) : '';
  if (!id) return NextResponse.json({ ok: false, error: 'missing_id' }, { status: 400 });

  const lots = await readLots();
  const idx = lots.findIndex((l) => l.id === id);
  if (idx === -1) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  const existing = lots[idx];
  const merged = sanitizePricingLot({ ...existing, ...(payload as object), id: existing.id }, existing);
  if (!merged) return NextResponse.json({ ok: false, error: 'invalid_pricing_lot' }, { status: 422 });

  lots[idx] = merged;
  if (!(await kvSet(PRICING_KEY, lots))) {
    return NextResponse.json({ ok: false, error: 'storage_unavailable', storage: 'unavailable' }, { status: 503 });
  }

  await logAudit({
    action: 'pricing.update',
    entity: 'pricing',
    entityId: merged.id,
    details: { market: merged.market, contract: merged.contract, quantityMT: merged.quantityMT, price: merged.price },
  });

  return NextResponse.json({ ok: true, storage: 'server', lot: merged, summary: summarizePricing(lots) }, { headers: noStore });
}

/** DELETE /api/pricing?id=… → remove a lot. (admin only) */
export async function DELETE(req: Request) {
  if (!(await requireAdmin(req))) return (await sessionFromRequest(req)) ? forbidden() : unauthorized();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'missing_id' }, { status: 400 });

  const lots = await readLots();
  const next = lots.filter((l) => l.id !== id);
  if (next.length === lots.length) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  if (!(await kvSet(PRICING_KEY, next))) {
    return NextResponse.json({ ok: false, error: 'storage_unavailable', storage: 'unavailable' }, { status: 503 });
  }

  await logAudit({ action: 'pricing.delete', entity: 'pricing', entityId: id });
  return NextResponse.json({ ok: true, storage: 'server', summary: summarizePricing(next) }, { headers: noStore });
}
