import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
  OAuthClientInformationFull,
  OAuthMetadata,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import express, { Request, Response } from 'express';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  createOAuthMetadata,
  mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import {
  ProxyOAuthServerProvider,
  ProxyOptions,
} from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js';

// Type for Google's tokeninfo response
interface GoogleTokenInfo {
  aud: string;
  scope?: string;
  exp?: number;
  expires_in?: number;
}

// In-memory client store for DCR
export class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  async getClient(clientId: string) {
    return this.clients.get(clientId);
  }

  async registerClient(clientMetadata: OAuthClientInformationFull) {
    this.clients.set(clientMetadata.client_id, clientMetadata);
    return clientMetadata;
  }
}

/**
 * Custom OAuth provider that extends ProxyOAuthServerProvider to handle
 * client registration locally while proxying the auth flow to Google.
 */
class GoogleProxyOAuthServerProvider extends ProxyOAuthServerProvider {
  private _clientsStore: OAuthRegisteredClientsStore;

  constructor(options: ProxyOptions, clientsStore: OAuthRegisteredClientsStore) {
    super(options);
    this._clientsStore = clientsStore;
  }

  // Override the clientsStore getter to use our local store
  override get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }
}

/**
 * Google OAuth Provider for MCP
 *
 * This provider bridges the gap between MCP's DCR-compliant interface and Google OAuth.
 * MCP clients can dynamically register, but actual authentication goes through Google
 * using pre-registered credentials.
 */
export const setupGoogleAuthServer = ({
  authServerUrl,
}: {
  authServerUrl: URL;
  mcpServerUrl: URL;
}): OAuthMetadata => {
  // Validate required environment variables
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error(
      'Missing required environment variables: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set'
    );
  }

  // Create local DCR client store
  const clientsStore = new InMemoryClientsStore();

  // Create custom provider that handles registration locally but proxies auth to Google
  const provider = new GoogleProxyOAuthServerProvider(
    {
      endpoints: {
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        revocationUrl: 'https://oauth2.googleapis.com/revoke',
      },
      verifyAccessToken: async (token: string): Promise<AuthInfo> => {
        // Verify token with Google's tokeninfo endpoint
        const response = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`
        );

        if (!response.ok) {
          throw new Error('Invalid or expired token');
        }

        const tokenInfo = (await response.json()) as GoogleTokenInfo;

        // Verify the token was issued to our client
        if (tokenInfo.aud !== GOOGLE_CLIENT_ID) {
          throw new Error('Token was not issued to this client');
        }

        return {
          token,
          clientId: tokenInfo.aud,
          scopes: tokenInfo.scope ? tokenInfo.scope.split(' ') : [],
          expiresAt: tokenInfo.exp,
        };
      },
      getClient: async (clientId: string) => {
        return clientsStore.getClient(clientId);
      },
    },
    clientsStore
  );

  // Create auth server Express app
  const authApp = express();
  authApp.use(express.json());
  authApp.use(express.urlencoded({ extended: true }));

  // Add OAuth routes to the auth server
  authApp.use(
    mcpAuthRouter({
      provider,
      issuerUrl: authServerUrl,
      scopesSupported: [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
    })
  );

  // Add introspection endpoint for token verification
  authApp.post('/introspect', async (req: Request, res: Response) => {
    try {
      const { token } = req.body;
      if (!token) {
        res.status(400).json({ error: 'Token is required' });
        return;
      }

      const tokenInfo = await provider.verifyAccessToken(token);
      res.json({
        active: true,
        client_id: tokenInfo.clientId,
        scope: tokenInfo.scopes.join(' '),
        exp: tokenInfo.expiresAt,
      });
      return;
    } catch (error) {
      res.status(401).json({
        active: false,
        error: 'Unauthorized',
        error_description: `Invalid token: ${error}`,
      });
    }
  });

  const auth_port = authServerUrl.port;

  // Start the auth server
  authApp.listen(auth_port, () => {
    console.log(`OAuth Authorization Server listening on port ${auth_port}`);
    console.log(`Using Google OAuth with client ID: ${GOOGLE_CLIENT_ID}`);
  });

  // Create OAuth metadata
  const oauthMetadata: OAuthMetadata = createOAuthMetadata({
    provider,
    issuerUrl: authServerUrl,
    scopesSupported: [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  });

  oauthMetadata.introspection_endpoint = new URL('/introspect', authServerUrl).href;

  return oauthMetadata;
};
