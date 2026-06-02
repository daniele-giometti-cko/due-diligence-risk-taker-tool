import { NextRequest, NextResponse } from 'next/server';
import { OktaAuth } from '@/lib/okta-auth';
import { cookies } from 'next/headers';
import { randomUUID } from 'crypto';

export async function GET(request: NextRequest) {
  // AUTH_BYPASS: skip Okta, go straight to the app.
  if (process.env.AUTH_BYPASS === 'true') {
    const returnTo = request.nextUrl.searchParams.get('returnTo') || '/';
    return NextResponse.redirect(new URL(returnTo, request.url));
  }

  const domain = process.env.OKTA_DOMAIN;
  const clientId = process.env.OKTA_CLIENT_ID;
  const nextAuthUrl = process.env.NEXTAUTH_URL || request.nextUrl.origin;

  if (!domain || !clientId) {
    return new NextResponse(
      'Okta is not configured. Set OKTA_DOMAIN, OKTA_CLIENT_ID, and NEXTAUTH_SECRET in .env.local.',
      { status: 503 },
    );
  }

  const oktaAuth = new OktaAuth({
    domain,
    clientId,
    redirectUri: `${nextAuthUrl}/api/auth/okta/callback`,
    scopes: 'openid email profile groups',
  });

  const state = randomUUID();
  const authUrl = oktaAuth.getAuthorizationUrl(state);
  const kp = oktaAuth.getDPoPKeyPair();

  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === 'production';
  const opts = { httpOnly: true, secure, sameSite: 'lax' as const, maxAge: 600 };

  cookieStore.set('okta_code_verifier', oktaAuth.getCodeVerifier(), opts);
  cookieStore.set('okta_state', state, opts);
  cookieStore.set('okta_dpop_keypair', JSON.stringify({
    privateKey: kp.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    publicKey: kp.publicKey.export({ format: 'pem', type: 'spki' }),
    jwk: kp.jwk,
  }), opts);

  const returnTo = request.nextUrl.searchParams.get('returnTo');
  if (returnTo) cookieStore.set('okta_return_to', returnTo, opts);

  return NextResponse.redirect(authUrl);
}
