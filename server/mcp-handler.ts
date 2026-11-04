import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { dashboard } from '../domain/ledger';
import { bogotaDate } from '../domain/money';
import type { State, Transaction } from '../domain/model';
import { DynamoRepository, type Repository } from './repository';
import { MCP_SCOPE, verifyAccessToken } from './mcp-auth';

type Request = { jsonrpc?: string; id?: string | number | null; method?: string; params?: { name?: string; arguments?: unknown } };
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const repo = new DynamoRepository();
const issuer = () => process.env.OAUTH_ISSUER!;
const resource = () => process.env.MCP_RESOURCE!;
const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const response = (statusCode: number, body?: unknown, extra: Record<string, string> = {}) => ({ statusCode, headers: { ...headers, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const rpc = (id: Request['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const rpcError = (id: Request['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function activeGrant(id: string, sub: string) {
  const result = await db.send(new GetCommand({ TableName: process.env.OAUTH_TABLE!, Key: { pk: `GRANT#${id}`, sk: 'META' }, ConsistentRead: true }));
  return Boolean(result.Item && !result.Item.revokedAt && result.Item.sub === sub && Number(result.Item.expiresAt) > Math.floor(Date.now() / 1000));
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const secured = [{ type: 'oauth2', scopes: [MCP_SCOPE] }];
const tools = [
  { name: 'get_profile', description: 'Return the stable Money Stalker account identity for connection confirmation.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, outputSchema: { type: 'object', properties: { id: { type: 'string' }, account: { type: 'string' } }, required: ['id', 'account'], additionalProperties: false }, annotations: readOnly, securitySchemes: secured, _meta: { 'openai/profile': true } },
  { name: 'get_financial_snapshot', description: 'Return aggregate dashboard values in COP minor units for today. Use list_movements for transaction history and merchant/date analysis.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: readOnly, securitySchemes: secured },
  { name: 'list_accounts', description: 'List the authenticated user\'s Money Stalker accounts with IDs, names, product kinds and current balances in COP minor units. Use account IDs from this result to filter list_movements.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: readOnly, securitySchemes: secured },
  { name: 'list_movements', description: 'Search the authenticated Money Stalker user\'s complete movement history. Results are newest first and paginated. When the user asks for all movements or a broad analysis, keep calling with nextCursor until it is absent. Amounts are COP minor-unit strings.', inputSchema: { type: 'object', properties: { fromDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Inclusive financial date.' }, toDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Inclusive financial date.' }, kinds: { type: 'array', items: { type: 'string', enum: ['expense', 'income', 'transfer', 'refund', 'loan_payment'] }, uniqueItems: true }, accountId: { type: 'string' }, categoryId: { type: 'string' }, merchantQuery: { type: 'string', maxLength: 200 }, status: { type: 'string', enum: ['posted', 'provisional'] }, includeDeleted: { type: 'boolean', default: false }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 }, cursor: { type: 'string', description: 'Opaque nextCursor returned by the previous call with identical filters.' } }, additionalProperties: false }, annotations: readOnly, securitySchemes: secured },
  { name: 'get_movement', description: 'Return one movement by ID with journal entries, account/category names, linked evidence summaries, confirmed place/location, loan allocation and audit-relevant revision fields. Use after list_movements when more detail is needed.', inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['id'], additionalProperties: false }, annotations: readOnly, securitySchemes: secured },
];

const movementQuerySchema = z.object({
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  kinds: z.array(z.enum(['expense', 'income', 'transfer', 'refund', 'loan_payment'])).max(5).optional(), accountId: z.string().min(1).max(200).optional(),
  categoryId: z.string().min(1).max(200).optional(), merchantQuery: z.string().trim().max(200).optional(), status: z.enum(['posted', 'provisional']).optional(),
  includeDeleted: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(50), cursor: z.string().max(1000).optional(),
}).strict().refine(value => !value.fromDate || !value.toDate || value.fromDate <= value.toDate, 'fromDate must not be after toDate');
type MovementQuery = z.infer<typeof movementQuerySchema>;
const cursorDigest = (query: MovementQuery) => createHash('sha256').update(JSON.stringify({ ...query, cursor: undefined, limit: undefined })).digest('base64url').slice(0, 16);
const encodeCursor = (date: string, id: string, digest: string) => Buffer.from(JSON.stringify({ date, id, digest })).toString('base64url');
function decodeCursor(value: string | undefined, digest: string) {
  if (!value) return undefined;
  try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString()) as { date?: string; id?: string; digest?: string }; return parsed.date && parsed.id && parsed.digest === digest ? { date: parsed.date, id: parsed.id } : undefined; }
  catch { return undefined; }
}
const categoryPath = (state: State, id: string) => {
  const value = state.categories.find(category => category.id === id); if (!value) return undefined;
  const parent = value.parentId ? state.categories.find(category => category.id === value.parentId) : undefined;
  return parent ? `${parent.name} / ${value.name}` : value.name;
};
const account = (state: State, id: string | undefined) => { const value = id ? state.accounts.find(item => item.id === id) : undefined; return value ? { id: value.id, name: value.name, kind: value.kind } : undefined; };
const movementSummary = (state: State, movement: Transaction) => ({
  id: movement.id, date: movement.date, kind: movement.kind, amountMinor: movement.amountMinor, currency: 'COP', merchant: movement.merchant,
  account: account(state, movement.accountId), counterAccount: account(state, movement.counterAccountId), categoryId: movement.categoryId,
  category: categoryPath(state, movement.categoryId), status: movement.status, note: movement.note || undefined, reference: movement.reference,
  deleted: Boolean(movement.voided), revision: movement.revision, linkedEvidenceCount: movement.observationIds.length,
});

export function listMovements(state: State, input: unknown) {
  const query = movementQuerySchema.parse(input ?? {}), digest = cursorDigest(query), cursor = decodeCursor(query.cursor, digest);
  if (query.cursor && !cursor) throw new Error('Invalid cursor for these filters');
  const merchant = query.merchantQuery?.toLocaleLowerCase('es-CO');
  let values = state.transactions.filter(value => (query.includeDeleted || !value.voided) && (!query.fromDate || value.date >= query.fromDate) && (!query.toDate || value.date <= query.toDate)
    && (!query.kinds?.length || query.kinds.includes(value.kind)) && (!query.accountId || value.accountId === query.accountId || value.counterAccountId === query.accountId)
    && (!query.categoryId || value.categoryId === query.categoryId) && (!query.status || value.status === query.status) && (!merchant || value.merchant.toLocaleLowerCase('es-CO').includes(merchant)))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  if (cursor) values = values.filter(value => value.date < cursor.date || (value.date === cursor.date && value.id > cursor.id));
  const page = values.slice(0, query.limit), hasMore = values.length > page.length, last = page.at(-1);
  return { movements: page.map(value => movementSummary(state, value)), count: page.length, hasMore, ...(hasMore && last ? { nextCursor: encodeCursor(last.date, last.id, digest) } : {}) };
}

export function movementDetail(state: State, id: string) {
  const movement = state.transactions.find(value => value.id === id); if (!movement) return undefined;
  return { ...movementSummary(state, movement), entries: movement.entries.map(entry => ({ ...entry, account: account(state, entry.accountId) })),
    place: movement.place, loanPayment: movement.loanPayment,
    evidence: movement.observationIds.map(observationId => state.observations.find(value => value.id === observationId)).filter(Boolean).map(value => ({ id: value!.id, source: value!.source, observedAt: value!.observedAt, receivedAt: value!.receivedAt, date: value!.date, amountMinor: value!.amountMinor, merchant: value!.merchant, kind: value!.kind, status: value!.status, reason: value!.reason, location: value!.location })),
  };
}

export async function financialSnapshot(source: Pick<Repository, 'read'>, subject: string) {
  const value = dashboard(await source.read(subject), bogotaDate());
  return { currency: 'COP', unit: 'minor', today: value.today, liquidMinor: value.liquidMinor, cardDebtMinor: value.cardDebtMinor, billsMinor: value.billsMinor, reserveMinor: value.reserveMinor, uncertainMinor: value.uncertainMinor, availableMinor: value.availableMinor, spendingMinor: value.spendingMinor, incomeMinor: value.incomeMinor, nextPayday: value.nextPayday, pendingReview: value.pending, categorySpending: value.categorySpending.map(({ id: _id, parentId: _parentId, ...category }) => category) };
}
export function accountDirectory(state: State) {
  const balances = dashboard(state, bogotaDate()).balances;
  return { currency: 'COP', unit: 'minor', accounts: state.accounts.map(value => ({ id: value.id, name: value.name, kind: value.kind, openingDate: value.openingDate, eligible: value.eligible, balanceMinor: balances[value.id] ?? '0' })) };
}
const toolResult = (data: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });

export async function mcp(event: APIGatewayProxyEventV2) {
  const challenge = `Bearer resource_metadata="${issuer()}/.well-known/oauth-protected-resource", scope="${MCP_SCOPE}"`;
  const bearer = event.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearer) return response(401, { error: 'unauthorized' }, { 'www-authenticate': challenge });
  let claims;
  try { claims = await verifyAccessToken(bearer, { issuer: issuer(), audience: resource(), scope: MCP_SCOPE }); }
  catch { return response(401, { error: 'invalid_token' }, { 'www-authenticate': `${challenge}, error="invalid_token"` }); }
  if (!await activeGrant(claims.grant_id, claims.sub)) return response(401, { error: 'invalid_token' }, { 'www-authenticate': `${challenge}, error="invalid_token"` });
  if (event.requestContext.http.method !== 'POST') return response(405, { error: 'method_not_allowed' }, { allow: 'POST' });
  let request: Request;
  try {
    const text = event.body ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8').toString() : '';
    if (Buffer.byteLength(text) > 32_768) return response(413, rpcError(null, -32600, 'Request too large'));
    request = JSON.parse(text) as Request;
  } catch { return response(400, rpcError(null, -32700, 'Parse error')); }
  if (request.jsonrpc !== '2.0' || !request.method) return response(400, rpcError(request.id, -32600, 'Invalid Request'));
  if (request.method === 'notifications/initialized') return response(202);
  if (request.method === 'initialize') return response(200, rpc(request.id, { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'money-stalker', version: '0.1.0' } }));
  if (request.method === 'tools/list') return response(200, rpc(request.id, { tools }));
  if (request.method !== 'tools/call') return response(200, rpcError(request.id, -32601, 'Method not found'));
  if (request.params?.name === 'get_profile') {
    const data = { id: claims.sub, account: 'Money Stalker' };
    return response(200, rpc(request.id, toolResult(data)));
  }
  if (request.params?.name === 'get_financial_snapshot') {
    const data = await financialSnapshot(repo, claims.sub);
    return response(200, rpc(request.id, toolResult(data)));
  }
  if (request.params?.name === 'list_accounts') return response(200, rpc(request.id, toolResult(accountDirectory(await repo.read(claims.sub)))));
  if (request.params?.name === 'list_movements') {
    try { return response(200, rpc(request.id, toolResult(listMovements(await repo.read(claims.sub), request.params.arguments)))); }
    catch (error) { return response(200, rpcError(request.id, -32602, error instanceof Error ? error.message : 'Invalid movement filters')); }
  }
  if (request.params?.name === 'get_movement') {
    const parsed = z.object({ id: z.string().min(1).max(200) }).strict().safeParse(request.params.arguments);
    if (!parsed.success) return response(200, rpcError(request.id, -32602, 'A valid movement id is required'));
    const data = movementDetail(await repo.read(claims.sub), parsed.data.id);
    if (!data) return response(200, rpcError(request.id, -32602, 'Movement not found'));
    return response(200, rpc(request.id, toolResult(data)));
  }
  return response(200, rpcError(request.id, -32602, 'Unknown tool'));
}
