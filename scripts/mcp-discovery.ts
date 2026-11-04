/** Read-only Cognito discovery preflight. Never receives credentials or tokens. */
export type DiscoveryCheck = { name: string; passed: boolean };
export type DiscoveryReport = {
  status: 'metadata_compatible' | 'incompatible' | 'unavailable';
  checks: DiscoveryCheck[];
  pending: string[];
};
type Document = Record<string, unknown>;
const includes = (value: unknown, item: string) => Array.isArray(value) && value.includes(item);
const httpsEndpoint = (value: unknown) => {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash; }
  catch { return false; }
};
export function cognitoIssuer(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.port ||
    !/^cognito-idp\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/.test(url.hostname) ||
    !/^\/[a-z0-9-]+_[A-Za-z0-9]+$/.test(url.pathname))
    throw new Error('Provide an HTTPS Cognito user-pool issuer URL, without credentials or query parameters.');
  return url;
}
export function inspectDiscovery(document: Document, issuer: string): DiscoveryCheck[] {
  return [
    { name: 'Exact issuer match', passed: document.issuer === issuer },
    { name: 'HTTPS authorization endpoint', passed: httpsEndpoint(document.authorization_endpoint) },
    { name: 'HTTPS token endpoint', passed: httpsEndpoint(document.token_endpoint) },
    { name: 'HTTPS signing-key endpoint', passed: httpsEndpoint(document.jwks_uri) },
    { name: 'Authorization-code response advertised', passed: includes(document.response_types_supported, 'code') },
    { name: 'PKCE S256 advertised', passed: includes(document.code_challenge_methods_supported, 'S256') },
    { name: 'Public-client token authentication advertised', passed: includes(document.token_endpoint_auth_methods_supported, 'none') },
    { name: 'Authorization-code grant supported', passed: document.grant_types_supported === undefined || includes(document.grant_types_supported, 'authorization_code') },
    { name: 'Refresh grant advertised', passed: includes(document.grant_types_supported, 'refresh_token') },
  ];
}
export async function checkCognitoDiscovery(value: string, request: typeof fetch = fetch): Promise<DiscoveryReport> {
  const issuer = cognitoIssuer(value);
  const pending = [
    'Dedicated MCP clients, exact callback allowlists and fully qualified scopes',
    'Authorization-code PKCE exchange and resource-bound access-token audience',
    'Refresh exchange preserving resource audience and authorization cutoff',
    'Owner-run ChatGPT and MCP Inspector linking acceptance',
  ];
  // RFC 8414 path insertion, appended fallback, then OIDC discovery.
  const paths = [
    `/.well-known/oauth-authorization-server${issuer.pathname}`,
    `${issuer.pathname}/.well-known/oauth-authorization-server`,
    `${issuer.pathname}/.well-known/openid-configuration`,
  ];
  for (const path of paths) {
    try {
      const response = await request(new URL(path, issuer.origin), {
        redirect: 'error', signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' },
      });
      if (!response.ok) { await response.body?.cancel(); continue; }
      const reader = response.body?.getReader();
      if (!reader) continue;
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 65536) { await reader.cancel(); throw new Error('Metadata response too large'); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const document: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!document || typeof document !== 'object' || Array.isArray(document)) continue;
      const checks = inspectDiscovery(document as Document, issuer.href);
      // A returned metadata document is authoritative: do not hide invalid
      // metadata by silently selecting a more permissive fallback document.
      return { status: checks.every(check => check.passed) ? 'metadata_compatible' : 'incompatible', checks, pending };
    } catch { /* Try discovery fallback; never print upstream content or URLs. */ }
  }
  return { status: 'unavailable', checks: [], pending };
}
