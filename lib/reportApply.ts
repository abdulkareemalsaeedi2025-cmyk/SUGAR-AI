/**
 * Feeds extracted report facts back into the system's own data (vessels,
 * inventory). Two paths:
 *  - structured: the company's Consolidated Sugar Sheet (high confidence)
 *  - generic:     keyword/label heuristics for any other report
 * A value is written only when it is clearly tied to a known entity.
 * Everything — applied or merely detected — is logged in the updates feed.
 */
import { kvGet, kvSet } from './db';
import {
  VESSELS_KEY, INVENTORY_KEY, DEFAULT_VESSELS, SAMPLE_INVENTORY,
  sanitizeVessels, sanitizeInventory,
  type Vessel, type InventoryData,
} from './userData';
import type { ExtractResult } from './reportExtract';
import type { ConsolidatedSheet, SheetVessel } from './sugarSheet';
import type { AppliedField } from './reportUpdates';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ').trim();

async function loadVessels(): Promise<Vessel[]> {
  try {
    const raw = await kvGet<unknown>(VESSELS_KEY);
    const arr = sanitizeVessels(raw ?? DEFAULT_VESSELS);
    return arr.length ? arr : structuredClone(DEFAULT_VESSELS);
  } catch {
    return structuredClone(DEFAULT_VESSELS);
  }
}

async function loadInventory(): Promise<InventoryData> {
  try {
    const raw = await kvGet<unknown>(INVENTORY_KEY);
    return sanitizeInventory(raw) ?? { ...SAMPLE_INVENTORY };
  } catch {
    return { ...SAMPLE_INVENTORY };
  }
}

const F = (path: string, labelAr: string, labelEn: string, oldValue: unknown, newValue: unknown, confidence: number, applied: boolean): AppliedField =>
  ({ path, labelAr, labelEn, oldValue, newValue, confidence, applied });

/* ---------- structured path: Consolidated Sugar Sheet ---------- */

