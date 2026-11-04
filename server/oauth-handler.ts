import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { INSPECTOR_CLIENT_ID, MCP_SCOPE, epoch, jwks, opaqueToken, sha256, signAccessToken, validPkceChallenge, verifyAccessToken } from './mcp-auth';

type Client = { id: string; redirectUris: string[] };
type ClientMetadata = { client_id?: string; redirect_uris?: string[]; token_endpoint_auth_methods_supported?: string[]; grant_types?: string[]; response_types?: string[] };
type Login = { clientId: string; redirectUri: string; clientState: string; challenge: string; scope: string; resource: string; verifier: string; nonce: string };
type Code = Omit<Login, 'clientState' | 'verifier' | 'nonce'> & { sub: string };
type Refresh = { grantId: string; sub: string; clientId: string; scope: string; resource: string };

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
const clientMetadataCache = new Map<string, { client: Client; expiresAt: number }>();
const table = () => process.env.OAUTH_TABLE!;
const issuer = () => process.env.OAUTH_ISSUER!;
const resource = () => process.env.MCP_RESOURCE!;
const json = (statusCode: number, body: unknown, headers: Record<string, string> = {}) => ({ statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }, body: JSON.stringify(body) });
const redirect = (location: string) => ({ statusCode: 302, headers: { location, 'cache-control': 'no-store' }, body: '' });
const oauthError = (error: string, description: string, status = 400) => json(status, { error, error_description: description });
export function isChatGptClientMetadataId(id: string) {
  try {
    const url = new URL(id);
    return url.origin === 'https://chatgpt.com' && (url.pathname === '/oauth/client.json' || /^\/oauth\/[A-Za-z0-9_-]+\/client\.json$/.test(url.pathname)) && !url.search && !url.hash;
  } catch { return false; }
}

export function clientFromMetadata(id: string, metadata: ClientMetadata): Client | undefined {
  if (metadata.client_id !== id || !metadata.token_endpoint_auth_methods_supported?.includes('none') || !metadata.grant_types?.includes('authorization_code') || !metadata.response_types?.includes('code')) return undefined;
  const redirectUris = metadata.redirect_uris?.filter(uri => {
    try {
      const url = new URL(uri);
      return url.origin === 'https://chatgpt.com' && (url.pathname === '/connector_platform_oauth_redirect' || /^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(url.pathname)) && !url.search && !url.hash;
    } catch { return false; }
  });
  if (!redirectUris?.length || redirectUris.length !== metadata.redirect_uris?.length) return undefined;
  return { id, redirectUris };
}

async function metadataClient(id: string) {
  if (!isChatGptClientMetadataId(id)) return undefined;
  const cached = clientMetadataCache.get(id); if (cached && cached.expiresAt > Date.now()) return cached.client;
  const response = await fetch(id, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) return undefined;
  const text = await response.text(); if (Buffer.byteLength(text) > 32_768) return undefined;
  const client = clientFromMetadata(id, JSON.parse(text) as ClientMetadata); if (!client) return undefined;
  clientMetadataCache.set(id, { client, expiresAt: Date.now() + 300_000 });
  return client;
}

async function resolveClient(id: string): Promise<Client | undefined> {
  const dynamic = await metadataClient(id); if (dynamic) return dynamic;
  if (id === INSPECTOR_CLIENT_ID) return { id, redirectUris: [process.env.INSPECTOR_CALLBACK_URL!] };
}

async function put(kind: string, id: string, value: unknown, ttl: number) {
  await db.send(new PutCommand({ TableName: table(), Item: { pk: `${kind}#${sha256(id)}`, sk: 'META', value, expiresAt: epoch() + ttl }, ConditionExpression: 'attribute_not_exists(pk)' }));
}
async function consume<T>(kind: string, id: string): Promise<T | undefined> {
  try {
    const result = await db.send(new DeleteCommand({ TableName: table(), Key: { pk: `${kind}#${sha256(id)}`, sk: 'META' }, ConditionExpression: 'attribute_exists(pk)', ReturnValues: 'ALL_OLD' }));
    if (!result.Attributes || Number(result.Attributes.expiresAt) <= epoch()) return undefined;
    return result.Attributes.value as T | undefined;
  } catch (error) { if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return undefined; throw error; }
}
async function grantActive(id: string) {
  const row = await db.send(new GetCommand({ TableName: table(), Key: { pk: `GRANT#${id}`, sk: 'META' }, ConsistentRead: true }));
  return Boolean(row.Item && !row.Item.revokedAt && Number(row.Item.expiresAt) > epoch());
}

function bodyParams(event: APIGatewayProxyEventV2) {
  const text = event.body ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8').toString() : '';
  if (Buffer.byteLength(text) > 16_384) throw new Error('Request body too large');
  return new URLSearchParams(text);
}

