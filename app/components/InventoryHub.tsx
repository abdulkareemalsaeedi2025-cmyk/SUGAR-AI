'use client';
import { useEffect, useState } from 'react';
import { SAMPLE_INVENTORY, coerceInventory, type InventoryData } from '../../lib/userData';
import { useLang } from './LangContext';
import { useAuth } from './AuthContext';
import { pick } from '../../lib/i18n';

const STORAGE_KEY = 'procurement-inventory-v3';
type Storage = 'server' | 'local' | 'memory' | 'unavailable';

function readLocal(): { data: InventoryData; saved: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { data: coerceInventory(parsed), saved: Boolean(parsed?.updatedAt) };
    }
  } catch { /* corrupted storage → sample */ }
  return { data: SAMPLE_INVENTORY, saved: false };
}

function writeLocal(data: InventoryData) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* private mode */ }
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

type Position = {
  totalMT: number;
  pricedMT: number;
  unpricedMT: number;
  pricedPct: number;
  unpricedPct: number;
  transitMT: number;
  forOthersMT: number;
  grossPricedMT: number;
  basis: 'vessels' | 'inventory';
};

type FieldSrc = 'report' | 'manual';
const FIELDS: { key: keyof Omit<InventoryData, 'unpriced' | 'updatedAt' | 'rawCoverageDays' | 'totalCoverageDays' | 'rawStockEndDate' | 'totalStockEndDate'>; label: string; hint: string; src: FieldSrc }[] = [
  { key: 'total', label: 'الإجمالي (MT)', hint: 'Total (MT)', src: 'report' },
  { key: 'rawSugar', label: 'سكر خام (MT)', hint: 'Raw sugar (MT)', src: 'report' },
  { key: 'refinedSugar', label: 'سكر مكرر (MT)', hint: 'Refined sugar (MT)', src: 'report' },
  { key: 'companyPriced', label: 'مسعر — شركتنا (MT)', hint: 'Priced — company (MT)', src: 'report' },
  // partner-priced = priced-for-others — ONE manual field only
  { key: 'partnerPriced', label: 'الكمية المسعرة للغير/الشريك (MT)', hint: 'Priced for others/partner (MT)', src: 'manual' },
  { key: 'dailyProductionMT', label: 'كمية الإنتاج اليومي (MT)', hint: 'Daily production (MT)', src: 'manual' },
  { key: 'monthlySalesMT', label: 'مبيعات الشهرية (MT)', hint: 'Monthly sales (MT)', src: 'manual' },
  { key: 'lastProductionDate', label: 'تاريخ آخر يوم إنتاج', hint: 'Last production date', src: 'manual' },
];