async function applySheet(sheet: ConsolidatedSheet, fields: AppliedField[]): Promise<number> {
  let changed = 0;

  // --- inventory (raw/refined/total, checksum-validated when possible)
  if (sheet.rawSugarMT !== null || sheet.refinedSugarMT !== null || sheet.totalMT !== null) {
    const inv = await loadInventory();
    const checksumOk =
      sheet.rawSugarMT !== null && sheet.refinedSugarMT !== null && sheet.totalMT !== null
        ? sheet.rawSugarMT + sheet.refinedSugarMT === sheet.totalMT
        : false;
    const conf = checksumOk ? 0.95 : 0.8;
    let dirty = false;
    if (sheet.rawSugarMT !== null && inv.rawSugar !== sheet.rawSugarMT) {
      fields.push(F('inventory.rawSugar', 'مخزون السكر الخام (MT)', 'Raw sugar stock (MT)', inv.rawSugar, sheet.rawSugarMT, conf, true));
      inv.rawSugar = sheet.rawSugarMT; dirty = true; changed++;
    }
    if (sheet.refinedSugarMT !== null && inv.refinedSugar !== sheet.refinedSugarMT) {
      fields.push(F('inventory.refinedSugar', 'مخزون السكر المكرر (MT)', 'Refined sugar stock (MT)', inv.refinedSugar, sheet.refinedSugarMT, conf, true));
      inv.refinedSugar = sheet.refinedSugarMT; dirty = true; changed++;
    }
    if (sheet.totalMT !== null && inv.total !== sheet.totalMT) {
      fields.push(F('inventory.total', 'إجمالي المخزون (MT)', 'Total stock (MT)', inv.total, sheet.totalMT, conf, true));
      inv.total = sheet.totalMT; dirty = true; changed++;
    }
    // priced stock position from the sheet ("AVERAGE PRICED POSITION (Stock)")
    // → updates the gross priced stock figure. partnerPriced is a MANUAL
    // field (= "priced for others") and is intentionally left untouched.
    if (sheet.avgPricedStock && sheet.avgPricedStock.qty > 0) {
      const q = sheet.avgPricedStock.qty;
      if (inv.companyPriced !== q) {
        fields.push(F('inventory.companyPriced', 'الكمية المسعرة من المخزون (MT)', 'Priced stock qty (MT)', inv.companyPriced, q, 0.9, true));
        inv.companyPriced = q;
        dirty = true; changed++;
      }
    }
    if (dirty) {
      inv.unpriced = Math.max(0, inv.total - (inv.companyPriced + inv.partnerPriced));
      // recompute coverage from the preserved manual fields so report-driven
      // stock changes flow through immediately (production/sales stay manual).
      // Raw coverage counts raw stock PLUS cargo still en route (the two
      // vessels underway = 104,396 MT on the 08-10-26 report).
      const transitQtyMT = sheet.vessels
        .filter((v) => /TRANSIT|ROUTE|SAIL/i.test(v.position))
        .reduce((s, v) => s + (v.qtyMT ?? 0), 0);
      const daily = inv.dailyProductionMT ?? 0;
      const monthly = inv.monthlySalesMT ?? 0;
      const base = inv.lastProductionDate || new Date().toISOString().slice(0, 10);
      if (daily > 0 && inv.rawSugar > 0) {
        inv.rawCoverageDays = Math.round((inv.rawSugar + transitQtyMT) / daily);
        const end = new Date(base + 'T00:00:00');
        end.setDate(end.getDate() + inv.rawCoverageDays);
        inv.rawStockEndDate = end.toISOString().slice(0, 10);
      }
      if (monthly > 0 && inv.total > 0) {
        inv.totalCoverageDays = Math.round((inv.total + transitQtyMT) / (monthly / 30));
        const end2 = new Date(base + 'T00:00:00');
        end2.setDate(end2.getDate() + inv.totalCoverageDays);
        inv.totalStockEndDate = end2.toISOString().slice(0, 10);
      }
      inv.updatedAt = new Date().toISOString();
      await kvSet(INVENTORY_KEY, inv);
    }
  }

  // --- vessels: merge sheet rows (same code may appear priced + unpriced)
  if (sheet.vessels.length > 0) {
    const groups = new Map<string, SheetVessel[]>();
    for (const row of sheet.vessels) {
      const k = row.code || norm(row.name);
      groups.set(k, [...(groups.get(k) ?? []), row]);
    }

    const vessels = await loadVessels();
    let dirty = false;

    for (const rows of groups.values()) {
      const first = rows[0];
      const stripMv = (s: string) => norm(s).replace(/^mv\s+/, '');
      const nameB = stripMv(first.name);
      let target = vessels.find((v) => {
        const a = stripMv(v.name);
        if (!a || !nameB) return false;
        if (a === nameB || a.includes(nameB) || nameB.includes(a)) return true;
        // token-subset match: "ortakoy" matches "tk ortakoy"
        const at = a.split(' '), bt = nameB.split(' ');
        const [small, large] = at.length <= bt.length ? [at, bt] : [bt, at];
        return small.every((t) => large.includes(t));
      });

      const totalQty = rows.reduce((s, r) => s + (r.qtyMT ?? 0), 0) || null;
      const pricedQty = rows.filter((r) => r.priced === 'priced').reduce((s, r) => s + (r.qtyMT ?? 0), 0);
      const anyTransit = rows.some((r) => /TRANSIT|ROUTE|SAIL/i.test(r.position));
      const status = anyTransit ? 'قيد الملاحة' : 'راسية';
      const pricedState = pricedQty > 0 ? 'priced' : 'unpriced';
      const etaISO = rows.map((r) => r.etaISO).filter(Boolean).sort().pop() ?? null; // latest ETA
      const refRow = rows.find((r) => r.priced === 'priced') ?? first;
      // merged across rows (a vessel may appear priced + unpriced): true
      // weighted average price and total cargo value — prefer the sheet's
      // stated C&F value per row, fall back to qty × price
      const mergedValue = rows.reduce((s, r) => s + (r.value ?? ((r.qtyMT ?? 0) * (r.price ?? 0))), 0) || null;
      const wAvgPrice = totalQty && mergedValue ? +(mergedValue / totalQty).toFixed(2) : refRow.price;
      const notesParts = [
        first.code,
        refRow.contract,
        mergedValue ? `C&F $${Math.round(mergedValue).toLocaleString('en-US')}` : '',
        refRow.invoice ? `Invoice $${refRow.invoice}` : '',
        rows.length > 1 ? `${rows.length} صفوف (مسعر+غير مسعر)` : '',
      ].filter(Boolean).join(' · ');

      if (!target) {
        target = {
          id: 'v_' + (first.code || Date.now().toString(36)).toLowerCase(),
          name: first.name,
          status,
          destination: '',
          eta: etaISO ?? '',
          pos: null, posAt: null,
          quantityMT: totalQty,
          loadedAt: null,
          etaAt: etaISO,
          priced: pricedState,
          pricedQtyMT: pricedQty > 0 ? pricedQty : null,
          marketAvg: refRow.contract,
          whitePremiumAvg: refRow.premium,
          finalAvgPrice: wAvgPrice,
          invoicePrice: refRow.invoice,
          cargoValueUsd: mergedValue,
          pricingNotes: notesParts,
        };
        vessels.push(target);
        fields.push(F(`vessels.${first.name}`, `باخرة جديدة أُضيفت: ${first.name}`, `New vessel added: ${first.name}`, null, `${totalQty ?? '—'} MT · ${status}`, 0.9, true));
        changed++;
        dirty = true;
        continue;
      }

      const upd = (
        key: keyof Vessel, labelAr: string, labelEn: string, val: unknown,
      ) => {
        const cur = target![key];
        if (val === null || val === undefined || val === '' || cur === val) return;
        fields.push(F(`vessels.${target!.name}.${String(key)}`, `${labelAr} — ${target!.name}`, `${labelEn} — ${target!.name}`, cur ?? null, val, 0.9, true));
        (target as unknown as Record<string, unknown>)[key] = val;
        changed++;
        dirty = true;
      };

      upd('status', 'الحالة', 'Status', status);
      upd('etaAt', 'تاريخ الوصول المتوقع', 'ETA date', etaISO);
      if (etaISO) upd('eta', 'الوصول المتوقع', 'ETA', etaISO);
      upd('quantityMT', 'الكمية (MT)', 'Quantity (MT)', totalQty);
      upd('priced', 'وضع التسعير', 'Pricing status', pricedState);
      if (pricedQty > 0) upd('pricedQtyMT', 'الكمية المسعرة (MT)', 'Priced qty (MT)', pricedQty);
      upd('marketAvg', 'متوسط مؤشر البورصة', 'Market avg', refRow.contract);
      upd('whitePremiumAvg', 'متوسط البريميوم', 'Premium avg', refRow.premium);
      upd('finalAvgPrice', 'متوسط التسعير النهائي', 'Final avg price', wAvgPrice);
      upd('invoicePrice', 'سعر الفاتورة', 'Invoice price', refRow.invoice);
      upd('cargoValueUsd', 'قيمة الشحنة الإجمالية', 'Total cargo value', mergedValue);
      upd('pricingNotes', 'ملاحظات التسعير', 'Pricing notes', notesParts);
    }

    if (dirty) await kvSet(VESSELS_KEY, vessels);
  }

  // --- prices: detected only (market data authority is the live feed)
  if (sheet.nyFront) {
    fields.push(F('facts.nyFront', `سعر NY (${sheet.nyFront.contract})`, `NY front (${sheet.nyFront.contract})`, null, `${sheet.nyFront.cLb}¢/lb · $${sheet.nyFront.usdMt}/MT`, 0.9, false));
  }
  if (sheet.londonFront) {
    fields.push(F('facts.londonFront', `سعر لندن (${sheet.londonFront.contract})`, `London front (${sheet.londonFront.contract})`, null, `$${sheet.londonFront.usdMt}/MT`, 0.9, false));
  }
  if (sheet.whitePremium) {
    fields.push(F('facts.whitePremium', `البريميوم (${sheet.whitePremium.period})`, `White premium (${sheet.whitePremium.period})`, null, `$${sheet.whitePremium.value}`, 0.9, false));
  }
  if (sheet.avgPricedStock) {
    fields.push(F('facts.avgPricedStock', 'متوسط المراكز المسعرة بالمخزون', 'Avg priced stock position', null, `${sheet.avgPricedStock.qty.toLocaleString('en-US')} MT @ $${sheet.avgPricedStock.price}`, 0.9, false));
  }

  // --- refined (white) sugar prices + report market refs: saved as the
  //     system's latest reference (Executive Snapshot falls back to these
  //     when the live London feed is unavailable) + logged
  if (sheet.refinedPrices.length > 0 || sheet.londonFront || sheet.whitePremium) {
    await kvSet('refined-prices', {
      at: new Date().toISOString(),
      reportDate: sheet.reportDate,
      londonFront: sheet.londonFront,
      nyFront: sheet.nyFront,
      whitePremium: sheet.whitePremium,
      items: sheet.refinedPrices,
    });
    const GROUP_AR: Record<string, string> = {
      container: 'سكر جاهز — حاويات CFR',
      breakbulk: 'سكر جاهز — كسر bulk CFR عدن',
      basis: 'بريميوم الأساس',
      replacement: 'قيم استبدال مرجعية',
    };
    for (const p of sheet.refinedPrices.slice(0, 24)) {
      fields.push(F(
        `refined-prices.${p.label}`,
        `${GROUP_AR[p.group] ?? p.group}: ${p.label}`,
        `Refined sugar — ${p.group}: ${p.label}`,
        null,
        `$${p.value}/MT${p.note ? ` (${p.note})` : ''}`,
        0.85,
        true,
      ));
      changed++;
    }
  }

  return changed;
}

