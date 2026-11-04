import { describe, expect, it } from 'vitest';
import { MCP_SCOPE, base64url, sha256, validPkceChallenge } from '../server/mcp-auth';
import { clientFromMetadata, isChatGptClientMetadataId, oauth } from '../server/oauth-handler';

describe('MCP OAuth primitives', () => {
  it('uses the required read-only scope and RFC 7636 S256 transform', () => {
    expect(MCP_SCOPE).toBe('money-stalker.read');
    expect(sha256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('accepts only a base64url 256-bit challenge', () => {
    expect(validPkceChallenge('A'.repeat(43))).toBe(true);
    expect(validPkceChallenge('A'.repeat(42))).toBe(false);
    expect(validPkceChallenge(`${'A'.repeat(42)}+`)).toBe(false);
  });

  it('encodes discovery and token material without padding', () => {
    expect(base64url('{"alg":"RS256"}')).not.toContain('=');
  });

  it('advertises issuer identification so ChatGPT can use its stable callback', async () => {
    process.env.OAUTH_ISSUER = 'https://api.example.test';
    process.env.MCP_RESOURCE = 'https://api.example.test/mcp';
    const result = await oauth({ rawPath: '/.well-known/oauth-authorization-server', requestContext: { http: { method: 'GET' } } } as never);
    expect(JSON.parse(result.body)).toMatchObject({ issuer: 'https://api.example.test', authorization_response_iss_parameter_supported: true, client_id_metadata_document_supported: true, code_challenge_methods_supported: ['S256'] });
  });

  it('accepts only validated ChatGPT CIMD clients and their declared exact redirect', () => {
    const id = 'https://chatgpt.com/oauth/client.json';
    expect(isChatGptClientMetadataId(id)).toBe(true);
    expect(isChatGptClientMetadataId('https://attacker.example/oauth/client.json')).toBe(false);
    expect(clientFromMetadata(id, { client_id: id, redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'], token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] })).toEqual({ id, redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect'] });
    expect(clientFromMetadata(id, { client_id: id, redirect_uris: ['https://attacker.example/callback'], token_endpoint_auth_methods_supported: ['none'], grant_types: ['authorization_code'], response_types: ['code'] })).toBeUndefined();
  });
});
