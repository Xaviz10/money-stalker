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


it('persists manual investment values in the owner ledger, preserves idempotency and rejects other products or owners', async () => {
  const { repo, send } = await setup();
  await send('POST', '/accounts', { id: 'investment', name: 'Inversión sintética', kind: 'investment', openingMinor: '1000000', openingDate: '2026-01-01', eligible: true });
  const input = { id: 'manual-value', accountId: 'investment', date: '2026-10-17', valueMinor: '1200000', note: 'Valor declarado' };
  expect((await send('POST', '/investment-values', input)).status).toBe(201);
  expect((await send('POST', '/investment-values', input)).status).toBe(201);
  const state = await repo.read('owner');
  expect(state.valuations).toHaveLength(1);
  expect(state.accounts.find(account => account.id === 'investment')?.eligible).toBe(false);
  expect(persistedStateItems(state).has('valuations#manual-value')).toBe(true);
  expect((await send('POST', '/investment-values', { ...input, id: 'wrong-kind', accountId: 'bank' })).status).toBe(400);
  expect((await send('POST', '/investment-values', input, 'other-owner')).status).toBe(400);
  expect((await send('POST', '/undo', { auditId: 'valuation:manual-value' })).status).toBe(200);
  expect((await repo.read('owner')).valuations[0].voided).toBe(true);
});


it('remembers a renamed investment merchant for CSV previews, freezes classification, and compares only movements predating upload', async () => {
  const { repo, files, send } = await setup();
  await send('POST', '/categories', { id: 'investment-category', name: 'Aportes', scope: 'expense' });
  await send('POST', '/transactions', { id: 'original-investment', accountId: 'bank', date: '2026-10-12', kind: 'expense', amountMinor: '10000000', merchant: 'FONDO ORIGINAL' });
  const edited = await send('PATCH', '/transactions/original-investment', {
    changes: { kind: 'transfer', counterAccountId: 'fund', merchant: 'Fondo renombrado', categoryId: 'investment-category', note: 'Aporte programado', investmentProduct: { id: 'fund', name: 'Plan a largo plazo' } },
    expectedRevision: 1, rememberMerchant: true,
  });
  expect(edited.status).toBe(200);
  let state = await repo.read('owner');
  expect(state.aliases.find(rule => rule.merchant === 'fondo original')).toMatchObject({ investmentAccountId: 'fund', categoryId: 'investment-category', displayMerchant: 'Fondo renombrado' });
  const bytes = Buffer.from('Fecha;Descripcion;Valor;Moneda;Tipo\n2026-10-12;FONDO ORIGINAL;100.000,00;COP;gasto\n2026-10-13;FONDO ORIGINAL;200.000,00;COP;gasto\n2026-10-13;FONDO ORIGINAL;200.000,00;COP;gasto\n2026-10-14;FONDO ORIGINAL;150.000,00;COP;gasto');
  const created = await send('POST', '/imports', { filename: 'investment.csv', size: bytes.length, accountId: 'bank', profile: 'cop-interchange-v1' });
  const batch = (created.body as { batch: { id: string; originalKey: string } }).batch;
  await files.put(batch.originalKey, bytes);
  await send('POST', '/transactions', { id: 'after-upload', accountId: 'bank', counterAccountId: 'fund', date: '2026-10-14', kind: 'transfer', amountMinor: '15000000', merchant: 'Fondo renombrado' });
  expect((await send('POST', `/imports/${batch.id}/preview`, {})).body).toMatchObject({ accepted: 3, duplicates: 1 });
  const preview = (await send('GET', `/imports/${batch.id}`)).body as { rows: { status: string; observation: { kind: string; counterAccountId: string; categoryId: string; note: string } }[] };
  expect(preview.rows.map(row => row.status)).toEqual(['duplicate', 'accepted', 'accepted', 'accepted']);
  for (const row of preview.rows) expect(row.observation).toMatchObject({ kind: 'transfer', counterAccountId: 'fund', categoryId: 'investment-category', note: 'Aporte programado' });
  // A changed rule must not redirect an already reviewed preview at commit time.
  await repo.mutate('owner', s => { for (const rule of s.aliases) rule.categoryId = 'restaurants'; });
  await send('POST', `/imports/${batch.id}/commit`, { includeDuplicateRows: [] });
  for (const job of await repo.pendingJobs()) await processJob(repo, files, 'owner', job.id);
  state = await repo.read('owner');
  expect(state.transactions).toHaveLength(5);
  expect(state.transactions.filter(movement => movement.observationIds.length).every(movement => movement.kind === 'transfer' && movement.counterAccountId === 'fund' && movement.categoryId === 'investment-category')).toBe(true);
  expect((await send('GET', '/dashboard')).body).toMatchObject({ investmentsMinor: '80000000', availableMinor: '20000000', spendingMinor: '0', incomeMinor: '0' });
});