/* ---------- generic path (other reports) ---------- */

async function applyGeneric(ex: ExtractResult, fields: AppliedField[]): Promise<number> {
  let changed = 0;
  const text = ex.text;

  const vessels = await loadVessels();
  let vesselsDirty = false;
  for (const v of vessels) {
    const nameN = norm(v.name.replace(/^mv\s+/i, ''));
    if (!nameN || nameN.length < 4) continue;
    const idx = norm(text).indexOf(nameN);
    if (idx < 0) continue;
    const window = text.slice(Math.max(0, idx - 160), idx + 260);
    const dateHit = window.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[0] ?? null;
    if (dateHit && v.etaAt !== dateHit) {
      fields.push(F(`vessels.${v.name}.etaAt`, `وصول متوقع — ${v.name}`, `ETA — ${v.name}`, v.etaAt ?? null, dateHit, 0.8, true));
      v.etaAt = dateHit;
      vesselsDirty = true;
      changed++;
    } else if (!dateHit) {
      fields.push(F(`vessels.${v.name}`, `ذُكرت الباخرة ${v.name} بدون تاريخ واضح`, `Vessel ${v.name} mentioned, no clear date`, null, null, 0.4, false));
    }
  }
  if (vesselsDirty) await kvSet(VESSELS_KEY, vessels);

  const inv = await loadInventory();
  // Inventory stock fields (raw/refined/total) and the manual production /
  // sales fields are owned EXCLUSIVELY by the structured Consolidated Sugar
  // Sheet and by manual entry (owner's standing rules). A generic news /
  // market report must NEVER overwrite them — a loose "raw sugar … 21"
  // headline regex once wiped 32,226 MT down to 21. Detect-and-log only.
  const setInv = (
    key: 'rawSugar' | 'refinedSugar' | 'total' | 'dailyProductionMT' | 'monthlySalesMT',
    labels: RegExp, labelAr: string, labelEn: string,
  ) => {
    for (const n of ex.facts.numbers) {
      if (labels.test(n.label)) {
        fields.push(F(`inventory.${key}`, labelAr, labelEn, inv[key] ?? null, n.value, 0.4, false));
        return;
      }
    }
  };
  setInv('rawSugar', /raw sugar|سكر خام/, 'مخزون السكر الخام', 'Raw sugar stock');
  setInv('refinedSugar', /refined sugar|سكر مكرر/, 'مخزون السكر المكرر', 'Refined sugar stock');
  setInv('total', /total stock|total inventory|إجمالي المخزون/, 'إجمالي المخزون', 'Total stock');
  setInv('dailyProductionMT', /daily production|إنتاج يومي/, 'الإنتاج اليومي (MT)', 'Daily production (MT)');
  setInv('monthlySalesMT', /monthly sales|مبيعات شهرية/, 'المبيعات الشهرية (MT)', 'Monthly sales (MT)');

  for (const p of ex.facts.prices.slice(0, 6)) {
    fields.push(F(`facts.price.${p.label}`, `سعر مذكور: ${p.label}`, `Price mentioned: ${p.label}`, null, p.value, 0.5, false));
  }

  return changed;
}

export async function applyReportToSystem(ex: ExtractResult, sheet?: ConsolidatedSheet | null): Promise<{ fields: AppliedField[]; changed: number }> {
  const fields: AppliedField[] = [];
  let changed = 0;
  if (sheet) changed += await applySheet(sheet, fields);
  else changed += await applyGeneric(ex, fields);
  return { fields, changed };
}
