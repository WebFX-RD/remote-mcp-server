import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function getMcpServer() {
  const server = new McpServer({
    name: 'stateless-streamable-http-server',
    version: '1.0.0',
  });

  // Register a simple prompt
  server.registerPrompt(
    'greeting-template',
    {
      title: 'Greeting Template',
      description: 'A simple greeting prompt template',
      argsSchema: {
        name: z.string().describe('Name to include in greeting'),
      },
    },
    async ({ name }) => {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please greet ${name} in a friendly manner.`,
            },
          },
        ],
      };
    }
  );

  // Register a simple tool
  server.registerTool(
    'add',
    {
      title: 'Add Two Numbers',
      description: 'Adds two numbers together and returns the result',
      inputSchema: {
        a: z.number().describe('First number'),
        b: z.number().describe('Second number'),
      },
    },
    async ({ a, b }) => {
      const result = a + b;
      return {
        content: [
          {
            type: 'text',
            text: `${a} + ${b} = ${result}`,
          },
        ],
      };
    }
  );

  // Create a simple resource at a fixed URI
  server.registerResource(
    'greeting-resource',
    'https://example.com/greetings/default',
    {
      title: 'Greeting Resource',
      description: 'A simple greeting resource',
      mimeType: 'text/plain',
    },
    async () => {
      return {
        contents: [
          {
            uri: 'https://example.com/greetings/default',
            text: 'Hello, world!',
          },
        ],
      };
    }
  );

  return server;
}
