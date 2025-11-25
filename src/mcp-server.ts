import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mysql } from '@webfx-rd/cloud-utils/mysql';

export function getMcpServer() {
  const server = new McpServer({ name: 'rcfx-mcp', version: '1.0.0' });

  server.registerTool(
    'mysql-execute',
    {
      description: 'Execute a sql statement in MySQL',
      inputSchema: {
        instance: z.enum(['monolith', 'revops'], {
          description:
            'Which database instance to query. Queries to the monolith instance should include the schema (e.g. core or identity) along with the table.',
        }),
        sql: z.string({
          description:
            'The sql to execute. Use ? as placeholders for values. Use ?? as a placeholder for identifiers.',
        }),
        params: z.optional(
          z.array(
            z.union([z.string(), z.number(), z.boolean(), z.null()], {
              description: 'Replacements for the placeholders.',
            })
          )
        ),
      },
      outputSchema: {
        results: z.array(z.any()),
      },
    },
    async ({ instance, sql, params }) => {
      const results = await mysql.read(sql, {
        instance: instance === 'monolith' ? 'mcfx' : 'mcfx-revops',
        values: params,
        castJson: true,
        label: 'MCP',
        user: 'rcfx-mcp',
        selectTimeout: 60000,
      });
      return {
        structuredContent: { results },
        // include a stringified version for backward compatibility
        content: [{ type: 'text', text: JSON.stringify({ results }) }],
      };
    }
  );

  return server;
}
