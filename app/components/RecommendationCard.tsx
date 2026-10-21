'use client';
import { useCallback, useEffect, useState } from 'react';
import { useLang } from './LangContext';
import { useAuth } from './AuthContext';
import { pick } from '../../lib/i18n';

type Plan = {
  supply: {
    available: boolean;
    coverageStockDays: number | null;
    coverageTotalDays: number | null;
    transitQtyMT: number;
    stockoutISO: string | null;
    orderDeadlineISO: string | null;
    daysToDeadline: number | null;
    recommendedQtyMT: number | null;
    urgency: 'critical' | 'urgent' | 'soon' | 'ok' | 'unknown';
    timeline: { date: string; name: string; qtyMT: number; balanceAfterMT: number }[];
  };
  pricing: {
    positionTotalMT: number;
    pricedTotalMT: number;
    pricedPct: number;
    targetPct: number;
    gapQtyMT: number;
    avgPricedCLb: number | null;
    nyRefCLb: number | null;
    vsBookPct: number | null;
    favorable: boolean | null;
    ceilingCLb: number | null;
    tranches: { pct: number; qtyMT: number; triggerCLb: number | null; note: 'now' | 'limit1' | 'limit2' }[];
    action: 'price_now' | 'price_partial_wait' | 'wait_dip' | 'target_met' | 'no_data';
  };
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
};
type Resp = { ok: boolean; input?: { dailyProductionMT: number | null; reportDate: string | null }; plan?: Plan };

const fmt0 = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const fmt2 = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2));

