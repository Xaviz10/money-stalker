import { createHash, createPublicKey, randomBytes, verify as verifySignature, type JsonWebKey } from 'node:crypto';
import { GetPublicKeyCommand, KMSClient, SignCommand } from '@aws-sdk/client-kms';

export const MCP_SCOPE = 'money-stalker.read';
export const INSPECTOR_CLIENT_ID = 'money-stalker-inspector';

export const base64url = (value: string | Uint8Array) => Buffer.from(value).toString('base64url');
export const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');
export const opaqueToken = () => randomBytes(32).toString('base64url');
export const epoch = () => Math.floor(Date.now() / 1000);

export function validPkceChallenge(value: string | undefined) {
  return Boolean(value && /^[A-Za-z0-9_-]{43}$/.test(value));
}

export type AccessClaims = {
  iss: string; aud: string; sub: string; scope: string; client_id: string; grant_id: string;
  iat: number; exp: number; jti: string;
};

const kms = new KMSClient({});
let publicKeyCache: { keyId: string; der: Buffer; jwk: JsonWebKey } | undefined;

export async function publicSigningKey(keyId = process.env.SIGNING_KEY_ID!) {
  if (publicKeyCache?.keyId === keyId) return publicKeyCache;
  const result = await kms.send(new GetPublicKeyCommand({ KeyId: keyId }));
  if (!result.PublicKey) throw new Error('KMS signing key has no public key');
  const der = Buffer.from(result.PublicKey);
  const jwk = createPublicKey({ key: der, format: 'der', type: 'spki' }).export({ format: 'jwk' });
  publicKeyCache = { keyId, der, jwk };
  return publicKeyCache;
}

export async function jwks(keyId = process.env.SIGNING_KEY_ID!) {
  const { jwk } = await publicSigningKey(keyId);
  return { keys: [{ ...jwk, use: 'sig', alg: 'RS256', kid: createHash('sha256').update(keyId).digest('hex').slice(0, 16) }] };
}

export async function signAccessToken(claims: AccessClaims, keyId = process.env.SIGNING_KEY_ID!) {
  const kid = createHash('sha256').update(keyId).digest('hex').slice(0, 16);
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }))}.${base64url(JSON.stringify(claims))}`;
  const result = await kms.send(new SignCommand({ KeyId: keyId, Message: Buffer.from(unsigned), MessageType: 'RAW', SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256' }));
  if (!result.Signature) throw new Error('KMS did not return a signature');
  return `${unsigned}.${base64url(result.Signature)}`;
}

export async function verifyAccessToken(token: string, expected: { issuer: string; audience: string; scope: string }, keyId = process.env.SIGNING_KEY_ID!): Promise<AccessClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed access token');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { alg?: string; typ?: string };
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as AccessClaims;
  if (header.alg !== 'RS256' || header.typ !== 'JWT') throw new Error('Unsupported access token');
  const { der } = await publicSigningKey(keyId);
  if (!verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: der, format: 'der', type: 'spki' }), Buffer.from(parts[2], 'base64url'))) throw new Error('Invalid access token signature');
  const now = epoch();
  if (claims.iss !== expected.issuer || claims.aud !== expected.audience || claims.exp <= now || claims.iat > now + 60) throw new Error('Invalid access token claims');
  if (!claims.scope?.split(' ').includes(expected.scope) || !claims.sub || !claims.grant_id) throw new Error('Insufficient access token scope');
  return claims;
}
