import { promisify } from 'node:util';

import cors from 'cors';
import express, { Request, Response } from 'express';
import { log } from '@webfx-rd/cloud-utils/log';
import { disconnect, registerCleanupFunction } from '@webfx-rd/cloud-utils/disconnect';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { auth } from './auth/index.js';
import { getMcpServer } from './mcp-server.js';

const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = new URL(process.env.BASE_URL as string);

const app = express();
app.set('trust proxy', 1); // trust the 1st proxy (cloud run LB)
app.use(express.json());
app.use(cors({ origin: '*', exposedHeaders: ['Mcp-Session-Id'] }));

const mcpServerUrl = new URL('/mcp', BASE_URL);
app.use(auth.getRouter({ baseUrl: BASE_URL, mcpServerUrl }));
app.use(auth.getMiddleware({ baseUrl: BASE_URL, mcpServerUrl }));

async function mcpPostHandler(req: Request, res: Response) {
  log.info('Handling MCP request from user:', req.user);
  const server = getMcpServer();
  try {
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      // Session IDs are not useful in stateless mode
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      transport.close().catch((e) => log.error('Failed to close transport:', e));
      server.close().catch((e) => log.error('Failed to close server:', e));
    });
  } catch (error) {
    log.error('Failed to handle MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
}

app.post('/mcp', mcpPostHandler);

app.get('/mcp', (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed' },
    id: null,
  });
});

app.delete('/mcp', (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed' },
    id: null,
  });
});

const server = app.listen(PORT, (error) => {
  if (error) {
    log.error('Failed to start server:', error);
    process.exit(1);
  }
  log.info(`Server listening on port ${PORT}`);
});
registerCleanupFunction('MCP Server', promisify(server.close.bind(server)));

process.on('SIGINT', () => {
  log.info('SIGINT received, gracefully shutting down...');
  disconnect().then(() => log.info('Graceful shutdown complete'));
});
