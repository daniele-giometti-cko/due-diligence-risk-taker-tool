import { NextRequest, NextResponse } from 'next/server';
import { OktaAuth, type SessionData } from '@/lib/okta-auth';
import { getNextAuthSecret } from '@/lib/auth';
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';

// Okta may use response_mode=form_post and POST the code+state as form data.
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const url = new URL(request.url);
  // Promote form fields to query params so the GET handler can process them uniformly.
  for (const [key, value] of form.entries()) {
    url.searchParams.set(key, value.toString());
  }
  return GET(new NextRequest(url, { headers: request.headers }));
}

export async function GET(request: NextRequest) {
  if (process.env.AUTH_BYPASS === 'true') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // Log everything we receive so we can diagnose what Okta is sending back.
  console.log('[okta-callback] full URL:', request.url);
  console.log('[okta-callback] query params:', Object.fromEntries(searchParams.entries()));

  if (error) {
    console.error('[okta-callback] Okta error:', error, searchParams.get('error_description'));
    return NextResponse.redirect(new URL(`/auth/error?error=${encodeURIComponent(error)}`, request.url));
  }

  // No code AND no error usually means Okta returned an error in the URL *fragment*
  // (#error=...) which the server never sees. Show a diagnostic page so the browser
  // can read the fragment and tell us what went wrong.
  if (!code || !state) {
    return new NextResponse(
      `<!DOCTYPE html>
<html>
<head><title>Okta callback debug</title></head>
<body style="font-family:monospace;padding:2rem">
  <h2>Okta callback — missing code/state</h2>
  <p>The server received no <code>code</code> or <code>state</code> params.
  Okta may have returned an error in the URL fragment (hash) instead of as query params.</p>
  <p><strong>Fragment received:</strong> <span id="frag">(reading…)</span></p>
  <p><strong>Full URL:</strong> <span id="url"></span></p>
  <script>
    document.getElementById('frag').textContent = location.hash || '(none)';
    document.getElementById('url').textContent = location.href;
  </script>
  <p style="margin-top:1rem"><a href="/api/auth/okta/login">Try again</a></p>
</body>
</html>`,
      { status: 400, headers: { 'Content-Type': 'text/html' } },
    );
  }

  const authority    = process.env.OKTA_AUTHORITY!;
  const clientId     = process.env.OKTA_CLIENT_ID!;
  const clientSecret = process.env.OKTA_CLIENT_SECRET!;
  const nextAuthUrl  = process.env.NEXTAUTH_URL || request.nextUrl.origin;

  try {
    const cookieStore = await cookies();
    const storedState   = cookieStore.get('okta_state')?.value;
    const codeVerifier  = cookieStore.get('okta_code_verifier')?.value;

    if (!storedState || !codeVerifier || state !== storedState) {
      return new NextResponse('Invalid state or missing PKCE verifier', { status: 400 });
    }

    const oktaAuth = new OktaAuth({
      authority, clientId, clientSecret,
      redirectUri: `${nextAuthUrl}/api/auth/okta/callback`,
      scopes: 'openid email profile',
    });
    oktaAuth.setCodeVerifier(codeVerifier);

    const tokens   = await oktaAuth.exchangeCodeForTokens(code);
    const userInfo = await oktaAuth.getUserInfo(tokens.accessToken);

    const session: SessionData = {
      user: userInfo,
      tokens,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
    };

    const sessionToken = jwt.sign(session, getNextAuthSecret(), { expiresIn: tokens.expiresIn });

    const returnTo = cookieStore.get('okta_return_to')?.value;
    ['okta_state', 'okta_code_verifier', 'okta_return_to'].forEach(k => cookieStore.delete(k));

    cookieStore.set('okta_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: tokens.expiresIn,
    });

    const safeReturn = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
    return NextResponse.redirect(new URL(safeReturn, nextAuthUrl));
  } catch (err) {
    console.error('[okta-callback]', err instanceof Error ? err.message : err);
    return NextResponse.redirect(new URL('/auth/error?error=Configuration', request.url));
  }
}
