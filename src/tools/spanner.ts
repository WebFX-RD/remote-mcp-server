import { z } from 'zod';
import { spanner } from '@webfx-rd/cloud-utils/spanner';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function register(server: McpServer) {
  server.registerTool(
    'spanner-execute',
    {
      description: 'Execute a SQL statement in Spanner',
      inputSchema: {
        databasePath: z
          .string()
          .describe('Database path in instance.database format (e.g., marketingcloudfx.mcfx)'),
        sql: z.string().describe('The SQL to execute. Use @paramName as placeholders for values.'),
        params: z.optional(
          z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
        ),
      },
      outputSchema: {
        results: z.array(z.any()),
      },
    },
    async ({ databasePath, sql, params }) => {
      const [results] = await spanner.query(sql, {
        databasePath,
        params,
        timeout: 30000,
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
        table: z
          .union([z.string(), z.array(z.string())])
          .describe(
            'Table path(s) in format [instance.]database.table (e.g., mcfx.impressions, iam.sites)'
          ),
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

  server.registerTool(
    'spanner-topology',
    {
      description:
        'Get the topology of all Spanner databases and tables organized by instance, database, and table',
      inputSchema: {},
      outputSchema: {
        topology: z
          .record(z.string(), z.record(z.string(), z.array(z.string())))
          .describe(`{ instance: { database: table[] } }`),
      },
    },
    async () => {
      const topology = await spanner.getTopology();
      return {
        structuredContent: { topology },
        content: [{ type: 'text', text: JSON.stringify({ topology }) }],
      };
    }
  );
}
