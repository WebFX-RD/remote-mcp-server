import { z } from 'zod';
import { elasticsearch } from '@webfx-rd/cloud-utils/elasticsearch';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { parseQueryForSiteId } from './_shared.js';
import { SITE_DETAILS_TOOL_NAME } from './site.js';

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

type SiteIdType = 'numeric' | 'alphanumeric' | 'none';

const instanceConfig: Record<(typeof instances)[number], [string, string, SiteIdType]> = {
  'identity-contact': ['elasticsearch-mcfx', 'identity-contact', 'numeric'],
  'identity-company': ['elasticsearch-mcfx', 'identity-company', 'numeric'],
  'identity-company-session': [
    'elasticsearch-company-session',
    'identity-company-session',
    'numeric',
  ],
  'idp-person': ['elasticsearch-idp', 'person', 'none'],
  'idp-company': ['elasticsearch-idp', 'companies', 'none'],
  impressions: ['elasticsearch-impressions', 'impressions', 'alphanumeric'],
  revops: ['elasticsearch-revops', 'deals', 'numeric'],
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
            'The URL will be constructed as {index}/{action}, where {index} is resolved from {instance}'
          ),
        query: z.optional(z.looseObject({})).describe('Request query params'),
        body: z.optional(z.looseObject({})).describe('Request body'),
      },
      outputSchema: {
        results: z.any(),
        warning: z.optional(z.string()),
      },
    },
    async ({ instance, action, query, body }) => {
      const [path, index, expectedSiteIdType] = instanceConfig[instance];

      let warning: string | undefined;
      if (expectedSiteIdType !== 'none' && body) {
        const result = parseQueryForSiteId(body);
        if (result && result.type !== expectedSiteIdType) {
          warning = `Instance ${instance} expects ${expectedSiteIdType} site IDs, but you provided a ${result.type} site ID.`;
          warning += ` If the results are unexpected (e.g. empty), use the ${SITE_DETAILS_TOOL_NAME} tool to convert and try again.`;
        }
      }

      const client = await elasticsearch.getClient({ path });
      const response = (await client.transport.request({
        method: 'GET',
        path: `${index}/${action}`,
        ...(query && { querystring: query }),
        ...(body && { body }),
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

      const structuredContent = { results, warning };
      return {
        structuredContent,
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
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