it('creates an inline investment atomically, supports retries, and rolls back invalid movements', async () => {
  const { repo, send } = await setup();
  const input = { id: 'inline', accountId: 'bank', counterAccountId: 'new-fund', date: '2026-10-20', kind: 'transfer', amountMinor: '1000000', merchant: 'Merchant de prueba', investmentProduct: { id: 'new-fund', name: 'Nombre elegido' }, rememberMerchant: true };
  expect((await send('POST', '/transactions', input)).status).toBe(201);
  expect((await send('POST', '/transactions', input)).status).toBe(201);
  let state = await repo.read('owner');
  expect(state.accounts.filter(account => account.kind === 'investment')).toHaveLength(1);
  expect(state.accounts.find(account => account.id === 'new-fund')).toMatchObject({ name: 'Nombre elegido', openingMinor: '0', openingDate: '2026-01-01', eligible: false });
  expect(state.transactions).toHaveLength(1);
  expect(state.aliases[0]).toMatchObject({ investmentAccountId: 'new-fund' });
  expect((await send('POST', '/transactions', { ...input, id: 'bad', accountId: 'missing', counterAccountId: 'bad-fund', investmentProduct: { id: 'bad-fund', name: 'No se debe crear' } })).status).toBe(400);
  state = await repo.read('owner');
  expect(state.accounts.some(account => account.id === 'bad-fund')).toBe(false);
});

describe('optional Shortcut location in the same capture request', () => {
  const location = { latitude: 4.6, longitude: -74.1, observedAt: now, fullAddress: 'Calle de Prueba 10, Ciudad de Prueba', street: 'Calle de Prueba', streetNumber: '10', city: 'Ciudad de Prueba', state: 'Departamento de Prueba', postalCode: '000000', region: 'Región de Prueba', country: 'Colombia', countryCode: 'CO', name: 'Ubicación del teléfono', url: 'https://maps.apple.com/place?coordinate=4.6,-74.1' };
  it('durably saves money and rich location together, keeps retries idempotent and exports every field', async () => {
    const { api, repo, files, send } = await setup();
    const { token } = await repo.createDevice('owner', 'phone');
    const body = { eventId: 'with-address', source: 'sms', observedAt: now, accountId: 'bank', date: '2026-10-10', amountMinor: '2200000', merchant: 'Comercio de prueba', location };
    const request = { method: 'POST', path: '/capture-events', token, body };
    const accepted = await api(request);
    expect(accepted.status).toBe(202);
    expect((await api(request)).status).toBe(202);
    expect((await api({ ...request, body: { ...body, location: { ...location, latitude: 5 } } })).status).toBe(409);
    const observationId = (accepted.body as { eventId: string }).eventId;
    expect((await repo.job('owner', observationId))?.payload).toMatchObject({ location });
    await processJob(repo, files, 'owner', observationId);
    await processJob(repo, files, 'owner', observationId);
    expect((await send('POST', '/reviews', { observationId, action: 'separate' })).status).toBe(200);
    const state = (await send('GET', '/state')).body as State;
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0]).toMatchObject({ merchant: 'Comercio de prueba', amountMinor: '2200000' });
    expect(state.observations[0]).toMatchObject({ status: 'linked', location });
    expect(state.observations[0].location?.accuracy).toBeUndefined();
    const { exportRecords } = await import('../server/imports');
    const csv = exportRecords(await repo.read('owner'), 'csv').bytes.toString();
    expect(csv).toContain('DetalleUbicaciones');
    for (const value of ['Calle de Prueba', 'Ciudad de Prueba', 'Departamento de Prueba', 'Región de Prueba', 'postalCode', 'https://www.google.com/maps/search/', 'https://maps.apple.com/place']) expect(csv).toContain(value);
  });
  it('does not persist a security message even when it includes a location', async () => {
    const { api, repo } = await setup();
    const { token } = await repo.createDevice('owner', 'phone');
    expect((await api({ method: 'POST', path: '/capture-events', token, body: { eventId: 'security-location', source: 'sms', observedAt: now, message: 'Tu código de seguridad es 000000', location } })).status).toBe(422);
    expect(await repo.pendingJobs()).toHaveLength(0);
  });
  it('never loses the financial capture to unavailable location, bad coordinates or optional metadata', async () => {
    const { api, repo, files } = await setup(); const { token } = await repo.createDevice('owner', 'phone');
    for (const [index, optionalLocation] of [undefined, { latitude: 999, longitude: -74, observedAt: now }, { ...location, accuracy: 'unknown', url: 'javascript:alert(1)' }].entries()) {
      const result = await api({ method: 'POST', path: '/capture-events', token, body: { eventId: `optional-${index}`, source: 'wallet', observedAt: now, accountId: 'bank', date: '2026-10-10', amountMinor: '10000', merchant: 'Comercio de prueba', location: optionalLocation } });
      expect(result.status).toBe(202);
      await processJob(repo, files, 'owner', (result.body as { eventId: string }).eventId);
    }
    const state = await repo.read('owner'); expect(state.observations).toHaveLength(3);
    expect(state.observations[0].location).toBeUndefined(); expect(state.observations[1].location).toBeUndefined();
    expect(state.observations[2].location).toMatchObject({ fullAddress: location.fullAddress });
    expect(state.observations[2].location?.url).toBeUndefined();
    expect(state.observations[2].location?.accuracy).toBeUndefined();
  });
});

