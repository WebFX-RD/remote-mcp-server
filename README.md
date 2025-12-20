> [!WARNING]
> This repository has been moved to https://github.com/WebFX-RD/micro-services/tree/master/domains/devops/remote-mcp-server

# mcp-server-remote

This service runs the RCFX Remote MCP Server. Watch this **[2 minute video](https://bucket-mcfx-internal-979839513730.us-central1.run.app/clipboard/7776df6a5a309c4e7e35901defad561b.mp4)** for an overview.

## Getting Started

1. Initialize environment variables:

   ```bash
   gcloud secrets versions access latest --secret=REMOTE_MCP_SERVER_LOCAL --out-file=.env.local
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Follow instructions in the [Testing](#testing) section

<details>
<summary>Claude Code Setup</summary>

1. The [block-env-files hook](.claude/hooks/block-env-files.sh) requires that you have [jq](https://jqlang.org/download/) installed on your system.

2. [CLAUDE.md](./CLAUDE.md) expects that you have the https://github.com/modelcontextprotocol/typescript-sdk cloned to `../mcp-typescript-sdk`. This makes it easier for Claude to reference the SDK source code without having to dig through node_modules.

3. Create `.claude/settings.local.json` based on the following:

   ```jsonc
   {
     "permissions": {
       "additionalDirectories": [
         "/path/to/mcp-typescript-sdk" // TODO
       ]
     },
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "Read",
           "hooks": [
             {
               "type": "command",
               "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/block-env-files.sh"
             }
           ]
         }
       ]
     }
   }
   ```

</details>

<details>
<summary>One-time OAuth Setup</summary>

This sections contains one-time setup instructions which were already completed for WebFX.

1. Acquire an OAuth Client ID and Client Secret by following [this guide](https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred). The following Authorized redirect URIs are recommended:

   - http://localhost:6274/oauth/callback/debug - Used by the MCP Inspector authorization flow described in the [testing section](#testing) below
   - http://localhost:6274/oauth/callback - Used by the MCP Inspector
   - https://developers.google.com/oauthplayground - Used by Google's [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) if you [use your own credentials](https://storage.googleapis.com/kamal-screenshots/ed8f07ba6269c7622202c599fce6807f.jpg).
   - From https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers:
     - https://claude.ai/api/mcp/auth_callback
     - https://claude.com/api/mcp/auth_callback
   - http://localhost:49498/callback - Used by Claude Code

2. Once you have your Client ID and Client Secret, copy [.env.example](.env.example) to `.env.local` and replace the fake values.

</details>

## Testing

1. Start the server via `pnpm run dev`
2. In another terminal, start the [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) via `pnpm run inspect`
3. Set the following options in the left pane:
   - **Transport Type:** Streamable HTTP
   - **URL:**
     - Local: http://localhost:3030/mcp
     - Production: https://remote-mcp-server-979839513730.us-central1.run.app/mcp
   - **Connection Type:** Direct
4. We support two [authentication strategies](#authentication-strategies):
   - For **API Key** authentication, see [this diagram](https://webpagefx.mangoapps.com/msc/MjYxODM2NV8yMzQ2NjY2NQ)
     - You can get your API Key from https://app.webfx.com/my-info/api-keys
   - For **OAuth** authentication, see [this diagram](https://webpagefx.mangoapps.com/msc/MjYxODM2OF8yMzQ2NjY3MQ)
     - For the Guided OAuth Flow, see [this diagram](https://webpagefx.mangoapps.com/msc/MjYxODM2OV8yMzQ2NjY3Mg)
     - Note: as of 2025-12-02, neither [MCP Inspector](https://github.com/modelcontextprotocol/inspector) nor Claude Desktop support the [Client ID Metadata Documents](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#client-id-metadata-documents) mechanism for [client registration](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#client-registration-approaches).
5. To test the MCP server, click the Connect button.

## Development

This section is useful for developers who want to modify the code.

### Code Structure

- [src/index.ts](src/index.ts) - Entrypoint that starts the server
- [src/auth/](src/auth/) - Authentication module
- [src/mcp-server.ts](src/mcp-server.ts) - Registers MCP tools
- [src/session-store.ts](src/session-store.ts) - Redis-backed session storage
- [src/tools/](src/tools/) - MCP tool definitions
- [src/transport.ts](src/transport.ts) - Custom transport with pre-defined session ID
- [deploy.sh](./deploy.sh) - Deploys the server to Cloud Run

### Authentication

We support two authentication strategies:

1. **API Key** - Clients send an `x-api-key` header. The key is verified against our authentication service and `req.user` is populated with user details.
2. **OAuth** - We support 2 of the 3 [client registration approaches](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#client-registration-approaches) defined in MCP spec 2025-11-25:

   - **Client ID Metadata Documents** (preferred): Clients provide an HTTPS URL as their `client_id`, and the server fetches their metadata from that URL.
   - **Dynamic Client Registration** (deprecated): Clients register via the `/register` endpoint. This will be removed once no known client applications rely on it. Per the spec, clients should prefer Client ID Metadata Documents, so DCR usage should naturally fall to zero.

   Google OAuth is used as the identity provider with pre-registered redirect URIs.

Both strategies populate `req.user` with a discriminated union type (`strategy: 'apikey' | 'oauth'`) for consistent downstream handling.

#### OAuth Limitation

OAuth only works with clients whose redirect URIs are pre-registered in Google Cloud Console. Clients like Claude Code use random localhost ports (e.g., `http://localhost:49999/callback`), which cannot be pre-registered. For these clients, use API Key authentication instead.

<details>
<summary>Potential Workaround (not implemented)</summary>

