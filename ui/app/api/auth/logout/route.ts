import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  cookieStore.delete('okta_session');

  // Redirect to Okta end-session if configured, otherwise just go home.
  const domain = process.env.OKTA_DOMAIN;
  const nextAuthUrl = process.env.NEXTAUTH_URL || request.nextUrl.origin;

  if (domain && process.env.AUTH_BYPASS !== 'true') {
    const params = new URLSearchParams({ post_logout_redirect_uri: nextAuthUrl });
    return NextResponse.redirect(`https://${domain}/oauth2/v1/logout?${params}`);
  }

  return NextResponse.redirect(new URL('/', request.url));
}
