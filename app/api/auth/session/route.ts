import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/auth/session → the current signed-in user (or null). */
export async function GET(req: Request) {
  const sess = await sessionFromRequest(req);
  return NextResponse.json(
    { ok: true, user: sess ? { username: sess.username, role: sess.role } : null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
