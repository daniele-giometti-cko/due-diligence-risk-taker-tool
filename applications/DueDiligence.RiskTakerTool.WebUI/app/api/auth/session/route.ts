import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

// Returns the current session's user info for the UI to show who is logged in.
// Never exposes the access token to the browser.
export async function GET() {
  const session = await requireAuth();
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({
    authenticated: true,
    user: {
      name: session.user.name,
      email: session.user.email,
    },
  });
}
