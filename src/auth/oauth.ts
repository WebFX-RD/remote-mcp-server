import express, { Router } from 'express';
import { log } from '@webfx-rd/cloud-utils/log';
import { spanner } from '@webfx-rd/cloud-utils/spanner';

import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';
import { OAuthTokensSchema } from '@modelcontextprotocol/sdk/shared/auth.js';

import type { Request, Response } from 'express';
import type { GenerateAuthUrlOpts } from 'google-auth-library';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

import { mcpAuthRouter } from './mcp-auth-router.js';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from './env-vars.js';

export const OAUTH_PATHS = [
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
  '/authorize',
  '/token',
  '/introspect',
  '/register', // TODO: delete after we stop supporting DCR
];

export function getOAuthRouter({
  baseUrl,
  mcpServerUrl,
}: {
  baseUrl: URL;
  mcpServerUrl: URL;
}): Router {
  const clientsStore = new ClientMetadataStore();

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

  router.use(
    mcpAuthRouter({
      provider,
      issuerUrl: baseUrl,
      resourceServerUrl: mcpServerUrl,
      scopesSupported: googleScopes,
    })
  );

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

  return router;
}

/**
 * Implements OAuthServerProvider to handle OAuth flows with Google as the identity provider.
 * Uses Client ID Metadata Documents (MCP spec 2025-11-25) for client identification.
 */
class GoogleOAuthProvider implements OAuthServerProvider {
  private readonly _clientsStore: OAuthRegisteredClientsStore;
  private readonly googleClientId: string;
  private readonly googleClientSecret: string;
  private readonly scope: GenerateAuthUrlOpts['scope'];
  private readonly googleOauthClient: OAuth2Client;

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
      prompt: 'consent', // required to get refresh_token
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
    return '';
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    redirectUri?: string
  ): Promise<OAuthTokens> {
    const { tokens } = await this.googleOauthClient.getToken({
      code: authorizationCode,
      ...(codeVerifier && { codeVerifier }),
      ...(redirectUri && { redirect_uri: redirectUri }),
    });
    if (!tokens.access_token) {
      throw new Error('Upstream error: Missing access_token');
    }

    const tokenInfo = await this.googleOauthClient.getTokenInfo(tokens.access_token);
    const { sub: googleUserId, email } = tokenInfo;
    if (!googleUserId) {
      throw new Error('Upstream error: Missing sub');
    }
    if (!email) {
      throw new Error('Upstream error: Missing email');
    }
    if (!email.endsWith('@webfx.com')) {
      throw new Error('Access restricted to @webfx.com email addresses');
    }

    const { client_id: clientId } = client;
    const registrationMechanism = getClientRegistrationMechanism(clientId);
    if (registrationMechanism === 'CIMD') {
      await spanner.transaction({
        databasePath: 'devops.mcp',
        run: async (transaction) => {
          const [rows] = await spanner.query(
            `
          SELECT 1
          FROM mcpAuthUsers
          WHERE
            clientId = @clientId AND
            googleUserId = @googleUserId
          `,
            { transaction, params: { clientId, googleUserId } }
          );
          if (rows.length) {
            return;
          }
          log.info(`New user authenticated: ${email}`, { clientId, googleUserId });
          spanner.insert(
            'mcpAuthUsers',
            {
              clientId,
              googleUserId,
              email,
              tokenInfo,
              updatedAt: spanner.COMMIT_TIMESTAMP,
            },
            { transaction }
          );
        },
      });
    } else {
      // TODO: delete after we stop supporting DCR
      const oauthClientId = clientId;
      await spanner.transaction({
        databasePath: 'devops.mcp',
        run: async (transaction) => {
          const [rows] = await spanner.query(
            `
            SELECT 1
            FROM oauthClientUsers
            WHERE
              oauthClientId = @oauthClientId AND
              googleUserId = @googleUserId
            `,
            {
              transaction,
              params: { oauthClientId, googleUserId },
            }
          );
          if (rows.length) {
            return;
          }
          log.info(`[DCR] New user authenticated ${email}`, { oauthClientId, googleUserId });
          spanner.insert(
            'oauthClientUsers',
            {
              oauthClientId,
              googleUserId,
              email,
              tokenInfo,
              updatedAt: spanner.COMMIT_TIMESTAMP,
            },
            { transaction }
          );
        },
      });
    }

    return OAuthTokensSchema.parse(setExpiresIn(tokens));
  }

  async exchangeRefreshToken(
    _client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[]
  ): Promise<OAuthTokens> {
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
      log.error('Token refresh failed:', errorText);
      throw new Error('Upstream error: Token refresh failed');
    }
    const tokens = (await response.json()) as {
      access_token: string;
      expires_in: number;
      scope: string;
      token_type: 'Bearer';
      id_token: string;
    };
    return OAuthTokensSchema.parse(setExpiresIn(tokens));
  }

  async verifyAccessToken(token: string) {
    try {
      const tokenInfo = await this.googleOauthClient.getTokenInfo(token);
      if (tokenInfo.aud !== this.googleClientId) {
        throw new Error('Token was not issued to this client');
      }
      if (!tokenInfo.email?.endsWith('@webfx.com')) {
        throw new Error('Access restricted to @webfx.com email addresses');
      }
      const expiresAt = Math.floor(tokenInfo.expiry_date / 1000);
      return {
        ...tokenInfo,
        token,
        clientId: tokenInfo.aud,
        scopes: tokenInfo.scopes || [],
        expiresAt,
      };
    } catch (error) {
      log.error('verifyAccessToken failed:', error);
      throw new Error(`Invalid or expired token: ${error}`);
    }
  }
}

