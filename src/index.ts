import { promisify } from 'node:util';

import cors from 'cors';
import express, { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';

import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';

import { setupGoogleAuthServer } from './google-auth-provider.js';
import { disconnect, registerCleanupFunction } from './disconnect.js';
import { getMcpServer } from './get-mcp-server.js';

const PORT = Number(process.env.PORT) || 3000;
const DISABLE_AUTH = process.env.DISABLE_AUTH === 'true';

const app = express();
app.use(express.json());

// Support browser-based clients
app.use(cors({ origin: '*', exposedHeaders: ['Mcp-Session-Id'] }));

// Set up OAuth if enabled
let authMiddleware = null;
if (!DISABLE_AUTH) {
  // Create auth middleware for MCP endpoints
  const baseUrl = new URL(`http://localhost:${PORT}`);
  const mcpServerUrl = new URL('/mcp', baseUrl);
  const authIssuerUrl = new URL('/auth', baseUrl);

  const { router: authRouter, metadata: oauthMetadata } = setupGoogleAuthServer({
    issuerUrl: authIssuerUrl,
  });

  // Mount auth routes under /auth
  app.use('/auth', authRouter);

  const tokenVerifier: OAuthTokenVerifier = {
    async verifyAccessToken(token) {
      const endpoint = oauthMetadata.introspection_endpoint;
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
      oauthMetadata,
      resourceServerUrl: mcpServerUrl,
    })
  );

  authMiddleware = requireBearerAuth({
    verifier: tokenVerifier,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpServerUrl),
  });
}

// MCP POST endpoint with optional auth
const mcpPostHandler = async (req: Request, res: Response) => {
  if (!DISABLE_AUTH && req.auth) {
    console.log('Authenticated user:', req.auth);
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
      console.log('Request closed');
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

if (authMiddleware) {
  app.post('/mcp', authMiddleware, mcpPostHandler);
} else {
  app.post('/mcp', mcpPostHandler);
}

// GET requests are not supported in stateless mode
const mcpGetHandler = async (_req: Request, res: Response) => {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    })
  );
};

// DELETE requests are not supported in stateless mode
const mcpDeleteHandler = async (_req: Request, res: Response) => {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    })
  );
};

// Set up GET route with conditional auth middleware
if (authMiddleware) {
  app.get('/mcp', authMiddleware, mcpGetHandler);
} else {
  app.get('/mcp', mcpGetHandler);
}

// Set up DELETE route with conditional auth middleware
if (authMiddleware) {
  app.delete('/mcp', authMiddleware, mcpDeleteHandler);
} else {
  app.delete('/mcp', mcpDeleteHandler);
}

const server = app.listen(PORT, (error) => {
  if (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
  console.log(`MCP Server listening on port ${PORT}`);
});
registerCleanupFunction('MCP Server', promisify(server.close.bind(server)));

process.on('SIGINT', () => {
  console.log('SIGINT received, gracefully shutting down...');
  disconnect().then(() => console.log('Graceful shutdown complete'));
});
