# Connect Money Stalker to ChatGPT or another MCP client

The repository now contains the AWS CDK design and Lambda code for a read-only remote MCP server. Cognito still owns the user account and login page. A small OAuth Lambda sits in front of Cognito because MCP clients require OAuth metadata and resource-bound tokens that the existing Cognito issuer does not advertise.

This is implemented locally but **not deployed or verified against a live AWS account**. The owner must deploy it manually.

## What CDK creates

- OAuth Lambda: discovery, authorize, callback, token, revocation and JWKS.
- MCP Lambda: stateless Streamable HTTP JSON-RPC at `POST /mcp`.
- Cognito public app client used only for the upstream login callback.
- DynamoDB OAuth table with TTL for one-use login states, authorization codes, rotating refresh tokens and revocable grants.
- RSA-2048 KMS signing key. Access tokens expire after 10 minutes.
- Read-only Ledger permission for MCP. It cannot write financial data, read S3, read Intake, or assume user AWS credentials.

The MCP exposes these authenticated, read-only tools:

- `get_profile`: stable Cognito subject for connection confirmation.
- `get_financial_snapshot`: aggregate COP dashboard values. It excludes raw SMS, statements, account identifiers, documents and location evidence.
- `list_accounts`: account IDs, names, product kinds and current balances for movement filtering.
- `list_movements`: complete household movement history with date, kind, account, category, merchant, status and deletion filters; pages contain at most 100 movements and expose an opaque continuation cursor.
- `get_movement`: one movement with journal entries, linked evidence summaries, confirmed place/location, loan allocation and revision details.

## Manual configuration after deployment

1. Deploy the CDK stack yourself. Codex does not deploy this repository.
2. Copy the `MCPURL` and `MCPOAuthIssuer` CloudFormation outputs.
3. In ChatGPT's connector/MCP setup, use the `MCPURL`, choose OAuth and choose **Client ID Metadata Document (CIMD)** for client registration. Do not enter a client ID or client secret.
4. Start the connection. ChatGPT supplies its `https://chatgpt.com/oauth/.../client.json` identity; Money Stalker fetches that document and validates the exact declared redirect URI.
5. The browser goes to the existing Cognito login. After successful login, ChatGPT receives a Money Stalker access/refresh grant.

Callback URLs are not configured in CDK. Money Stalker accepts only ChatGPT metadata documents on `https://chatgpt.com/oauth/`, fetches the document without following redirects, and accepts only the exact `chatgpt.com` callback URI declared there. OAuth metadata advertises issuer identification, so eligible connections normally use the stable callback. There is no predefined ChatGPT client or ChatGPT client secret.

## MCP Inspector

The separate public client ID is `money-stalker-inspector`; it always requires PKCE S256 and has no secret. The default callback is `http://127.0.0.1:6274/oauth/callback`. If the Inspector shows a different exact callback, add this CDK context to the owner's deploy command:

```sh
-c mcpInspectorCallbackUrl=http://127.0.0.1:PORT/EXACT-PATH
```

## Security behavior

- Authorization requires a validated ChatGPT CIMD client or the separate Inspector public client, exact declared redirect URI, `resource=<MCPURL>`, scope `money-stalker.read`, and PKCE S256.
- Cognito login uses a separate nonce and PKCE verifier. The callback validates the Cognito ID token signature, audience, expiry and nonce.
- Authorization codes are one-use and live for five minutes. Login state lives for ten minutes. Refresh tokens rotate on every use and live for 30 days.
- KMS-signed access tokens bind issuer, MCP audience, Cognito `sub`, scope, client and grant. MCP also reads the grant row on every request, so revocation cuts off an otherwise unexpired access token.
- The verified Cognito `sub` selects only DynamoDB partition `H#<sub>`.
- OAuth and MCP errors do not log tokens or financial payloads.

## Acceptance checks after the owner deploys

1. Open `MCPOAuthIssuer/.well-known/oauth-authorization-server` and confirm it advertises authorization code, refresh token, S256, token/revocation/JWKS URLs.
2. Open `MCPOAuthIssuer/.well-known/oauth-protected-resource` and confirm its `resource` exactly equals `MCPURL`.
3. Connect through ChatGPT and Inspector. Complete Cognito login, run the summary tools, page through movement history and retrieve one movement's details.
4. Confirm a second household cannot read the first household's snapshot.
5. Revoke/disconnect, then confirm both the old access token and refresh token stop working. Reconnect and confirm a new grant works.
6. Confirm CloudWatch logs contain no tokens, Cognito claims, raw statements, messages, locations or financial response bodies.

The old `npm run check:mcp-auth` command still checks the public Cognito issuer. It is diagnostic only; the deployable MCP path now uses the OAuth Lambda issuer, not Cognito discovery directly.