describe('owner-confirmed movement locations', () => {
  it('requires owner authentication to resolve links and keeps non-Google place IDs out of Google exports', async () => {
    const { api, send, repo } = await setup();
    const url = 'https://www.google.com/maps/place/Ejemplo/data=!3d4.65!4d-74.15';
    expect((await api({ method: 'POST', path: '/places/resolve-link', body: { url } })).status).toBe(401);
    expect(await send('POST', '/places/resolve-link', { url })).toMatchObject({ status: 200, body: { latitude: 4.65, longitude: -74.15, approximate: false } });
    expect((await send('POST', '/places/resolve-link', { url: 'https://localhost/private' })).status).toBe(400);
    const place = { id: 'coordinates:4.65:-74.15', latitude: 4.65, longitude: -74.15, name: 'Lugar confirmado', address: 'Dirección de prueba', source: 'google-link', url };
    expect((await send('POST', '/transactions', { id: 'chosen-place', accountId: 'bank', date: '2026-10-10', amountMinor: '10000', kind: 'expense', merchant: place.name, place })).status).toBe(201);
    const { exportRecords } = await import('../server/imports');
    const XLSX = await import('xlsx');
    const book = XLSX.read(exportRecords(await repo.read('owner'), 'xlsx').bytes, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(book.Sheets.Movimientos, { defval: '' });
    expect(rows[0]).toMatchObject({ Lugar: place.name, OrigenLugar: 'google-link', EnlaceLugar: url, GooglePlaceID: '' });
  });
});

describe('simple Shortcut coordinates', () => {
  it('accepts top-level coordinates and an optional address string without a location dictionary', async () => {
    const { api, repo, files } = await setup(); const { token } = await repo.createDevice('owner', 'phone');
    const body = { eventId: 'flat-location', source: 'sms', observedAt: now, accountId: 'bank', date: '2026-10-10', amountMinor: '2200000', merchant: 'Comercio de prueba', latitude: '4,6', longitude: '-74.1', location: 'Dirección de prueba' };
    const request = { method: 'POST', path: '/capture-events', token, body };
    const accepted = await api(request);
    expect(accepted.status).toBe(202); expect((await api(request)).status).toBe(202);
    await processJob(repo, files, 'owner', (accepted.body as { eventId: string }).eventId);
    const state = await repo.read('owner');
    expect(state.observations).toHaveLength(1);
    expect(state.observations[0].location).toEqual({ latitude: 4.6, longitude: -74.1, observedAt: now, timestampSource: 'event', fullAddress: 'Dirección de prueba' });
  });
  it('preserves a separate sample time and ignores incomplete or invalid coordinate pairs', async () => {
    const { api, repo, files } = await setup(); const { token } = await repo.createDevice('owner', 'phone');
    for (const [index, coordinates] of [{ latitude: 4.6, longitude: -74.1, locationObservedAt: '2026-10-17T13:00:02-0500' }, { latitude: 4.6 }, { latitude: '', longitude: '-74' }, { latitude: 100, longitude: -74 }].entries()) {
      const accepted = await api({ method: 'POST', path: '/capture-events', token, body: { eventId: `simple-${index}`, source: 'wallet', observedAt: now, ...coordinates } });
      expect(accepted.status).toBe(202);
      await processJob(repo, files, 'owner', (accepted.body as { eventId: string }).eventId);
    }
    const state = await repo.read('owner');
    expect(state.observations[0].location).toMatchObject({ observedAt: '2026-10-17T13:00:02-05:00', timestampSource: 'sample' });
    expect(state.observations.slice(1).every(observation => observation.location === undefined)).toBe(true);
  });
});

describe('remembered merchant places', () => {
  const place = { id: 'synthetic-place', name: 'Comercio de prueba', address: 'Dirección sintética', latitude: 4.6, longitude: -74.1, source: 'manual' as const };
  const movement = { accountId: 'bank', date: '2026-10-10', amountMinor: '2200000', kind: 'expense', merchant: 'Comercio de prueba' };
  it('keeps place rules independent from category rules and respects explicit per-movement places or removal', async () => {
    const { repo, send } = await setup();
    expect((await send('POST', '/transactions', { ...movement, id: 'remember-place', categoryId: 'restaurants', note: 'Solo este movimiento', place, rememberMerchantPlace: true })).status).toBe(201);
    expect((await repo.read('owner')).aliases[0]).toEqual({ id: 'comercio de prueba', merchant: 'comercio de prueba', place });
    await send('POST', '/transactions', { ...movement, id: 'future', date: '2026-10-11', merchant: ' COMERCIO   DE PRUEBA ' });
    const otherPlace = { ...place, id: 'different-branch', latitude: 4.7 };
    await send('POST', '/transactions', { ...movement, id: 'specific', date: '2026-10-12', place: otherPlace });
    await send('POST', '/transactions', { ...movement, id: 'without-place', date: '2026-10-13', skipMerchantPlace: true });
    const state = await repo.read('owner');
    expect(state.transactions.find(t => t.id === 'future')).toMatchObject({ place, categoryId: 'uncategorized', note: '' });
    expect(state.transactions.find(t => t.id === 'specific')?.place).toEqual(otherPlace);
    expect(state.transactions.find(t => t.id === 'without-place')?.place).toBeUndefined();
    await send('PATCH', '/transactions/remember-place', { expectedRevision: 1, changes: { categoryId: 'car', note: 'Regla de categoría' }, rememberMerchant: true });
    expect((await repo.read('owner')).aliases[0]).toMatchObject({ place, categoryId: 'car', note: 'Regla de categoría' });
    await send('PATCH', '/transactions/remember-place', { expectedRevision: 2, changes: { place: otherPlace }, rememberMerchantPlace: true });
    expect((await repo.read('owner')).aliases[0]).toMatchObject({ place: otherPlace, categoryId: 'car', note: 'Regla de categoría' });
  });
  it('applies places across existing movements in safe audited chunks without changing categories, amounts or phone evidence', async () => {
    const repo = new DynamoLimitMemoryRepository(), files = new MemoryFiles(), api = createAPI(repo, files);
    await repo.mutate('owner', s => configure(s, 'accounts', { id: 'bank', name: 'Prueba', kind: 'bank', openingMinor: '100000000', openingDate: '2026-01-01' }));
    for (let offset = 0; offset < 74; offset += 25) await repo.mutate('owner', s => {
      for (let i = offset; i < Math.min(offset + 25, 74); i++) addTransaction(s, { ...movement, id: `same-place-${i}`, amountMinor: String(10000 + i), kind: i === 73 ? 'refund' : 'expense', merchant: i % 2 ? ' COMERCIO   de Prueba ' : movement.merchant, categoryId: i % 2 ? 'car' : 'restaurants', note: `Nota ${i}`, ...(i === 2 ? { place: { ...place, latitude: 4.8 } } : {}) }, now);
    });
    await repo.mutate('owner', s => {
      addTransaction(s, { ...movement, id: 'other-merchant', merchant: 'Otro comercio' }, now);
      addTransaction(s, { ...movement, id: 'deleted', place: { ...place, latitude: 4.9 } }, now).voided = true;
      s.observations.push({ id: 'phone-evidence', source: 'sms', observedAt: now, receivedAt: now, merchant: movement.merchant, kind: 'expense', currency: 'COP', status: 'linked', transactionId: 'same-place-0', candidates: [], parserVersion: 'synthetic', location: { latitude: 4.5, longitude: -74.2, observedAt: now } });
    });
    const before = await repo.read('owner');
    const result = await api({ method: 'PATCH', path: '/transactions/same-place-0', subject: 'owner', body: { expectedRevision: 1, changes: { place }, applyPlaceToSimilar: true, rememberMerchantPlace: true } });
    expect(result).toMatchObject({ status: 200, body: { updated: 74 } });
    const after = await repo.read('owner');
    for (const t of after.transactions.filter(t => t.id.startsWith('same-place-'))) {
      expect(t.place).toEqual(place);
      const original = before.transactions.find(item => item.id === t.id)!;
      expect([t.amountMinor, t.categoryId, t.note, t.entries]).toEqual([original.amountMinor, original.categoryId, original.note, original.entries]);
      expect(after.audit.some(a => a.action === 'edit' && a.transactionId === t.id && a.beforeTransaction)).toBe(true);
    }
    expect(after.transactions.find(t => t.id === 'other-merchant')?.place).toBeUndefined();
    expect(after.transactions.find(t => t.id === 'deleted')?.place?.latitude).toBe(4.9);
    expect(after.observations).toEqual(before.observations);
    expect(after.aliases[0]).toEqual({ id: 'comercio de prueba', merchant: 'comercio de prueba', place });
    expect(repo.largestMutation).toBeLessThanOrEqual(100);
  });
  it('uses the place for future Shortcut registrations and CSV previews without promoting phone coordinates to a merchant rule', async () => {
    const { repo, files, send } = await setup();
    await send('POST', '/transactions', { ...movement, id: 'rule', place, rememberMerchantPlace: true });
    const job = captureJob('owner', 'synthetic-device', { eventId: 'future-capture', source: 'wallet', observedAt: now, accountId: 'bank', date: '2026-10-12', amountMinor: '3300000', merchant: 'COMERCIO DE PRUEBA', kind: 'expense', location: { latitude: 4.7, longitude: -74.2, observedAt: now } }, now);
    await repo.putJob(job); await processJob(repo, files, 'owner', job.id);
    expect((await send('POST', '/reviews', { observationId: job.id, action: 'separate' })).status).toBe(200);
    const registered = await repo.read('owner');
    expect(registered.transactions.find(t => t.observationIds.includes(job.id))?.place).toEqual(place);
    expect(registered.observations.find(o => o.id === job.id)?.location?.latitude).toBe(4.7);
    const bytes = Buffer.from('Fecha;Descripcion;Valor;Moneda;Tipo\n2026-10-13;COMERCIO DE PRUEBA;44.000,00;COP;gasto');
    const created = await send('POST', '/imports', { filename: 'place.csv', size: bytes.length, accountId: 'bank', profile: 'cop-interchange-v1' });
    const batch = (created.body as { batch: { id: string; originalKey: string } }).batch;
    await files.put(batch.originalKey, bytes);
    expect((await send('POST', `/imports/${batch.id}/preview`, {})).status).toBe(200);
    expect((await send('GET', `/imports/${batch.id}`)).body).toMatchObject({ rows: [{ observation: { place } }] });
    await repo.mutate('owner', state => { state.aliases[0].place = { ...place, latitude: 4.8 }; });
    await send('POST', `/imports/${batch.id}/commit`, { includeDuplicateRows: [] });
    for (const pending of await repo.pendingJobs()) await processJob(repo, files, 'owner', pending.id);
    expect((await repo.read('owner')).transactions.find(t => t.amountMinor === '4400000')?.place).toEqual(place);
  });
  it('rejects remembering a place without an explicit choice and preserves existing rules on failure', async () => {
    const { repo, send } = await setup();
    expect((await send('POST', '/transactions', { ...movement, id: 'invalid', rememberMerchantPlace: true })).status).toBe(400);
    expect((await repo.read('owner')).transactions).toHaveLength(0);
    await send('POST', '/transactions', { ...movement, id: 'valid', place, rememberMerchantPlace: true });
    const before = await repo.read('owner');
    expect((await send('PATCH', '/transactions/valid', { expectedRevision: 1, changes: { place: null }, applyPlaceToSimilar: true })).status).toBe(400);
    expect((await repo.read('owner')).aliases).toEqual(before.aliases);
    expect((await repo.read('owner')).transactions).toEqual(before.transactions);
  });
});

it('keeps historical place propagation separate from future memory and respects category scope when combined', async () => {
  const { repo, send } = await setup();
  const firstPlace = { id: 'place-one', name: 'Comercio común', address: '', latitude: 4.6, longitude: -74.1, source: 'manual' };
  const nextPlace = { ...firstPlace, id: 'place-two', latitude: 4.7 };
  const base = { accountId: 'bank', date: '2026-10-10', merchant: 'Comercio común' };
  await send('POST', '/transactions', { ...base, id: 'common-expense', kind: 'expense', amountMinor: '1200000', categoryId: 'restaurants', place: firstPlace, rememberMerchantPlace: true });
  await send('POST', '/transactions', { ...base, id: 'common-income', kind: 'income', amountMinor: '2200000', categoryId: 'salary' });
  expect((await send('PATCH', '/transactions/common-expense', { expectedRevision: 1, changes: { place: nextPlace, categoryId: 'car' }, applyToSimilar: true, applyPlaceToSimilar: true })).status).toBe(200);
  const state = await repo.read('owner');
  expect(state.transactions.find(t => t.id === 'common-expense')).toMatchObject({ place: nextPlace, categoryId: 'car' });
  expect(state.transactions.find(t => t.id === 'common-income')).toMatchObject({ place: nextPlace, categoryId: 'salary' });
  expect(state.aliases[0]).toMatchObject({ place: firstPlace, categoryId: 'car' });
  await send('POST', '/transactions', { ...base, id: 'future-common', date: '2026-10-11', kind: 'expense', amountMinor: '3300000' });
  expect((await repo.read('owner')).transactions.find(t => t.id === 'future-common')?.place).toEqual(firstPlace);
});

it('converts matching historical expenses into contributions to one new investment across chunks', async () => {
  const { repo, send } = await setup();
  await send('POST', '/accounts', { id: 'cash', name: 'Efectivo', kind: 'cash', openingMinor: '0', openingDate: '2026-01-01' });
  await send('POST', '/accounts', { id: 'other-fund', name: 'Otro fondo', kind: 'investment', openingMinor: '0', openingDate: '2026-01-01' });
  for (let i = 0; i < 40; i++) expect((await send('POST', '/transactions', {
    id: `contribution-${i}`, accountId: i % 2 ? 'cash' : 'bank', date: i ? '2025-12-01' : '2026-10-10',
    amountMinor: String(100000 + i), kind: 'expense', merchant: i % 2 ? ' FONDO COMÚN ' : 'Fondo común',
  })).status).toBe(201);
  for (const [id, kind, counterAccountId] of [['income', 'income', undefined], ['refund', 'refund', undefined], ['elsewhere', 'transfer', 'other-fund']] as const) {
    expect((await send('POST', '/transactions', { id, kind, counterAccountId, accountId: 'bank', date: '2026-10-11', amountMinor: '200000', merchant: 'Fondo común', categoryId: kind === 'income' ? 'salary' : 'uncategorized' })).status).toBe(201);
  }
  const response = await send('PATCH', '/transactions/contribution-0', {
    expectedRevision: 1, applyToSimilar: true, rememberMerchant: true,
    changes: { kind: 'transfer', counterAccountId: 'common-fund', investmentProduct: { id: 'common-fund', name: 'Mi inversión' }, categoryId: 'car', note: 'Aporte', billId: null },
  });
  expect(response).toMatchObject({ status: 200, body: { updated: 40 } });
  const state = await repo.read('owner');
  expect(state.accounts.filter(a => a.id === 'common-fund')).toHaveLength(1);
  const contributions = state.transactions.filter(t => t.id.startsWith('contribution-'));
  expect(contributions.every(t => t.kind === 'transfer' && t.counterAccountId === 'common-fund' && t.categoryId === 'car' && t.note === 'Aporte')).toBe(true);
  expect(state.transactions.find(t => t.id === 'income')?.kind).toBe('income');
  expect(state.transactions.find(t => t.id === 'refund')?.kind).toBe('refund');
  expect(state.transactions.find(t => t.id === 'elsewhere')?.counterAccountId).toBe('other-fund');
  expect(state.aliases.find(rule => rule.merchant === 'fondo común')?.investmentAccountId).toBe('common-fund');
  const total = contributions.reduce((sum, t) => sum + BigInt(t.amountMinor), 0n).toString();
  expect((await send('GET', '/dashboard')).body).toMatchObject({ balances: { 'common-fund': total, bank: '100100000' }, spendingMinor: '-200000' });
  const first = contributions[0];
  expect((await send('POST', '/transactions', { id: 'later-history', accountId: 'bank', date: '2025-11-01', amountMinor: '500000', kind: 'expense', merchant: 'Fondo común' })).status).toBe(201);
  expect((await send('PATCH', `/transactions/${first.id}`, { expectedRevision: first.revision, applyToSimilar: true, changes: { kind: 'transfer', counterAccountId: 'common-fund', note: 'Aportes revisados' } })).status).toBe(200);
  expect((await repo.read('owner')).transactions.find(t => t.id === 'later-history')).toMatchObject({ kind: 'transfer', counterAccountId: 'common-fund' });
  expect((await send('GET', '/dashboard')).body).toMatchObject({ balances: { 'common-fund': (BigInt(total) + 500000n).toString() } });
});

it('unlinks paid bills during bulk investment conversion within DynamoDB transaction limits', async () => {
  const repo = new DynamoLimitMemoryRepository(), api = createAPI(repo, new MemoryFiles());
  const send = (method: string, path: string, body?: unknown) => api({ method, path, body, subject: 'owner' });
  await send('POST', '/accounts', { id: 'bank', name: 'Banco', kind: 'bank', openingMinor: '100000000', openingDate: '2026-01-01' });
  for (let i = 0; i < 40; i++) {
    await send('POST', '/bills', { id: `bill-${i}`, name: `Cuota ${i}`, amountMinor: '100000', dueDate: '2026-10-10' });
    expect((await send('POST', '/transactions', { id: `bill-payment-${i}`, accountId: 'bank', amountMinor: '100000', date: '2026-10-10', kind: 'expense', merchant: 'Ahorro común', billId: `bill-${i}`, duplicateConfirmed: true })).status).toBe(201);
  }
  expect((await send('PATCH', '/transactions/bill-payment-0', { expectedRevision: 1, applyToSimilar: true, changes: { kind: 'transfer', counterAccountId: 'fund', investmentProduct: { id: 'fund', name: 'Fondo' }, billId: null } })).status).toBe(200);
  const state = await repo.read('owner');
  expect(state.bills.every(b => !b.paidTransactionId)).toBe(true);
  expect(state.transactions.every(t => t.kind === 'transfer' && !t.billId)).toBe(true);
  expect(repo.largestMutation).toBeLessThanOrEqual(96);
});
