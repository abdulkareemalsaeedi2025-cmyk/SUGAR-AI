'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UPLOAD_ENABLED } from '../../lib/featureFlags';
import { useLang } from './LangContext';
import { ago, pick } from '../../lib/i18n';

type Macro = {
  symbol: string;
  key: string;
  ar: string;
  en: string;
  impact: 'high' | 'medium';
  whyAr: string;
  whyEn: string;
  last: number | null;
  change: number | null;
  changePct: number | null;
  ok: boolean;
};

type News = {
  title: string;
  titleAr?: string;
  link: string;
  source: string;
  publishedAt: string | null;
  topic: string;
  topicAr: string;
  topicEn: string;
  matched: string[];
};

type UploadedItem = {
  id: string;
  file: string;
  topic: string;
  topicAr: string;
  topicEn: string;
  text: string;
  relevance: number;
  at?: string;
};

type Weather = {
  key: string;
  ar: string;
  en: string;
  temp: number | null;
  rainNow: number | null;
  rainDay: number | null;
  wind: number | null;
  tmax: number | null;
  ok: boolean;
};

type Tab = 'drivers' | 'news' | 'weather' | 'files';

const TOPIC_ORDER = ['weather', 'quake', 'geopolitics', 'shipping', 'brazil', 'india', 'thailand', 'energy', 'stocks', 'market', 'currency', 'policy', 'general'];

