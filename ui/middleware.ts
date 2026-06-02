import { NextRequest, NextResponse } from 'next/server';

// When AUTH_BYPASS=true or Okta is not configured, the app runs unauthenticated.
// When Okta is configured and AUTH_BYPASS is absent, every non-auth request
// must carry a valid okta_session cookie; missing one → redirect to /api/auth/okta/login.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow: auth routes, static assets, Next.js internals.
  if (
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/auth/') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // If Okta is not configured or bypass is on, pass through.
  const oktaConfigured = !!process.env.OKTA_DOMAIN && !!process.env.OKTA_CLIENT_ID && !!process.env.NEXTAUTH_SECRET;
  if (!oktaConfigured || process.env.AUTH_BYPASS === 'true') {
    return NextResponse.next();
  }

  // Require session cookie.
  const session = request.cookies.get('okta_session');
  if (!session) {
    const loginUrl = new URL('/api/auth/okta/login', request.url);
    loginUrl.searchParams.set('returnTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
