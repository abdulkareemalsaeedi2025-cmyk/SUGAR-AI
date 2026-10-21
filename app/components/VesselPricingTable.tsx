'use client';
import { useCallback, useEffect, useState } from 'react';
import { useLang } from './LangContext';
import { pick } from '../../lib/i18n';

/**
 * Vessel pricing table — fed automatically from uploaded daily reports.
 * Lives on its own (the manual Pricing Ledger is hidden for now).
 */
type VesselRow = {
  id: string;
  name: string;
  status: string;
  quantityMT?: number | null;
  priced?: 'priced' | 'unpriced' | 'unknown';
  pricedQtyMT?: number | null;
  marketAvg?: string;
  whitePremiumAvg?: number | null;
  finalAvgPrice?: number | null;
  invoicePrice?: number | null;
  cargoValueUsd?: number | null;
  pricingNotes?: string;
};

const fmt = (n: number | null | undefined, d = 2): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtInt = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US');

export default function VesselPricingTable() {
  const { lang } = useLang();
  const [vessels, setVessels] = useState<VesselRow[]>([]);
  const [reportDate, setReportDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const v = await fetch('/api/vessels', { cache: 'no-store' }).then((r) => r.json());
      const rows = (Array.isArray(v.vessels) ? v.vessels : []) as VesselRow[];
      setVessels(rows.filter((x) => x.quantityMT != null || x.pricedQtyMT != null || x.finalAvgPrice != null));
    } catch { /* keep last */ }
    try {
      const rp = await fetch('/api/refined-prices', { cache: 'no-store' }).then((r) => r.json());
      setReportDate(rp?.data?.reportDate ?? null);
    } catch { /* keep last */ }
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, [load]);

  if (vessels.length === 0) return null;

  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const totQty = vessels.reduce((s, v) => s + (v.quantityMT ?? 0), 0);
  const totPriced = vessels.reduce((s, v) => s + (v.pricedQtyMT ?? 0), 0);
  const totUnpriced = Math.max(0, totQty - totPriced);
  const totValue = vessels.reduce((s, v) => s + (v.cargoValueUsd ?? 0), 0);
  const wAvg = totQty > 0 && totValue > 0 ? totValue / totQty : null;

  const badge = (v: VesselRow) => {
    const q = v.quantityMT ?? 0, p = v.pricedQtyMT ?? 0;
    if (p > 0 && p < q) return { cls: 'partial', ar: 'جزئياً', en: 'Partial' };
    if (v.priced === 'priced' || p > 0) return { cls: 'priced', ar: 'مسعرة', en: 'Priced' };
    if (v.priced === 'unpriced') return { cls: 'unpriced', ar: 'غير مسعرة', en: 'Unpriced' };
    return { cls: 'unknown', ar: 'غير محدد', en: 'Unknown' };
  };

  return (
    <section className="card pricing vessel-pricing" dir={dir}>
      <div className="pricing__vessels-head">
        <div>
          <span className="kicker">VESSEL PRICING</span>
          <h2>{pick(lang, 'تسعير البواخر', 'Vessel Pricing')}</h2>
        </div>
        <span className="pricing__vessels-src">
          {reportDate
            ? pick(lang, `من تقرير ${reportDate} — يتحدث تلقائياً مع كل تقرير`, `From report ${reportDate} — auto-updated with every upload`)
            : pick(lang, 'من التقارير اليومية المرفوعة', 'From uploaded daily reports')}
        </span>
      </div>
      <div className="pricing__tablewrap">
        <table className="pricing__table pricing__table--vessels">
          <thead>
            <tr>
              <th>{pick(lang, 'الباخرة', 'Vessel')}</th>
              <th>{pick(lang, 'التسعير', 'Pricing')}</th>
              <th>{pick(lang, 'الكمية MT', 'Qty MT')}</th>
              <th>{pick(lang, 'مسعر MT', 'Priced MT')}</th>
              <th>{pick(lang, 'غير مسعر MT', 'Unpriced MT')}</th>
              <th>{pick(lang, 'العقد/المؤشر', 'Contract')}</th>
              <th>{pick(lang, 'البريميوم $', 'Premium $')}</th>
              <th>{pick(lang, 'متوسط التسعير $', 'Avg price $')}</th>
              <th>{pick(lang, 'سعر الفاتورة $', 'Invoice $')}</th>
              <th>{pick(lang, 'القيمة US$', 'Value US$')}</th>
            </tr>
          </thead>
          <tbody>
            {vessels.map((v) => {
              const b = badge(v);
              const q = v.quantityMT ?? 0;
              // unpriced vessel without an explicit priced qty = 0 priced, all unpriced
              const p: number | null = v.pricedQtyMT ?? (v.priced === 'unpriced' ? 0 : null);
              const u = p != null ? Math.max(0, q - p) : null;
              return (
                <tr key={v.id} className="pricing__row">
                  <td className="pricing__sym" data-label={pick(lang, 'الباخرة', 'Vessel')}>{v.name}</td>
                  <td data-label={pick(lang, 'التسعير', 'Pricing')}><span className={`pricing__vbadge pricing__vbadge--${b.cls}`}>{lang === 'ar' ? b.ar : b.en}</span></td>
                  <td data-label={pick(lang, 'الكمية MT', 'Qty MT')}>{fmtInt(v.quantityMT)}</td>
                  <td data-label={pick(lang, 'مسعر MT', 'Priced MT')}>{p != null ? fmtInt(p) : '—'}</td>
                  <td data-label={pick(lang, 'غير مسعر MT', 'Unpriced MT')}>{u != null ? fmtInt(u) : '—'}</td>
                  <td data-label={pick(lang, 'العقد/المؤشر', 'Contract')}>{v.marketAvg || '—'}</td>
                  <td data-label={pick(lang, 'البريميوم $', 'Premium $')}>{fmt(v.whitePremiumAvg)}</td>
                  <td data-label={pick(lang, 'متوسط التسعير $', 'Avg price $')}>{fmt(v.finalAvgPrice)}</td>
                  <td data-label={pick(lang, 'سعر الفاتورة $', 'Invoice $')}>{fmt(v.invoicePrice)}</td>
                  <td data-label={pick(lang, 'القيمة US$', 'Value US$')}>{fmtInt(v.cargoValueUsd)}</td>
                </tr>
              );
            })}
            <tr className="pricing__row pricing__row--total">
              <td data-label={pick(lang, 'الإجمالي', 'Total')}>{pick(lang, 'الإجمالي', 'Total')}</td>
              <td />
              <td data-label={pick(lang, 'الكمية MT', 'Qty MT')}>{fmtInt(totQty)}</td>
              <td data-label={pick(lang, 'مسعر MT', 'Priced MT')}>{fmtInt(totPriced)}</td>
              <td data-label={pick(lang, 'غير مسعر MT', 'Unpriced MT')}>{fmtInt(totUnpriced)}</td>
              <td />
              <td />
              <td data-label={pick(lang, 'متوسط التسعير $', 'Avg price $')}>{fmt(wAvg)}</td>
              <td />
              <td data-label={pick(lang, 'القيمة US$', 'Value US$')}>{totValue > 0 ? fmtInt(totValue) : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