export default function DriversPanel() {
  const { lang } = useLang();
  const [macro, setMacro] = useState<Macro[]>([]);
  const [news, setNews] = useState<News[]>([]);
  const [uploaded, setUploaded] = useState<UploadedItem[]>([]);
  const [weather, setWeather] = useState<Weather[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('drivers');
  const [busy, setBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/drivers');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setMacro(j.macro ?? []);
      setNews(j.news ?? []);
      setUploaded(j.uploads?.items ?? []);
      setWeather(j.weather ?? []);
      setUpdatedAt(j.updatedAt ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  async function send(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setUploadMsg(null);
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    try {
      const r = await fetch('/api/upload', { method: 'POST', body: fd });
      const j = await r.json();
      const total = (j.results ?? []).reduce((n: number, x: { driversFound?: number }) => n + (x.driversFound ?? 0), 0);
      const bad = (j.results ?? []).filter((x: { error?: string }) => x.error);
      setUploadMsg({
        ok: !bad.length && total > 0,
        text: bad.length
          ? pick(lang, `${total} عامل مستخرج — ${bad.length} ملف فشل`, `${total} drivers extracted — ${bad.length} file(s) failed`)
          : pick(lang, `تم استخراج ${total} عامل من ${(j.results ?? []).length} ملف`, `Extracted ${total} drivers from ${(j.results ?? []).length} file(s)`),
      });
      await load();
    } catch {
      setUploadMsg({ ok: false, text: pick(lang, 'فشل الاتصال بالخادم', 'Server unreachable') });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const byTopic = useMemo(() => {
    const m = new Map<string, News[]>();
    for (const n of news) {
      const arr = m.get(n.topic) ?? [];
      arr.push(n);
      m.set(n.topic, arr);
    }
    return [...m.entries()].sort(
      (a, b) => TOPIC_ORDER.indexOf(a[0]) - TOPIC_ORDER.indexOf(b[0]),
    );
  }, [news]);

  const when = (iso: string | null) => {
    if (!iso) return '';
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms) || ms < 0) return '';
    return ago(lang, Math.round(ms / 1000));
  };

  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  return (
    <section className="sdrv" dir={dir}>
      <header className="sdrv__head">
        <h2>{pick(lang, 'العوامل المؤثرة في سوق السكر', 'Sugar market drivers')}</h2>
        <div className="sdrv__meta">
          {loading ? pick(lang, 'جارِ التحميل…', 'Loading…') : error ? <span className="sdrv__err">{error}</span> : `${pick(lang, 'آخر تحديث', 'Updated')} ${when(updatedAt) || '—'}`}
          <button type="button" onClick={load} disabled={loading} className="sdrv__refresh">
            {pick(lang, 'تحديث', 'Refresh')}
          </button>
        </div>
      </header>

      <nav className="sdrv__tabs" role="tablist">
        {(
          [
            ['drivers', pick(lang, `المؤشرات (${macro.filter((m) => m.ok).length})`, `Indicators (${macro.filter((m) => m.ok).length})`)],
            ['news', pick(lang, `الأخبار (${news.length})`, `News (${news.length})`)],
            ['weather', pick(lang, `الطقس (${weather.filter((w) => w.ok).length})`, `Weather (${weather.filter((w) => w.ok).length})`)],
            ['files', UPLOAD_ENABLED ? pick(lang, `الملفات (${uploaded.length})`, `Files (${uploaded.length})`) : pick(lang, 'الملفات (معطّل)', 'Files (off)')],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'drivers' && (
        <div className="sdrv__grid">
          {macro.map((m) => (
            <article key={m.symbol} className={`driver ${m.ok ? '' : 'driver--down'}`}>
              <div className="driver__top">
                <h3>{pick(lang, m.ar, m.en)}</h3>
                <span className={`driver__impact driver__impact--${m.impact}`}>
                  {m.impact === 'high' ? pick(lang, 'أثر عالٍ', 'High impact') : pick(lang, 'أثر متوسط', 'Medium impact')}
                </span>
                <span className="driver__sym">{m.symbol}</span>
              </div>
              <div className="driver__val">
                {m.ok && m.last != null ? m.last.toFixed(m.symbol === 'BZ=F' || m.symbol === 'DX-Y.NYB' ? 3 : 4) : '—'}
                {m.change != null && (
                  <em className={m.change > 0 ? 'up' : m.change < 0 ? 'dn' : 'flat'}>
                    {m.change > 0 ? '+' : ''}
                    {m.change.toFixed(4)} ({m.changePct?.toFixed(2)}%)
                  </em>
                )}
              </div>
              <p>{pick(lang, m.whyAr, m.whyEn ?? m.whyAr)}</p>
            </article>
          ))}
        </div>
      )}

      {tab === 'news' && (
        <div className="news">
          {byTopic.map(([topic, list]) => (
            <div key={topic} className="news__group">
              <h3 className="news__topic">{pick(lang, list[0].topicAr, list[0].topicEn ?? list[0].topic)}</h3>
              <ul>
                {list.map((n, i) => (
                  <li key={`${topic}-${i}`}>
                    <a href={n.link} target="_blank" rel="noreferrer noopener">
                      {lang === 'ar' ? (n.titleAr ?? n.title) : n.title}
                    </a>
                    <span className="news__src">
                      {n.source} · {when(n.publishedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {tab === 'weather' && (
        <div className="wx">
          {weather.map((w) => {
            const heavy = (w.rainDay ?? 0) >= 10;
            const light = (w.rainDay ?? 0) > 0 && !heavy;
            return (
              <article key={w.key} className={`wxcard${w.ok ? '' : ' driver--down'}`}>
                <div className="wxcard__top">
                  <h3>{pick(lang, w.ar, w.en)}</h3>
                  <span className={`wxcard__badge ${heavy ? 'is-heavy' : light ? 'is-rain' : 'is-dry'}`}>
                    {heavy ? pick(lang, 'أمطار غزيرة', 'Heavy rain') : light ? pick(lang, 'أمطار', 'Rain') : pick(lang, 'جاف', 'Dry')}
                  </span>
                </div>
                <div className="wxcard__temp">{w.ok && w.temp != null ? `${Math.round(w.temp)}°` : '—'}</div>
                <dl>
                  <div><dt>{pick(lang, 'هطول اليوم', 'Rain today')}</dt><dd>{w.rainDay != null ? `${w.rainDay} mm` : '—'}</dd></div>
                  <div><dt>{pick(lang, 'هطول الآن', 'Rain now')}</dt><dd>{w.rainNow != null ? `${w.rainNow} mm` : '—'}</dd></div>
                  <div><dt>{pick(lang, 'أعلى حرارة', 'Max temp')}</dt><dd>{w.tmax != null ? `${Math.round(w.tmax)}°C` : '—'}</dd></div>
                  <div><dt>{pick(lang, 'الرياح', 'Wind')}</dt><dd>{w.wind != null ? `${Math.round(w.wind)} km/h` : '—'}</dd></div>
                </dl>
                <p className="wxcard__note">
                  {heavy
                    ? pick(lang, 'هطول غزير قد يوقف التموير ويؤخر السحق في المنطقة.', 'Heavy rain may halt milling and delay crushing in the region.')
                    : light
                      ? pick(lang, 'هطول خفيف — راقب أثره على نمو القصب.', 'Light rain — watch its effect on cane growth.')
                      : pick(lang, 'لا هطول مؤثر — راقب الحرارة والجفاف.', 'No meaningful rain — watch heat and dryness.')}
                </p>
              </article>
            );
          })}
        </div>
      )}

      {tab === 'files' && (
        <div className="files">
          {UPLOAD_ENABLED ? (
            <>
          <div
            className={`drop ${drag ? 'is-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void send([...e.dataTransfer.files]);
            }}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.docx,.xlsx,.xls"
              hidden
              onChange={(e) => void send([...(e.target.files ?? [])])}
            />
            <strong>{pick(lang, 'اسحب ملفات التقرير هنا أو اضغط للاختيار', 'Drop report files here or click to browse')}</strong>
            <span>{pick(lang, 'PDF · Word · Excel — حتى 12 MB', 'PDF · Word · Excel — up to 12 MB')}</span>
          </div>

          {uploadMsg && <p className={`files__msg ${uploadMsg.ok ? 'ok' : 'bad'}`}>{busy ? pick(lang, 'جارِ التحليل…', 'Analyzing…') : uploadMsg.text}</p>}

          <ul className="files__list">
            {uploaded.map((u) => (
              <li key={u.id}>
                <div className="files__row">
                  <em className="files__topic">{pick(lang, u.topicAr, u.topicEn ?? u.topicAr)}</em>
                  <span className="files__file">{u.file}</span>
                  <span className="files__rel">{u.relevance}</span>
                </div>
                <p>{u.text}</p>
              </li>
            ))}
            {!uploaded.length && <li className="files__empty">{pick(lang, 'لم تُرفع ملفات بعد.', 'No files uploaded yet.')}</li>}
          </ul>
            </>
          ) : (
            <div className="files__off">
              <strong>{pick(lang, 'رفع التقارير معطّل مؤقتاً', 'Report upload is temporarily disabled')}</strong>
              <span>
                {pick(
                  lang,
                  'التخزين على هذا الخادم للقراءة فقط، والرفع يحتاج قرصاً دائماً. تُبقى بيانات المؤشرات والأخبار والطقس ومقترح الشراء تعمل بشكل طبيعي.',
                  'Storage on this server is read-only and upload needs a persistent disk. Indicators, news, weather and the purchase call keep working normally.',
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}