/**
 * Implements Client ID Metadata Documents (MCP spec 2025-11-25).
 * Fetches client metadata from the client's HTTPS URL instead of storing registrations.
 */
class ClientMetadataStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const registrationMechanism = getClientRegistrationMechanism(clientId);

    if (registrationMechanism === 'DCR') {
      log.info(`[DCR] getting client ${clientId}`);
      const [rows] = await spanner.query(
        'SELECT data FROM oauthClients WHERE oauthClientId = @clientId',
        {
          databasePath: 'devops.mcp',
          params: { clientId },
        }
      );
      return (rows[0] as { data: OAuthClientInformationFull } | undefined)?.data;
    }

    const response = await fetch(clientId);
    if (!response.ok) {
      throw new Error(`Failed to fetch client metadata: ${response.status}`);
    }

    const metadata = (await response.json()) as OAuthClientInformationFull;
    if (metadata.client_id !== clientId) {
      throw new Error('client_id in metadata does not match the URL');
    }

    return metadata;
  }

  async registerClient(clientMetadata: OAuthClientInformationFull) {
    log.info('[DCR] Registering client', clientMetadata);
    try {
      await spanner.insert('devops.mcp.oauthClients', {
        oauthClientId: clientMetadata.client_id,
        data: clientMetadata,
        updatedAt: spanner.COMMIT_TIMESTAMP,
      });
      return clientMetadata;
    } catch (error) {
      log.error('[DCR] Failed to register client:', error);
      throw error;
    }
  }
}

function setExpiresIn(tokens: any) {
  if (typeof tokens?.expiry_date === 'number') {
    tokens.expires_in = Math.floor((tokens.expiry_date - Date.now()) / 1000);
  }
  return tokens;
}

/**
 * Determine the client registration mechanism.
 * https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#client-registration-approaches
 */
function getClientRegistrationMechanism(clientId: string) {
  if (typeof clientId !== 'string') {
    throw new Error(`Expected clientId to be a string, received ${clientId}`);
  }
  if (clientId.startsWith('https://')) {
    return 'CIMD'; // Client ID Metadata Documents
  }
  return 'DCR'; // Dynamic Client Registration
}
