# mcp-server-remote

This repository is a demonstration of a Remote MCP Server that uses Google as the identity provider, written in TypeScript. Watch this **[2 minute video](https://storage.googleapis.com/kamal-screenshots/334c31902279f6a424f6811e76c07199.mp4)** for an overview.

## Getting Started

1. The first step is to acquire an OAuth Client ID and Client Secret by following [this guide](https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred). The following Authorized redirect URIs are recommended:

   - http://localhost:6274/oauth/callback/debug - Used by the MCP Inspector authorization flow described in the [testing section](#testing) below
   - http://localhost:6274/oauth/callback - Used by the MCP Inspector
   - https://developers.google.com/oauthplayground - Used by Google's [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) if you [use your own credentials](https://storage.googleapis.com/kamal-screenshots/ed8f07ba6269c7622202c599fce6807f.jpg).

2. Once you have your Client ID and Client Secret, copy [.env.example](.env.example) to `.env.local` and replace the fake values.

3. Run `pnpm install` followed by `pnpm run dev`. You should see the following output in your terminal:

   ```
   Authorization Server listening on port 3001
   MCP Streamable HTTP Server listening on port 3000
   ```

4. Follow the [testing section](#testing) below to test your MCP server.

<details>
<summary>(OPTIONAL) <a href="https://code.claude.com/docs">Claude Code</a> setup</summary>

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

## Testing

1. Start the server via `pnpm run dev`
2. Start the [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) via `pnpx inspect` and set the following options in the left pane:
   - Transport Type: Streamable HTTP
   - URL:
     - Local: http://localhost:3030/mcp
     - Production: https://remote-mcp-server-979839513730.us-central1.run.app/mcp
   - Connection Type: Direct
3. To test authentication, do _not_ click the Connect button. Instead,
   - click Open Auth Settings button
   - in the OAuth Authentication card, click Guided Token Refresh
   - click through using the Continue button
4. To test the MCP server, click the Connect button.

## Development

### Code Structure

- [index.ts](src/index.ts) - Entrypoint that starts the server
- [auth.ts](src/auth.ts) - Handles authentication via Google OAuth
- [mcp-server.ts](src/mcp-server.ts) - Defines the MCP tools, resources, etc.

### Authorization Approach

Because Google doesn't support Dynamic Client Registration (DCR), we need to bridge the gap by presenting a DCR-compliant interface to MCP clients while using our pre-registered Google OAuth client credentials. This approach was inspired by [FastMCP's OAuthProxy](https://gofastmcp.com/servers/auth/authentication#oauthproxy).

## Deployment

Run the [deploy.sh](./deploy.sh) script to deploy the Cloud Run Service.

Note: the [--set-secrets](https://cloud.google.com/sdk/gcloud/reference/run/deploy#--set-secrets) option has a bug when mounting a secret as a file where it clears the directory. Therefore, mounting it to `/workspace/.env.local` does not work. To workaround this issue, we mount to `/etc/secrets` instead.

## History

This code was initialized from [simpleStatelessStreamableHttp.ts](https://github.com/modelcontextprotocol/typescript-sdk/blob/2da89dbfc5f61d92bfc3ef6663d8886911bd4666/src/examples/server/simpleStatelessStreamableHttp.ts) example from the MCP TypeScript SDK.
