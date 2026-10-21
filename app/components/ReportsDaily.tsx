'use client';
import { useRef, useState } from 'react';
import { useLang } from './LangContext';
import { useAuth } from './AuthContext';
import { pick } from '../../lib/i18n';

/**
 * Daily reports — upload zone only.
 * Classification, analysis and system feeding run automatically on the
 * server; the applied-changes log stays server-side (data/daily-reports).
 * Uploads are admin-only (viewers get a read-only note).
 */
export default function ReportsDaily() {
  const { lang } = useLang();
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const noticeTimer = useRef<number>(0);

  const upload = async (file: File) => {
    setBusy(true);
    setNotice('');
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 12000);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('reportDate', date);
      const r = await fetch('/api/reports/upload', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) {
        setNotice(pick(lang, `فشل الرفع: ${j.error ?? ''}`, `Upload failed: ${j.error ?? ''}`));
      } else {
        const catTxt = lang === 'ar' ? j.item.categoryAr : j.item.categoryEn;
        setNotice(pick(
          lang,
          `تم استلام «${file.name}» — التصنيف: ${catTxt} · ${j.changed > 0 ? `غذّى النظام بـ ${j.changed} تحديث` : 'لا تغييرات تلقائية'}`,
          `Received "${file.name}" — Category: ${catTxt} · ${j.changed > 0 ? `fed the system with ${j.changed} updates` : 'no automatic changes'}`,
        ));
      }
    } catch {
      setNotice(pick(lang, 'فشل الاتصال أثناء الرفع', 'Network error during upload'));
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <section id="reports-daily" className="vessel-compact reports-daily">
      <div className="vessel-compact__head">
        <div>
          <h2>{pick(lang, 'التقارير اليومية — تغذية النظام', 'Daily Reports — System Feed')}</h2>
          <p className="vessel-compact__sub">
            {pick(
              lang,
              'ارفع التقرير (PDF / Word / Excel / PowerPoint / CSV) — يُصنّف ويُحلّل تلقائياً وتُحدَّث نتائج النظام بموجبه',
              'Upload a report (PDF / Word / Excel / PowerPoint / CSV) — auto-classified, analyzed, and system results updated accordingly',
            )}
          </p>
        </div>
        <div className="vessel-compact__headtools">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} title={pick(lang, 'تاريخ التقرير', 'Report date')} />
        </div>
      </div>

      {/* ===== clear upload zone (admin) / read-only note (viewer) ===== */}
      {!isAdmin ? (
        <div className="reports-daily__drop reports-daily__drop--readonly">
          <div className="reports-daily__drop-icon">🔒</div>
          <div className="reports-daily__drop-title">
            {pick(lang, 'رفع التقارير متاح لمدير النظام فقط', 'Report uploads are available to the system admin only')}
          </div>
          <div className="reports-daily__drop-hint">
            {pick(lang, 'حسابك بصلاحية استعراض — تظهر نتائج التقارير تلقائياً في اللوحة', 'Your account is view-only — report results appear automatically on the dashboard')}
          </div>
        </div>
      ) : (
      <div
        className={`reports-daily__drop ${dragOver ? 'over' : ''} ${busy ? 'busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.click(); }}
      >
        <input
          ref={inputRef}
          type="file"
          hidden
          accept=".pdf,.docx,.pptx,.ppt,.xlsx,.xls,.txt,.csv,.json"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
        />
        <div className="reports-daily__drop-icon">{busy ? '⏳' : '📄'}</div>
        <div className="reports-daily__drop-title">
          {busy
            ? pick(lang, 'جارٍ الرفع والتحليل والتغذية…', 'Uploading, analyzing & feeding…')
            : pick(lang, 'اضغط هنا أو اسحب ملف التقرير وأفلته', 'Click here or drag & drop the report file')}
        </div>
        <div className="reports-daily__drop-hint">
          PDF · Word · Excel · PowerPoint · CSV · TXT — {pick(lang, 'التصنيف والتحليل تلقائي', 'auto-classified & analyzed')}
        </div>
      </div>
      )}

      {notice && <div className="reports-daily__notice">{notice}</div>}
    </section>
  );
}
