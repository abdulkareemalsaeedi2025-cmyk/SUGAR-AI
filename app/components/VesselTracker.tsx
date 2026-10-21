'use client';
import { useEffect, useState } from 'react';
import VesselMap from './VesselMap';
import { DEFAULT_VESSELS, coerceVessels, type Vessel } from '../../lib/userData';
import { useLang } from './LangContext';
import { useAuth } from './AuthContext';
import { ago, pick } from '../../lib/i18n';

const STORAGE_KEY = 'vessel-tracker-data';
type Storage = 'server' | 'local' | 'memory' | 'unavailable';

type AisShip = {
  vesselId?: string;
  imo?: string;
  mmsi?: string;
  lat: number;
  lng: number;
  speedKn?: number | null;
  headingDeg?: number | null;
  dest?: string;
  eta?: string;
  at?: string | null;
};
type AisState = { live: boolean; message: string; ships: AisShip[]; at: string | null };

const STATUS_OPTIONS = ['قيد الملاحة', 'راسية', 'قيد التحميل', 'في الانتظار'];

/** Vessels drop off the tracking list one month after their arrival date —
 *  their cargo lives on in stock/position calculations, only the list entry
 *  is hidden here. */
const RETIRE_AFTER_MS = 30 * 86400000;
const isRetired = (v: Vessel): boolean => {
  if (!v.etaAt) return false;
  const t = Date.parse(v.etaAt);
  return Number.isFinite(t) && Date.now() - t > RETIRE_AFTER_MS;
};
const STATUS_EN: Record<string, string> = {
  'قيد الملاحة': 'Underway',
  'راسية': 'Anchored',
  'قيد التحميل': 'Loading',
  'في الانتظار': 'Waiting',
};
const statusTxt = (lang: 'ar' | 'en', s: string) => pick(lang, s, STATUS_EN[s] ?? s);

function readLocal(): { vessels: Vessel[]; saved: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        return { vessels: coerceVessels(parsed), saved: true };
      }
    }
  } catch { /* corrupted → defaults */ }
  return { vessels: DEFAULT_VESSELS, saved: false };
}

