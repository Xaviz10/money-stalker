import { describe, expect, it } from 'vitest';
import { createAPI } from '../server/api';
import { MemoryRepository, persistedStateItems } from '../server/repository';
import { MemoryFiles } from '../server/storage';
import { captureJob, processJob } from '../server/processing';
import { addTransaction, configure } from '../domain/ledger';
import { emptyState, type State } from '../domain/model';
import { readFileSync } from 'node:fs';
const now = '2026-10-17T18:00:00Z';
async function setup() {
  const repo = new MemoryRepository(), files = new MemoryFiles(), api = createAPI(repo, files);
  await repo.mutate('owner', s => configure(s, 'accounts', { id: 'bank', name: 'Prueba', kind: 'bank', openingMinor: '100000000', openingDate: '2026-01-01' }));
  return { repo, files, api, send: (method: string, path: string, body?: unknown, subject = 'owner') => api({ method, path, body, subject }) };
}

class DynamoLimitMemoryRepository extends MemoryRepository {
  largestMutation = 0;

  override async mutate<T>(householdId: string, fn: (state: State) => T) {
    return super.mutate(householdId, state => {
      const before = persistedStateItems(state);
      const result = fn(state);
      const after = persistedStateItems(state);
      const changed = [...after].filter(([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(before.get(key))).length;
      const deleted = [...before.keys()].filter(key => !after.has(key)).length;
      const actions = changed + deleted + 1; // The household revision item.
      this.largestMutation = Math.max(this.largestMutation, actions);
      if (actions > 100) throw new Error(`DynamoDB transaction has ${actions} actions`);
      return result;
    });
  }
}
describe('authorization and capture', () => {
  it('keeps an immutable persistence snapshot when existing records mutate in place', () => {
    const state = emptyState();
    state.transactions.push({ id: 'existing', accountId: 'bank', date: '2026-10-10', amountMinor: '100', kind: 'expense', merchant: 'Test', categoryId: 'uncategorized', note: '', status: 'posted', entries: [], observationIds: [], revision: 1 });
    state.observations.push({ id: 'clue', source: 'statement', observedAt: now, receivedAt: now, date: '2026-10-10', accountId: 'bank', amountMinor: '100', currency: 'COP', merchant: 'Test', kind: 'expense', status: 'review', candidates: [], parserVersion: 'test' });
    const before = persistedStateItems(state);
    state.transactions[0].categoryId = 'car';
    state.transactions[0].revision++;
    state.observations[0].status = 'linked';
    state.observations[0].transactionId = 'existing';
    expect(before.get('transactions#existing')).toMatchObject({ categoryId: 'uncategorized', revision: 1 });
    expect(before.get('observations#clue')).toMatchObject({ status: 'review' });
    expect(before.get('observations#clue')).not.toHaveProperty('transactionId');
    expect(state.transactions[0]).toMatchObject({ categoryId: 'car', revision: 2 });
    expect(state.observations[0]).toMatchObject({ status: 'linked', transactionId: 'existing' });
  });
  it('rejects anonymous reads and isolates household data', async () => {
    const { api, send } = await setup(); expect((await api({ method: 'GET', path: '/state' })).status).toBe(401);
    expect((await send('GET', '/state', undefined, 'other')).body).toMatchObject({ accounts: [] });
    expect((await send('POST', '/transactions', { id: 'x', accountId: 'bank', date: '2026-10-01', amountMinor: '100', kind: 'expense' }, 'other')).status).toBe(400);
  });
  it('acknowledges durable capture, rejects mutations under the same event key, and replays safely', async () => {
    const { api, repo, files, send } = await setup(); const { token } = await repo.createDevice('owner', 'phone');
    const body = { eventId: 'event', source: 'sms', observedAt: now, date: '2026-10-01', amountMinor: '1250000', accountId: 'bank', merchant: 'Café', location: { latitude: 5.12345, longitude: -73.12345, accuracy: 18, observedAt: now } };
    const request = { method: 'POST', path: '/capture-events', token, body };
    const accepted = await api(request); expect(accepted.status).toBe(202); expect((await repo.read('owner')).transactions).toHaveLength(0);
    expect((await api(request)).status).toBe(202); expect((await api({ ...request, body: { ...body, amountMinor: '1' } })).status).toBe(409);
    const id = (accepted.body as { eventId: string }).eventId; await processJob(repo, files, 'owner', id); await processJob(repo, files, 'owner', id);
    expect((await repo.read('owner')).transactions).toHaveLength(0); expect((await repo.job('owner', id))?.status).toBe('done');
    const visible = (await send('GET', '/state')).body as State;
    expect(visible.observations[0]).toMatchObject({ status: 'review', location: { latitude: 5.12345, longitude: -73.12345, accuracy: 18, observedAt: now } });
    expect((await api({ method: 'GET', path: '/state', token })).status).toBe(401);
  });
  it('persists all financial fields from a Pagaste SMS through the capture API', async () => {
    const { api, repo, files, send } = await setup();
    await repo.mutate('owner', state => configure(state, 'instruments', {
      id: 'payment-account', name: 'Cuenta de prueba', accountId: 'bank', aliases: ['1122'],
    }));
    const { token } = await repo.createDevice('owner', 'phone');
    const accepted = await api({ method: 'POST', path: '/capture-events', token, body: {
      eventId: 'payment-sms', source: 'sms', observedAt: now,
      message: 'Bancolombia: Pagaste $1,312,000.00 a SERVICIO EJEMPLO desde tu producto 1122 el 12/10/2026 21:02:36. ¿Dudas? Llamanos al 0000000000. Estamos cerca',
    } });
    expect(accepted.status).toBe(202);
    const id = (accepted.body as { eventId: string }).eventId;
    await processJob(repo, files, 'owner', id);
    expect((await repo.job('owner', id))?.status).toBe('done');
    const visible = (await send('GET', '/state')).body as State;
    expect(visible.observations).toHaveLength(1);
    expect(visible.observations[0]).toMatchObject({
      accountId: 'bank', amountMinor: '131200000', date: '2026-10-12',
      merchant: 'SERVICIO EJEMPLO', kind: 'expense', status: 'review',
      parserVersion: 'bancolombia-sms-v1',
    });
  });
  it('accepts and normalizes the basic ISO 8601 timezone emitted by Apple Shortcuts', async () => {
    const { api, repo } = await setup(); const { token, device } = await repo.createDevice('owner', 'phone');
    const accepted = await api({ method: 'POST', path: '/capture-events', token, body: {
      eventId: 'apple-iso', source: 'sms', observedAt: '2026-10-19T18:43:12-0500', message: 'Bancolombia: pagaste $12.000',
      location: { latitude: 4.60971, longitude: -74.08175, accuracy: 20, observedAt: '2026-10-19T18:43:15-0500' },
    } });
    expect(accepted.status).toBe(202);
    expect((await repo.job('owner', `${device.id}:apple-iso`))?.payload).toMatchObject({
      observedAt: '2026-10-19T18:43:12-05:00',
      location: { observedAt: '2026-10-19T18:43:15-05:00' },
    });
  });
  it('revokes tokens and excludes security messages before persistence', async () => {
    const { api, repo } = await setup(); const { token, device } = await repo.createDevice('owner', 'phone');
    const request = { method: 'POST', path: '/capture-events', token, body: { eventId: 'otp', source: 'sms', observedAt: now, message: 'Tu código de seguridad es 123456' } };
    expect((await api(request)).status).toBe(422); expect(await repo.pendingJobs()).toHaveLength(0);
    await repo.revokeDevice('owner', device.id); expect((await api({ ...request, body: { eventId: 'w', source: 'wallet', observedAt: now } })).status).toBe(401);
  });
  it('maps normalized Wallet aliases and preserves location', async () => {
    const { repo, files } = await setup(); await repo.mutate('owner', s => configure(s, 'instruments', { id: 'debit', name: 'Wallet', accountId: 'bank', aliases: ['wallet-debit'] }));
    const location = { latitude: 4.60971, longitude: -74.08175, accuracy: 24, observedAt: now };
    const job = captureJob('owner', 'device', { eventId: 'w', source: 'wallet', observedAt: now, instrumentHint: 'Wallet Debit', date: '2026-10-10', amountMinor: '2500000', merchant: 'Tienda', location }, now);
    await repo.putJob(job); await processJob(repo, files, 'owner', job.id);
    const s = await repo.read('owner'); expect(s.observations[0]).toMatchObject({ accountId: 'bank', status: 'review', location }); expect(s.transactions).toHaveLength(0);
  });
  it('stores an owner-confirmed Google Place on a transaction', async () => {
    const { send } = await setup();
    const place = { id: 'google-place-demo', name: 'Café seleccionado', address: 'Bogotá, Colombia', latitude: 4.60971, longitude: -74.08175 };
    expect((await send('POST', '/transactions', { id: 'with-place', accountId: 'bank', date: '2026-10-10', amountMinor: '2500000', kind: 'expense', merchant: place.name, place })).status).toBe(201);
    const visible = (await send('GET', '/state')).body as State;
    expect(visible.transactions[0]).toMatchObject({ merchant: place.name, place });
  });
  it('requires inline confirmation before saving a duplicate manual movement', async () => {
    const { send, repo } = await setup();
    const movement = { accountId: 'bank', date: '2026-10-10', amountMinor: '2500000', kind: 'expense', merchant: 'Tienda repetida' };
    expect((await send('POST', '/transactions', { ...movement, id: 'manual-one' })).status).toBe(201);
    expect((await send('POST', '/transactions', { ...movement, id: 'manual-two' })).status).toBe(409);
    expect((await send('POST', '/transactions', { ...movement, id: 'manual-two', duplicateConfirmed: true })).status).toBe(201);
    expect((await repo.read('owner')).transactions).toHaveLength(2); expect((await repo.read('owner')).observations).toHaveLength(0);
  });
  it('persists category and note across every movement from the same merchant', async () => {
    const { repo, send } = await setup();
    await repo.mutate('owner', state => {
      for (let index = 0; index < 73; index++) addTransaction(state, { id: `same-${index}`, accountId: 'bank', date: '2026-10-10', amountMinor: String(10000 + index), kind: 'expense', merchant: index % 2 ? ' PEaje Central ' : 'Peaje Central' }, now);
      addTransaction(state, { id: 'different', accountId: 'bank', date: '2026-10-10', amountMinor: '50000', kind: 'expense', merchant: 'Otro comercio' }, now);
    });
    const response = await send('PATCH', '/transactions/same-0', { changes: { categoryId: 'car', note: 'Ruta al trabajo' }, expectedRevision: 1, applyToSimilar: true });
    expect(response).toMatchObject({ status: 200, body: { saved: true, updated: 73 } });
    const state = await repo.read('owner'), same = state.transactions.filter(transaction => transaction.id.startsWith('same-'));
    expect(same).toHaveLength(73); expect(same.every(transaction => transaction.categoryId === 'car' && transaction.note === 'Ruta al trabajo')).toBe(true);
    expect(state.transactions.find(transaction => transaction.id === 'different')).toMatchObject({ categoryId: 'uncategorized', note: '' });
    expect(state.aliases).toContainEqual({ id: 'peaje central', merchant: 'peaje central', categoryId: 'car', note: 'Ruta al trabajo' });
  });
  it('discards the entire mutation when validation fails', async () => { const { repo } = await setup(); await expect(repo.mutate('owner', s => { s.accounts.length = 0; throw new Error('failure'); })).rejects.toThrow(); expect((await repo.read('owner')).accounts).toHaveLength(1); });
  it('registers more than one hundred repeated review clues in safe chunks', async () => {
    const repo = new DynamoLimitMemoryRepository(), files = new MemoryFiles(), api = createAPI(repo, files);
    await repo.mutate('owner', state => configure(state, 'accounts', { id: 'bank', name: 'Prueba', kind: 'bank', openingMinor: '100000000', openingDate: '2026-01-01' }));
    const send = (method: string, path: string, body?: unknown) => api({ method, path, body, subject: 'owner' });
    const ids = Array.from({ length: 103 }, (_, index) => `toll-${index}`);
    for (let offset = 0; offset < ids.length; offset += 50) await repo.mutate('owner', s => {
      for (const id of ids.slice(offset, offset + 50)) s.observations.push({
        id, source: 'statement', observedAt: now, receivedAt: now, date: '2026-10-10', accountId: 'bank',
        amountMinor: '1500000', currency: 'COP', merchant: 'Peaje', kind: 'expense', status: 'review',
        candidates: [], parserVersion: 'test',
      });
    });
    const response = await send('POST', '/reviews/batch', { observationIds: ids, action: 'separate' });
    expect(response).toMatchObject({ status: 200, body: { saved: true, resolved: 103 } });
    expect(repo.largestMutation).toBeLessThanOrEqual(100);
    const state = await repo.read('owner');
    expect(state.observations.every(o => o.status === 'linked')).toBe(true);
    expect(state.transactions).toHaveLength(103);
    expect(state.audit.filter(a => a.action === 'separate')).toHaveLength(103);
    const batchId = (response.body as { batchId: string }).batchId;
    expect((await send('POST', '/undo/batch', { batchId })).body).toMatchObject({ saved: true, undone: 103 });
    const restored = await repo.read('owner');
    expect(restored.observations.every(o => o.status === 'review')).toBe(true);
    expect(restored.transactions.every(transaction => transaction.voided)).toBe(true);
    expect(restored.audit.filter(a => a.batchId === batchId).every(a => a.undone)).toBe(true);
  });
});
describe('import lifecycle and retries', () => {
  it('allows more than ten import files in one day', async () => {
    const { send, repo } = await setup();
    const responses = await Promise.all(Array.from({ length: 11 }, (_, index) =>
      send('POST', '/imports', { filename: `statement-${index}.csv`, size: 1, accountId: 'bank', profile: 'cop-interchange-v1' })));
    expect(responses.every(response => response.status === 201)).toBe(true);
    expect(await repo.batches('owner')).toHaveLength(11);
  });
  it('previews then commits; reimport and row retries preserve multiplicity without double posting', async () => {
    const { send, repo, files } = await setup(); const bytes = readFileSync('tests/fixtures/interchange.csv');
    const response = await send('POST', '/imports', { filename: 'test.csv', size: bytes.length, accountId: 'bank', profile: 'cop-interchange-v1' });
    const { batch } = response.body as { batch: { id: string; originalKey: string } }; await files.put(batch.originalKey, bytes);
    expect((await send('POST', `/imports/${batch.id}/preview`, {})).status).toBe(200); expect((await repo.read('owner')).transactions).toHaveLength(0);
    await send('POST', `/imports/${batch.id}/commit`, {});
    for (const j of await repo.pendingJobs()) await processJob(repo, files, 'owner', j.id);
    expect((await repo.batch('owner', batch.id))?.status).toBe('done');
    const s = await repo.read('owner'); expect(s.transactions).toHaveLength(3); expect(s.observations.filter(o => o.status === 'review')).toHaveLength(0);
    await send('POST', `/imports/${batch.id}/commit`, {}); expect((await repo.read('owner')).transactions).toHaveLength(3);
    const overlap = Buffer.from('Fecha;Descripcion;Valor;Moneda;Tipo\n2026-10-05;Café de ejemplo;12.500,00;COP;gasto\n2026-10-07;Movimiento nuevo;7.000,00;COP;gasto');
    const overlapResponse = await send('POST', '/imports', { filename: 'overlap.csv', size: overlap.length, accountId: 'bank', profile: 'cop-interchange-v1' });
    const overlapBatch = (overlapResponse.body as { batch: { id: string; originalKey: string } }).batch; await files.put(overlapBatch.originalKey, overlap);
    expect((await send('POST', `/imports/${overlapBatch.id}/preview`, {})).body).toMatchObject({ accepted: 1, duplicates: 1 });
    const overlapPreview = (await send('GET', `/imports/${overlapBatch.id}`)).body as { rows: { row: number; status: string }[] };
    expect(overlapPreview.rows.map(row => row.status)).toEqual(['duplicate', 'accepted']);
    await send('POST', `/imports/${overlapBatch.id}/commit`, { includeDuplicateRows: [] });
    for (const job of await repo.pendingJobs()) await processJob(repo, files, 'owner', job.id);
    expect((await repo.read('owner')).transactions).toHaveLength(4);
    expect((await repo.read('owner')).observations.every(observation => observation.status === 'linked')).toBe(true);
    const second = await send('POST', '/imports', { filename: 'again.csv', size: bytes.length, accountId: 'bank', profile: 'cop-interchange-v1' });
    const b = (second.body as { batch: { id: string; originalKey: string } }).batch; await files.put(b.originalKey, bytes);
    expect((await send('POST', `/imports/${b.id}/preview`, {})).body).toMatchObject({ id: batch.id, duplicate: true });
    expect((await send('GET', `/imports/${batch.id}`, undefined, 'other')).status).toBe(404);
  });
  it('resumes after a crash between advancing a batch and enqueueing the next chunk', async () => {
    const { repo, files, send } = await setup();
    const bytes = Buffer.from('Fecha;Descripcion;Valor;Moneda;Tipo\n' + Array.from({ length: 25 }, (_, i) => `2026-10-01;Comercio ${i};${i + 1};COP;gasto`).join('\n'));
    const response = await send('POST', '/imports', { filename: 'test.csv', size: bytes.length, accountId: 'bank', profile: 'cop-interchange-v1' });
    const b = (response.body as { batch: { id: string; originalKey: string } }).batch; await files.put(b.originalKey, bytes); await send('POST', `/imports/${b.id}/preview`, {}); await send('POST', `/imports/${b.id}/commit`, {});
    const first = (await repo.pendingJobs())[0]; const real = repo.putJob.bind(repo); let fail = true;
    repo.putJob = async j => { if (fail && j.id.endsWith(':20')) { fail = false; throw new Error('simulated interruption'); } return real(j); };
    await expect(processJob(repo, files, 'owner', first.id)).rejects.toThrow();
    await processJob(repo, files, 'owner', first.id); for (const job of await repo.pendingJobs()) await processJob(repo, files, 'owner', job.id);
    expect((await repo.batch('owner', b.id))?.status).toBe('done'); expect((await repo.read('owner')).transactions).toHaveLength(25);
  });
});
