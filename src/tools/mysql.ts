import { z } from 'zod';
import { mysql } from '@webfx-rd/cloud-utils/mysql';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** Server-side query timeout */
const TIMEOUT_MS = 30_000;

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
        selectTimeout: TIMEOUT_MS,
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
      description: 'Get the DDL (CREATE TABLE statement) for one or more MySQL tables',
      inputSchema: {
        tablePath: z.union([z.string(), z.array(z.string())], {
          description:
            'Table path(s) in database.table format (e.g., core.sites, identity.audiences)',
        }),
      },
      outputSchema: {
        ddl: z.string(),
      },
    },
    async ({ tablePath }) => {
      const tablePaths = Array.isArray(tablePath) ? tablePath : [tablePath];

      const results = await Promise.allSettled(
        tablePaths.map(async (path) => {
          const instance = path.startsWith('revops') ? 'mcfx-revops' : 'mcfx';

          const result = await mysql.readOne('SHOW CREATE TABLE ??', {
            values: [path],
            instance,
            user: 'rcfx-mcp',
            label: 'MCP:tool:mysql-execute',
          });

          const ddl = result?.['Create Table'] as string;
          return `-- ${path} definition\n${ddl}`;
        })
      );

      const successful: string[] = [];
      const failed: string[] = [];
      for (const [i, res] of results.entries()) {
        if (res.status === 'fulfilled') {
          successful.push(res.value);
        } else {
          failed.push(tablePaths[i]);
        }
      }

      const formattedDdl = successful.join('\n\n');
      const structuredContent = { ddl: formattedDdl };

      if (failed.length) {
        throw new Error(`${formattedDdl}\n\nFailed tables: ${failed.join(', ')}`);
      }

      return {
        structuredContent,
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
      };
    }
  );
}
