import { describe, expect, it } from 'vitest';
import { addTransaction, configure, dashboard, deleteTransaction, editTransaction, ingestCapture, mergeObservation, recordStatement, refreshCaptureCandidates, resolveObservation, undo } from '../domain/ledger';
import { emptyState, normalizeDefaultCategories, type Observation, type State } from '../domain/model';
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
  it('uses the current built-in categories and upgrades the legacy food label', () => {
    const state = emptyState();
    expect(state.categories.map(category => category.name)).toEqual(expect.arrayContaining([
      'Sin categoría', 'Mercado', 'Supermercado', 'Restaurantes', 'Carro', 'Peajes', 'Domicilios', 'Servicios', 'Salario', 'Nómina', 'Honorarios', 'Rendimientos',
    ]));
    state.categories = [{ id: 'food', name: 'Alimentación', scope: 'expense' }];
    normalizeDefaultCategories(state as State);
    expect(state.categories.find(category => category.id === 'food')?.name).toBe('Mercado');
    expect(state.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'car', name: 'Carro', scope: 'expense' }),
      expect.objectContaining({ id: 'salary', name: 'Salario', scope: 'income' }),
      expect.objectContaining({ id: 'car-tolls', name: 'Peajes', parentId: 'car' }),
    ]));
  });
  it('keeps expense and income category trees separate', () => {
    const state = setup();
    configure(state, 'categories', { id: 'commissions', name: 'Comisiones', scope: 'income' });
    configure(state, 'categories', { id: 'sales-commission', name: 'Ventas', scope: 'income', parentId: 'commissions' });
    expect(() => configure(state, 'categories', { id: 'invalid-child', name: 'Inválida', scope: 'expense', parentId: 'commissions' })).toThrow(/mismo tipo/);
    expect(() => addTransaction(state, { ...purchase('wrong-expense'), categoryId: 'salary' }, at)).toThrow(/categoría de gasto/);
    expect(() => addTransaction(state, { ...purchase('wrong-income'), kind: 'income', categoryId: 'car' }, at)).toThrow(/categoría de ingreso/);
    const income = addTransaction(state, { ...purchase('income'), kind: 'income', categoryId: 'salary-payroll' }, at);
    const expense = addTransaction(state, { ...purchase('toll'), categoryId: 'car-tolls' }, at);
    expect(income.categoryId).toBe('salary-payroll'); expect(expense.categoryId).toBe('car-tolls');
    expect(state.categories.find(category => category.id === 'sales-commission')).toMatchObject({ parentId: 'commissions', scope: 'income' });
  });
  it('resolves pending transfers without an owned destination as expenses', () => {
    const state = setup();
    state.observations.push(observation('external-transfer', { accountId: 'bank', kind: 'transfer', counterAccountId: 'missing-nequi', merchant: 'Transferencia a Nequi' }));
    resolveObservation(state, 'external-transfer', 'separate', at);
    expect(state.observations[0]).toMatchObject({ kind: 'expense', merchant: 'Transferencia a Nequi', status: 'linked' });
    expect(state.observations[0].counterAccountId).toBeUndefined();
    expect(state.transactions[0]).toMatchObject({ kind: 'expense', merchant: 'Transferencia a Nequi', accountId: 'bank' });
  });
  it('keeps cents and large amounts exact', () => { expect(parseCOP('$ 1.234.567,89')).toBe('123456789'); expect(formatCOP('123456789')).toBe('$ 1.234.567,89'); expect(parseCOP('90071992547409,91')).toBe('9007199254740991'); });
  it('rejects malformed values and USD-style decimals', () => { for (const v of ['1.23', 'NaN', '1,000.00', '2,222', 'USD 2']) expect(() => parseCOP(v)).toThrow(); });
  it('uses Bogota dates and clamps payday at month end', () => { expect(bogotaDate(new Date('2026-10-01T02:00:00Z'))).toBe('2026-09-30'); expect(nextPayday('2026-02-10', 31)).toBe('2026-02-28'); expect(nextPayday('2026-12-31', 31)).toBe('2027-01-31'); });
});
describe('commitments and balanced journal', () => {
  it('keeps pre-opening history visible without changing current balances', () => {
    const s = setup();
    addTransaction(s, { id: 'old-bank', accountId: 'bank', date: '2025-12-20', kind: 'expense', amountMinor: '25000000', merchant: 'Compra histórica' }, at);
    addTransaction(s, { id: 'old-card', accountId: 'card', date: '2025-12-21', kind: 'expense', amountMinor: '30000000', merchant: 'Compra histórica con tarjeta', status: 'provisional' }, at);
    const d = dashboard(s, '2026-10-17');
    expect(s.transactions.map(t => t.id)).toEqual(['old-bank', 'old-card']);
    expect(d.balances.bank).toBe('100000000');
    expect(d.balances.card).toBe('0');
    expect(d.cardDebtMinor).toBe('0');
    expect(d.cards[0].unconfirmedMinor).toBe('0');
    expect(d.availableMinor).toBe('100000000');
  });
  it('applies each side of a transfer only after that account snapshot', () => {
    const s = emptyState();
    configure(s, 'accounts', { id: 'early', name: 'Cuenta enero', kind: 'bank', openingMinor: '100000000', openingDate: '2026-01-01' });
    configure(s, 'accounts', { id: 'late', name: 'Cuenta junio', kind: 'bank', openingMinor: '50000000', openingDate: '2026-06-01' });
    addTransaction(s, { id: 'between-snapshots', accountId: 'early', counterAccountId: 'late', date: '2026-03-01', kind: 'transfer', amountMinor: '20000000' }, at);
    const d = dashboard(s, '2026-10-17');
    expect(d.balances.early).toBe('80000000');
    expect(d.balances.late).toBe('50000000');
  });
  it('does not reserve pre-opening evidence that still needs review', () => {
    const s = setup();
    ingestCapture(s, observation('historical-review', { date: '2025-12-20' }));
    ingestCapture(s, observation('historical-match', { date: '2025-12-21' }));
    expect(s.transactions).toHaveLength(0);
    expect(s.observations[1].status).toBe('review');
    expect(dashboard(s, '2026-10-17').uncertainMinor).toBe('0');
  });
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
  it('deletes a movement from balances and can restore it through the audit trail', () => {
    const s = setup(); addTransaction(s, { id: 'delete-me', accountId: 'bank', date: '2026-10-10', amountMinor: '2500000', kind: 'expense', merchant: 'Compra' }, at);
    expect(dashboard(s, '2026-10-17').balances.bank).toBe('97500000');
    deleteTransaction(s, 'delete-me', at, 1); expect(dashboard(s, '2026-10-17').balances.bank).toBe('100000000'); expect(s.transactions[0].voided).toBe(true);
    undo(s, s.audit.at(-1)!.id, at); expect(dashboard(s, '2026-10-17').balances.bank).toBe('97500000'); expect(s.transactions[0].voided).toBeFalsy();
  });
});
describe('evidence reconciliation and corrections', () => {
  it('keeps Shortcut captures pending until the owner confirms them', () => {
    const s = setup(); ingestCapture(s, observation('sms')); ingestCapture(s, observation('sms')); ingestCapture(s, observation('wallet', { source: 'wallet' }));
    expect(s.transactions).toHaveLength(0); expect(s.observations).toHaveLength(2); expect(s.observations.every(item => item.status === 'review')).toBe(true);
    resolveObservation(s, 'sms', 'separate', at); refreshCaptureCandidates(s);
    expect(s.transactions).toHaveLength(1); expect(s.observations[1].candidates).toEqual([s.transactions[0].id]);
    mergeObservation(s, 'wallet', s.transactions[0].id, at); expect(s.transactions[0].observationIds).toEqual(['sms', 'wallet']);
    expect(dashboard(s, '2026-10-17').uncertainMinor).toBe('0');
    undo(s, s.audit.at(-1)!.id, at); expect(s.observations[1].status).toBe('review'); expect(s.transactions[0].observationIds).toEqual(['sms']);
  });
  it('preserves two real equal-value Shortcut purchases', () => { const s = setup(); ingestCapture(s, observation('one')); ingestCapture(s, observation('two')); resolveObservation(s, 'one', 'separate', at); resolveObservation(s, 'two', 'separate', at); expect(s.transactions).toHaveLength(2); expect(dashboard(s, '2026-10-17').spendingMinor).toBe('40000000'); });
  it('records statements as posted movements without sending them to review', () => { const s = setup(); recordStatement(s, observation('statement', { source: 'statement', reference: 'bank-unique' }), at); expect(s.transactions).toHaveLength(1); expect(s.transactions[0].status).toBe('posted'); expect(s.observations[0]).toMatchObject({ status: 'linked', candidates: [] }); });
  it('keeps merchant and category edits when a Shortcut is joined to a posted statement', () => { const s = setup(); recordStatement(s, observation('bank', { source: 'statement', merchant: 'POS XYZ' }), at); editTransaction(s, s.transactions[0].id, { merchant: 'Comercio recordado', categoryId: 'food' }, at); ingestCapture(s, observation('sms')); refreshCaptureCandidates(s); mergeObservation(s, 'sms', s.transactions[0].id, at); expect(s.transactions[0].merchant).toBe('Comercio recordado'); expect(s.transactions[0].categoryId).toBe('food'); });
  it('remembers category and note for the same merchant', () => { const s = setup(); addTransaction(s, { ...purchase('first'), merchant: 'Tienda repetida' }, at); editTransaction(s, 'first', { categoryId: 'restaurants', note: 'Almuerzo de trabajo' }, at, true); const next = addTransaction(s, { ...purchase('next'), merchant: '  TIENDA   REPETIDA  ' }, at); expect(next).toMatchObject({ categoryId: 'restaurants', note: 'Almuerzo de trabajo' }); });
  it('stores incomplete evidence without inventing a purchase', () => { const s = setup(); ingestCapture(s, observation('missing', { amountMinor: undefined })); expect(s.transactions).toHaveLength(0); expect(dashboard(s, '2026-10-17').incomplete).toBe(1); });
  it('rejects cross-account merges and undo over later edits', () => { const s = setup(); ingestCapture(s, observation('one')); resolveObservation(s, 'one', 'separate', at); ingestCapture(s, observation('missing', { accountId: 'bank', amountMinor: undefined })); expect(() => mergeObservation(s, 'missing', s.transactions[0].id, at)).toThrow(); editTransaction(s, s.transactions[0].id, { merchant: 'A' }, at); const audit = s.audit.at(-1)!.id; editTransaction(s, s.transactions[0].id, { merchant: 'B' }, at); expect(() => undo(s, audit, at)).toThrow(/posteriores/); });
});

