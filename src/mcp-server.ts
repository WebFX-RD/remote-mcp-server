import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as mysql from './tools/mysql.js';
import * as mango from './tools/mango.js';
import * as mongo from './tools/mongo.js';
import * as spanner from './tools/spanner.js';
import * as elastic from './tools/elastic.js';
import * as site from './tools/site.js';

export function getMcpServer() {
  const server = new McpServer({ name: 'rcfx-mcp', version: '1.0.0' });
  mysql.register(server);
  mango.register(server);
  mongo.register(server);
  spanner.register(server);
  elastic.register(server);
  site.register(server);
  return server;
}
