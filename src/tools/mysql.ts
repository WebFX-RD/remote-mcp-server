import { z } from 'zod';
import { mysql } from '@webfx-rd/cloud-utils/mysql';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function register(server: McpServer) {
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
        user: 'rcfx-mcp',
        label: 'MCP:tool:mysql-execute',
        selectTimeout: 60000,
      });
      return {
        structuredContent: { results },
        content: [{ type: 'text', text: JSON.stringify({ results }) }],
      };
    }
  );

  server.registerTool(
    'mysql-ddl',
    {
      description: 'Get the DDL (CREATE TABLE statement) for a MySQL table',
      inputSchema: {
        tablePath: z.string({
          description: 'Table path in format database.table (e.g., core.sites, identity.audiences)',
        }),
      },
      outputSchema: {
        ddl: z.string(),
      },
    },
    async ({ tablePath }) => {
      const instance = tablePath.startsWith('revops') ? 'mcfx-revops' : 'mcfx';

      try {
        const result = await mysql.readOne('SHOW CREATE TABLE ??', {
          values: [tablePath],
          instance,
          user: 'rcfx-mcp',
          label: 'MCP:tool:mysql-execute',
        });

        const ddl = result?.['Create Table'] as string;
        const formattedDdl = `-- ${tablePath} definition\n${ddl}`;

        const structuredContent = { ddl: formattedDdl };
        return {
          structuredContent,
          content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        };
      } catch (error: any) {
        throw new Error(`Failed to get DDL for ${tablePath}: ${error.message}`);
      }
    }
  );
}