A proxy/relay approach could support dynamic redirect URIs:

1. Client calls `GET /authorize` with `redirect_uri=http://localhost:{random}/callback&state=client_state`
2. Server generates a `session_id` and stores `{session_id → {redirect_uri, client_state}}` in Redis
3. Server redirects to Google with our fixed redirect URI and `state=session_id`
4. Google redirects to `/oauth/callback?code=...&state=session_id`
5. Server looks up `session_id` → retrieves original redirect URI and client's state
6. Server stores `{code → true}` to mark it as proxied
7. Server redirects to `http://localhost:{random}/callback?code=...&state=client_state`
8. During token exchange, server detects proxied codes and substitutes the fixed redirect URI when calling Google

We decided not to implement this because API Key authentication is simpler and sufficient for CLI tools like Claude Code.

</details>

### Spanner Tables

Database:

- Production: [devops.mcp](https://console.cloud.google.com/spanner/instances/devops/databases/mcp/details/tables?inv=1&invt=Abp6IQ&project=idyllic-vehicle-159522)
- Staging: TODO (does not yet exist)

| Table                                                                                                                                                                        | Purpose                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [mcpAuthUsers](https://console.cloud.google.com/spanner/instances/devops/databases/mcp/tables/mcpAuthUsers/details?inv=1&invt=Abp6IQ&project=idyllic-vehicle-159522)         | Authenticated users via Client ID Metadata Documents |
| [oauthClients](https://console.cloud.google.com/spanner/instances/devops/databases/mcp/tables/oauthClients/details?inv=1&invt=Abp6IQ&project=idyllic-vehicle-159522)         | DCR registered clients (deprecated)                  |
| [oauthClientUsers](https://console.cloud.google.com/spanner/instances/devops/databases/mcp/tables/oauthClientUsers/details?inv=1&invt=Abp6IQ&project=idyllic-vehicle-159522) | Authenticated users via DCR (deprecated)             |

### Session Management

**NOTE:** As of 2025-12-07, Claude Desktop doesn't properly implement the [2025-06-18 session management protocol](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#session-management). Here's a **[2 minute video](https://bucket-mcfx-internal-979839513730.us-central1.run.app/clipboard/c7858ea6c6b0414748cc4eb89fc26eea.mp4)** explanation. Therefore, I code that utilizes sessions has been commented out for now.

We implement [MCP session management](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management) with Redis-backed state:

1. On `initialize` request, generate a UUID session ID and store it in Redis: `mcp:sessions:{sessionId}` → `email`
2. On subsequent requests, validate that the session ID (which MUST be passed by the client) exists and belongs to the same user (identified by email)
3. Session state is stored per-key in Redis: `mcp:{sessionId}:{key}` → value
4. All session data has a 24-hour TTL

<details>
<summary>Deviation from SDK approach</summary>

The [typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) keeps one transport instance alive per session and validates session IDs by comparing against an in-memory property. There are a few issues with this approach:

1. It requires sticky sessions for horizontal scaling which adds complexity.
2. It requires storing objects in an in-memory cache. We must then implement a cache eviction policy to avoid a memory leak. Also, Cloud Run may scale down an instance at any point so this could lead to weird errors.

Our approach creates a new transport per request and validates sessions via Redis lookup. This is simpler conceptually (functional-style, stateless handlers) and avoids the issues mentioned above. We subclass `StreamableHTTPServerTransport` to bypass the SDK's built-in session validation, which would otherwise reject requests since each transport instance has a different in-memory session ID.

</details>

<details>
<summary>Security</summary>

Sessions are bound to the authenticated user's email. Even if an attacker guesses a valid UUID, the session will be rejected unless it was created for their email address. This prevents session hijacking.

</details>

<details>
<summary>Correctness</summary>

Redis is ephemeral and session data has a TTL, so we cannot guarantee perfect state tracking across server restarts or long-lived sessions. Tools should handle missing session state gracefully rather than failing hard. For example, if a tool requires prior state (like `elastic-execute` requiring `elastic-mapping` to be called first), it should return a clear error message guiding the user to retry the prerequisite step.

</details>

### Useful Links

- [Building Custom Connectors via Remote MCP Servers](https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers) (official Anthropic support article)

## Deployment

Run the [deploy.sh](./deploy.sh) script to deploy the Cloud Run Service.

Note: the [--set-secrets](https://cloud.google.com/sdk/gcloud/reference/run/deploy#--set-secrets) option has a bug when mounting a secret as a file where it clears the directory. Therefore, mounting it to `/workspace/.env.local` does not work. To workaround this issue, we mount to `/etc/secrets` instead.

## Roadmap

- Move this code to the [micro-services](https://github.com/WebFX-RD/micro-services) repository.

- Improve error logging. As of 2025-12-02, the [typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) swallows some errors, which makes production issues hard to debug.

- Deprecate Dynamic Client Registration (DCR) ones we confirm that no clients are using it.

## History

- This code was initialized from [simpleStatelessStreamableHttp.ts](https://github.com/modelcontextprotocol/typescript-sdk/blob/2da89dbfc5f61d92bfc3ef6663d8886911bd4666/src/examples/server/simpleStatelessStreamableHttp.ts) example from the MCP TypeScript SDK.

- https://github.com/kym6464/mcp-server-remote was forked into the WebFX-RD GitHub organization

- Added support for [Client ID Metadata Documents](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#client-id-metadata-documents) per MCP spec 2025-11-25, which fetches client metadata from the client's URL instead of storing registrations in Spanner. Dynamic Client Registration (DCR) is still supported but deprecated for backwards compatibility with older MCP clients.