export default function RecommendationCard() {
  const { lang } = useLang();
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const [resp, setResp] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [prodInput, setProdInput] = useState('');
  const [savingProd, setSavingProd] = useState(false);

  const load = useCallback(async () => {
    try {
      const j = await fetch('/api/procurement', { cache: 'no-store' }).then((r) => r.json());
      setResp(j);
    } catch { /* keep last */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  const saveProduction = async () => {
    const n = Number(prodInput.replace(/[, ]/g, ''));
    if (!Number.isFinite(n) || n <= 0) return;
    setSavingProd(true);
    try {
      const cur = await fetch('/api/inventory', { cache: 'no-store' }).then((r) => r.json());
      await fetch('/api/inventory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { ...cur.data, dailyProductionMT: n } }),
      });
      setProdInput('');
      await load();
    } catch { /* ignore */ }
    setSavingProd(false);
  };

  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const plan = resp?.plan;
  const s = plan?.supply;
  const p = plan?.pricing;
  const noProd = resp?.input?.dailyProductionMT == null;

  const urg = s?.urgency ?? 'unknown';
  const urgTxt: Record<string, { ar: string; en: string }> = {
    critical: { ar: 'حرج — توقف وشيك!', en: 'CRITICAL — stockout imminent' },
    urgent: { ar: 'عاجل — اطلب الآن', en: 'URGENT — order now' },
    soon: { ar: 'قريب — جهّز الطلب', en: 'Soon — prepare order' },
    ok: { ar: 'آمن حالياً', en: 'Covered for now' },
    unknown: { ar: '—', en: '—' },
  };
  const actTxt: Record<string, { ar: string; en: string }> = {
    price_now: { ar: 'سعّر الشريحة الأولى الآن — السوق تحت دفترك (فرصة)', en: 'Price the first tranche NOW — market below your book (opportunity)' },
    price_partial_wait: { ar: 'سعّر شريحة صغيرة واترك الباقي بحدود معلقة', en: 'Price a small tranche, leave the rest as resting limits' },
    wait_dip: { ar: 'انتظر الهبوط — لا تسعّر فوق دفترك', en: 'Wait for a dip — do not price above your book' },
    target_met: { ar: 'هدف 50% محقق — لا حاجة لتسعير إضافي', en: '50% target met — no additional pricing needed' },
    no_data: { ar: 'لا يوجد سعر مرجعي بعد', en: 'No reference price yet' },
  };

  return (
    <section className="card rec-card" dir={dir}>
      <div className="cardhead">
        <div>
          <span className="kicker">PROCUREMENT ENGINE</span>
          <h2>{pick(lang, 'مقترح الشراء والتثبيت', 'Purchase & Pricing Recommendation')}</h2>
        </div>
        {plan && (
          <span className={`rec__conf rec__conf--${plan.confidence}`}>
            {pick(lang, 'الثقة', 'Confidence')}: {plan.confidence === 'high' ? pick(lang, 'عالية', 'High') : plan.confidence === 'medium' ? pick(lang, 'متوسطة', 'Medium') : pick(lang, 'منخفضة', 'Low')}
            {resp?.input?.reportDate ? ` · ${pick(lang, 'تقرير', 'report')} ${resp.input.reportDate}` : ''}
          </span>
        )}
      </div>

      {loading && <div className="rec__block dim">{pick(lang, 'جارِ الحساب…', 'computing…')}</div>}

      {plan && s && p && (
        <>
          {/* ============ SUPPLY — production continuity ============ */}
          <div className="rec__block">
            <div className="rec__blockhead">
              <h3>{pick(lang, 'التوريد — استمرارية الإنتاج (إمداد 90 يوم)', 'Supply — production continuity (90-day lead)')}</h3>
              <span className={`rec__urg rec__urg--${urg}`}>{lang === 'ar' ? urgTxt[urg].ar : urgTxt[urg].en}</span>
            </div>

            {noProd && isAdmin && (
              <div className="rec__prodentry">
                <span>{pick(lang, 'أدخل الإنتاج اليومي لتفعيل التنبؤ الدقيق بانتهاء الخام:', 'Enter daily production to activate the precise raw-stockout forecast:')}</span>
                <input
                  inputMode="numeric"
                  placeholder={pick(lang, 'مثال 1500 MT/يوم', 'e.g. 1500 MT/day')}
                  value={prodInput}
                  onChange={(e) => setProdInput(e.target.value)}
                />
                <button type="button" onClick={saveProduction} disabled={savingProd}>
                  {savingProd ? '…' : pick(lang, 'حفظ وحساب', 'Save & compute')}
                </button>
              </div>
            )}

            {s.available ? (
              <div className="rec__grid">
                <div className="rec__cell">
                  <span>{pick(lang, 'كفاية الخام — المخزون فقط', 'Raw coverage — stock only')}</span>
                  <b>{s.coverageStockDays} {pick(lang, 'يوم', 'days')}</b>
                </div>
                <div className="rec__cell">
                  <span>{pick(lang, 'مع الكميات بالطريق', 'incl. cargo en route')} ({fmt0(s.transitQtyMT)} MT)</span>
                  <b>{s.coverageTotalDays} {pick(lang, 'يوم', 'days')}</b>
                </div>
                <div className="rec__cell">
                  <span>{pick(lang, 'ينفد الخام في', 'Raw runs out')}</span>
                  <b>{s.stockoutISO}</b>
                </div>
                <div className={`rec__cell ${s.daysToDeadline != null && s.daysToDeadline <= 0 ? 'rec__cell--alert' : ''}`}>
                  <span>{pick(lang, 'آخر موعد لأمر الشراء', 'Order deadline')} (−90 {pick(lang, 'يوم', 'd')})</span>
                  <b>{s.orderDeadlineISO}</b>
                  {s.daysToDeadline != null && (
                    <small>{s.daysToDeadline <= 0 ? pick(lang, 'فات الموعد — اطلب فوراً', 'overdue — order now') : pick(lang, `متبقٍ ${s.daysToDeadline} يوم`, `${s.daysToDeadline} days left`)}</small>
                  )}
                </div>
                <div className="rec__cell rec__cell--action">
                  <span>{pick(lang, 'الكمية المقترح طلبها (باخرة قياسية)', 'Recommended order qty (standard vessel)')}</span>
                  <b>{fmt0(s.recommendedQtyMT)} MT</b>
                  <small>{pick(lang, 'دفعة واحدة ثابتة — كرر الطلب حسب الحاجة', 'fixed single lot — repeat as needed')}</small>
                </div>
              </div>
            ) : (
              !noProd && <div className="dim">{pick(lang, 'لا يمكن الحساب بدون الإنتاج اليومي', 'Cannot compute without daily production')}</div>
            )}

            {s.timeline.length > 0 && (
              <div className="rec__timeline">
                {s.timeline.map((ev, i) => (
                  <div key={i} className="rec__event">
                    <span className="rec__event-date">{ev.date}</span>
                    <span className="rec__event-name">{pick(lang, 'وصول', 'arrival')} {ev.name}</span>
                    <span className="rec__event-qty">+{fmt0(ev.qtyMT)} MT</span>
                    <span className="rec__event-bal">{pick(lang, 'الرصيد بعدها', 'balance')} ≈ {fmt0(ev.balanceAfterMT)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ============ PRICING — 50% target, opportunistic ============ */}
          <div className="rec__block">
            <div className="rec__blockhead">
              <h3>{pick(lang, 'التسعير — هدف 50% من المركز الكلي', 'Pricing — 50% of total position target')}</h3>
              <span className={`rec__action rec__action--${p.action}`}>{lang === 'ar' ? actTxt[p.action].ar : actTxt[p.action].en}</span>
            </div>

            <div className="rec__grid">
              <div className="rec__cell">
                <span>{pick(lang, 'المركز الكلي (مخزون + طريق)', 'Total position (stock + transit)')}</span>
                <b>{fmt0(p.positionTotalMT)} MT</b>
              </div>
              <div className="rec__cell">
                <span>{pick(lang, 'مسعر حالياً', 'Priced now')}</span>
                <b>{fmt0(p.pricedTotalMT)} MT <small>({p.pricedPct.toFixed(1)}%)</small></b>
              </div>
              <div className={`rec__cell ${p.gapQtyMT > 0 ? 'rec__cell--alert' : ''}`}>
                <span>{pick(lang, 'فجوة الهدف 50%', 'Gap to 50% target')}</span>
                <b>{p.gapQtyMT > 0 ? `${fmt0(p.gapQtyMT)} MT` : pick(lang, 'محقق ✓', 'Met ✓')}</b>
              </div>
              <div className="rec__cell">
                <span>NY {pick(lang, 'الآن', 'now')} / {pick(lang, 'دفترك', 'your book')}</span>
                <b>{fmt2(p.nyRefCLb)}¢ / {fmt2(p.avgPricedCLb)}¢</b>
                {p.vsBookPct != null && (
                  <small className={p.vsBookPct <= 0 ? 'up' : 'dn'}>
                    {p.vsBookPct <= 0 ? '' : '+'}{p.vsBookPct.toFixed(1)}% {p.vsBookPct <= 0 ? pick(lang, 'فرصة', 'opportunity') : pick(lang, 'فوق الدفتر', 'above book')}
                  </small>
                )}
              </div>
            </div>

            {p.tranches.length > 0 && (
              <div className="rec__tranches">
                {p.tranches.map((t, i) => (
                  <div key={i} className={`rec__tranche rec__tranche--${t.note}`}>
                    <b>{t.pct}% · {fmt0(t.qtyMT)} MT</b>
                    <span>
                      {t.note === 'now'
                        ? pick(lang, 'بالسوق الآن', 'at market now')
                        : pick(lang, `حد معلق @ ${fmt2(t.triggerCLb)}¢`, `resting limit @ ${fmt2(t.triggerCLb)}¢`)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {p.ceilingCLb != null && p.gapQtyMT > 0 && (
              <div className="rec__ceiling">
                {pick(lang, `قاعدة المرونة: لا تسعّر فوق ${fmt2(p.ceilingCLb)}¢ (متوسط دفترك) إلا للضرورة — اقتنص الهبوط`, `Flexibility rule: never price above ${fmt2(p.ceilingCLb)}¢ (your book avg) unless forced — seize the dips`)}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
