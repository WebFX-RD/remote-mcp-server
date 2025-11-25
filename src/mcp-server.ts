import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as mysql from './tools/mysql.js';
import * as mango from './tools/mango.js';

export function getMcpServer() {
  const server = new McpServer({ name: 'rcfx-mcp', version: '1.0.0' });
  mysql.register(server);
  mango.register(server);
  return server;
}
