import { promisify } from 'node:util';

import cors from 'cors';
import express, { Request, Response } from 'express';
import { log } from '@webfx-rd/cloud-utils/log';
import { disconnect, registerCleanupFunction } from '@webfx-rd/cloud-utils/disconnect';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { auth } from './auth/index.js';
import { getMcpServer } from './mcp-server.js';
import { createSession, validateSession } from './session-store.js';
import { Transport } from './transport.js';

const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = new URL(process.env.BASE_URL as string);

const app = express();
app.set('trust proxy', 1); // trust the 1st proxy (cloud run LB)
app.use(express.json());
app.use(cors({ origin: '*', exposedHeaders: ['Mcp-Session-Id'] }));

const mcpServerUrl = new URL('/mcp', BASE_URL);
app.use(auth.getRouter({ baseUrl: BASE_URL, mcpServerUrl }));
app.use(auth.getMiddleware({ baseUrl: BASE_URL, mcpServerUrl }));

app.post('/mcp', async (req: Request, res: Response) => {
  if (!req.user) {
    throw new Error('This should never happen: User does not exist');
  }
  log.info('Handling MCP request from user:', req.user);

  // Generate or validate session id:
  // https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management
  let sessionId: string;
  const messages = Array.isArray(req.body) ? req.body : [req.body];
  const isInit = messages.some(isInitializeRequest);
  if (isInit) {
    sessionId = await createSession(req.user.email);
    res.set('mcp-session-id', sessionId);
  } else {
    const headerSessionId = req.headers['mcp-session-id'];
    if (!(headerSessionId && typeof headerSessionId === 'string')) {
      return res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: Mcp-Session-Id header is required' },
        id: null,
      });
    }
    const isValid = await validateSession(headerSessionId, req.user.email);
    if (!isValid) {
      return res.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Session not found' },
        id: null,
      });
    }
    sessionId = headerSessionId;
  }

  const server = getMcpServer();
  try {
    const transport = new Transport(sessionId);
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
});

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
