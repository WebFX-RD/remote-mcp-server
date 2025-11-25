import { promisify } from 'node:util';

import cors from 'cors';
import express, { Request, Response } from 'express';
import { log } from '@webfx-rd/cloud-utils/log';
import { disconnect, registerCleanupFunction } from '@webfx-rd/cloud-utils/disconnect';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';

import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';

import { setupGoogleAuthServer } from './google-auth-provider.js';
import { getMcpServer } from './get-mcp-server.js';

const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = new URL(process.env.BASE_URL as string);

const app = express();
app.set('trust proxy', 1); // trust the 1st proxy (cloud run LB)
app.use(express.json());
app.use(cors({ origin: '*', exposedHeaders: ['Mcp-Session-Id'] }));

// Set up OAuth
const mcpServerUrl = new URL('/mcp', BASE_URL);
const authIssuerUrl = new URL('/auth/', BASE_URL);

const authServer = setupGoogleAuthServer({ issuerUrl: authIssuerUrl });
app.use('/auth', authServer.router);

const tokenVerifier: OAuthTokenVerifier = {
  async verifyAccessToken(token) {
    const endpoint = authServer.metadata.introspection_endpoint;
    if (!endpoint) {
      throw new Error('No token verification endpoint available in metadata');
    }

    const response = await fetch(endpoint, {
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

// Add metadata routes to the main MCP server
app.use(
  mcpAuthMetadataRouter({
    oauthMetadata: authServer.metadata,
    resourceServerUrl: mcpServerUrl,
  })
);

const authMiddleware = requireBearerAuth({
  verifier: tokenVerifier,
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpServerUrl),
});

// MCP POST endpoint with optional auth
const mcpPostHandler = async (req: Request, res: Response) => {
  if (req.auth) {
    log.info('Authenticated user:', req.auth);
  }

  const server = getMcpServer();
  try {
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      // Session IDs are not useful in stateless mode
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      log.info('Request closed');
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error('Failed to handle MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
};

app.post('/mcp', authMiddleware, mcpPostHandler);

// GET requests are not supported in stateless mode
const mcpNotAllowedHandler = async (_req: Request, res: Response) => {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed' },
      id: null,
    })
  );
};

// GET & DELETE requests are not supported in stateless mode
app.get('/mcp', authMiddleware, mcpNotAllowedHandler);
app.delete('/mcp', authMiddleware, mcpNotAllowedHandler);

const server = app.listen(PORT, (error) => {
  if (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
  log.info(`Server listening on port ${PORT}`);
});
registerCleanupFunction('MCP Server', promisify(server.close.bind(server)));

process.on('SIGINT', () => {
  log.info('SIGINT received, gracefully shutting down...');
  disconnect().then(() => log.info('Graceful shutdown complete'));
});
