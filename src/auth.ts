import { log } from '@webfx-rd/cloud-utils/log';
import { spanner } from '@webfx-rd/cloud-utils/spanner';
import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
  OAuthClientInformationFull,
  OAuthMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import express, { Request, Response, Router } from 'express';
import {
  createOAuthMetadata,
  mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { OAuthTokensSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';

import type { GenerateAuthUrlOpts } from 'google-auth-library';
import type {
  AuthorizationParams,
  OAuthTokenVerifier,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';

export class SpannerClientsStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string) {
    const [rows] = await spanner.query(
      'SELECT data FROM oauthClients WHERE oauthClientId = @clientId',
      {
        databasePath: 'devops.mcp',
        params: { clientId },
      }
    );
    return (rows[0] as { data: OAuthClientInformationFull } | undefined)?.data;
  }

  async registerClient(clientMetadata: OAuthClientInformationFull) {
    log.info('Registering OAuth client', clientMetadata);
    await spanner.insert('devops.mcp.oauthClients', {
      oauthClientId: clientMetadata.client_id,
      data: clientMetadata,
      updatedAt: spanner.COMMIT_TIMESTAMP,
    });
    return clientMetadata;
  }
}

/**
 * Implements OAuthServerProvider to handle OAuth flows with Google as the identity provider.
 * This provider bridges the gap between MCP's DCR-compliant interface and Google OAuth.
 */
class GoogleOAuthProvider implements OAuthServerProvider {
  private readonly _clientsStore: OAuthRegisteredClientsStore;
  private readonly googleClientId: string;
  private readonly googleClientSecret: string;
  private readonly scope: GenerateAuthUrlOpts['scope'];
  private readonly googleOauthClient: OAuth2Client;

  // Google's OAuth server performs it
  skipLocalPkceValidation = true;

  constructor(
    clientsStore: OAuthRegisteredClientsStore,
    googleClientId: string,
    googleClientSecret: string,
    scope: GenerateAuthUrlOpts['scope']
  ) {
    this._clientsStore = clientsStore;
    this.googleClientId = googleClientId;
    this.googleClientSecret = googleClientSecret;
    this.scope = scope;
    this.googleOauthClient = new OAuth2Client({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    });
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  async authorize(
    _client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: express.Response
  ): Promise<void> {
    const authUrl = this.googleOauthClient.generateAuthUrl({
      access_type: 'offline',
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
      scope: this.scope,
      ...(params.state && { state: params.state }),
    });
    res.redirect(authUrl);
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    _authorizationCode: string
  ): Promise<string> {
    // We don't store challenges locally since Google validates PKCE
    return '';
  }

  async exchangeAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    redirectUri?: string
  ): Promise<OAuthTokens> {
    const { tokens } = await this.googleOauthClient.getToken({
      code: authorizationCode,
      ...(codeVerifier && { codeVerifier }),
      ...(redirectUri && { redirect_uri: redirectUri }),
    });
    // Validate and narrows types
    return OAuthTokensSchema.parse(tokens);
  }

  async exchangeRefreshToken(
    _client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[]
  ): Promise<OAuthTokens> {
    // The refreshToken comes from the MCP client (e.g., Claude Desktop) that previously
    // authenticated and is now refreshing their access token. We can't use googleOauthClient
    // because it's a shared instance that doesn't track session-specific tokens, and doesn't offer
    // a stateless API for refresh token exchange (unlike getToken() for authorization codes).
    // Therefore, we call the token endpoint directly instead.
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.googleClientId,
      client_secret: this.googleClientSecret,
      refresh_token: refreshToken,
      ...(scopes?.length && { scopes: scopes.join(' ') }),
    });
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${response.status} - ${errorText}`);
    }
    return (await response.json()) as OAuthTokens;
  }

  async verifyAccessToken(token: string) {
    try {
      const tokenInfo = await this.googleOauthClient.getTokenInfo(token);
      if (tokenInfo.aud !== this.googleClientId) {
        throw new Error('Token was not issued to this client');
      }
      // Convert milliseconds to seconds
      const expiresAt = Math.floor(tokenInfo.expiry_date / 1000);
      return {
        ...tokenInfo,
        token,
        clientId: tokenInfo.aud,
        scopes: tokenInfo.scopes || [],
        expiresAt,
      };
    } catch (error) {
      throw new Error(`Invalid or expired token: ${error}`);
    }
  }
}

/**
 * Google OAuth Provider for MCP
 *
 * This provider bridges the gap between MCP's DCR-compliant interface and Google OAuth.
 * MCP clients can dynamically register, but actual authentication goes through Google
 * using pre-registered credentials.
 */
export function setupGoogleAuthServer({ issuerUrl }: { issuerUrl: URL }): {
  router: Router;
  metadata: OAuthMetadata;
} {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error(
      'Missing required environment variables: GOOGLE_CLIENT_ID and/or GOOGLE_CLIENT_SECRET'
    );
  }

  const clientsStore = new SpannerClientsStore();

  const googleScopes = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
  ];

  const provider = new GoogleOAuthProvider(
    clientsStore,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    googleScopes
  );

  const router = Router();
  router.use(express.json());
  router.use(express.urlencoded({ extended: true }));

  // Add OAuth routes to the auth router
  router.use(mcpAuthRouter({ provider, issuerUrl, scopesSupported: googleScopes }));

  // Add introspection endpoint for token verification
  router.post('/introspect', async (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      if (!token) {
        res.status(400).json({ error: 'Token is required' });
        return;
      }

      const { clientId, scopes, expiresAt, ...rest } = await provider.verifyAccessToken(token);
      res.json({
        ...rest,
        active: true,
        client_id: clientId,
        scope: scopes.join(' '),
        exp: expiresAt,
      });
    } catch (error) {
      res.status(401).json({
        active: false,
        error: 'Unauthorized',
        error_description: `Invalid token: ${error}`,
      });
    }
  });

  const oauthMetadata: OAuthMetadata = createOAuthMetadata({
    provider,
    issuerUrl,
    scopesSupported: googleScopes,
  });

  // Fix endpoint URLs to include the /auth prefix
  // createOAuthMetadata generates URLs at the origin, but routes are mounted under /auth
  oauthMetadata.authorization_endpoint = new URL('authorize', issuerUrl).href;
  oauthMetadata.token_endpoint = new URL('token', issuerUrl).href;
  oauthMetadata.registration_endpoint = new URL('register', issuerUrl).href;
  oauthMetadata.introspection_endpoint = new URL('introspect', issuerUrl).href;

  return { router, metadata: oauthMetadata };
}

export function getAuthMiddleware({
  mcpServerUrl,
  introspectionUrl,
}: {
  mcpServerUrl: URL;
  introspectionUrl: string | URL;
}): ReturnType<typeof requireBearerAuth> {
  const tokenVerifier: OAuthTokenVerifier = {
    async verifyAccessToken(token) {
      const response = await fetch(introspectionUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: token }).toString(),
      });
      if (!response.ok) {
        throw new Error(`Invalid or expired token: ${await response.text()}`);
      }

      const data = (await response.json()) as { [key: string]: any };
      return {
        ...data,
        token,
        clientId: data.client_id,
        scopes: data.scope ? data.scope.split(' ') : [],
        expiresAt: data.exp,
      };
    },
  };

  return requireBearerAuth({
    verifier: tokenVerifier,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpServerUrl),
  });
}
