import { NextResponse } from 'next/server';
import { SESSION_COOKIE, sessionFromRequest } from '../../../../lib/auth';
import { logAudit } from '../../../../lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/logout → clears the session cookie. */
export async function POST(req: Request) {
  const sess = await sessionFromRequest(req);
  if (sess) await logAudit({ action: 'auth.logout', actor: sess.username, entity: 'auth', entityId: sess.uid });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return res;
}
