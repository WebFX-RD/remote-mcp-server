import { z } from 'zod';
import { mysql } from '@webfx-rd/cloud-utils/mysql';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** Server-side query timeout */
const TIMEOUT_MS = 30_000;

export function register(server: McpServer) {
  server.registerTool(
    'mysql-execute',
    {
      description: 'Execute a SQL statement in MySQL',
      inputSchema: {
        database: z.string({
          description: 'Database name (e.g., core, identity, revops)',
        }),
        sql: z.string({
          description:
            'The SQL to execute. Use ? as placeholders for values. Use ?? as placeholders for identifiers.',
        }),
        params: z.optional(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
      },
      outputSchema: {
        results: z.array(z.any()),
      },
    },
    async ({ database, sql, params }) => {
      const results = await mysql.read(sql, {
        ...getConnectionOptions(database),
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
      description: 'Get the DDL (CREATE TABLE statement) of one or more MySQL tables',
      inputSchema: {
        database: z.string({
          description: 'Database name (e.g., core, identity, revops)',
        }),
        table: z.union([z.string(), z.array(z.string())], {
          description: 'Table name(s) to get DDL for',
        }),
      },
      outputSchema: {
        ddl: z.string(),
      },
    },
    async ({ database, table }) => {
      const tables = Array.isArray(table) ? table : [table];
      const connectionOptions = getConnectionOptions(database);

      const results = await Promise.allSettled(
        tables.map(async (tableName) => {
          const result = await mysql.readOne('SHOW CREATE TABLE ??', {
            ...connectionOptions,
            values: [tableName],
            user: 'rcfx-mcp',
            label: 'MCP:tool:mysql-ddl',
          });
          const ddl = result?.['Create Table'] as string;
          return `-- ${database}.${tableName}\n${ddl}`;
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
    'mysql-list-tables',
    {
      description: 'List tables in a MySQL database',
      inputSchema: {
        database: z.string({
          description: 'Database name (e.g., core, identity, revops)',
        }),
      },
      outputSchema: {
        tables: z.array(z.string()),
      },
    },
    async ({ database }) => {
      const results = await mysql.read('SHOW TABLES', {
        ...getConnectionOptions(database),
        user: 'rcfx-mcp',
        label: 'MCP:tool:mysql-list-tables',
        selectTimeout: TIMEOUT_MS,
      });
      const tables = results.map((row) => Object.values(row)[0] as string);
      return {
        structuredContent: { tables },
        content: [{ type: 'text', text: JSON.stringify({ tables }) }],
      };
    }
  );
}

function getConnectionOptions(database: string) {
  if (database === 'revops') {
    return { instance: 'mcfx-revops' as const };
  }
  return { instance: 'mcfx' as const, database };
}
