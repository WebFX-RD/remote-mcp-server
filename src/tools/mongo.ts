import { z } from 'zod';
import { mongo } from '@webfx-rd/cloud-utils/mongo';
import { inspect } from 'node:util';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** Server-side query timeout */
const TIMEOUT_MS = 60_000;

export function register(server: McpServer) {
  server.registerTool(
    'mongo-execute',
    {
      description: 'Execute a query against a MongoDB collection',
      inputSchema: {
        collection: z.string({
          description: 'Collection name',
        }),
        operation: z
          .enum(['find', 'aggregate'], {
            description: 'Find for basic queries, aggregate for complex operations',
          })
          .default('find'),
        query: z.any({
          description:
            'Filter object for find operations (e.g., { _id: "someId" }), or pipeline array for aggregate operations',
        }),
        options: z.optional(
          z
            .object(
              {},
              {
                description:
                  'Additional options for find operations (limit, sort, projection, etc.)',
              }
            )
            .passthrough()
        ),
        preview: z.optional(
          z.number({
            description:
              'When set, runs results through util.inspect with specified depth to constrain size for exploration (e.g., preview=2)',
          })
        ),
        limit: z.optional(
          z
            .number()
            .gte(1)
            .lte(1000)
            .default(10)
            .describe('Maximum number of documents to return (1-100, default: 10)')
        ),
      },
      outputSchema: {
        results: z.array(z.any()),
      },
    },
    async ({ collection, operation, query, options, preview, limit = 100 }) => {
      try {
        var connection = await mongo.connect();
      } catch (error: any) {
        error.message = `Failed to connect to MongoDB: ${error.message}`;
        throw error;
      }

      // Workaround to a bug where query comes in as a string
      if (
        typeof query === 'string' &&
        ((query.startsWith('[') && query.endsWith(']')) ||
          (query.startsWith('{') && query.endsWith('}')))
      ) {
        query = JSON.parse(query);
      }

      const collections = await connection.db
        .listCollections({ name: collection }, { nameOnly: true })
        .toArray();
      if (!collections.length) {
        throw new Error(`Collection '${collection}' does not exist`);
      }

      // Handle ObjectId conversion for _id fields in queries
      function convertObjectIds(input: any): Record<string, any> {
        if (!(input && typeof input === 'object')) {
          return input;
        }

        if (Array.isArray(input)) {
          return input.map(convertObjectIds);
        }

        const converted: Record<string, any> = {};
        for (const [key, value] of Object.entries(input)) {
          if (key === '_id' && typeof value === 'string') {
            try {
              converted[key] = new mongo.mongoose.Types.ObjectId(value);
            } catch (e) {
              converted[key] = value;
            }
          } else if (typeof value === 'object') {
            converted[key] = convertObjectIds(value);
          } else {
            converted[key] = value;
          }
        }

        return converted;
      }

      let results;
      const colRef = connection.db.collection(collection);

      if (operation === 'find') {
        const queryPrep = query ? convertObjectIds(query) : {};
        results = await colRef
          .find(queryPrep, options || {})
          .maxTimeMS(TIMEOUT_MS)
          .limit(limit)
          .toArray();
      } else if (operation === 'aggregate') {
        if (!query) {
          throw new Error(`query is required when operation is 'aggregate'`);
        }
        if (!Array.isArray(query)) {
          throw new Error(`query must be an array when operation is 'aggregate'`);
        }
        const convertedPipeline = convertObjectIds(query) as Record<string, any>[];
        results = await colRef
          .aggregate(convertedPipeline)
          .maxTimeMS(TIMEOUT_MS)
          .limit(limit)
          .toArray();
      } else {
        throw new Error(`Unknown operation: ${operation}`);
      }

      await mongo.disconnect();

      // Apply preview formatting if requested
      const finalResults = preview
        ? results.map((result) => inspect(result, { depth: preview, colors: false, compact: true }))
        : results;

      return {
        structuredContent: { results: finalResults },
        content: [{ type: 'text', text: JSON.stringify({ results: finalResults }) }],
      };
    }
  );
}