function writeLocal(v: Vessel[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch { /* private mode */ }
}

export default function VesselTracker() {
  const { lang } = useLang();
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const [vessels, setVessels] = useState<Vessel[]>(DEFAULT_VESSELS);
  const [storage, setStorage] = useState<Storage>('local');
  const [selected, setSelected] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [posDraft, setPosDraft] = useState({ lat: '', lng: '' });
  const [showMap, setShowMap] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState({ name: '', imo: '', mmsi: '', status: 'قيد الملاحة', destination: '', eta: '', quantityMT: '', loadedAt: '', etaAt: '' });
  const [detailsDraft, setDetailsDraft] = useState({ status: '', destination: '', eta: '', imo: '', mmsi: '', quantityMT: '', loadedAt: '', etaAt: '' });
  const [ais, setAis] = useState<AisState | null>(null);
  const [aisBusy, setAisBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const local = readLocal();

    (async () => {
      try {
        const r = await fetch('/api/vessels', { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          if (j?.saved && Array.isArray(j.vessels)) {
            const server = coerceVessels(j.vessels);
            if (!cancelled) {
              setVessels(server);
              setStorage((j.storage as Storage) ?? 'server');
            }
            writeLocal(server);
            if (!cancelled) setLoaded(true);
            return;
          }
        }
      } catch { /* offline → local */ }

      if (local.saved) {
        if (!cancelled) {
          setVessels(local.vessels);
          setStorage('local');
        }
        try {
          const r = await fetch('/api/vessels', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vessels: local.vessels }),
          });
          if (r.ok && !cancelled) setStorage('server');
        } catch { /* keep local */ }
      } else if (!cancelled) {
        setVessels(local.vessels);
      }
      if (!cancelled) setLoaded(true);
    })();

    return () => { cancelled = true; };
  }, []);

  if (!loaded) return null;

  const commit = (next: Vessel[]) => {
    setVessels(next);
    writeLocal(next);
    fetch('/api/vessels', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vessels: next }),
    })
      .then((r) => setStorage(r.ok ? 'server' : 'local'))
      .catch(() => setStorage('local'));
  };

  const select = (id: string) => {
    const opening = selected !== id;
    setSelected(opening ? id : null);
    setShowMap(false);
    setEditingId(null);
    const v = vessels.find((x) => x.id === id);
    if (opening && v) {
      setPosDraft({ lat: v.pos ? String(v.pos.lat) : '', lng: v.pos ? String(v.pos.lng) : '' });
      setDetailsDraft({
        status: v.status,
        destination: v.destination,
        eta: v.eta,
        imo: v.imo ?? '',
        mmsi: v.mmsi ?? '',
        quantityMT: v.quantityMT != null ? String(v.quantityMT) : '',
        loadedAt: v.loadedAt ?? '',
        etaAt: v.etaAt ?? '',
      });
    }
  };

  const saveName = (id: string) => {
    const name = nameDraft.trim();
    if (name) commit(vessels.map((v) => (v.id === id ? { ...v, name } : v)));
    setEditingId(null);
  };

  const savePos = (id: string) => {
    const lat = Number(posDraft.lat);
    const lng = Number(posDraft.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    commit(vessels.map((v) => (v.id === id ? { ...v, pos: { lat, lng }, posAt: new Date().toISOString() } : v)));
    setShowMap(true);
  };

  const clearPos = (id: string) => {
    commit(vessels.map((v) => (v.id === id ? { ...v, pos: null, posAt: null } : v)));
    setShowMap(false);
  };

  const saveDetails = (id: string) => {
    commit(
      vessels.map((v) =>
        v.id === id
          ? {
              ...v,
              status: detailsDraft.status || v.status,
              destination: detailsDraft.destination || v.destination,
              eta: detailsDraft.eta || v.eta,
              imo: detailsDraft.imo.trim(),
              mmsi: detailsDraft.mmsi.trim(),
              quantityMT: Number(detailsDraft.quantityMT) > 0 ? Math.round(Number(detailsDraft.quantityMT)) : null,
              loadedAt: detailsDraft.loadedAt || null,
              etaAt: detailsDraft.etaAt || null,
              // pricing fields are intentionally untouched here — they are
              // fed from daily reports and shown in the Pricing Ledger
            }
          : v,
      ),
    );
    setNotice(pick(lang, 'حُفظت تفاصيل السفينة.', 'Vessel details saved.'));
    setTimeout(() => setNotice(null), 2600);
  };

  const addVessel = async () => {
    const name = addDraft.name.trim();
    if (!name) return;
    try {
      const r = await fetch('/api/vessels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...addDraft,
          name,
          quantityMT: addDraft.quantityMT ? Math.round(Number(addDraft.quantityMT)) : null,
        }),
      });
      const j = await r.json();
      if (!r.ok || j.ok === false) {
        setNotice(`${pick(lang, 'فشل الإضافة', 'Add failed')}: ${j.error ?? r.status}`);
        return;
      }
      setVessels(coerceVessels(j.vessels));
      writeLocal(coerceVessels(j.vessels));
      setStorage(j.storage === 'unavailable' ? 'local' : (j.storage as Storage));
      setAdding(false);
      setSelected(j.vessel?.id ?? null);
      const v = j.vessels?.find((x: Vessel) => x.id === j.vessel?.id);
      setDetailsDraft({
        status: v?.status ?? 'قيد الملاحة',
        destination: v?.destination ?? '',
        eta: v?.eta ?? '',
        imo: v?.imo ?? '',
        mmsi: v?.mmsi ?? '',
        quantityMT: v?.quantityMT != null ? String(v.quantityMT) : '',
        loadedAt: v?.loadedAt ?? '',
        etaAt: v?.etaAt ?? '',
      });
      setAddDraft({ name: '', imo: '', mmsi: '', status: 'قيد الملاحة', destination: '', eta: '', quantityMT: '', loadedAt: '', etaAt: '' });
      setNotice(pick(lang, 'أُضيفت السفينة.', 'Vessel added.'));
      setTimeout(() => setNotice(null), 2600);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : pick(lang, 'فشل الاتصال', 'Connection failed'));
    }
  };

  const removeVessel = async (id: string) => {
    if (!window.confirm(pick(lang, 'حذف هذه السفينة نهائياً؟', 'Delete this vessel permanently?'))) return;
    try {
      const r = await fetch(`/api/vessels?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const j = await r.json();
      if (!r.ok || j.ok === false) {
        setNotice(`${pick(lang, 'فشل الحذف', 'Delete failed')}: ${j.error ?? r.status}`);
        return;
      }
      const next = coerceVessels(j.vessels);
      setVessels(next);
      writeLocal(next);
      setStorage(j.storage === 'unavailable' ? 'local' : (j.storage as Storage));
      if (selected === id) {
        setSelected(null);
        setShowMap(false);
      }
      setNotice(pick(lang, 'حُذفت السفينة.', 'Vessel deleted.'));
      setTimeout(() => setNotice(null), 2600);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : pick(lang, 'فشل الاتصال', 'Connection failed'));
    }
  };

  const refreshAis = async () => {
    setAisBusy(true);
    setNotice(null);
    try {
      const j = await fetch('/api/vessels?ais=1', { cache: 'no-store' }).then((r) => r.json());
      setAis({
        live: !!j?.ais?.live,
        message: j?.ais?.message ?? pick(lang, 'لا توجد بيانات AIS', 'No AIS data'),
        ships: Array.isArray(j?.ais?.ships) ? j.ais.ships : [],
        at: j?.ais?.at ?? null,
      });
    } catch (e) {
      setAis({ live: false, message: pick(lang, 'فشل الاتصال بخدمة AIS', 'AIS service unreachable'), ships: [], at: null });
    } finally {
      setAisBusy(false);
    }
  };

  const when = (iso: string | null) => {
    if (!iso) return '—';
    const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
    if (!Number.isFinite(s) || s < 0) return '—';
    return ago(lang, s);
  };

  const findLive = (v: Vessel): AisShip | null => {
    if (!ais?.live) return null;
    return (
      ais.ships.find(
        (s) =>
          (v.imo && s.imo && s.imo === v.imo) ||
          (v.mmsi && s.mmsi && s.mmsi === v.mmsi) ||
          s.vesselId === v.id,
      ) ?? null
    );
  };

  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const speedTxt = (kn: number | null | undefined) =>
    kn != null ? `${kn} ${pick(lang, 'عقدة', 'kn')}` : pick(lang, 'سرعة غير معروفة', 'speed unknown');
  const posUnknown = pick(lang, 'غير مسجل', 'not set');
  const noPos = pick(lang, 'بدون موضع', 'no position');

  // list shows only active vessels — arrived > 1 month ago drops off
  const activeVessels = vessels.filter((v) => !isRetired(v));
  const retiredCount = vessels.length - activeVessels.length;

  return (
    <article className="card vessel-compact" dir={dir}>
      <div className="cardhead">
        <div>
          <span className="kicker">VESSELS · AIS</span>
          <h2>{pick(lang, 'السفن', 'Vessels')}</h2>
        </div>
        <div className="vessel-compact__headtools">
          {isAdmin && (
            <button type="button" className="vessel-compact__btn" onClick={() => setAdding((a) => !a)}>
              {adding ? pick(lang, 'إلغاء', 'Cancel') : `+ ${pick(lang, 'سفينة', 'Vessel')}`}
            </button>
          )}
          <button type="button" className="vessel-compact__btn" onClick={refreshAis} disabled={aisBusy}>
            {aisBusy ? '…' : ais?.live ? pick(lang, 'تحديث AIS', 'Refresh AIS') : 'AIS'}
          </button>
        </div>
      </div>

      <div className={`vessel-compact__hint ${ais?.live ? 'live' : ''}`}>
        {ais?.live
          ? `${pick(lang, 'AIS مباشر', 'Live AIS')} — ${ais.ships.length} ${pick(lang, 'سفينة بمواضع لحظية', 'vessels with live positions')}${ais.at ? ` · ${when(ais.at)}` : ''}`
          : `${pick(lang, 'انقر للسفينة', 'Click a vessel')} · ${ais ? pick(lang, 'AIS غير متصل لهذه السفن', 'AIS offline for these vessels') : pick(lang, 'AIS غير متصل', 'AIS offline')}${storage !== 'server' ? pick(lang, ' · حفظ محلي', ' · saved locally') : ''}`}
        {pick(lang, ' · تُحذف الباخرة بعد شهر من وصولها', ' · vessels drop off 1 month after arrival')}
        {retiredCount > 0 ? pick(lang, ` (${retiredCount} محذوفة تلقائياً)`, ` (${retiredCount} auto-removed)`) : ''}
      </div>

      {adding && (
        <div className="vessel-compact__add">
          <label><span>{pick(lang, 'اسم السفينة *', 'Vessel name *')}</span>
            <input value={addDraft.name} onChange={(e) => setAddDraft({ ...addDraft, name: e.target.value })} placeholder="MV …" />
          </label>
          <label><span>IMO</span>
            <input inputMode="numeric" value={addDraft.imo} onChange={(e) => setAddDraft({ ...addDraft, imo: e.target.value })} placeholder="9449772" />
          </label>
          <label><span>MMSI</span>
            <input inputMode="numeric" value={addDraft.mmsi} onChange={(e) => setAddDraft({ ...addDraft, mmsi: e.target.value })} placeholder="636018000" />
          </label>
          <label><span>{pick(lang, 'الحالة', 'Status')}</span>
            <select value={addDraft.status} onChange={(e) => setAddDraft({ ...addDraft, status: e.target.value })}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusTxt(lang, s)}</option>)}
            </select>
          </label>
          <label><span>{pick(lang, 'الوجهة', 'Destination')}</span>
            <input value={addDraft.destination} onChange={(e) => setAddDraft({ ...addDraft, destination: e.target.value })} placeholder={pick(lang, 'سانتوس', 'Santos')} />
          </label>
          <label><span>{pick(lang, 'الوصول المتوقع', 'ETA')}</span>
            <input value={addDraft.eta} onChange={(e) => setAddDraft({ ...addDraft, eta: e.target.value })} placeholder={pick(lang, '15 أكتوبر', 'Oct 15')} />
          </label>
          <label><span>{pick(lang, 'الكمية (MT)', 'Quantity (MT)')}</span>
            <input inputMode="numeric" value={addDraft.quantityMT} onChange={(e) => setAddDraft({ ...addDraft, quantityMT: e.target.value })} placeholder="50000" />
          </label>
          <label><span>{pick(lang, 'تاريخ الشحن', 'Loaded date')}</span>
            <input type="date" value={addDraft.loadedAt} onChange={(e) => setAddDraft({ ...addDraft, loadedAt: e.target.value })} />
          </label>
          <label><span>{pick(lang, 'تاريخ الوصول المتوقع', 'ETA date')}</span>
            <input type="date" value={addDraft.etaAt} onChange={(e) => setAddDraft({ ...addDraft, etaAt: e.target.value })} />
          </label>
          <button type="button" className="vessel-compact__btn primary" onClick={addVessel}>{pick(lang, 'إضافة السفينة', 'Add vessel')}</button>
        </div>
      )}

      <div className="vessel-compact__list">
        {activeVessels.length === 0 && (
          <div className="vessel-compact__empty">
            {pick(lang, 'لا توجد بواخر نشطة — أضف سفينة أو ارفع التقرير اليومي', 'No active vessels — add one or upload the daily report')}
          </div>
        )}
        {activeVessels.map((v) => {
          const live = findLive(v);
          const shownPos = live ? { lat: live.lat, lng: live.lng } : v.pos;
          return (
            <div key={v.id}>
              <div
                className={`vessel-compact__item ${selected === v.id ? 'selected' : ''}`}
                onClick={() => select(v.id)}
              >
                <div className="vessel-compact__main">
                  <span className="vessel-compact__name">
                    {editingId === v.id ? (
                      <input
                        value={nameDraft}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveName(v.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        onBlur={() => saveName(v.id)}
                      />
                    ) : (
                      <>
                        {v.name}{' '}
                        {isAdmin && (
                          <em
                            className="edit-hint"
                            title={pick(lang, 'تعديل اسم السفينة', 'Edit vessel name')}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingId(v.id);
                              setNameDraft(v.name);
                            }}
                          >
                            ✎
                          </em>
                        )}
                      </>
                    )}
                  </span>
                  <span className={`vessel-compact__status ${v.status === 'قيد الملاحة' ? 'active' : 'anchored'}`}>
                    {live ? (
                      <>
                        <b className="vessel-compact__aislive">{pick(lang, 'AIS مباشر', 'LIVE AIS')}</b> · {speedTxt(live.speedKn)} · {pick(lang, 'آخر موضع', 'last fix')} {when(live.at ?? null)}
                      </>
                    ) : (
                      <>
                        {statusTxt(lang, v.status)}{v.pos ? ` · ${pick(lang, 'آخر موضع', 'last fix')} ${when(v.posAt)}` : ` · ${noPos}`}
                      </>
                    )}
                  </span>
                </div>
                <div className="vessel-compact__eta">
                  <span>{live?.dest || v.destination}</span>
                  <b>{v.eta}</b>
                </div>
              </div>

              {selected === v.id && (
                <div className="vessel-compact__detail" onClick={(e) => e.stopPropagation()}>
                  <div className="vessel-compact__grid">
                    <div className="vessel-compact__cell"><span>{pick(lang, 'الحالة', 'Status')}</span><b>{live ? pick(lang, 'AIS مباشر', 'Live AIS') : statusTxt(lang, v.status)}</b></div>
                    <div className="vessel-compact__cell"><span>{pick(lang, 'الوجهة', 'Destination')}</span><b>{v.destination}</b></div>
                    <div className="vessel-compact__cell"><span>{pick(lang, 'الوصول المتوقع', 'ETA')}</span><b>{v.eta}</b></div>
                    <div className="vessel-compact__cell"><span>{pick(lang, 'الكمية (MT)', 'Quantity (MT)')}</span><b>{v.quantityMT != null ? v.quantityMT.toLocaleString('en-US') : '—'}</b></div>
                    <div className="vessel-compact__cell"><span>{pick(lang, 'تاريخ الشحن', 'Loaded date')}</span><b>{v.loadedAt ?? '—'}</b></div>
                    <div className="vessel-compact__cell"><span>{pick(lang, 'تاريخ الوصول المتوقع', 'ETA date')}</span><b>{v.etaAt ?? '—'}</b></div>
                    <div className="vessel-compact__cell"><span>{pick(lang, 'الموضع', 'Position')}</span><b>{shownPos ? `${shownPos.lat.toFixed(3)}, ${shownPos.lng.toFixed(3)}` : posUnknown}</b></div>
                    <div className="vessel-compact__cell"><span>IMO</span><b>{v.imo || '—'}</b></div>
                    <div className="vessel-compact__cell"><span>MMSI</span><b>{v.mmsi || '—'}</b></div>
                  </div>

                  <div className="vessel-compact__tools">
                    {isAdmin && (
                      <span className="vessel-compact__pos">
                        {pick(lang, 'خطي العرض', 'Lat')}
                        <input
                          inputMode="decimal" placeholder="-23.96" value={posDraft.lat}
                          onChange={(e) => setPosDraft((p) => ({ ...p, lat: e.target.value }))}
                        />
                        {pick(lang, 'خط الطول', 'Lng')}
                        <input
                          inputMode="decimal" placeholder="-46.33" value={posDraft.lng}
                          onChange={(e) => setPosDraft((p) => ({ ...p, lng: e.target.value }))}
                        />
                        <button type="button" className="vessel-compact__btn" onClick={() => savePos(v.id)}>
                          {pick(lang, 'حفظ الموضع', 'Save position')}
                        </button>
                      </span>
                    )}

                    {shownPos && (
                      <>
                        <button
                          type="button"
                          className={`vessel-compact__btn ${showMap ? 'on' : ''}`}
                          onClick={() => setShowMap((s) => !s)}
                        >
                          {showMap ? pick(lang, 'إخفاء الخريطة', 'Hide map') : pick(lang, 'تتبع على الخريطة', 'Track on map')}
                        </button>
                        {isAdmin && (
                          <button type="button" className="vessel-compact__btn" onClick={() => clearPos(v.id)}>
                            {pick(lang, 'مسح الموضع', 'Clear position')}
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {isAdmin ? (
                    <div className="vessel-compact__details">
                      <label><span>{pick(lang, 'الحالة', 'Status')}</span>
                        <select value={detailsDraft.status} onChange={(e) => setDetailsDraft({ ...detailsDraft, status: e.target.value })}>
                          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusTxt(lang, s)}</option>)}
                        </select>
                      </label>
                      <label><span>{pick(lang, 'الوجهة', 'Destination')}</span>
                        <input value={detailsDraft.destination} onChange={(e) => setDetailsDraft({ ...detailsDraft, destination: e.target.value })} />
                      </label>
                      <label><span>{pick(lang, 'الوصول المتوقع', 'ETA')}</span>
                        <input value={detailsDraft.eta} onChange={(e) => setDetailsDraft({ ...detailsDraft, eta: e.target.value })} />
                      </label>
                      <label><span>{pick(lang, 'الكمية (MT)', 'Quantity (MT)')}</span>
                        <input inputMode="numeric" value={detailsDraft.quantityMT} onChange={(e) => setDetailsDraft({ ...detailsDraft, quantityMT: e.target.value })} />
                      </label>
                      <label><span>{pick(lang, 'تاريخ الشحن', 'Loaded date')}</span>
                        <input type="date" value={detailsDraft.loadedAt} onChange={(e) => setDetailsDraft({ ...detailsDraft, loadedAt: e.target.value })} />
                      </label>
                      <label><span>{pick(lang, 'تاريخ الوصول المتوقع', 'ETA date')}</span>
                        <input type="date" value={detailsDraft.etaAt} onChange={(e) => setDetailsDraft({ ...detailsDraft, etaAt: e.target.value })} />
                      </label>
                      <label><span>{pick(lang, 'IMO (لتتبع AIS)', 'IMO (for AIS tracking)')}</span>
                        <input value={detailsDraft.imo} onChange={(e) => setDetailsDraft({ ...detailsDraft, imo: e.target.value })} />
                      </label>
                      <label><span>{pick(lang, 'MMSI (لتتبع AIS)', 'MMSI (for AIS tracking)')}</span>
                        <input value={detailsDraft.mmsi} onChange={(e) => setDetailsDraft({ ...detailsDraft, mmsi: e.target.value })} />
                      </label>
                      <div className="vessel-compact__detailbtns">
                        <button type="button" className="vessel-compact__btn primary" onClick={() => saveDetails(v.id)}>{pick(lang, 'حفظ التفاصيل', 'Save details')}</button>
                        <button type="button" className="vessel-compact__btn danger" onClick={() => removeVessel(v.id)}>{pick(lang, 'حذف السفينة', 'Delete vessel')}</button>
                      </div>
                    </div>
                  ) : null}

                  <span className="vessel-compact__hint">
                    {live
                      ? pick(
                          lang,
                          `الموضع الحالي من VesselFinder AIS (${speedTxt(live.speedKn)}) — لا يُحفظ تلقائياً؛ أدخل موضعاً يدوياً لحفظه في السجل.`,
                          `Live position from VesselFinder AIS (${speedTxt(live.speedKn)}) — not auto-saved; enter a position manually to keep it on record.`,
                        )
                      : pick(
                          lang,
                          'خدمة AIS غير متاحة حالياً — أضف IMO/MMSI أعلاه ثم اضغط "AIS"، أو أدخل الموضع يدوياً من مصدر تتبع خارجي، ويُحفظ على الخادم مع تاريخ الإدخال.',
                          'AIS unavailable now — add IMO/MMSI above, press "AIS", or enter the position manually from an external tracker; it is saved to the server with a timestamp.',
                        )}
                  </span>

                  {showMap && shownPos && (
                    <VesselMap
                      position={{ lat: shownPos.lat, lng: shownPos.lng, location: v.destination }}
                      vesselName={v.name}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {notice && <div className="vessel-compact__notice">ℹ {notice}</div>}
      {ais && !ais.live && <div className="vessel-compact__aismsg">🛰 {ais.message}</div>}
    </article>
  );
}