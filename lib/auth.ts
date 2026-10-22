/**
 * Authentication & roles — one system admin (full permissions) + viewer users
 * (read-only). Users live in the kv store (`auth:users`), sessions are
 * HMAC-signed cookies. No external dependency — node:crypto only.
 *
 * Server-side enforcement is the real boundary: every mutating API route
 * calls requireAdmin(); the UI merely hides the controls for viewers.
 */
import { createHmac, scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { kvGet, kvSet, logAudit } from './db';

export type Role = 'admin' | 'viewer';
export type AuthUser = { id: string; username: string; passHash: string; role: Role; createdAt: string };
export type Session = { uid: string; username: string; role: Role };

const USERS_KEY = 'auth:users';
const SECRET_KEY = 'auth:secret';
export const SESSION_COOKIE = 'ssa_sess';
const SESSION_DAYS = 14;

/* ------------------------------------------------------------- secrets */

async function secret(): Promise<string> {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  let s = await kvGet<string>(SECRET_KEY);
  if (!s) {
    s = randomBytes(32).toString('hex');
    await kvSet(SECRET_KEY, s);
  }
  return s;
}

/* ------------------------------------------------------------- passwords */

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pw, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(pw: string, stored: string): boolean {
  const [alg, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const test = scryptSync(pw, salt, 32);
  const ref = Buffer.from(hash, 'hex');
  return test.length === ref.length && timingSafeEqual(test, ref);
}

/* ------------------------------------------------------------- users */

export async function listUsers(): Promise<AuthUser[]> {
  return (await kvGet<AuthUser[]>(USERS_KEY)) ?? [];
}

/** First boot: create the admin from env (or the documented default). */
export async function ensureSeedAdmin(): Promise<void> {
  const users = await listUsers();
  if (users.length) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'Sugar@2026';
  const admin: AuthUser = {
    id: 'u_admin',
    username,
    passHash: hashPassword(password),
    role: 'admin',
    createdAt: new Date().toISOString(),
  };
  await kvSet(USERS_KEY, [admin]);
  await logAudit({ action: 'auth.seed_admin', entity: 'auth', entityId: admin.id, details: { username } });
}

export async function findUser(username: string): Promise<AuthUser | null> {
  const u = username.trim().toLowerCase();
  return (await listUsers()).find((x) => x.username.toLowerCase() === u) ?? null;
}

export async function verifyLogin(username: string, password: string): Promise<AuthUser | null> {
  await ensureSeedAdmin();
  const u = await findUser(username);
  if (!u || !verifyPassword(password, u.passHash)) return null;
  return u;
}

export async function createUser(username: string, password: string, role: Role, actor: string): Promise<{ ok: boolean; error?: string }> {
  username = username.trim();
  if (!/^[A-Za-z0-9_.@-]{3,32}$/.test(username)) return { ok: false, error: 'invalid_username' };
  if (password.length < 6) return { ok: false, error: 'weak_password' };
  if (await findUser(username)) return { ok: false, error: 'username_taken' };
  const users = await listUsers();
  const u: AuthUser = {
    id: 'u_' + randomBytes(6).toString('hex'),
    username,
    passHash: hashPassword(password),
    role,
    createdAt: new Date().toISOString(),
  };
  await kvSet(USERS_KEY, [...users, u]);
  await logAudit({ action: 'auth.create_user', actor, entity: 'auth', entityId: u.id, details: { username, role } });
  return { ok: true };
}

export async function deleteUser(id: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  const users = await listUsers();
  const target = users.find((u) => u.id === id);
  if (!target) return { ok: false, error: 'not_found' };
  if (target.role === 'admin' && users.filter((u) => u.role === 'admin').length <= 1) {
    return { ok: false, error: 'last_admin' };
  }
  await kvSet(USERS_KEY, users.filter((u) => u.id !== id));
  await logAudit({ action: 'auth.delete_user', actor, entity: 'auth', entityId: id, details: { username: target.username } });
  return { ok: true };
}

/** Change the caller's own password (current password required). */
export async function changePassword(uid: string, current: string, next: string, actor: string): Promise<{ ok: boolean; error?: string }> {
  if (next.length < 6) return { ok: false, error: 'weak_password' };
  const users = await listUsers();
  const u = users.find((x) => x.id === uid);
  if (!u) return { ok: false, error: 'not_found' };
  if (!verifyPassword(current, u.passHash)) return { ok: false, error: 'bad_credentials' };
  u.passHash = hashPassword(next);
  await kvSet(USERS_KEY, users);
  await logAudit({ action: 'auth.change_password', actor, entity: 'auth', entityId: uid });
  return { ok: true };
}

/* ------------------------------------------------------------- session tokens */

export async function signSession(s: Session): Promise<string> {
  const payload = Buffer.from(JSON.stringify({ ...s, exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  const sig = createHmac('sha256', await secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export async function readSession(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expect = createHmac('sha256', await secret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const j = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!j?.uid || (j.role !== 'admin' && j.role !== 'viewer') || typeof j.exp !== 'number' || j.exp < Date.now()) return null;
    return { uid: j.uid, username: j.username, role: j.role };
  } catch {
    return null;
  }
}

export async function sessionFromRequest(req: Request): Promise<Session | null> {
  const cookie = req.headers.get('cookie') ?? '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return readSession(m?.[1] ? decodeURIComponent(m[1]) : null);
}

/* ------------------------------------------------------------- guards */

export const unauthorized = () => NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
export const forbidden = () => NextResponse.json({ ok: false, error: 'forbidden_viewer' }, { status: 403 });

/** Any authenticated session (admin OR viewer) — for read-only routes. */
export async function requireUser(req: Request): Promise<Session | null> {
  return sessionFromRequest(req);
}

/** Admin-only — for every mutating route. Returns the session or null (reply 401/403). */
export async function requireAdmin(req: Request): Promise<Session | null> {
  const s = await sessionFromRequest(req);
  return s?.role === 'admin' ? s : null;
}

/* ------------------------------------------------------------- login throttling */

type Fail = { n: number; until: number };
const g2 = globalThis as typeof globalThis & { __sugarLoginFails?: Map<string, Fail> };
const fails: Map<string, Fail> = (g2.__sugarLoginFails ??= new Map());

export function loginThrottle(key: string): { allowed: boolean; retryAfterSec: number } {
  const f = fails.get(key);
  if (f && f.until > Date.now()) return { allowed: false, retryAfterSec: Math.ceil((f.until - Date.now()) / 1000) };
  return { allowed: true, retryAfterSec: 0 };
}

export function loginFailed(key: string): void {
  const f = fails.get(key) ?? { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 5) {
    f.until = Date.now() + 10 * 60_000; // 10-minute lock after 5 failures
    f.n = 0;
  }
  fails.set(key, f);
}

export function loginSucceeded(key: string): void {
  fails.delete(key);
}
