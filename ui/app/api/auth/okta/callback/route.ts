import { NextRequest, NextResponse } from 'next/server';
import { OktaAuth, type SessionData } from '@/lib/okta-auth';
import { getNextAuthSecret } from '@/lib/auth';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export async function GET(request: NextRequest) {
  if (process.env.AUTH_BYPASS === 'true') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    console.error('[okta-callback] IdP error:', error, searchParams.get('error_description'));
    return NextResponse.redirect(new URL(`/auth/error?error=${encodeURIComponent(error)}`, request.url));
  }

  if (!code || !state) {
    return new NextResponse('Missing code or state', { status: 400 });
  }

  const cookieStore = await cookies();
  const storedState = cookieStore.get('okta_state')?.value;
  const codeVerifier = cookieStore.get('okta_code_verifier')?.value;
  const dpopStr = cookieStore.get('okta_dpop_keypair')?.value;

  if (!storedState || !codeVerifier || !dpopStr || state !== storedState) {
    return new NextResponse('Invalid state or missing PKCE data', { status: 400 });
  }

  const domain = process.env.OKTA_DOMAIN!;
  const clientId = process.env.OKTA_CLIENT_ID!;
  const nextAuthUrl = process.env.NEXTAUTH_URL || request.nextUrl.origin;

  try {
    const oktaAuth = new OktaAuth({
      domain, clientId,
      redirectUri: `${nextAuthUrl}/api/auth/okta/callback`,
      scopes: 'openid email profile groups',
    });

    const kp = JSON.parse(dpopStr);
    oktaAuth.setCodeVerifier(codeVerifier);
    oktaAuth.setDPoPKeyPair({
      privateKey: crypto.createPrivateKey(kp.privateKey),
      publicKey: crypto.createPublicKey(kp.publicKey),
      jwk: kp.jwk,
    });

    const tokens = await oktaAuth.exchangeCodeForTokens(code);
    const userInfo = await oktaAuth.getUserInfo(tokens.accessToken);

    const session: SessionData = {
      user: userInfo, tokens,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
    };

    const sessionToken = jwt.sign(session, getNextAuthSecret(), { expiresIn: tokens.expiresIn });

    const returnTo = cookieStore.get('okta_return_to')?.value;
    ['okta_state', 'okta_code_verifier', 'okta_dpop_keypair', 'okta_return_to'].forEach(k =>
      cookieStore.delete(k)
    );

    cookieStore.set('okta_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: tokens.expiresIn,
    });

    const safeReturn = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
    return NextResponse.redirect(new URL(safeReturn, nextAuthUrl));
  } catch (err) {
    console.error('[okta-callback] error:', err instanceof Error ? err.message : err);
    return NextResponse.redirect(new URL('/auth/error?error=Configuration', request.url));
  }
}
