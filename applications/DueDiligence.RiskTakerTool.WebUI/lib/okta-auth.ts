import crypto from 'crypto';

export interface OktaConfig {
  authority: string;   // full issuer URL incl. auth server path
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
}

export interface OktaTokens {
  accessToken: string;
  idToken: string;
  expiresIn: number;
}

export interface OktaUserInfo {
  sub: string;
  name?: string;
  email?: string;
  preferred_username?: string;
  groups?: string[];
  [key: string]: unknown;
}

export interface SessionData {
  user: OktaUserInfo;
  tokens: OktaTokens;
  expiresAt: number;
}

// Standard authorization-code + PKCE flow for a confidential client.
export class OktaAuth {
  private config: OktaConfig;
  private codeVerifier: string;
  private codeChallenge: string;

  constructor(config: OktaConfig) {
    this.config = config;
    this.codeVerifier = crypto.randomBytes(32).toString('base64url');
    this.codeChallenge = crypto
      .createHash('sha256')
      .update(this.codeVerifier)
      .digest('base64url');
  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      response_mode: 'query',
      scope: this.config.scopes,
      redirect_uri: this.config.redirectUri,
      code_challenge: this.codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce: crypto.randomUUID(),
    });
    return `${this.config.authority}/v1/authorize?${params}`;
  }

  async exchangeCodeForTokens(code: string): Promise<OktaTokens> {
    const url = `${this.config.authority}/v1/token`;

    // Confidential client: client_secret sent as Basic auth header.
    // PKCE code_verifier proves possession of the original auth request.
    const basicAuth = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString('base64');

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: this.codeVerifier,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${text}`);
    }

    const t = await res.json();
    return {
      accessToken: t.access_token,
      idToken: t.id_token,
      expiresIn: t.expires_in,
    };
  }

  async getUserInfo(accessToken: string): Promise<OktaUserInfo> {
    const url = `${this.config.authority}/v1/userinfo`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`UserInfo failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  getCodeVerifier() { return this.codeVerifier; }
  setCodeVerifier(v: string) { this.codeVerifier = v; }
}
