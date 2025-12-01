import { z } from 'zod';
import { spanner } from '@webfx-rd/cloud-utils/spanner';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function register(server: McpServer) {
  server.registerTool(
    'spanner-execute',
    {
      description: 'Execute a SQL query in Spanner',
      inputSchema: {
        databasePath: z.string({
          description: 'Database path in format project.database (e.g., marketingcloudfx.mcfx)',
        }),
        sql: z.string({
          description: 'The SQL to execute. Use @paramName as placeholders for values.',
        }),
        params: z.optional(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
      },
      outputSchema: {
        results: z.array(z.any()),
      },
    },
    async ({ databasePath, sql, params }) => {
      const [results] = await spanner.query(sql, {
        databasePath,
        params,
      });
      return {
        structuredContent: { results },
        content: [{ type: 'text', text: JSON.stringify({ results }) }],
      };
    }
  );

  server.registerTool(
    'spanner-ddl',
    {
      description: 'Get the DDL (schema definition) of one or more Spanner tables',
      inputSchema: {
        table: z.union([z.string(), z.array(z.string())], {
          description:
            'Table path(s) in format [instance.]database.table (e.g., mcfx.impressions, iam.sites)',
        }),
      },
      outputSchema: {
        ddl: z.string(),
      },
    },
    async ({ table }) => {
      const tables = Array.isArray(table) ? table : [table];

      const results = await Promise.allSettled(
        tables.map(async (tablePath) => {
          const ddlStatements = await spanner.getTableDDL(tablePath);
          return `-- ${tablePath}\n${ddlStatements.join('\n\n')}`;
        })
      );

      const successful: string[] = [];
      const failed: string[] = [];
      for (const [i, res] of results.entries()) {
        if (res.status === 'fulfilled') {
          successful.push(res.value);
        } else {
          failed.push(tables[i]);
        }
      }

      const formattedDdl = successful.join('\n\n');
      if (failed.length) {
        throw new Error(`${formattedDdl}\n\nFailed tables: ${failed.join(', ')}`);
      }

      const structuredContent = { ddl: formattedDdl };
      return {
        structuredContent,
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
      };
    }
  );
}
