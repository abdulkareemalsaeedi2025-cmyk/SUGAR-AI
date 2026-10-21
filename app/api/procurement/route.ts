import { NextResponse } from 'next/server';
import { kvGet } from '../../../lib/db';
import {
  INVENTORY_KEY, VESSELS_KEY, SAMPLE_INVENTORY, DEFAULT_VESSELS,
  sanitizeInventory, sanitizeVessels,
} from '../../../lib/userData';
import { computePlan, type ProcurementInput } from '../../../lib/procurement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const inv = sanitizeInventory(await kvGet<unknown>(INVENTORY_KEY)) ?? SAMPLE_INVENTORY;
    const vessels = sanitizeVessels((await kvGet<unknown>(VESSELS_KEY)) ?? DEFAULT_VESSELS);
    const refs = (await kvGet<any>('refined-prices')) ?? null;

    // NY live price from the market cache (wrap-tolerant: {value:{...}} or direct)
    const marketRaw = await kvGet<any>('cache:market');
    const market = marketRaw?.value ?? marketRaw;
    const nyNowCLb = typeof market?.contracts?.[0]?.last === 'number' ? market.contracts[0].last : null;

    // transit cargo = vessels underway (IN TRANSIT → 'قيد الملاحة' per report mapping)
    const transit = vessels
      .filter((v) => v.status === 'قيد الملاحة' && (v.quantityMT ?? 0) > 0)
      .map((v) => ({
        name: v.name,
        qtyMT: v.quantityMT ?? 0,
        etaISO: v.etaAt ?? null,
        pricedQtyMT: v.pricedQtyMT ?? 0,
      }));

    // weighted average cost of priced cargo (book basis) from vessel rows
    let pq = 0, pv = 0;
    for (const v of vessels) {
      if ((v.pricedQtyMT ?? 0) > 0 && (v.finalAvgPrice ?? 0) > 0) {
        pq += v.pricedQtyMT!;
        pv += v.pricedQtyMT! * v.finalAvgPrice!;
      }
    }
    const pricedCargoAvgUsdMt = pq > 0 ? +(pv / pq).toFixed(2) : null;

    const input: ProcurementInput = {
      todayISO: new Date().toISOString().slice(0, 10),
      rawStockMT: inv.rawSugar,
      totalStockMT: inv.total,
      pricedStockMT: Math.max(0, inv.companyPriced + inv.partnerPriced - (inv.partnerPriced ?? 0)),
      dailyProductionMT: inv.dailyProductionMT ?? null,
      transit,
      pricedCargoAvgUsdMt,
      nyNowCLb,
      nyReportCLb: refs?.nyFront?.cLb ?? null,
      reportDate: refs?.reportDate ?? null,
    };

    const plan = computePlan(input);
    return NextResponse.json({ ok: true, input, plan });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'خطأ' }, { status: 500 });
  }
}
