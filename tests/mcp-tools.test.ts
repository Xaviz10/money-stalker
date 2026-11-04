import { describe, expect, it, vi } from 'vitest';
import { emptyState } from '../domain/model';
import { accountDirectory, financialSnapshot, listMovements, movementDetail } from '../server/mcp-handler';

describe('MCP financial tools', () => {
  it('reads only the household selected by the verified Cognito subject', async () => {
    const state = emptyState(); state.settings.reserveMinor = '12345';
    const read = vi.fn(async () => state);
    const snapshot = await financialSnapshot({ read }, 'owner-subject');
    expect(read).toHaveBeenCalledWith('owner-subject');
    expect(snapshot.reserveMinor).toBe('12345');
    expect(snapshot).not.toHaveProperty('transactions');
    expect(snapshot).not.toHaveProperty('observations');
    expect(snapshot).not.toHaveProperty('locations');
  });

  it('paginates and filters the complete movement history without mixing deleted rows by default', () => {
    const state = emptyState();
    state.accounts.push({ id: 'bank', name: 'Banco', kind: 'bank', openingMinor: '0', openingDate: '2026-01-01', eligible: true });
    state.transactions.push(
      { id: 'b', accountId: 'bank', date: '2026-10-02', amountMinor: '20000', kind: 'expense', merchant: 'Café Norte', categoryId: 'restaurants-cafe', note: '', status: 'posted', entries: [], observationIds: [], revision: 1 },
      { id: 'a', accountId: 'bank', date: '2026-10-03', amountMinor: '100000', kind: 'income', merchant: 'Cliente', categoryId: 'freelance-income', note: '', status: 'posted', entries: [], observationIds: [], revision: 1 },
      { id: 'c', accountId: 'bank', date: '2026-10-01', amountMinor: '30000', kind: 'expense', merchant: 'Café Sur', categoryId: 'restaurants-cafe', note: '', status: 'posted', entries: [], observationIds: [], revision: 2, voided: true },
    );
    const first = listMovements(state, { limit: 1 });
    expect(first.movements.map(value => value.id)).toEqual(['a']);
    expect(first.hasMore).toBe(true);
    const second = listMovements(state, { limit: 1, cursor: first.nextCursor });
    expect(second.movements.map(value => value.id)).toEqual(['b']);
    expect(second.hasMore).toBe(false);
    expect(listMovements(state, { merchantQuery: 'café', includeDeleted: true }).movements.map(value => value.id)).toEqual(['b', 'c']);
    expect(() => listMovements(state, { kinds: ['expense'], cursor: first.nextCursor })).toThrow(/cursor/);
  });

  it('returns journal and linked evidence details for one movement', () => {
    const state = emptyState();
    state.accounts.push({ id: 'bank', name: 'Banco', kind: 'bank', openingMinor: '0', openingDate: '2026-01-01', eligible: true });
    state.observations.push({ id: 'obs', source: 'sms', observedAt: '2026-10-02T10:00:00-05:00', receivedAt: '2026-10-02T10:00:01-05:00', date: '2026-10-02', accountId: 'bank', amountMinor: '20000', currency: 'COP', merchant: 'Café', kind: 'expense', status: 'linked', transactionId: 'movement', candidates: [], parserVersion: 'test' });
    state.transactions.push({ id: 'movement', accountId: 'bank', date: '2026-10-02', amountMinor: '20000', kind: 'expense', merchant: 'Café', categoryId: 'restaurants-cafe', note: 'Desayuno', status: 'posted', entries: [{ accountId: 'bank', debitMinor: '0', creditMinor: '20000' }], observationIds: ['obs'], revision: 1 });
    expect(movementDetail(state, 'movement')).toMatchObject({ id: 'movement', account: { name: 'Banco' }, category: 'Restaurantes / Cafés', evidence: [{ id: 'obs', source: 'sms' }], entries: [{ account: { name: 'Banco' } }] });
    expect(accountDirectory(state)).toMatchObject({ currency: 'COP', accounts: [{ id: 'bank', name: 'Banco', balanceMinor: '-20000' }] });
  });
});
