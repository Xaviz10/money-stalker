import { describe, expect, it } from 'vitest';
import { addTransaction, configure, dashboard, editTransaction, ingest, mergeObservation, resolveObservation, undo } from '../domain/ledger';
import { emptyState, type Observation } from '../domain/model';
import { bogotaDate, formatCOP, nextPayday, parseCOP } from '../domain/money';
const at = '2026-10-17T18:00:00Z';
export function setup() {
  const s = emptyState();
  configure(s, 'accounts', { id: 'bank', name: 'Banco de prueba', kind: 'bank', openingMinor: '100000000', openingDate: '2026-01-01' });
  configure(s, 'accounts', { id: 'card', name: 'Tarjeta de prueba', kind: 'credit', openingMinor: '0', openingDate: '2026-01-01', closingDay: 15, dueDay: 5 });
  return s;
}
const purchase = (id: string, date = '2026-10-10') => ({ id, date, amountMinor: '20000000', kind: 'expense', accountId: 'card', merchant: 'Tienda' });
function observation(id: string, extra: Partial<Observation> = {}): Observation {
  return { id, source: 'sms', observedAt: at, receivedAt: at, date: '2026-10-10', accountId: 'card', amountMinor: '20000000', currency: 'COP', kind: 'expense', merchant: 'Tienda', status: 'review', candidates: [], parserVersion: 'test', ...extra };
}
describe('exact COP amounts and dates', () => {
  it('keeps cents and large amounts exact', () => { expect(parseCOP('$ 1.234.567,89')).toBe('123456789'); expect(formatCOP('123456789')).toBe('$ 1.234.567,89'); expect(parseCOP('90071992547409,91')).toBe('9007199254740991'); });
  it('rejects malformed values and USD-style decimals', () => { for (const v of ['1.23', 'NaN', '1,000.00', '2,222', 'USD 2']) expect(() => parseCOP(v)).toThrow(); });
  it('uses Bogota dates and clamps payday at month end', () => { expect(bogotaDate(new Date('2026-10-01T02:00:00Z'))).toBe('2026-09-30'); expect(nextPayday('2026-02-10', 31)).toBe('2026-02-28'); expect(nextPayday('2026-12-31', 31)).toBe('2027-01-31'); });
});
describe('commitments and balanced journal', () => {
  it('card purchase reserves once and repayment is not another expense', () => {
    const s = setup(); addTransaction(s, purchase('p'), at);
    expect(dashboard(s, '2026-10-17').availableMinor).toBe('80000000');
    addTransaction(s, { id: 'pay', kind: 'transfer', accountId: 'bank', counterAccountId: 'card', date: '2026-10-12', amountMinor: '20000000' }, at);
    const d = dashboard(s, '2026-10-17'); expect(d.availableMinor).toBe('80000000'); expect(d.spendingMinor).toBe('20000000'); expect(d.cardDebtMinor).toBe('0');
    for (const t of s.transactions) expect(t.entries.reduce((n, e) => n + BigInt(e.debitMinor) - BigInt(e.creditMinor), 0n)).toBe(0n);
  });
  it('spends identically across the closing date', () => { for (const day of ['2026-10-14', '2026-10-16']) { const s = setup(); addTransaction(s, purchase(day, day), at); expect(dashboard(s, '2026-10-17').availableMinor).toBe('80000000'); } });
  it('keeps multiple debit cards from creating balances', () => { const s = setup(); for (const id of ['debit', 'wallet']) configure(s, 'instruments', { id, name: id, accountId: 'bank', aliases: [id] }); expect(dashboard(s, '2026-10-17').liquidMinor).toBe('100000000'); });
  it('replaces the bill reserve with the actual card expense', () => {
    const s = setup(); configure(s, 'bills', { id: 'bill', name: 'Servicio', amountMinor: '20000000', dueDate: '2026-10-20' });
    expect(dashboard(s, '2026-10-17').availableMinor).toBe('80000000');
    addTransaction(s, { ...purchase('p'), billId: 'bill' }, at);
    expect(dashboard(s, '2026-10-17').availableMinor).toBe('80000000'); expect(dashboard(s, '2026-10-17').billsMinor).toBe('0');
  });
  it('counts partial refunds and partial card repayments correctly', () => {
    const s = setup(); addTransaction(s, purchase('p'), at);
    addTransaction(s, { ...purchase('r'), kind: 'refund', amountMinor: '5000000' }, at);
    addTransaction(s, { id: 'pay', kind: 'transfer', accountId: 'bank', counterAccountId: 'card', date: '2026-10-12', amountMinor: '10000000' }, at);
    const d = dashboard(s, '2026-10-17'); expect(d.spendingMinor).toBe('15000000'); expect(d.cardDebtMinor).toBe('5000000'); expect(d.availableMinor).toBe('85000000');
  });
  it('does not count future salary and can show negative availability', () => { const s = setup(); configure(s, 'settings', { payday: 25, reserveMinor: '110000000' }); expect(dashboard(s, '2026-10-17').availableMinor).toBe('-10000000'); });
  it('rejects a duplicate transaction ID with altered financial intent', () => { const s = setup(); addTransaction(s, purchase('p'), at); expect(() => addTransaction(s, { ...purchase('p'), amountMinor: '1' }, at)).toThrow(/Identificador/); });
});
describe('evidence reconciliation and corrections', () => {
  it('is idempotent and leaves similar purchases for review', () => {
    const s = setup(); ingest(s, observation('sms'), at); ingest(s, observation('sms'), at); ingest(s, observation('wallet', { source: 'wallet' }), at);
    expect(s.transactions).toHaveLength(1); expect(s.observations).toHaveLength(2); expect(s.observations[1].status).toBe('review');
    expect(dashboard(s, '2026-10-17').uncertainMinor).toBe('20000000');
    mergeObservation(s, 'wallet', s.transactions[0].id, at); expect(s.transactions[0].observationIds).toEqual(['sms', 'wallet']);
    expect(dashboard(s, '2026-10-17').uncertainMinor).toBe('0');
    undo(s, s.audit.at(-1)!.id, at); expect(s.observations[1].status).toBe('review'); expect(s.transactions[0].observationIds).toEqual(['sms']);
  });
  it('preserves two real equal-value purchases', () => { const s = setup(); ingest(s, observation('one'), at); ingest(s, observation('two'), at); resolveObservation(s, 'two', 'separate', at); expect(s.transactions).toHaveLength(2); expect(dashboard(s, '2026-10-17').spendingMinor).toBe('40000000'); });
  it('automatically links strong references but reviews amount conflicts', () => { const s = setup(); ingest(s, observation('one', { reference: 'bank-unique' }), at); ingest(s, observation('two', { source: 'statement', reference: 'bank-unique' }), at); expect(s.transactions).toHaveLength(1); expect(s.transactions[0].status).toBe('posted'); ingest(s, observation('three', { reference: 'bank-unique', amountMinor: '25000000' }), at); expect(s.observations[2].status).toBe('review'); });
  it('keeps merchant and category edits when a statement confirms the purchase', () => { const s = setup(); ingest(s, observation('sms'), at); editTransaction(s, s.transactions[0].id, { merchant: 'Comercio recordado', categoryId: 'food' }, at); ingest(s, observation('bank', { source: 'statement', merchant: 'POS XYZ' }), at); mergeObservation(s, 'bank', s.transactions[0].id, at); expect(s.transactions[0].merchant).toBe('Comercio recordado'); expect(s.transactions[0].categoryId).toBe('food'); });
  it('stores incomplete evidence without inventing a purchase', () => { const s = setup(); ingest(s, observation('missing', { amountMinor: undefined }), at); expect(s.transactions).toHaveLength(0); expect(dashboard(s, '2026-10-17').incomplete).toBe(1); });
  it('rejects cross-account merges and undo over later edits', () => { const s = setup(); ingest(s, observation('one'), at); ingest(s, observation('missing', { accountId: 'bank', amountMinor: undefined }), at); expect(() => mergeObservation(s, 'missing', s.transactions[0].id, at)).toThrow(); editTransaction(s, s.transactions[0].id, { merchant: 'A' }, at); const audit = s.audit.at(-1)!.id; editTransaction(s, s.transactions[0].id, { merchant: 'B' }, at); expect(() => undo(s, audit, at)).toThrow(/posteriores/); });
});
