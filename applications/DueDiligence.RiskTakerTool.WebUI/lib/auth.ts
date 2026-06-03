import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import type { SessionData } from '@/lib/okta-auth';

// Synthetic session returned when AUTH_BYPASS=true (local dev without Okta).
const DEV_SESSION: SessionData = {
  user: { sub: 'dev-user', name: 'Dev User', email: 'dev@localhost', groups: [] },
  tokens: { accessToken: 'dev-token', idToken: 'dev-token', expiresIn: 86_400 },
  expiresAt: Date.now() + 86_400_000,
};

function getNextAuthSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET env var is not set');
  return secret;
}

export async function requireAuth(): Promise<SessionData | null> {
  if (process.env.AUTH_BYPASS === 'true') return DEV_SESSION;

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('okta_session')?.value;
    if (!token) return null;

    const secret = getNextAuthSecret();
    const session = jwt.verify(token, secret) as SessionData;

    if (Date.now() > session.expiresAt) {
      cookieStore.delete('okta_session');
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

export { getNextAuthSecret };
