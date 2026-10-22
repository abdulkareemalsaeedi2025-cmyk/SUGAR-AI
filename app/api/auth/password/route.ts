import { NextResponse } from 'next/server';
import { sessionFromRequest, unauthorized, changePassword } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/auth/password { currentPassword, newPassword } — change own password. */
export async function POST(req: Request) {
  const sess = await sessionFromRequest(req);
  if (!sess) return unauthorized();
  let b: { currentPassword?: unknown; newPassword?: unknown };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const r = await changePassword(sess.uid, String(b.currentPassword ?? ''), String(b.newPassword ?? ''), sess.username);
  if (!r.ok) {
    const status = r.error === 'bad_credentials' ? 401 : 422;
    return NextResponse.json({ ok: false, error: r.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
