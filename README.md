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

### Code Structure

- [src/index.ts](src/index.ts) - Entrypoint that starts the server
- [src/auth/](src/auth/) - Authentication module
- [src/mcp-server.ts](src/mcp-server.ts) - Registers MCP tools
- [src/tools/](src/tools/) - MCP tool definitions
- [deploy.sh](./deploy.sh) - Deploys the server to Cloud Run

### Authentication Strategies

We support two authentication strategies:

1. **API Key** - Clients send an `x-api-key` header. The key is verified against our authentication service and `req.user` is populated with user details.
2. **OAuth** - We support 2 of the 3 [client registration approaches](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization#client-registration-approaches) defined in MCP spec 2025-11-25:

   - **Client ID Metadata Documents** (preferred): Clients provide an HTTPS URL as their `client_id`, and the server fetches their metadata from that URL.
   - **Dynamic Client Registration** (deprecated): Clients register via the `/register` endpoint. This will be removed once no known client applications rely on it. Per the spec, clients should prefer Client ID Metadata Documents, so DCR usage should naturally fall to zero.

   Google OAuth is used as the identity provider with pre-registered redirect URIs.

Both strategies populate `req.user` with a discriminated union type (`strategy: 'apikey' | 'oauth'`) for consistent downstream handling.

### Spanner Tables

Database:

- Production: [devops.mcp](https://console.cloud.google.com/spanner/instances/devops/databases/mcp/details/tables?inv=1&invt=Abp6IQ&project=idyllic-vehicle-159522)
- Staging: TODO (does not yet exist)

| Table                                                                                                                                                                        | Purpose                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [mcpAuthUsers](https://console.cloud.google.com/spanner/instances/devops/databases/mcp/tables/mcpAuthUsers/details?inv=1&invt=Abp6IQ&project=idyllic-vehicle-159522)         | Authenticated users via Client ID Metadata Documents |
| [oauthClients](https://console.cloud.google.com/spanner/instances/devops/databases/mcp/tables/oauthClients/details?inv=1&invt=Abp6IQ&project=idyllic-vehicle-159522)         | DCR registered clients (deprecated)                  |
| [oauthClientUsers](https://console.cloud.google.com/spanner/instances/devops/databases/mcp/tables/oauthClientUsers/details?inv=1&invt=Abp6IQ&project=idyllic-vehicle-159522) | Authenticated users via DCR (deprecated)             |

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
