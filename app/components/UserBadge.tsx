'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useLang } from './LangContext';

type ListedUser = { id: string; username: string; role: 'admin' | 'viewer'; createdAt: string };

/**
 * User chip in the header: name, role badge, logout. For admins it also opens
 * a compact users panel (create viewer accounts, delete users).
 */
export default function UserBadge() {
  const { user, role, logout } = useAuth();
  const { lang } = useLang();
  const isAdmin = role === 'admin';
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<ListedUser[]>([]);
  const [nu, setNu] = useState('');
  const [np, setNp] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const ar = lang === 'ar';

  async function loadUsers() {
    try {
      const r = await fetch('/api/auth/users', { cache: 'no-store' });
      const j = await r.json();
      if (j.ok) setUsers(j.users);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (open && isAdmin) void loadUsers();
  }, [open, isAdmin]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      const r = await fetch('/api/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: nu, password: np, role: 'viewer' }),
      });
      const j = await r.json();
      if (j.ok) {
        setNu('');
        setNp('');
        setMsg(ar ? 'تمت الإضافة' : 'Added');
        void loadUsers();
      } else {
        setMsg(
          j.error === 'username_taken' ? (ar ? 'الاسم مأخوذ' : 'Username taken')
          : j.error === 'weak_password' ? (ar ? 'كلمة المرور أقل من 6 أحرف' : 'Password too short (min 6)')
          : j.error === 'invalid_username' ? (ar ? 'اسم غير صالح (3–32 حرفاً لاتينياً/أرقام)' : 'Invalid username (3–32 latin/digits)')
          : (ar ? 'فشل' : 'Failed'),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeUser(id: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/auth/users?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const j = await r.json();
      if (j.ok) void loadUsers();
      else setMsg(ar ? 'لا يمكن الحذف' : 'Cannot delete');
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <span className="user-badge" ref={panelRef}>
      <button
        type="button"
        className="user-badge__main"
        onClick={() => isAdmin && setOpen((o) => !o)}
        title={isAdmin ? (ar ? 'كل الصلاحيات — إدارة المستخدمين' : 'Full access — manage users') : (ar ? 'استعراض فقط' : 'View only')}
      >
        <span className={`role-dot ${isAdmin ? 'role-dot--admin' : 'role-dot--viewer'}`} />
        {user}
        <span className="role-tag">{isAdmin ? (ar ? 'مدير' : 'Admin') : (ar ? 'مشاهد' : 'Viewer')}</span>
      </button>
      <button className="logout-btn" onClick={logout} title={ar ? 'خروج' : 'Sign out'}>
        {ar ? 'خروج' : 'Sign out'}
      </button>

      {open && isAdmin && (
        <div className="users-panel" dir={ar ? 'rtl' : 'ltr'}>
          <h3>{ar ? 'المستخدمون' : 'Users'}</h3>
          <ul>
            {users.map((u) => (
              <li key={u.id}>
                <span className={`role-dot ${u.role === 'admin' ? 'role-dot--admin' : 'role-dot--viewer'}`} />
                {u.username}
                <em>{u.role === 'admin' ? (ar ? 'مدير' : 'admin') : (ar ? 'مشاهد' : 'viewer')}</em>
                {u.username !== user && (
                  <button type="button" className="users-panel__del" disabled={busy} onClick={() => removeUser(u.id)} title={ar ? 'حذف' : 'Delete'}>×</button>
                )}
              </li>
            ))}
          </ul>
          <form onSubmit={addUser}>
            <input value={nu} onChange={(e) => setNu(e.target.value)} placeholder={ar ? 'اسم مستخدم جديد' : 'New username'} required />
            <input value={np} onChange={(e) => setNp(e.target.value)} placeholder={ar ? 'كلمة مرور' : 'Password'} type="password" required />
            <button type="submit" disabled={busy}>{ar ? '+ مشاهد' : '+ Viewer'}</button>
          </form>
          {msg && <p className="users-panel__msg">{msg}</p>}
          <p className="users-panel__hint">{ar ? 'المستخدمون الجدد يحصلون على صلاحية استعراض فقط' : 'New users get view-only access'}</p>
        </div>
      )}
    </span>
  );
}
