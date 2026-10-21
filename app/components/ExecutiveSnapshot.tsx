'use client';
import { useEffect, useState } from 'react';
import type { LondonData } from './LondonSugarCard';
import { useLang } from './LangContext';
import { pick } from '../../lib/i18n';

type Rec = {
  net: number;
  actionAr: string;
  action: string;
  confidence: number;
  confidenceAr: string;
} | null;

type Inventory = { total: number; companyPriced: number; partnerPriced: number };

/** Mirrors the sample shown by InventoryHub until the user saves real figures. */
const SAMPLE_INV: Inventory = { total: 120000, companyPriced: 50000, partnerPriced: 34000 };
const SAMPLE_SHIPS = 2;

type Props = {
  ny: { label: string; last: number | null; change: number | null; changePct: number | null } | null;
  london: LondonData | null;
};

const NY_TONNE_FACTOR = 22.0462; // 1 lb = 0.45359237 kg → 1 MT = 2204.62262 lb

const T = {
  ar: {
    ny: 'سكر خام NY #11',
    london: 'سكر أبيض لندن #5',
    premium: 'White Premium',
    inventory: 'إجمالي المخزون',
    netPricedQty: 'الكمية المسعرة النهائية',
    netPricedNote: 'صافي المسعر بعد خصم مسعر الغير/الشريك',
    priced: 'نسبة التسعير',
    unpricedTxt: 'غير مسعر',
    ships: 'سفن قيد الملاحة',
    bias: 'اتجاه السوق',
    na: 'غير متاح',
    noPrice: 'بلا سعر',
    hint: 'أول ما يراه المدير — محدَّث تلقائياً',
    sample: 'قيم افتراضية — أدخل بياناتك الحقيقية',
    shipsSample: 'قائمة افتراضية',
    biasWords: { bullish: 'صاعد', bearish: 'هابط', neutral: 'محايد' },
    confidence: 'الثقة',
  },
  en: {
    ny: 'Raw Sugar NY #11',
    london: 'White Sugar London #5',
    premium: 'White Premium',
    inventory: 'Total Inventory',
    netPricedQty: 'Net Priced Quantity',
    netPricedNote: 'Net priced after for-others/partner deduction',
    priced: 'Pricing Coverage',
    unpricedTxt: 'unpriced',
    ships: 'Vessels Afloat',
    bias: 'Market Bias',
    na: 'N/A',
    noPrice: 'no price',
    hint: 'First thing the executive sees — auto-updated',
    sample: 'sample values — enter your real data',
    shipsSample: 'sample list',
    biasWords: { bullish: 'BULLISH', bearish: 'BEARISH', neutral: 'NEUTRAL' },
    confidence: 'confidence',
  },
} as const;

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt0 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

const ACTION_EN: Record<string, string> = {
  buy_now: 'Buy now',
  buy_gradual: 'Gradual buying',
  hold: 'Hold',
  wait: 'Wait',
  avoid: 'Avoid',
};

type ReportRefs = {
  reportDate: string | null;
  londonFront: { contract: string; usdMt: number } | null;
  nyFront: { contract: string; cLb: number; usdMt: number } | null;
  whitePremium: { value: number; period: string } | null;
} | null;

