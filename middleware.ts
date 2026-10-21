import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Gate the whole platform behind the login screen. This checks cookie
 * PRESENCE only (Edge middleware has no DB); the session signature is always
 * verified inside the Node route handlers — requireAdmin() on every mutation.
 */
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout', '/api/auth/session'];
const PUBLIC_FILES = ['/manifest.webmanifest', '/icon.svg', '/app-qr.png', '/favicon.ico'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/')) ||
    PUBLIC_FILES.includes(pathname) ||
    pathname.startsWith('/_next')
  ) {
    return NextResponse.next();
  }

  const hasCookie = Boolean(req.cookies.get('ssa_sess')?.value);
  if (hasCookie) return NextResponse.next();

  // Cron path: the refresh endpoint's internal fan-out carries the secret.
  const rt = process.env.REFRESH_TOKEN;
  if (rt && req.headers.get('x-refresh-token') === rt) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
