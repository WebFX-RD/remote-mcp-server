import {
  StreamableHTTPServerTransport,
  StreamableHTTPServerTransportOptions,
} from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export class Transport extends StreamableHTTPServerTransport {
  constructor(
    sessionId: string,
    options?: Omit<StreamableHTTPServerTransportOptions, 'sessionIdGenerator'>
  ) {
    super({ ...options, sessionIdGenerator: undefined });
    this.sessionId = sessionId;
  }
}
