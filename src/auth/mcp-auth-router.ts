import { Router } from 'express';
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';

import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type {
  OAuthMetadata,
  OAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/sdk/shared/auth.js';

/**
 * This function was forked from [1].
 * The primary motivation was to indicate that the we support Client ID Metadata Documents [2].
 * The secondary motivation was to simplify the code by using few helper functions and instead
 * inlining the code.
 *
 * [1] https://github.com/modelcontextprotocol/typescript-sdk/blob/6dd7cd4e16cf7ece373dff4138e9a065aa1c6ae7/src/server/auth/router.ts#L129
 * [2] https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#client-registration-approaches:~:text=supports%20it%20(via-,client_id_metadata_document_supported,-in%20OAuth%20Authorization
 */
export function mcpAuthRouter({
  provider,
  issuerUrl,
  resourceServerUrl,
  scopesSupported,
}: {
  provider: OAuthServerProvider;
  issuerUrl: URL;
  resourceServerUrl: URL;
  scopesSupported: string[];
}): Router {
  const oauthMetadata: OAuthMetadata = {
    issuer: issuerUrl.href,
    authorization_endpoint: new URL('/authorize', issuerUrl).href,
    token_endpoint: new URL('/token', issuerUrl).href,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    scopes_supported: scopesSupported,
    client_id_metadata_document_supported: true,
  };

  const protectedResourceMetadata: OAuthProtectedResourceMetadata = {
    resource: resourceServerUrl.href,
    authorization_servers: [issuerUrl.href],
    scopes_supported: scopesSupported,
  };

  const router = Router();

  router.use('/authorize', authorizationHandler({ provider }));
  router.use('/token', tokenHandler({ provider }));

  router.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json(oauthMetadata);
  });

  // Serve Protected Resources Metadata (PRM) at the path-specific URL per RFC 9728
  const rsPath = resourceServerUrl.pathname;
  router.get(
    `/.well-known/oauth-protected-resource${rsPath === '/' ? '' : rsPath}`,
    (_req, res) => {
      res.json(protectedResourceMetadata);
    }
  );

  return router;
}
