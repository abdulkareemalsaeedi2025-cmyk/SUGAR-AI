import { NextResponse } from 'next/server';
import { requireAdmin, unauthorized, forbidden, listUsers, createUser, deleteUser, sessionFromRequest, type Role } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/auth/users → admin: list users (without password hashes). */
export async function GET(req: Request) {
  const sess = await sessionFromRequest(req);
  if (!sess) return unauthorized();
  if (sess.role !== 'admin') return forbidden();
  const users = (await listUsers()).map((u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt }));
  return NextResponse.json({ ok: true, users }, { headers: { 'Cache-Control': 'no-store' } });
}

/** POST /api/auth/users { username, password, role } → admin: create a user. */
export async function POST(req: Request) {
  const sess = await requireAdmin(req);
  if (!sess) return (await sessionFromRequest(req)) ? forbidden() : unauthorized();
  let b: { username?: unknown; password?: unknown; role?: unknown };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const role: Role = b.role === 'admin' ? 'admin' : 'viewer';
  const r = await createUser(String(b.username ?? ''), String(b.password ?? ''), role, sess.username);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 422 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/auth/users?id=… → admin: delete a user (never the last admin). */
export async function DELETE(req: Request) {
  const sess = await requireAdmin(req);
  if (!sess) return (await sessionFromRequest(req)) ? forbidden() : unauthorized();
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ ok: false, error: 'missing_id' }, { status: 400 });
  if (id === sess.uid) return NextResponse.json({ ok: false, error: 'cannot_delete_self' }, { status: 422 });
  const r = await deleteUser(id, sess.username);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 422 });
  return NextResponse.json({ ok: true });
}