async function authenticateClient(event: APIGatewayProxyEventV2, form: URLSearchParams) {
  const id = form.get('client_id') ?? '';
  if (event.headers.authorization) return undefined;
  const client = await resolveClient(id);
  return client;
}

async function authorize(event: APIGatewayProxyEventV2) {
  const q = event.queryStringParameters ?? {}, client = await resolveClient(q.client_id ?? '');
  if (!client || !q.redirect_uri || !client.redirectUris.includes(q.redirect_uri)) return oauthError('invalid_request', 'Unknown client or redirect URI');
  if (q.response_type !== 'code' || !q.state || q.resource !== resource() || q.scope !== MCP_SCOPE || q.code_challenge_method !== 'S256' || !validPkceChallenge(q.code_challenge))
    return redirectError(q.redirect_uri, q.state, 'invalid_request', 'Authorization code, state, resource, scope, and PKCE S256 are required');
  const state = opaqueToken(), verifier = opaqueToken(), nonce = opaqueToken();
  const login: Login = { clientId: client.id, redirectUri: q.redirect_uri, clientState: q.state, challenge: q.code_challenge!, scope: q.scope, resource: q.resource, verifier, nonce };
  await put('LOGIN', state, login, 600);
  const upstream = new URL('/oauth2/authorize', process.env.COGNITO_DOMAIN!);
  upstream.search = new URLSearchParams({ response_type: 'code', client_id: process.env.COGNITO_CLIENT_ID!, redirect_uri: `${issuer()}/oauth/callback`, scope: 'openid email profile', state, nonce, code_challenge: sha256(verifier), code_challenge_method: 'S256' }).toString();
  return redirect(upstream.toString());
}

function redirectError(uri: string, state: string | undefined, error: string, description: string) {
  const target = new URL(uri); target.searchParams.set('error', error); target.searchParams.set('error_description', description);
  if (state) target.searchParams.set('state', state);
  target.searchParams.set('iss', issuer());
  return redirect(target.toString());
}

async function callback(event: APIGatewayProxyEventV2) {
  const state = event.queryStringParameters?.state, upstreamCode = event.queryStringParameters?.code;
  if (!state) return oauthError('invalid_request', 'Missing login state');
  const login = await consume<Login>('LOGIN', state);
  if (!login) return oauthError('invalid_grant', 'Login state expired or already used');
  if (!upstreamCode) return redirectError(login.redirectUri, login.clientState, event.queryStringParameters?.error ?? 'access_denied', 'Cognito login was not completed');
  const tokenUrl = new URL('/oauth2/token', process.env.COGNITO_DOMAIN!);
  const response = await fetch(tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: process.env.COGNITO_CLIENT_ID!, code: upstreamCode, redirect_uri: `${issuer()}/oauth/callback`, code_verifier: login.verifier }) });
  if (!response.ok) return redirectError(login.redirectUri, login.clientState, 'access_denied', 'Cognito token exchange failed');
  const tokens = await response.json() as { id_token?: string };
  if (!tokens.id_token) return redirectError(login.redirectUri, login.clientState, 'access_denied', 'Cognito did not return an ID token');
  const verifier = CognitoJwtVerifier.create({ userPoolId: process.env.USER_POOL_ID!, tokenUse: 'id', clientId: process.env.COGNITO_CLIENT_ID! });
  const claims = await verifier.verify(tokens.id_token);
  if (claims.nonce !== login.nonce) return redirectError(login.redirectUri, login.clientState, 'access_denied', 'Cognito nonce validation failed');
  const code = opaqueToken();
  await put('CODE', code, { clientId: login.clientId, redirectUri: login.redirectUri, challenge: login.challenge, scope: login.scope, resource: login.resource, sub: claims.sub } satisfies Code, 300);
  const target = new URL(login.redirectUri); target.searchParams.set('code', code); target.searchParams.set('state', login.clientState); target.searchParams.set('iss', issuer());
  return redirect(target.toString());
}

async function issue(refresh: Refresh, includeRefresh = true) {
  const now = epoch();
  const access_token = await signAccessToken({ iss: issuer(), aud: refresh.resource, sub: refresh.sub, scope: refresh.scope, client_id: refresh.clientId, grant_id: refresh.grantId, iat: now, exp: now + 600, jti: opaqueToken() });
  if (!includeRefresh) return { access_token, token_type: 'Bearer', expires_in: 600, scope: refresh.scope };
  const refresh_token = opaqueToken(); await put('REFRESH', refresh_token, refresh, 30 * 86400);
  return { access_token, refresh_token, token_type: 'Bearer', expires_in: 600, scope: refresh.scope };
}