export default function InventoryHub() {
  const { lang } = useLang();
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const [data, setData] = useState<InventoryData>(SAMPLE_INVENTORY);
  const [isSample, setIsSample] = useState(true);
  const [storage, setStorage] = useState<Storage>('local');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [reportDate, setReportDate] = useState<string | null>(null);
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(() => {
    let cancelled = false;
    const local = readLocal();

    (async () => {
      // Server is authoritative when it already holds real figures.
      try {
        const r = await fetch('/api/inventory', { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          if (j?.data?.updatedAt) {
            const server = coerceInventory(j.data);
            if (!cancelled) {
              setData(server);
              setIsSample(false);
              setStorage((j.storage as Storage) ?? 'server');
              if (j.position) setPosition(j.position as Position);
            }
            writeLocal(server);
            if (!cancelled) setLoaded(true);
            return;
          }
        }
      } catch { /* offline or API down → local fallback */ }

      // No server figures yet: migrate a locally-saved copy up, else show sample.
      if (local.saved) {
        if (!cancelled) {
          setData(local.data);
          setIsSample(false);
          setStorage('local');
        }
        try {
          const r = await fetch('/api/inventory', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: local.data }),
          });
          if (r.ok && !cancelled) setStorage('server');
        } catch { /* keep local */ }
      } else if (!cancelled) {
        setData(local.data);
        setIsSample(true);
      }
      if (!cancelled) setLoaded(true);
    })();

    return () => { cancelled = true; };
  }, []);

  // Auto-refresh from the server every 60s — daily reports feed it there,
  // so the card reflects the latest SUGAR POSITION report without a reload.
  // Paused while editing; also fires immediately when the tab regains focus
  // (browsers throttle/suspend timers in background tabs).
  useEffect(() => {
    if (editing) return;
    let alive = true;
    const refresh = async () => {
      try {
        const r = await fetch('/api/inventory', { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          if (alive && j?.data?.updatedAt) {
            const server = coerceInventory(j.data);
            setData(server);
            setIsSample(false);
            setStorage((j.storage as Storage) ?? 'server');
            if (j.position) setPosition(j.position as Position);
            writeLocal(server);
          }
        }
      } catch { /* keep current view */ }
      try {
        const rp = await fetch('/api/refined-prices', { cache: 'no-store' }).then((x) => x.json());
        if (alive) setReportDate(rp?.data?.reportDate ?? null);
      } catch { /* keep last */ }
    };
    const id = setInterval(refresh, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [editing]);

  // report date label on first load too
  useEffect(() => {
    fetch('/api/refined-prices', { cache: 'no-store' })
      .then((x) => x.json())
      .then((rp) => setReportDate(rp?.data?.reportDate ?? null))
      .catch(() => { /* no report yet */ });
  }, []);

  if (!loaded) return null;

  // Total / priced / unpriced follow the vessel-pricing table method
  // (stock + cargo still en route) whenever the server provides the position;
  // otherwise fall back to the stored inventory figures (manual mode).
  // "Priced for others" = "partner priced" (same thing) — always deducted.
  const forOthersEff = data.partnerPriced ?? 0;
  const totalPriced = position
    ? position.pricedMT
    : Math.max(0, data.companyPriced + data.partnerPriced - forOthersEff);
  const unpriced = position ? position.unpricedMT : Math.max(0, data.total - totalPriced);
  const displayTotal = position ? position.totalMT : data.total;
  const pricedPct = position ? position.pricedPct : data.total > 0 ? (totalPriced / data.total) * 100 : 0;
  const unpricedPct = position ? position.unpricedPct : data.total > 0 ? (unpriced / data.total) * 100 : 0;

  const startEdit = () => {
    setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, String(data[f.key])])));
    setEditing(true);
  };

  const save = () => {
    const next: InventoryData = { ...data, updatedAt: new Date().toISOString() };
    for (const f of FIELDS) {
      const key = f.key as keyof InventoryData;
      const val = draft[key] ?? '';
      if (key === 'dailyProductionMT' || key === 'monthlySalesMT' || key === 'lastProductionDate') {
        if (key === 'lastProductionDate') {
          const d = String(val);
          if (/^\d{4}-\d{2}-\d{2}$/.test(d)) { (next as any)[key] = d; }
          else if (!isNaN(Date.parse(d))) { (next as any)[key] = new Date(d).toISOString().slice(0,10); }
        } else {
          const n = Number(String(val).replace(/[, ]/g, ''));
          (next as any)[key] = Number.isFinite(n) && n >= 0 ? n : (data as any)[key];
        }
      } else {
        const n = Number(String(val).replace(/[, ]/g, ''));
        (next as any)[key] = Number.isFinite(n) && n >= 0 ? n : (data as any)[key];
      }
    }
    // handle date fields
    if (draft['lastProductionDate']) {
      const d = draft['lastProductionDate'];
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(d) || !isNaN(Date.parse(d));
      if (ok) next.lastProductionDate = d.length === 10 ? d : new Date(d).toISOString().slice(0,10);
    }
    // auto calculate coverage — raw coverage counts raw stock PLUS cargo
    // still en route (vessels underway), same as the report-driven recompute
    const transitMT = position?.transitMT ?? 0;
    const positionTotalMT = position?.totalMT ?? 0;
    const daily = Number(next.dailyProductionMT ?? 0);
    const monthly = Number(next.monthlySalesMT ?? 0);
    const raw = Number(next.rawSugar ?? 0);
    const tot = positionTotalMT > 0 ? positionTotalMT : Number(next.total ?? 0);
    const dailySales = monthly > 0 ? monthly/30 : 0;
    if (daily > 0 && raw > 0) {
      next.rawCoverageDays = Math.round((raw + transitMT) / daily);
      const end = new Date((next.lastProductionDate||new Date().toISOString().slice(0,10)) + 'T00:00:00');
      end.setDate(end.getDate() + next.rawCoverageDays);
      next.rawStockEndDate = end.toISOString().slice(0,10);
    } else { next.rawCoverageDays = null; next.rawStockEndDate = null; }
    if (dailySales > 0 && tot > 0) {
      next.totalCoverageDays = Math.round(tot / dailySales);
      const end2 = new Date((next.lastProductionDate||new Date().toISOString().slice(0,10)) + 'T00:00:00');
      end2.setDate(end2.getDate() + next.totalCoverageDays);
      next.totalStockEndDate = end2.toISOString().slice(0,10);
    } else { next.totalCoverageDays = null; next.totalStockEndDate = null; }
    setData(next);
    setIsSample(false);
    setEditing(false);
    writeLocal(next);
    // Persist server-side so the assistant and the team share the same books.
    fetch('/api/inventory', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: next }),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (r.ok && j?.data) {
          setData(j.data);
          writeLocal(j.data);
          setStorage((j.storage as Storage) ?? 'server');
        } else {
          setStorage('local');
        }
      })
      .catch(() => setStorage('local'));
  };

  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  return (
    <article className="card inventory-compact" dir={dir}>
      <div className="cardhead">
        <div>
          <span className="kicker">INVENTORY</span>
          <h2>{pick(lang, 'المخزون', 'Inventory')}</h2>
        </div>
        <div className="inventory-compact__tools">
          {editing ? (
            <>
              <button type="button" className="inventory-compact__btn primary" onClick={save}>{pick(lang, 'حفظ', 'Save')}</button>
              <button type="button" className="inventory-compact__btn" onClick={() => setEditing(false)}>{pick(lang, 'إلغاء', 'Cancel')}</button>
            </>
          ) : (
            isAdmin && (
              <button type="button" className="inventory-compact__btn" onClick={startEdit}>{pick(lang, 'تعديل', 'Edit')}</button>
            )
          )}
        </div>
      </div>

      <div className="inventory-compact__main">
        <div className="inventory-compact__total">
          <strong>{fmt(displayTotal)}</strong>
          <span>
            {position?.basis === 'vessels'
              ? pick(lang, `MT إجمالي (شامل ${fmt(position.transitMT)} بالطريق)`, `MT total (incl. ${fmt(position.transitMT)} en route)`)
              : pick(lang, 'MT إجمالي', 'MT total')}
          </span>
        </div>
        <div className="inventory-compact__grid">
          <div className="inventory-compact__cell raw">
            <b>{fmt(data.rawSugar)}</b>
            <span>{pick(lang, 'خام', 'Raw')}</span>
          </div>
          <div className="inventory-compact__cell refined">
            <b>{fmt(data.refinedSugar)}</b>
            <span>{pick(lang, 'مكرر', 'Refined')}</span>
          </div>
          <div className="inventory-compact__cell priced">
            <b>{fmt(totalPriced)}</b>
            <span>{pick(lang, `مسعر ${pricedPct.toFixed(0)}%`, `Priced ${pricedPct.toFixed(0)}%`)}</span>
          </div>
          <div className="inventory-compact__cell unpriced">
            <b>{fmt(unpriced)}</b>
            <span>{pick(lang, `غير مسعر ${unpricedPct.toFixed(0)}%`, `Unpriced ${unpricedPct.toFixed(0)}%`)}</span>
          </div>
          <div className="inventory-compact__cell others">
            <b>{(position?.forOthersMT ?? forOthersEff) > 0 ? fmt(position?.forOthersMT ?? forOthersEff) : '—'}</b>
            <span>{pick(lang, 'مسعر للغير/الشريك (يُخصم)', 'For others/partner (deducted)')}</span>
          </div>
          <div className="inventory-compact__cell">
            <b>{data.dailyProductionMT != null ? fmt(data.dailyProductionMT) : '—'}</b>
            <span>{pick(lang, 'إنتاج يومي (MT)', 'Daily prod. (MT)')}</span>
          </div>
          <div className="inventory-compact__cell">
            <b>{data.monthlySalesMT != null ? fmt(data.monthlySalesMT) : '—'}</b>
            <span>{pick(lang, 'مبيعات شهرية (MT)', 'Monthly sales (MT)')}</span>
          </div>
          <div className="inventory-compact__cell">
            <b>{data.rawCoverageDays != null ? data.rawCoverageDays : '—'}</b>
            <span>{pick(lang, 'كفاية خام+الطريق (أيام)', 'Raw+route coverage (days)')}</span>
          </div>
          <div className="inventory-compact__cell">
            <b>{data.totalCoverageDays != null ? data.totalCoverageDays : '—'}</b>
            <span>{pick(lang, 'كفاية إجمالي/مبيعات (أيام)', 'Total/sales (days)')}</span>
          </div>
        </div>
      </div>

      {/* priced vs unpriced ratio bar */}
      <div
        className="inventory-compact__bar"
        title={pick(lang, `مسعر ${pricedPct.toFixed(0)}% — غير مسعر ${unpricedPct.toFixed(0)}%`, `Priced ${pricedPct.toFixed(0)}% — unpriced ${unpricedPct.toFixed(0)}%`)}
      >
        <i className="b-priced" style={{ width: `${pricedPct}%` }} />
        <i className="b-unpriced" style={{ width: `${unpricedPct}%` }} />
      </div>

      {isSample && !editing && (
        <span className="inventory-compact__badge">
          {pick(lang, 'قيم افتراضية للتجربة — اضغط «تعديل» لإدخال بيانات الشركة الحقيقية', 'Sample values for testing — press "Edit" to enter real company data')}
        </span>
      )}

      {!isSample && !editing && storage !== 'server' && (
        <span className="inventory-compact__badge">
          {pick(lang, 'محفوظ محلياً في هذا المتصفح — سيتم المزامنة مع الخادم عند توفّره', 'Saved locally in this browser — will sync to the server when available')}
        </span>
      )}

      {!editing && reportDate && (
        <span className="inventory-compact__badge inventory-compact__badge--report">
          {pick(lang, `محدَّث تلقائياً من تقرير SUGAR POSITION بتاريخ ${reportDate} — الحقول اليدوية (الإنتاج/المبيعات) عبر «تعديل»`, `Auto-updated from SUGAR POSITION report dated ${reportDate} — manual fields (production/sales) via "Edit"`)}
        </span>
      )}

      {!editing && (
        <div className="inventory-compact__cover">
          {data.rawStockEndDate && <span>{pick(lang, 'نهاية مخزون الخام', 'Raw stock ends')}: {data.rawStockEndDate}</span>}
          {data.totalStockEndDate && <span>{pick(lang, 'نهاية المخزون الكلي حسب المبيعات', 'Total stock ends by sales')}: {data.totalStockEndDate}</span>}
          {data.lastProductionDate && <span>{pick(lang, 'آخر يوم إنتاج', 'Last production date')}: {data.lastProductionDate}</span>}
        </div>
      )}

      {editing && (
        <div className="inventory-compact__form">
          {FIELDS.map((f) => (
            <label className="inventory-compact__field" key={f.key}>
              <span>
                {pick(lang, f.label, f.hint)}
                <em className={`inventory-compact__src inventory-compact__src--${f.src}`}>
                  {f.src === 'report' ? pick(lang, 'من التقرير', 'report') : pick(lang, 'يدوي', 'manual')}
                </em>
              </span>
              <input
                type={f.key === 'lastProductionDate' ? 'date' : 'text'}
                inputMode={f.key === 'lastProductionDate' ? undefined : 'numeric'}
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((p) => ({ ...p, [f.key]: e.target.value }))}
              />
            </label>
          ))}
          <div className="inventory-compact__form-actions">
            <span className="inventory-compact__hint">
              {pick(lang, 'حقول «من التقرير» تُستبدل تلقائياً عند رفع تقرير جديد — حقول «يدوي» تبقى كما تدخلها. كفاية المخزون تُحسب تلقائياً: الخام = خام/إنتاج يومي، الإجمالي/مبيعات = إجمالي/(مبيعات شهرية/30)', '"Report" fields are replaced automatically when a new report is uploaded — "manual" fields stay as you enter them. Coverage auto: raw = raw/daily, total/sales = total/(monthly/30)')}
            </span>
          </div>
        </div>
      )}
    </article>
  );
}