describe('product setup and initial debit identity', () => {
  it('saves one bank balance and its debit card atomically and retries without duplicates', () => {
    const state = emptyState();
    const input = { id: 'new-bank', name: 'Ahorros', kind: 'bank', openingMinor: '10000000', openingDate: '2026-01-01', captureAliases: ['3344'], initialInstrument: { id: 'new-debit', name: 'Débito', aliases: ['5566'] } };
    configure(state, 'accounts', input);
    configure(state, 'accounts', input);
    expect(state.accounts).toHaveLength(1);
    expect(state.instruments).toEqual([{ id: 'new-debit', name: 'Débito', accountId: 'new-bank', aliases: ['5566'] }]);
    expect(dashboard(state, '2026-10-20').availableMinor).toBe('10000000');
  });
  it('leaves no account when its initial card alias conflicts or exposes a full number', () => {
    const state = setup();
    configure(state, 'instruments', { id: 'existing', name: 'Débito existente', accountId: 'bank', aliases: ['5566'] });
    const before = structuredClone(state);
    for (const alias of ['5566', '1234567890123456']) {
      expect(() => configure(state, 'accounts', { id: 'other-bank', name: 'Otra', kind: 'bank', openingMinor: '0', openingDate: '2026-01-01', initialInstrument: { id: 'other-debit', name: 'Otra débito', aliases: [alias] } })).toThrow();
      expect(state).toEqual(before);
    }
  });
});