async function token(event: APIGatewayProxyEventV2) {
  let form: URLSearchParams; try { form = bodyParams(event); } catch { return oauthError('invalid_request', 'Invalid form body'); }
  const client = await authenticateClient(event, form); if (!client) return oauthError('invalid_client', 'Client authentication failed', 401);
  if (form.get('grant_type') === 'authorization_code') {
    const rawCode = form.get('code') ?? '', code = await consume<Code>('CODE', rawCode);
    if (!code || code.clientId !== client.id || code.redirectUri !== form.get('redirect_uri') || sha256(form.get('code_verifier') ?? '') !== code.challenge || form.get('resource') !== code.resource) return oauthError('invalid_grant', 'Code is invalid, expired, reused, or not bound to this request');
    const grantId = opaqueToken();
    await db.send(new PutCommand({ TableName: table(), Item: { pk: `GRANT#${grantId}`, sk: 'META', sub: code.sub, clientId: code.clientId, scope: code.scope, resource: code.resource, createdAt: new Date().toISOString(), expiresAt: epoch() + 30 * 86400 }, ConditionExpression: 'attribute_not_exists(pk)' }));
    return json(200, await issue({ grantId, sub: code.sub, clientId: code.clientId, scope: code.scope, resource: code.resource }));
  }
  if (form.get('grant_type') === 'refresh_token') {
    const oldToken = form.get('refresh_token') ?? '', refresh = await consume<Refresh>('REFRESH', oldToken);
    if (!refresh || refresh.clientId !== client.id || !await grantActive(refresh.grantId)) return oauthError('invalid_grant', 'Refresh token is invalid, expired, reused, or revoked');
    return json(200, await issue(refresh));
  }
  return oauthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported');
}

async function revoke(event: APIGatewayProxyEventV2) {
  let form: URLSearchParams; try { form = bodyParams(event); } catch { return json(200, {}); }
  const client = await authenticateClient(event, form); if (!client) return oauthError('invalid_client', 'Client authentication failed', 401);
  const tokenValue = form.get('token') ?? '';
  let value = await consume<Refresh>('REFRESH', tokenValue);
  if (!value && tokenValue.split('.').length === 3) {
    try {
      const claims = await verifyAccessToken(tokenValue, { issuer: issuer(), audience: resource(), scope: MCP_SCOPE });
      if (claims.client_id === client.id) value = { grantId: claims.grant_id, sub: claims.sub, clientId: claims.client_id, scope: claims.scope, resource: claims.aud };
    } catch { /* RFC 7009 returns success for an unknown token. */ }
  }
  if (value?.clientId === client.id) await db.send(new UpdateCommand({ TableName: table(), Key: { pk: `GRANT#${value.grantId}`, sk: 'META' }, UpdateExpression: 'SET revokedAt = :at', ConditionExpression: 'clientId = :client', ExpressionAttributeValues: { ':at': new Date().toISOString(), ':client': client.id } }));
  return json(200, {});
}

export async function oauth(event: APIGatewayProxyEventV2) {
  try {
    if (event.rawPath === '/.well-known/oauth-authorization-server') return json(200, { issuer: issuer(), authorization_response_iss_parameter_supported: true, client_id_metadata_document_supported: true, authorization_endpoint: `${issuer()}/oauth/authorize`, token_endpoint: `${issuer()}/oauth/token`, revocation_endpoint: `${issuer()}/oauth/revoke`, jwks_uri: `${issuer()}/.well-known/jwks.json`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: [MCP_SCOPE] });
    if (event.rawPath === '/.well-known/oauth-protected-resource' || event.rawPath === '/.well-known/oauth-protected-resource/mcp') return json(200, { resource: resource(), authorization_servers: [issuer()], scopes_supported: [MCP_SCOPE], bearer_methods_supported: ['header'] });
    if (event.rawPath === '/.well-known/jwks.json') return json(200, await jwks(), { 'cache-control': 'public, max-age=300' });
    if (event.rawPath === '/oauth/authorize' && event.requestContext.http.method === 'GET') return authorize(event);
    if (event.rawPath === '/oauth/callback' && event.requestContext.http.method === 'GET') return callback(event);
    if (event.rawPath === '/oauth/token' && event.requestContext.http.method === 'POST') return token(event);
    if (event.rawPath === '/oauth/revoke' && event.requestContext.http.method === 'POST') return revoke(event);
    return oauthError('invalid_request', 'Unknown OAuth endpoint', 404);
  } catch (error) { console.error('OAuth request failed', error instanceof Error ? error.name : 'UnknownError'); return oauthError('server_error', 'OAuth request failed', 500); }
}
