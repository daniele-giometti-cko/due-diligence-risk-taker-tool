import { NextRequest, NextResponse } from 'next/server';
import { OktaAuth } from '@/lib/okta-auth';
import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';

export async function GET(request: NextRequest) {
  if (process.env.AUTH_BYPASS === 'true') {
    return NextResponse.redirect(new URL(request.nextUrl.searchParams.get('returnTo') || '/', request.url));
  }

  const authority = process.env.OKTA_AUTHORITY;
  const clientId = process.env.OKTA_CLIENT_ID;
  const clientSecret = process.env.OKTA_CLIENT_SECRET;
  const nextAuthUrl = process.env.NEXTAUTH_URL || request.nextUrl.origin;

  if (!authority || !clientId || !clientSecret) {
    return new NextResponse(
      'Okta is not configured. Set OKTA_AUTHORITY, OKTA_CLIENT_ID, and OKTA_CLIENT_SECRET in .env.local.',
      { status: 503 },
    );
  }

  const oktaAuth = new OktaAuth({
    authority,
    clientId,
    clientSecret,
    redirectUri: `${nextAuthUrl}/api/auth/okta/callback`,
    scopes: 'openid email profile',
  });

  const state = randomUUID();
  const authUrl = oktaAuth.getAuthorizationUrl(state);

  const cookieStore = cookies();
  const opts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, maxAge: 600 };

  cookieStore.set('okta_code_verifier', oktaAuth.getCodeVerifier(), opts);
  cookieStore.set('okta_state', state, opts);

  const returnTo = request.nextUrl.searchParams.get('returnTo');
  if (returnTo) cookieStore.set('okta_return_to', returnTo, opts);

  return NextResponse.redirect(authUrl);
}