export default function ExecutiveSnapshot({ ny, london }: Props) {
  const { lang } = useLang();
  const t = T[lang];
  const [inv, setInv] = useState<Inventory | null>(null);
  const [ships, setShips] = useState<number | null>(null);
  const [sample, setSample] = useState(false);
  const [rec, setRec] = useState<Rec>(null);
  const [refs, setRefs] = useState<ReportRefs>(null);

  // Latest market references extracted from uploaded daily reports —
  // used for London #5 / White Premium when the live feed is unavailable.
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const j = await fetch('/api/refined-prices', { cache: 'no-store' }).then((r) => r.json());
        if (alive && j?.data) {
          setRefs({
            reportDate: j.data.reportDate ?? null,
            londonFront: j.data.londonFront ?? null,
            nyFront: j.data.nyFront ?? null,
            whitePremium: j.data.whitePremium ?? null,
          });
        }
      } catch { /* keep last refs */ }
    };
    pull();
    const id = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    const read = async () => {
      let sawInv = false;
      let sawShips = false;
      // Server first — daily reports feed it, so it is the freshest source.
      try {
        const j = await fetch('/api/inventory', { cache: 'no-store' }).then((r) => r.json());
        if (j?.data && !j.isSample) {
          // position (stock + en route, vessel-pricing method) wins when present
          if (j.position && typeof j.position.totalMT === 'number') {
            setInv({
              total: j.position.totalMT,
              companyPriced: j.position.pricedMT,
              partnerPriced: 0,
            });
          } else {
            setInv({
              total: Number(j.data.total) || 0,
              companyPriced: Number(j.data.companyPriced) || 0,
              partnerPriced: Number(j.data.partnerPriced) || 0,
            });
          }
          sawInv = true;
        }
      } catch { /* server unreachable → local fallbacks below */ }
      if (!sawInv) {
        try {
          const raw = localStorage.getItem('procurement-inventory-v3');
          if (raw) {
            const p = JSON.parse(raw);
            // partner-priced = priced-for-others (same thing) → deducted once
            const forOthers = Number(p.pricedForOthersMT ?? p.partnerPriced) || 0;
            setInv({
              total: Number(p.total) || 0,
              companyPriced: Math.max(0, (Number(p.companyPriced) || 0) + (Number(p.partnerPriced) || 0) - forOthers),
              partnerPriced: 0,
            });
            sawInv = true;
          }
        } catch { /* storage unavailable */ }
      }
      try {
        const vj = await fetch('/api/vessels', { cache: 'no-store' }).then((r) => r.json());
        // Count ONLY cargo still under shipment (underway, not yet arrived).
        // Arrived/anchored vessels and those past the 30-day tracking window
        // are excluded — same basis as the position's transit figure.
        const inTransit = (vj?.vessels ?? []).filter((v: { arrivedAt?: string | null; etaAt?: string | null; status?: string }) => {
          if (v.arrivedAt) return false;
          if (v.status && v.status !== 'قيد الملاحة') return false;
          const eta = v.etaAt ? new Date(v.etaAt).getTime() : NaN;
          if (Number.isFinite(eta) && Date.now() - eta > 30 * 864e5) return false;
          return true;
        });
        if (Array.isArray(vj?.vessels) && vj.vessels.length) { setShips(inTransit.length); sawShips = true; }
      } catch { /* fall through to local */ }
      if (!sawShips) {
        try {
          const v = localStorage.getItem('vessel-tracker-data');
          if (v) {
            const list = JSON.parse(v);
            if (Array.isArray(list)) {
              const inTransit = list.filter((x: { arrivedAt?: string | null; etaAt?: string | null; status?: string }) => {
                if (x.arrivedAt) return false;
                if (x.status && x.status !== 'قيد الملاحة') return false;
                const eta = x.etaAt ? new Date(x.etaAt).getTime() : NaN;
                if (Number.isFinite(eta) && Date.now() - eta > 30 * 864e5) return false;
                return true;
              });
              setShips(inTransit.length); sawShips = true;
            }
          }
        } catch { /* storage unavailable */ }
      }
      // Same fallback the cards below display — flagged as sample, never as real data.
      if (!sawInv) setInv(SAMPLE_INV);
      if (!sawShips) setShips(SAMPLE_SHIPS);
      setSample(!sawInv || !sawShips);
    };
    read();
    const id = setInterval(read, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await fetch('/api/recommend', { cache: 'no-store' });
        const j = await r.json();
        if (alive && j?.recommendation) setRec(j.recommendation);
      } catch { /* bias stays on last reading */ }
    };
    pull();
    const id = setInterval(pull, 120_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const nyLast = ny?.last ?? null;
  const londonLive = london?.last ?? null;
  // Fallback hierarchy for London #5: live feed → latest uploaded report
  const londonLast = londonLive ?? refs?.londonFront?.usdMt ?? null;
  const londonFromReport = londonLive == null && refs?.londonFront != null;
  const nyInTonne = nyLast != null ? nyLast * NY_TONNE_FACTOR : null;
  // White Premium: live computation first, then the report's own spread value
  const premiumLive = londonLive != null && nyInTonne != null ? londonLive - nyInTonne : null;
  const premium = premiumLive ?? refs?.whitePremium?.value ?? null;
  const premiumFromReport = premiumLive == null && refs?.whitePremium != null;
  const reportTag = refs?.reportDate
    ? (lang === 'ar' ? `تقرير ${refs.reportDate}` : `report ${refs.reportDate}`)
    : null;

  const totalPriced = inv ? inv.companyPriced + inv.partnerPriced : 0;
  const pricedPct = inv && inv.total > 0 ? (totalPriced / inv.total) * 100 : null;
  const unpricedPct = pricedPct != null ? 100 - pricedPct : null;

  const biasKey: 'bullish' | 'bearish' | 'neutral' =
    rec == null ? 'neutral' : rec.net >= 20 ? 'bullish' : rec.net <= -20 ? 'bearish' : 'neutral';
  const biasClass = biasKey === 'bullish' ? 'up' : biasKey === 'bearish' ? 'dn' : 'flat';

  const nyUp = (ny?.change ?? 0) >= 0;

  return (
    <section className="card exec" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="cardhead">
        <div>
          <span className="kicker">EXECUTIVE DECISION PANEL</span>
          <h2>{lang === 'ar' ? 'ملخص القرار التنفيذي' : 'Executive Market Snapshot'}</h2>
        </div>
        <span className="exec__hint">{t.hint}</span>
      </div>

      <div className="exec__grid">
        {/* NY #11 */}
        <article className="exec__cell">
          <span className="exec__k">{t.ny}</span>
          <strong className="exec__v">
            {nyLast != null ? fmt(nyLast) : '—'}
            <small>¢/lb</small>
          </strong>
          <span className={`exec__d ${nyUp ? 'up' : 'dn'}`}>
            {nyLast == null
              ? t.noPrice
              : `${ny?.change != null && ny.change > 0 ? '+' : ''}${fmt(ny?.change ?? 0)} (${fmt(ny?.changePct ?? 0)}%)`}
          </span>
          <span className="exec__note">{ny?.label ?? '—'}</span>
        </article>

        {/* London #5 */}
        <article className="exec__cell">
          <span className="exec__k">{t.london}</span>
          <strong className="exec__v">
            {londonLast != null ? fmt(londonLast) : '—'}
            <small>{londonLast != null ? '$/MT' : ''}</small>
          </strong>
          <span className={`exec__d ${londonLive != null ? ((london?.change ?? 0) >= 0 ? 'up' : 'dn') : 'flat'}`}>
            {londonLast == null
              ? t.na
              : londonFromReport
                ? (refs?.londonFront?.contract ?? '')
                : `${london?.change != null && london.change > 0 ? '+' : ''}${fmt(london?.change ?? 0)} (${fmt(london?.changePct ?? 0)}%)`}
          </span>
          <span className="exec__note">
            {londonFromReport ? reportTag : (london?.source ?? t.na)}
          </span>
        </article>

        {/* White Premium */}
        <article className="exec__cell">
          <span className="exec__k">{t.premium}</span>
          <strong className="exec__v">
            {premium != null ? fmt(premium) : '—'}
            <small>{premium != null ? '$/MT' : ''}</small>
          </strong>
          <span className="exec__d flat">
            {premium == null
              ? t.na
              : premiumFromReport
                ? (refs?.whitePremium?.period ?? reportTag ?? '')
                : lang === 'ar' ? 'لندن #5 − NY #11 محوَّل' : 'London #5 − NY #11 converted'}
          </span>
          <span className="exec__note">
            {premiumFromReport ? reportTag : nyInTonne != null ? `NY = ${fmt(nyInTonne)} $/MT` : t.na}
          </span>
        </article>

        {/* Inventory */}
        <article className="exec__cell">
          <span className="exec__k">{t.inventory}</span>
          <strong className="exec__v">
            {inv ? fmt0(inv.total) : '—'}
            <small>MT</small>
          </strong>
          <span className="exec__d flat">
            {inv ? `${fmt0(totalPriced)} MT ${lang === 'ar' ? 'مسعر' : 'priced'}` : t.na}
          </span>
          <span className="exec__note">
            {sample
              ? t.sample
              : inv ? `${fmt0(Math.max(0, inv.total - totalPriced))} MT ${t.unpricedTxt}` : t.na}
          </span>
        </article>

        {/* Net priced quantity (before the pricing-coverage cell) */}
        <article className="exec__cell exec__cell--netpriced">
          <span className="exec__k">{t.netPricedQty}</span>
          <strong className="exec__v">
            {inv ? fmt0(totalPriced) : '—'}
            <small>MT</small>
          </strong>
          <span className="exec__d flat">
            {inv ? pick(lang, `من إجمالي ${fmt0(inv.total)} MT`, `of ${fmt0(inv.total)} MT total`) : t.na}
          </span>
          <span className="exec__note">{t.netPricedNote}</span>
        </article>

        {/* Pricing coverage */}
        <article className="exec__cell">
          <span className="exec__k">{t.priced}</span>
          <strong className="exec__v">
            {pricedPct != null ? `${pricedPct.toFixed(0)}%` : '—'}
          </strong>
          <span className="exec__d flat">
            {unpricedPct != null ? `${unpricedPct.toFixed(0)}% ${t.unpricedTxt}` : t.na}
          </span>
          <span className="exec__note">{sample ? t.sample : '—'}</span>
          <span className="inventory-compact__bar exec__bar">
            <i className="b-priced" style={{ width: `${pricedPct ?? 0}%` }} />
            <i className="b-unpriced" style={{ width: `${unpricedPct ?? 0}%` }} />
          </span>
        </article>

        {/* Vessels */}
        <article className="exec__cell">
          <span className="exec__k">{t.ships}</span>
          <strong className="exec__v">{ships != null ? ships : '—'}</strong>
          <span className="exec__d flat">
            {ships === null
              ? t.na
              : sample ? t.shipsSample : lang === 'ar' ? 'مسجلة يدوياً' : 'manually tracked'}
          </span>
          <span className="exec__note">AIS: {lang === 'ar' ? 'غير متصل' : 'not connected'}</span>
        </article>

        {/* Market bias */}
        <article className="exec__cell">
          <span className="exec__k">{t.bias}</span>
          <strong className={`exec__v ${biasClass}`}>{t.biasWords[biasKey]}</strong>
          <span className={`exec__d ${biasClass}`}>
            {rec
              ? `${lang === 'ar' ? rec.actionAr : (ACTION_EN[rec.action] ?? rec.action)} · ${rec.confidence}%`
              : lang === 'ar' ? 'جارِ الحساب…' : 'computing…'}
          </span>
          <span className="exec__note">
            {rec
              ? lang === 'ar'
                ? `${t.confidence}: ${rec.confidenceAr}`
                : `${t.confidence}: ${rec.confidence}%`
              : t.na}
          </span>
        </article>
      </div>
    </section>
  );
}
