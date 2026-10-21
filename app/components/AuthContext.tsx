'use client';

import { createContext, useContext, useEffect, useState } from 'react';

export type Role = 'admin' | 'viewer' | null;

type Auth = {
  user: string | null;
  role: Role;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<Auth>({
  user: null,
  role: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<string | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const r = await fetch('/api/auth/session', { cache: 'no-store' });
      const j = await r.json();
      if (j.ok && j.user) {
        setUser(j.user.username);
        setRole(j.user.role);
      } else {
        setUser(null);
        setRole(null);
      }
    } catch {
      setUser(null);
      setRole(null);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return <Ctx.Provider value={{ user, role, loading, refresh, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
