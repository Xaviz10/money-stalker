import { describe, expect, it } from 'vitest';
import { checkCognitoDiscovery, cognitoIssuer, inspectDiscovery } from '../scripts/mcp-discovery';

const issuer = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Synthetic';
const metadata = {
  issuer, authorization_endpoint: 'https://login.example.com/oauth2/authorize',
  token_endpoint: 'https://login.example.com/oauth2/token', jwks_uri: `${issuer}/.well-known/jwks.json`,
  response_types_supported: ['code'], code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'], grant_types_supported: ['authorization_code', 'refresh_token'],
};
describe('MCP Cognito discovery gate', () => {
  it('rejects missing S256 even if authorization-code support is advertised', () => {
    const { code_challenge_methods_supported: _, ...withoutPkce } = metadata;
    expect(inspectDiscovery(withoutPkce, issuer).find(c => c.name === 'PKCE S256 advertised')?.passed).toBe(false);
  });
  it('rejects wrong issuer, unsafe endpoints and secret-only clients', () => {
    const checks = inspectDiscovery({ ...metadata, issuer: `${issuer}/other`, token_endpoint: 'http://localhost/token', token_endpoint_auth_methods_supported: ['client_secret_basic'] }, issuer);
    expect(checks.filter(c => !c.passed)).toHaveLength(3);
  });
  it('limits network access to Cognito discovery and never follows redirects', async () => {
    const requested: string[] = [];
    const report = await checkCognitoDiscovery(issuer, (async (url, init) => {
      requested.push(String(url)); expect(init?.redirect).toBe('error');
      return requested.length < 3 ? new Response('', { status: 404 }) : Response.json(metadata);
    }) as typeof fetch);
    expect(report.status).toBe('metadata_compatible');
    expect(report.pending).toHaveLength(4);
    expect(requested).toEqual([
      'https://cognito-idp.us-east-1.amazonaws.com/.well-known/oauth-authorization-server/us-east-1_Synthetic',
      `${issuer}/.well-known/oauth-authorization-server`, `${issuer}/.well-known/openid-configuration`,
    ]);
  });
  it('stops on authoritative incompatible discovery', async () => {
    let calls = 0;
    const report = await checkCognitoDiscovery(issuer, (async () => {
      calls++; return Response.json({ ...metadata, code_challenge_methods_supported: [] });
    }) as typeof fetch);
    expect(calls).toBe(1); expect(report.status).toBe('incompatible');
  });
  it('distinguishes unavailable or malformed metadata from incompatibility', async () => {
    expect((await checkCognitoDiscovery(issuer, (async () => new Response('not json')) as typeof fetch)).status).toBe('unavailable');
    expect((await checkCognitoDiscovery(issuer, (async () => new Response('x'.repeat(65537))) as typeof fetch)).status).toBe('unavailable');
  });
  it('rejects arbitrary hosts, credentials, query strings, paths and HTTP before fetching', () => {
    for (const input of ['http://localhost', 'https://example.com/pool', `${issuer}?token=secret`, `${issuer}/other`, issuer.replace('https://', 'https://user:pass@')])
      expect(() => cognitoIssuer(input)).toThrow();
  });
});
