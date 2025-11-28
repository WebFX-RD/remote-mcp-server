import { log } from '@webfx-rd/cloud-utils/log';
import { getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { Request, Response, NextFunction } from 'express';

import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';

import { getOAuthRouter, OAUTH_PATHS } from './oauth.js';
import { verifyApiKey } from './api-key.js';
import type { OAuthUser, ApiKeyUser } from './types.js';

export type { AppUser, OAuthUser, ApiKeyUser } from './types.js';

function getMiddleware({
  baseUrl,
  mcpServerUrl,
  publicPaths = [],
}: {
  baseUrl: URL;
  mcpServerUrl: URL;
  publicPaths?: string[];
}): (req: Request, res: Response, next: NextFunction) => void {
  const introspectionUrl = new URL('/introspect', baseUrl);
  const tokenVerifier: OAuthTokenVerifier = {
    async verifyAccessToken(token) {
      const response = await fetch(introspectionUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
      });
      if (!response.ok) {
        throw new Error(`Invalid or expired token: ${await response.text()}`);
      }

      const data = (await response.json()) as { [key: string]: unknown };
      return {
        ...data,
        token,
        clientId: data.client_id as string,
        scopes: data.scope ? (data.scope as string).split(' ') : [],
        expiresAt: data.exp as number,
      };
    },
  };

  const bearerAuth = requireBearerAuth({
    verifier: tokenVerifier,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpServerUrl),
  });

  const skipPaths = new Set([...publicPaths, ...OAUTH_PATHS]);
  return (req: Request, res: Response, next: NextFunction) => {
    if (skipPaths.has(req.path)) {
      next();
      return;
    }

    const apiKey = req.headers['x-api-key'];

    if (apiKey) {
      if (Array.isArray(apiKey)) {
        res.status(400).json({ error: 'Expected x-api-key to be a string, received string[]' });
        return;
      }
      verifyApiKey(apiKey)
        .then(({ firstName, lastName, email, type }) => {
          const user: ApiKeyUser = { strategy: 'apikey', firstName, lastName, email, type };
          req.user = user;
          next();
        })
        .catch((error) => {
          log.error('Invalid API key:', error);
          res.status(401).json({ error: 'Invalid API key' });
        });
      return;
    }

    bearerAuth(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      if (req.auth) {
        const authData = req.auth as unknown as { sub: string; email: string; scopes: string[] };
        const user: OAuthUser = {
          strategy: 'oauth',
          email: authData.email,
          googleUserId: authData.sub,
          scopes: authData.scopes,
        };
        req.user = user;
      }
      next();
    });
  };
}

export const auth = {
  getRouter: getOAuthRouter,
  getMiddleware,
};
