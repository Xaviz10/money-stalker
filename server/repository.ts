import { createHash, randomBytes } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { emptyState, normalizeDefaultCategories, DomainError, type State } from '../domain/model';

export type Job = { id: string; householdId: string; kind: 'capture' | 'import'; payload: unknown; digest: string; status: 'pending' | 'done'; createdAt: string; error?: string };
export type Device = { id: string; householdId: string; name: string; tokenHash: string; createdAt: string; revoked: boolean };
export type Batch = { id: string; householdId: string; filename: string; accountId: string; profile: string; status: 'uploading' | 'preview' | 'committing' | 'done' | 'error';
  originalKey: string; previewKey?: string; hash?: string; total?: number; accepted?: number; rejected?: number; skipped?: number;
  duplicates?: number; omittedDuplicates?: number;
  next: number; createdAt: string; error?: string };
export interface Repository {
  read(h: string): Promise<State>;
  mutate<T>(h: string, fn: (state: State) => T): Promise<T>;
  putJob(job: Job): Promise<void>; job(h: string, id: string): Promise<Job | undefined>;
  finishJob(h: string, id: string, error?: string): Promise<void>; pendingJobs(): Promise<Job[]>;
  devices(h: string): Promise<Device[]>; createDevice(h: string, name: string): Promise<{ device: Device; token: string }>;
  authenticateDevice(token: string): Promise<Device>; revokeDevice(h: string, id: string): Promise<void>;
  batch(h: string, id: string): Promise<Batch | undefined>; batches(h: string): Promise<Batch[]>; saveBatch(batch: Batch): Promise<void>;
}
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export class MemoryRepository implements Repository {
  states = new Map<string, State>(); jobs = new Map<string, Job>(); deviceRows = new Map<string, Device>(); batchRows = new Map<string, Batch>();
  private key(h: string, id: string) { return `${h}/${id}`; }
  async read(h: string) { const state = structuredClone(this.states.get(h) ?? emptyState()); normalizeDefaultCategories(state); return state; }
  async mutate<T>(h: string, fn: (state: State) => T) { const s = structuredClone(this.states.get(h) ?? emptyState()); normalizeDefaultCategories(s); const result = fn(s); this.states.set(h, s); return structuredClone(result); }
  async putJob(job: Job) { const k = this.key(job.householdId, job.id), old = this.jobs.get(k); if (old && old.digest !== job.digest) throw new DomainError('Evento reutilizado con datos distintos', 409); if (!old) this.jobs.set(k, structuredClone(job)); }
  async job(h: string, id: string) { return structuredClone(this.jobs.get(this.key(h, id))); }
  async finishJob(h: string, id: string, error?: string) { const j = this.jobs.get(this.key(h, id)); if (j) { j.status = error ? 'pending' : 'done'; j.error = error; } }
  async pendingJobs() { return structuredClone([...this.jobs.values()].filter(j => j.status === 'pending').slice(0, 100)); }
  async devices(h: string) { return structuredClone([...this.deviceRows.values()].filter(d => d.householdId === h)); }
  async createDevice(h: string, name: string) { const token = randomBytes(32).toString('base64url'), device = { id: randomBytes(8).toString('hex'), householdId: h, name, tokenHash: tokenHash(token), createdAt: new Date().toISOString(), revoked: false }; this.deviceRows.set(device.id, device); return { device: structuredClone(device), token }; }
  async authenticateDevice(token: string) { const d = [...this.deviceRows.values()].find(d => d.tokenHash === tokenHash(token) && !d.revoked); if (!d) throw new DomainError('Token de captura inválido', 401); return structuredClone(d); }
  async revokeDevice(h: string, id: string) { const d = this.deviceRows.get(id); if (!d || d.householdId !== h) throw new DomainError('Dispositivo desconocido', 404); d.revoked = true; }
  async batch(h: string, id: string) { return structuredClone(this.batchRows.get(this.key(h, id))); }
  async batches(h: string) { return structuredClone([...this.batchRows.values()].filter(b => b.householdId === h)); }
  async saveBatch(b: Batch) { this.batchRows.set(this.key(b.householdId, b.id), structuredClone(b)); }
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
type Item = { pk: string; sk: string; value?: unknown; revision?: number; workPk?: string; workSk?: string; expiresAt?: number };
const stateItems = (state: State): Map<string, unknown> => {
  const map = new Map<string, unknown>([['settings', state.settings]]);
  for (const key of ['accounts', 'instruments', 'categories', 'bills', 'transactions', 'observations', 'audit', 'aliases'] as const)
    for (const value of state[key]) map.set(`${key}#${value.id}`, value);
  return map;
};
export const persistedStateItems = (state: State): Map<string, unknown> =>
  new Map([...stateItems(state)].map(([key, value]) => [key, structuredClone(value)]));
export class DynamoRepository implements Repository {
  constructor(private ledger = process.env.LEDGER_TABLE!, private intake = process.env.INTAKE_TABLE!) {}
  private async query(table: string, pk: string, prefix?: string) {
    const items: Item[] = []; let cursor: Record<string, unknown> | undefined;
    do {
      const result = await db.send(new QueryCommand({ TableName: table, ConsistentRead: true,
        KeyConditionExpression: 'pk = :p' + (prefix ? ' AND begins_with(sk, :s)' : ''),
        ExpressionAttributeValues: { ':p': pk, ...(prefix ? { ':s': prefix } : {}) }, ExclusiveStartKey: cursor }));
      items.push(...result.Items as Item[] ?? []); cursor = result.LastEvaluatedKey;
      if (items.length > 30000) throw new DomainError('Se alcanzó el límite del piloto; exporta y amplía la paginación antes de continuar', 413);
    } while (cursor);
    return items;
  }
  private async snapshot(h: string) {
    const rows = await this.query(this.ledger, `H#${h}`), state = emptyState();
    const meta = rows.find(r => r.sk === 'META');
    for (const row of rows) {
      if (row.sk === 'settings') state.settings = row.value as State['settings'];
      else { const key = row.sk.split('#')[0]; if (Array.isArray(state[key as keyof State])) {
        const array = state[key as keyof State] as { id: string }[];
        const item = row.value as { id: string }; const old = array.findIndex(i => i.id === item.id);
        if (old < 0) array.push(item); else array[old] = item;
      } }
    }
    const persisted = persistedStateItems(state);
    normalizeDefaultCategories(state);
    return { state, persisted, revision: meta?.revision ?? 0 };
  }
  async read(h: string) { return (await this.snapshot(h)).state; }
  async mutate<T>(h: string, fn: (state: State) => T): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { state, persisted: before, revision } = await this.snapshot(h), result = fn(state), after = stateItems(state);
      const changed = [...after].filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before.get(k)));
      const deleted = [...before.keys()].filter(k => !after.has(k));
      if (changed.length + deleted.length > 95) throw new DomainError('Operación demasiado grande; utiliza lotes pequeños', 413);
      try {
        await db.send(new TransactWriteCommand({ TransactItems: [
          { Put: { TableName: this.ledger, Item: { pk: `H#${h}`, sk: 'META', revision: revision + 1 },
            ConditionExpression: revision ? 'revision = :v' : 'attribute_not_exists(pk)', ...(revision ? { ExpressionAttributeValues: { ':v': revision } } : {}) } },
          ...changed.map(([sk, value]) => ({ Put: { TableName: this.ledger, Item: { pk: `H#${h}`, sk, value } } })),
          ...deleted.map(sk => ({ Delete: { TableName: this.ledger, Key: { pk: `H#${h}`, sk } } })),
        ] })); return result;
      } catch (e) { if (!(e instanceof Error) || e.name !== 'TransactionCanceledException' || attempt === 3) throw e; }
    }
    throw new DomainError('Actualización concurrente; vuelve a intentar', 409);
  }
  private async get<T>(pk: string, sk: string): Promise<T | undefined> { return (await db.send(new GetCommand({ TableName: this.intake, Key: { pk, sk }, ConsistentRead: true }))).Item?.value as T | undefined; }
  async putJob(job: Job) {
    try { await db.send(new PutCommand({ TableName: this.intake, Item: { pk: `H#${job.householdId}`, sk: `JOB#${job.id}`, value: job, workPk: 'PENDING', workSk: `${job.createdAt}#${job.id}`, expiresAt: Math.floor(Date.parse(job.createdAt) / 1000) + 30 * 86400 }, ConditionExpression: 'attribute_not_exists(pk)' })); }
    catch (e) { if (!(e instanceof Error) || e.name !== 'ConditionalCheckFailedException') throw e; const old = await this.job(job.householdId, job.id); if (old?.digest !== job.digest) throw new DomainError('Evento reutilizado con datos distintos', 409); }
  }
  async job(h: string, id: string) { return this.get<Job>(`H#${h}`, `JOB#${id}`); }
  async finishJob(h: string, id: string, error?: string) {
    if (error) { await db.send(new UpdateCommand({ TableName: this.intake, Key: { pk: `H#${h}`, sk: `JOB#${id}` }, UpdateExpression: 'SET #v.#e = :e', ExpressionAttributeNames: { '#v': 'value', '#e': 'error' }, ExpressionAttributeValues: { ':e': error } })); return; }
    await db.send(new UpdateCommand({ TableName: this.intake, Key: { pk: `H#${h}`, sk: `JOB#${id}` },
      UpdateExpression: 'SET #v.#s = :s REMOVE workPk, workSk, #v.#e', ExpressionAttributeNames: { '#v': 'value', '#s': 'status', '#e': 'error' }, ExpressionAttributeValues: { ':s': 'done' } }));
  }
  async pendingJobs() {
    const result = await db.send(new QueryCommand({ TableName: this.intake, IndexName: 'pending', KeyConditionExpression: 'workPk = :p', ExpressionAttributeValues: { ':p': 'PENDING' }, Limit: 100 }));
    return (result.Items ?? []).map(i => i.value as Job);
  }
  async devices(h: string) { return (await this.query(this.intake, `H#${h}`, 'DEVICE#')).map(i => i.value as Device); }
  async createDevice(h: string, name: string) {
    const token = randomBytes(32).toString('base64url'), device: Device = { id: randomBytes(8).toString('hex'), householdId: h, name, tokenHash: tokenHash(token), createdAt: new Date().toISOString(), revoked: false };
    await db.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: this.intake, Item: { pk: `H#${h}`, sk: `DEVICE#${device.id}`, value: device } } },
      { Put: { TableName: this.intake, Item: { pk: `TOKEN#${device.tokenHash}`, sk: 'TOKEN', value: device } } },
    ] })); return { device, token };
  }
  async authenticateDevice(token: string) {
    const d = await this.get<Device>(`TOKEN#${tokenHash(token)}`, 'TOKEN');
    if (!d || d.revoked) throw new DomainError('Token de captura inválido', 401);
    // Atomic per-device daily quota. Replays count toward the bound as well.
    const today = new Date().toISOString().slice(0, 10);
    try { await db.send(new UpdateCommand({ TableName: this.intake, Key: { pk: `RATE#${d.id}`, sk: today },
      UpdateExpression: 'SET expiresAt = :ttl ADD #n :one', ConditionExpression: 'attribute_not_exists(#n) OR #n < :max',
      ExpressionAttributeNames: { '#n': 'count' }, ExpressionAttributeValues: { ':ttl': Math.floor(Date.now() / 1000) + 172800, ':one': 1, ':max': 200 } })); }
    catch (e) { if (e instanceof Error && e.name === 'ConditionalCheckFailedException') throw new DomainError('Límite diario de captura alcanzado', 429); throw e; }
    return d;
  }
  async revokeDevice(h: string, id: string) {
    const d = await this.get<Device>(`H#${h}`, `DEVICE#${id}`); if (!d) throw new DomainError('Dispositivo desconocido', 404); d.revoked = true;
    await db.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: this.intake, Item: { pk: `H#${h}`, sk: `DEVICE#${id}`, value: d } } },
      { Put: { TableName: this.intake, Item: { pk: `TOKEN#${d.tokenHash}`, sk: 'TOKEN', value: d } } },
    ] }));
  }
  async batch(h: string, id: string) { return this.get<Batch>(`H#${h}`, `BATCH#${id}`); }
  async batches(h: string) { return (await this.query(this.intake, `H#${h}`, 'BATCH#')).map(i => i.value as Batch); }
  async saveBatch(batch: Batch) { await db.send(new PutCommand({ TableName: this.intake, Item: { pk: `H#${batch.householdId}`, sk: `BATCH#${batch.id}`, value: batch } })); }
}
