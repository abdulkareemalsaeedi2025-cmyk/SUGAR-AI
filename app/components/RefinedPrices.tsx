'use client';
import { useCallback, useEffect, useState } from 'react';
import { useLang } from './LangContext';
import { pick } from '../../lib/i18n';

type RefinedPrice = { group: 'container' | 'breakbulk' | 'basis' | 'replacement'; label: string; value: number; note?: string };
type Feed = { at: string; reportDate: string | null; items: RefinedPrice[] } | null;

const ORIGINS = ['Egyptian 45s', 'Indian/ME 45s', 'Brazilian 150s'] as const;

export default function RefinedPrices() {
  const { lang } = useLang();
  const [feed, setFeed] = useState<Feed>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const j = await fetch('/api/refined-prices', { cache: 'no-store' }).then((r) => r.json());
      setFeed(j.data ?? null);
    } catch { /* keep last */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, [load]);

  const items = feed?.items ?? [];
  const containers = items.filter((i) => i.group === 'container');
  const breakbulk = items.filter((i) => i.group === 'breakbulk');
  const replacement = items.filter((i) => i.group === 'replacement');

  // container table: rows = "MONTH · PORT" (row 1 = Hodeidah, row 2 = Aden), cols = origins
  const contRows: { key: string; note?: string; vals: (number | null)[] }[] = [];
  for (const p of containers) {
    const m = p.label.match(/^([A-Z]+)\s+(.+?)\s+containers CFR\s+(Hodeidah|Aden)$/);
    if (!m) continue;
    const portAr = m[3] === 'Hodeidah' ? 'الحديدة' : 'عدن';
    const key = `${m[1]} · ${lang === 'ar' ? portAr : m[3]}`;
    let row = contRows.find((r) => r.key === key);
    if (!row) { row = { key, note: p.note, vals: [null, null, null] }; contRows.push(row); }
    const ci = ORIGINS.findIndex((o) => m[2] === o);
    if (ci >= 0) row.vals[ci] = p.value;
    if (p.note) row.note = p.note;
  }

  // NOTE: the basis/shipping premium table was removed per owner request.

  const usd = (v: number | null) => (v === null ? '—' : `$${v.toFixed(2)}`);

  // Report labels arrive in English (grade/origin names stay as-is); translate
  // only the structural market terms for the Arabic view.
  const labelTxt = (s: string) =>
    lang === 'ar'
      ? s
          .replace(/break-bulk CFR ADEN/gi, 'كسر bulk CFR عدن')
          .replace(/white premium/gi, 'البريميوم الأبيض')
          .replace(/replacement ref/gi, 'مرجع استبدال')
      : s;

  return (
    <section className="vessel-compact refined-prices">
      <div className="vessel-compact__head">
        <div>
          <h2>{pick(lang, 'أسعار السكر الجاهز (CFR)', 'Refined Sugar Prices (CFR)')}</h2>
          <p className="vessel-compact__sub">
            {feed
              ? pick(lang, `من تقرير بتاريخ ${feed.reportDate ?? '—'} · تحديث تلقائي مع كل تقرير مرفوع`, `From report dated ${feed.reportDate ?? '—'} · auto-updated with every upload`)
              : pick(lang, 'تُسحب تلقائياً من التقارير اليومية المرفوعة', 'Pulled automatically from uploaded daily reports')}
          </p>
        </div>
        <div className="vessel-compact__headtools">
          <button type="button" className="vessel-compact__btn" onClick={load} disabled={loading}>
            {loading ? '…' : pick(lang, 'تحديث', 'Refresh')}
          </button>
        </div>
      </div>

      {!feed && !loading && (
        <div className="vessel-compact__empty">
          {pick(lang, 'لا توجد أسعار بعد — ارفع التقرير اليومي لسحب الأسعار تلقائياً', 'No prices yet — upload the daily report to pull prices automatically')}
        </div>
      )}

      {contRows.length > 0 && (
        <div className="refined-prices__block">
          <h3>{pick(lang, 'حاويات CFR', 'Containers CFR')}</h3>
          <table className="refined-prices__table">
            <thead>
              <tr>
                <th>{pick(lang, 'الشهر', 'Month')}</th>
                {ORIGINS.map((o) => <th key={o}>{o}</th>)}
                <th>{pick(lang, 'أساس', 'Basis')}</th>
              </tr>
            </thead>
            <tbody>
              {contRows.map((r) => (
                <tr key={r.key}>
                  <td>{r.key}</td>
                  {r.vals.map((v, i) => <td key={i} className="num">{usd(v)}</td>)}
                  <td className="dim">{r.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="refined-prices__cols">
        {(breakbulk.length > 0 || replacement.length > 0) && (
          <div className="refined-prices__block">
            <h3>{pick(lang, 'bulk CFR عدن + قيم مرجعية', 'Bulk CFR Aden + reference')}</h3>
            <ul className="refined-prices__list">
              {breakbulk.map((p, i) => (
                <li key={`b${i}`}><span>{labelTxt(p.label)}</span><b>{usd(p.value)}</b></li>
              ))}
              {replacement.map((p, i) => (
                <li key={`r${i}`}><span>{labelTxt(p.label)}</span><b>{usd(p.value)}</b></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
