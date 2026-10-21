import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE, verifyLogin, signSession,
  loginThrottle, loginFailed, loginSucceeded,
} from '../../../../lib/auth';
import { logAudit } from '../../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/login { username, password } → sets the session cookie. */
export async function POST(req: Request) {
  let b: { username?: unknown; password?: unknown };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const username = String(b.username ?? '').trim();
  const password = String(b.password ?? '');
  if (!username || !password) {
    return NextResponse.json({ ok: false, error: 'missing_credentials' }, { status: 400 });
  }

  const key = username.toLowerCase();
  const th = loginThrottle(key);
  if (!th.allowed) {
    return NextResponse.json(
      { ok: false, error: 'locked', retryAfterSec: th.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(th.retryAfterSec) } },
    );
  }

  const user = await verifyLogin(username, password);
  if (!user) {
    loginFailed(key);
    return NextResponse.json({ ok: false, error: 'bad_credentials' }, { status: 401 });
  }
  loginSucceeded(key);

  const token = await signSession({ uid: user.id, username: user.username, role: user.role });
  await logAudit({ action: 'auth.login', actor: user.username, entity: 'auth', entityId: user.id });

  // Secure only when the request itself arrived over https (Render proxy sets
  // x-forwarded-proto). Local http:// deployments keep the cookie working.
  const proto = (req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '')).toLowerCase();
  const res = NextResponse.json({ ok: true, user: { username: user.username, role: user.role } });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: proto === 'https' && process.env.AUTH_INSECURE_COOKIE !== '1',
    path: '/',
    maxAge: 14 * 86400,
  });
  return res;
}
