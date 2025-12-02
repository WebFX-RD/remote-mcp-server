import { z } from 'zod';
import { elasticsearch } from '@webfx-rd/cloud-utils/elasticsearch';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const instances = [
  'identity-contact',
  'identity-company',
  'identity-company-session',
  'idp-person',
  'idp-company',
  'impressions',
  'revops',
] as const;

const instanceDescription =
  'Which instance to query\n' +
  'identity-company-session: a combination `identity-company` and `impressions` that powers a feature called CompanyTrackerFX on the RevenueCloudFX web app\n' +
  'idp: Identity Data Platform contains enrichment data.\n' +
  'impressions: contains entities such as forms, chats, calls, sms, visits.\n' +
  'revops: contains deals';

const instanceConfig: Record<(typeof instances)[number], [string, string]> = {
  'identity-contact': ['elasticsearch-mcfx', 'identity-contact'],
  'identity-company': ['elasticsearch-mcfx', 'identity-company'],
  'identity-company-session': ['elasticsearch-company-session', 'identity-company-session'],
  'idp-person': ['elasticsearch-idp', 'person'],
  'idp-company': ['elasticsearch-idp', 'companies'],
  impressions: ['elasticsearch-impressions', 'impressions'],
  revops: ['elasticsearch-revops', 'deals'],
};

export function register(server: McpServer) {
  server.registerTool(
    'elastic-execute',
    {
      description: 'Execute a request against an Elasticsearch server',
      inputSchema: {
        instance: z.enum(instances).describe(instanceDescription),
        action: z
          .enum(['_mapping', '_search', '_count'])
          .describe(
            'The URL will be constructed as {index}/{action}, where `index` is auto-filled based on the `instance`'
          ),
        query: z.optional(
          z
            .string()
            .describe(
              'Query parameters, which will be parsed from `application/x-www-form-urlencoded` format'
            )
        ),
        body: z.optional(z.string().describe('Request body as a JSON string')),
      },
      outputSchema: {
        results: z.any(),
      },
    },
    async ({ instance, action, query, body }) => {
      const [path, index] = instanceConfig[instance];

      let parsedQuery: Record<string, string> | undefined;
      if (query) {
        try {
          const searchParams = new URLSearchParams(query);
          parsedQuery = Object.fromEntries(searchParams.entries());
        } catch (error) {
          throw new Error(`Failed to parse query: ${(error as Error).message}`);
        }
      }

      let parsedBody: unknown;
      if (body) {
        try {
          parsedBody = JSON.parse(body);
        } catch (error) {
          throw new Error(`Failed to parse body as JSON: ${(error as Error).message}`);
        }
      }

      const client = await elasticsearch.getClient({ path });
      const response = (await client.transport.request({
        method: 'GET',
        path: `${index}/${action}`,
        ...(parsedQuery ? { querystring: parsedQuery } : {}),
        ...(parsedBody ? { body: parsedBody } : {}),
      })) as Record<string, unknown>;

      let results: unknown;
      if (response.profile) {
        results = response.profile;
      } else if (action === '_search') {
        results = response.hits;
      } else if (action === '_count') {
        results = response.count;
      } else {
        results = response;
      }

      return {
        structuredContent: { results },
        content: [{ type: 'text', text: JSON.stringify({ results }) }],
      };
    }
  );

  server.registerTool(
    'elastic-mapping',
    {
      description: 'Get the mapping (schema) for an Elasticsearch index',
      inputSchema: {
        instance: z.enum(instances).describe(instanceDescription),
      },
      outputSchema: {
        mapping: z.any(),
      },
    },
    async ({ instance }) => {
      const [path, index] = instanceConfig[instance];

      const client = await elasticsearch.getClient({ path });
      const mapping = await client.transport.request({
        method: 'GET',
        path: `${index}/_mapping`,
      });

      return {
        structuredContent: { mapping },
        content: [{ type: 'text', text: JSON.stringify({ mapping }) }],
      };
    }
  );
}
