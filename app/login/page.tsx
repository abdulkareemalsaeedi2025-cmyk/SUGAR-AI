'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [lang, setLang] = useState<'ar' | 'en'>('ar');

  const t = {
    ar: {
      title: 'Smart Sugar AI',
      sub: 'لوحة تحكم تنفيذية لسوق السكر والمشتريات',
      user: 'اسم المستخدم',
      pass: 'كلمة المرور',
      login: 'دخول',
      errCred: 'بيانات الدخول غير صحيحة',
      errLocked: 'محاولات متعددة، جرّب بعد قليل',
      errNet: 'خطأ في الاتصال',
      hint: 'للمشرف: admin / Sugar@2026 (غيّرها فوراً)',
    },
    en: {
      title: 'Smart Sugar AI',
      sub: 'Executive Sugar Market & Procurement Intelligence',
      user: 'Username',
      pass: 'Password',
      login: 'Sign In',
      errCred: 'Invalid credentials',
      errLocked: 'Too many attempts, try again later',
      errNet: 'Connection error',
      hint: 'Admin: admin / Sugar@2026 (change immediately)',
    },
  }[lang];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const j = await r.json();
      if (j.ok) {
        router.push('/');
        router.refresh();
        return;
      }
      if (j.error === 'locked') setErr(t.errLocked);
      else setErr(t.errCred);
    } catch {
      setErr(t.errNet);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main dir={lang === 'ar' ? 'rtl' : 'ltr'} style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'radial-gradient(ellipse at top, #1a1f2e, #0a0d14)' }}>
      <div style={{ width: 'min(380px, 92vw)', padding: 32, borderRadius: 16, background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 40px 80px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>SMART SUGAR AI</div>
            <h1 style={{ margin: '4px 0 0', fontSize: 24 }}>{t.title}</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>{t.sub}</p>
          </div>
          <button onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', padding: '4px 10px', borderRadius: 8, cursor: 'pointer' }}>{lang === 'ar' ? 'EN' : 'عربي'}</button>
        </div>
        <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{t.user}</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.3)', color: '#fff' }} />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{t.pass}</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.3)', color: '#fff' }} />
          </label>
          {err && <div style={{ color: '#f87171', fontSize: 13 }}>{err}</div>}
          <button disabled={loading} style={{ marginTop: 8, padding: '10px 16px', borderRadius: 10, border: 'none', background: 'linear-gradient(90deg, #22d3ee, #2563eb)', color: '#fff', fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }}>{loading ? '...' : t.login}</button>
        </form>
        <p style={{ marginTop: 16, fontSize: 11, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>{t.hint}</p>
      </div>
    </main>
  );
}
