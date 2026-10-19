import { accountSchema, billSchema, categorySchema, instrumentSchema, settingsSchema, transactionInput,
  DomainError, normalizeUnlinkedTransfer, requireValue, type State, type Transaction, type TransactionInput, type Observation, type Entry, type Account } from './model';
import { bogotaDate, nextPayday } from './money';

const clone = <T>(value: T): T => structuredClone(value);
export const merchantKey = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('es-CO').replace(/\s+/g, ' ');
type ComparableMovement = Pick<TransactionInput, 'accountId' | 'counterAccountId' | 'date' | 'amountMinor' | 'kind' | 'merchant' | 'reference'>;
export function duplicateTransactions(state: State, movement: ComparableMovement): Transaction[] {
  return state.transactions.filter(t => !t.voided && t.accountId === movement.accountId
    && t.counterAccountId === movement.counterAccountId && t.amountMinor === movement.amountMinor && t.kind === movement.kind
    && ((movement.reference && t.reference === movement.reference) || (t.date === movement.date
      && (movement.kind === 'transfer' || merchantKey(t.merchant) === merchantKey(movement.merchant)))));
}
function captureCandidates(state: State, observation: Observation): Transaction[] {
  if (!observation.accountId || !observation.amountMinor || !observation.date) return [];
  return state.transactions.filter(t => !t.voided && t.accountId === observation.accountId && (
    (observation.reference && t.reference === observation.reference) ||
    (t.amountMinor === observation.amountMinor && t.kind === observation.kind
      && Math.abs(Date.parse(t.date) - Date.parse(observation.date!)) <= 7 * 86400000)
  ));
}
const findAccount = (state: State, id: string) => requireValue(state.accounts.find(a => a.id === id), 'Cuenta desconocida');
function entries(state: State, t: TransactionInput): Entry[] {
  const account = findAccount(state, t.accountId);
  const line = (accountId: string, debit: boolean): Entry => ({ accountId, debitMinor: debit ? t.amountMinor : '0', creditMinor: debit ? '0' : t.amountMinor });
  if (t.kind === 'transfer') {
    const other = findAccount(state, requireValue(t.counterAccountId, 'Selecciona la cuenta destino'));
    if (other.id === account.id) throw new DomainError('Selecciona dos cuentas distintas');
    return [line(other.id, true), line(account.id, false)];
  }
  const category = state.categories.find(c => c.id === t.categoryId);
  if (!category) throw new DomainError('Categoría desconocida');
  const expectedScope = t.kind === 'income' ? 'income' : 'expense';
  if (category.scope !== 'both' && category.scope !== expectedScope)
    throw new DomainError(t.kind === 'income' ? 'Selecciona una categoría de ingreso' : 'Selecciona una categoría de gasto');
  if (category.parentId) {
    const parent = state.categories.find(c => c.id === category.parentId);
    if (!parent || (parent.scope !== 'both' && parent.scope !== category.scope)) throw new DomainError('Subcategoría inválida');
  }
  return t.kind === 'expense' ? [line(`expense:${t.categoryId}`, true), line(account.id, false)]
    : [line(account.id, true), line(t.kind === 'income' ? 'income' : `expense:${t.categoryId}`, false)];
}
function linkBill(state: State, t: Transaction) {
  if (!t.billId) return;
  if (t.kind !== 'expense') throw new DomainError('Asocia la factura al gasto, no al pago de la tarjeta');
  const bill = requireValue(state.bills.find(b => b.id === t.billId), 'Factura desconocida');
  if (bill.paidTransactionId && bill.paidTransactionId !== t.id) throw new DomainError('La factura ya tiene un pago');
  if (bill.amountMinor !== t.amountMinor) throw new DomainError('El pago de la factura debe coincidir con su valor; ajusta la factura primero');
  bill.paidTransactionId = t.id;
}
export function addTransaction(state: State, input: unknown, at: string, observationId?: string): Transaction {
  const value = transactionInput.parse(input);
  const requestSignature = JSON.stringify(value);
  if (value.date > bogotaDate(new Date(at))) throw new DomainError('Registra movimientos realizados, no ingresos o gastos futuros');
  const existing = state.transactions.find(t => t.id === value.id);
  if (existing) {
    // Idempotency requires the same intent, not merely the same key.
    if (existing.requestSignature !== requestSignature) throw new DomainError('Identificador reutilizado para un movimiento distinto', 409);
    return existing;
  }
  const rule = state.aliases.find(a => a.merchant === merchantKey(value.merchant));
  if (value.categoryId === 'uncategorized' && rule) value.categoryId = rule.categoryId;
  if (!value.note && rule?.note) value.note = rule.note;
  const t: Transaction = { ...value, entries: entries(state, value), observationIds: observationId ? [observationId] : [], revision: 1, requestSignature };
  linkBill(state, t);
  state.transactions.push(t);
  state.audit.push({ id: `create:${t.id}`, at, action: 'create', transactionId: t.id });
  return t;
}
export function configure(state: State, kind: string, input: unknown) {
  if (kind === 'settings') { state.settings = settingsSchema.parse(input); return; }
  if (kind === 'accounts') {
    const item = accountSchema.parse(input), old = state.accounts.find(a => a.id === item.id);
    if (item.parentAccountId) {
      if (item.kind !== 'credit') throw new DomainError('Solo una tarjeta de crédito puede vincularse a una cuenta bancaria');
      if (item.parentAccountId === item.id) throw new DomainError('Una tarjeta no puede vincularse a sí misma');
      const parent = findAccount(state, item.parentAccountId);
      if (parent.kind !== 'bank') throw new DomainError('Vincula la tarjeta a una cuenta bancaria');
    }
    if (item.kind !== 'bank' && state.accounts.some(a => a.parentAccountId === item.id))
      throw new DomainError('Desvincula las tarjetas de crédito antes de cambiar el tipo de cuenta');
    if (old && state.transactions.some(t => t.accountId === old.id || t.counterAccountId === old.id)
      && ['kind', 'openingMinor', 'openingDate'].some(k => old[k as keyof Account] !== item[k as keyof Account]))
      throw new DomainError('No cambies el saldo inicial de una cuenta con movimientos; registra y documenta una corrección');
    upsert(state.accounts, item); return;
  }
  if (kind === 'instruments') {
    const item = instrumentSchema.parse(input); findAccount(state, item.accountId);
    if (state.instruments.some(i => i.id !== item.id && i.aliases.some(a => item.aliases.includes(a)))) throw new DomainError('Alias de tarjeta duplicado');
    upsert(state.instruments, item); return;
  }
  if (kind === 'categories') {
    const item = categorySchema.parse(input);
    if (item.parentId) {
      if (item.parentId === item.id) throw new DomainError('Una categoría no puede ser su propia subcategoría');
      const parent = requireValue(state.categories.find(c => c.id === item.parentId), 'Categoría principal desconocida');
      if (parent.parentId) throw new DomainError('Solo se permite un nivel de subcategorías');
      if (parent.scope !== 'both' && item.scope !== parent.scope) throw new DomainError('La subcategoría debe tener el mismo tipo que su categoría principal');
    }
    upsert(state.categories, item); return;
  }
  if (kind === 'bills') {
    const item = billSchema.omit({ paidTransactionId: true }).parse(input);
    const old = state.bills.find(b => b.id === item.id);
    if (old?.paidTransactionId) throw new DomainError('No se puede editar una factura pagada');
    upsert(state.bills, item); return;
  }
  throw new DomainError('Configuración desconocida');
}
function upsert<T extends { id: string }>(list: T[], item: T) { const index = list.findIndex(i => i.id === item.id); if (index < 0) list.push(item); else list[index] = item; }

export function ingestCapture(state: State, input: Observation): Observation {
  if (input.source === 'statement') throw new DomainError('Los extractos se confirman durante la importación');
  const existing = state.observations.find(o => o.id === input.id);
  if (existing) return existing;
  const observation = clone(input);
  observation.status = 'review'; observation.candidates = [];
  state.observations.push(observation);
  if (!observation.accountId || !observation.amountMinor || !observation.date || (observation.kind === 'transfer' && !observation.counterAccountId)) {
    observation.reason = 'Faltan datos para registrar el movimiento'; return observation;
  }
  if (!state.accounts.some(a => a.id === observation.accountId)) { observation.reason = 'Cuenta sin configurar'; return observation; }
  const candidates = captureCandidates(state, observation);
  observation.candidates = candidates.map(t => t.id);
  observation.reason = candidates.length ? 'Posible coincidencia: confirma antes de unir' : 'Captura de Shortcut pendiente de confirmación';
  return observation;
}
export function refreshCaptureCandidates(state: State) {
  for (const observation of state.observations.filter(o => o.status === 'review' && o.source !== 'statement')) {
    if (!observation.accountId || !observation.amountMinor || !observation.date) continue;
    observation.candidates = captureCandidates(state, observation).map(t => t.id);
    if (observation.candidates.length) observation.reason = 'Posible coincidencia: confirma antes de unir';
  }
}
export function recordStatement(state: State, input: Observation, at: string): Observation {
  if (input.source !== 'statement') throw new DomainError('Solo los extractos se registran como confirmados');
  const existing = state.observations.find(o => o.id === input.id);
  if (existing) return existing;
  const transaction = addTransaction(state, { id: `obs:${input.id}`,
    accountId: requireValue(input.accountId, 'El extracto no identifica la cuenta'),
    counterAccountId: input.counterAccountId, date: requireValue(input.date, 'El extracto no contiene una fecha'),
    amountMinor: requireValue(input.amountMinor, 'El extracto no contiene un valor'), kind: input.kind,
    merchant: input.merchant, reference: input.reference, status: 'posted' }, at, input.id);
  const observation = clone(input);
  observation.status = 'linked'; observation.candidates = []; observation.transactionId = transaction.id;
  state.observations.push(observation);
  return observation;
}
export function mergeObservation(state: State, observationId: string, transactionId: string, at: string) {
  const observation = requireValue(state.observations.find(o => o.id === observationId), 'Evidencia desconocida');
  normalizeUnlinkedTransfer(state, observation);
  if (observation.status !== 'review') throw new DomainError('La evidencia ya fue revisada', 409);
  const t = requireValue(state.transactions.find(t => t.id === transactionId && !t.voided), 'Movimiento desconocido');
  if (observation.accountId && observation.accountId !== t.accountId) throw new DomainError('No se pueden unir cuentas distintas');
  const beforeTransaction = clone(t), beforeObservation = clone(observation);
  if (observation.source === 'statement') {
    if (!observation.amountMinor || !observation.date) throw new DomainError('Extracto incompleto');
    if (observation.kind !== t.kind || observation.counterAccountId !== t.counterAccountId) throw new DomainError('Corrige el tipo de movimiento antes de unir');
    t.amountMinor = observation.amountMinor; t.date = observation.date; t.status = 'posted';
    t.reference = observation.reference ?? t.reference; t.entries = entries(state, t);
    if (t.billId) linkBill(state, t);
  }
  if (!t.merchant) t.merchant = observation.merchant;
  t.observationIds.push(observation.id); t.revision++;
  observation.status = 'linked'; observation.transactionId = t.id; observation.reason = undefined;
  state.audit.push({ id: `merge:${observation.id}:${t.revision}`, at, action: 'merge', transactionId: t.id,
    beforeTransaction, beforeObservation, expectedRevision: t.revision });
}
export function resolveObservation(state: State, observationId: string, action: 'separate' | 'ignore', at: string, details?: unknown,
  batch?: { id: string; size: number }) {
  const o = requireValue(state.observations.find(o => o.id === observationId), 'Evidencia desconocida');
  normalizeUnlinkedTransfer(state, o);
  if (o.status !== 'review') throw new DomainError('La evidencia ya fue revisada', 409);
  const beforeObservation = clone(o);
  if (action === 'ignore') { o.status = 'ignored'; state.audit.push({ id: `ignore:${o.id}:${state.audit.length}`, at, action, beforeObservation }); return; }
  const t = addTransaction(state, { accountId: o.accountId, amountMinor: o.amountMinor, date: o.date,
    kind: o.kind, merchant: o.merchant, counterAccountId: o.counterAccountId, ...(typeof details === 'object' ? details : {}),
    reference: o.reference, id: `obs:${o.id}:v${state.transactions.filter(t => t.observationIds.includes(o.id)).length + 1}`, status: o.source === 'statement' ? 'posted' : 'provisional' }, at, o.id);
  o.status = 'linked'; o.transactionId = t.id;
  state.audit.push({ id: `separate:${o.id}:${t.id}`, at, action: 'separate', beforeObservation, transactionId: t.id,
    expectedRevision: t.revision, ...(batch ? { batchId: batch.id, batchSize: batch.size } : {}) });
}
export function editTransaction(state: State, transactionId: string, input: unknown, at: string, remember = false, expectedRevision?: number) {
  const t = requireValue(state.transactions.find(t => t.id === transactionId && !t.voided), 'Movimiento desconocido');
  const beforeTransaction = clone(t);
  if (expectedRevision !== undefined && t.revision !== expectedRevision) throw new DomainError('El movimiento cambió; actualiza antes de editar', 409);
  const changes = Object.fromEntries(Object.entries(input && typeof input === 'object' ? input : {}).map(([k, v]) => [k, v === null ? undefined : v]));
  const value = transactionInput.parse({ ...t, ...changes, id: t.id });
  if (value.date > bogotaDate(new Date(at))) throw new DomainError('No se pueden registrar movimientos futuros');
  const journal = entries(state, value);
  for (const bill of state.bills) if (bill.paidTransactionId === t.id) delete bill.paidTransactionId;
  Object.assign(t, value, { entries: journal, revision: t.revision + 1 }); linkBill(state, t);
  if (remember && t.merchant) upsert(state.aliases, { id: merchantKey(t.merchant), merchant: merchantKey(t.merchant), categoryId: t.categoryId, note: t.note });
  state.audit.push({ id: `edit:${t.id}:${t.revision}`, at, action: 'edit', transactionId: t.id, beforeTransaction, expectedRevision: t.revision });
}
export function deleteTransaction(state: State, transactionId: string, at: string, expectedRevision?: number) {
  const t = requireValue(state.transactions.find(item => item.id === transactionId && !item.voided), 'Movimiento desconocido');
  if (expectedRevision !== undefined && t.revision !== expectedRevision) throw new DomainError('El movimiento cambió; actualiza antes de eliminar', 409);
  const beforeTransaction = clone(t);
  for (const bill of state.bills) if (bill.paidTransactionId === t.id) delete bill.paidTransactionId;
  t.voided = true; t.revision++;
  state.audit.push({ id: `delete:${t.id}:${t.revision}`, at, action: 'delete', transactionId: t.id, beforeTransaction, expectedRevision: t.revision });
}
export function undo(state: State, auditId: string, at: string) {
  const a = requireValue(state.audit.find(a => a.id === auditId), 'Cambio desconocido');
  if (a.undone || (!a.beforeObservation && !a.beforeTransaction)) throw new DomainError('Este cambio no puede deshacerse');
  if (a.transactionId) {
    const t = requireValue(state.transactions.find(t => t.id === a.transactionId), 'Movimiento desconocido');
    if (t.revision !== a.expectedRevision) throw new DomainError('Hay cambios posteriores; revísalos primero', 409);
    for (const bill of state.bills) if (bill.paidTransactionId === t.id) delete bill.paidTransactionId;
    if (a.beforeTransaction) { const restored = { ...clone(a.beforeTransaction), revision: t.revision + 1 }; upsert(state.transactions, restored); linkBill(state, restored); }
    else { t.voided = true; t.revision++; }
  }
  if (a.beforeObservation) {
    const current = state.observations.find(o => o.id === a.beforeObservation!.id)!;
    upsert(state.observations, { ...clone(a.beforeObservation), candidates: current.candidates });
  }
  a.undone = true; state.audit.push({ id: `undo:${a.id}`, at, action: 'undo', transactionId: a.transactionId });
}

export function dashboard(state: State, today: string) {
  const balances = Object.fromEntries(state.accounts.map(a => [a.id, a.openingDate <= today ? BigInt(a.openingMinor) : 0n]));
  const active = state.transactions.filter(t => !t.voided && t.date <= today);
  for (const t of active) for (const e of t.entries) {
    const a = state.accounts.find(a => a.id === e.accountId); if (!a) continue;
    // The opening balance is a dated snapshot. Earlier movements stay visible as
    // history, but are already represented by that snapshot and must not be counted again.
    if (t.date < a.openingDate) continue;
    const delta = BigInt(e.debitMinor) - BigInt(e.creditMinor);
    balances[a.id] += a.kind === 'credit' ? -delta : delta;
  }
  const liquid = state.accounts.filter(a => a.kind !== 'credit' && a.eligible).reduce((sum, a) => sum + balances[a.id], 0n);
  const cardDebt = state.accounts.filter(a => a.kind === 'credit').reduce((sum, a) => sum + (balances[a.id] > 0n ? balances[a.id] : 0n), 0n);
  const payday = nextPayday(today, state.settings.payday);
  const dueBills = state.bills.filter(b => !b.paidTransactionId && b.dueDate < payday);
  const bills = dueBills.reduce((sum, b) => sum + BigInt(b.amountMinor), 0n);
  const pending = state.observations.filter(o => o.status === 'review');
  const uncertain = pending.filter(o => {
    if (o.kind !== 'expense' || !o.amountMinor) return false;
    const account = o.accountId ? state.accounts.find(a => a.id === o.accountId) : undefined;
    return !account || !o.date || o.date >= account.openingDate;
  }).reduce((sum, o) => sum + BigInt(o.amountMinor!), 0n);
  const month = active.filter(t => t.date.startsWith(today.slice(0, 7)));
  const spending = month.filter(t => ['expense', 'refund'].includes(t.kind)).reduce((sum, t) => sum + (t.kind === 'refund' ? -1n : 1n) * BigInt(t.amountMinor), 0n);
  const income = month.filter(t => t.kind === 'income').reduce((sum, t) => sum + BigInt(t.amountMinor), 0n);
  const categorySpending = state.categories.map(c => ({ ...c, amountMinor: month.filter(t => t.categoryId === c.id && ['expense', 'refund'].includes(t.kind)).reduce((sum, t) => sum + (t.kind === 'refund' ? -1n : 1n) * BigInt(t.amountMinor), 0n).toString() }));
  return { today, nextPayday: payday, liquidMinor: liquid.toString(), cardDebtMinor: cardDebt.toString(), billsMinor: bills.toString(),
    reserveMinor: state.settings.reserveMinor, uncertainMinor: uncertain.toString(),
    availableMinor: (liquid - cardDebt - bills - BigInt(state.settings.reserveMinor) - uncertain).toString(),
    spendingMinor: spending.toString(), incomeMinor: income.toString(), categorySpending, dueBills,
    pending: pending.length, incomplete: pending.filter(o => !o.amountMinor).length,
    balances: Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, v.toString()])),
    cards: state.accounts.filter(a => a.kind === 'credit').map(a => {
      // Statement confirmation, not an inferred closing day, establishes posted purchases.
      const unconfirmed = active.filter(t => t.accountId === a.id && t.date >= a.openingDate && t.kind === 'expense' && t.status === 'provisional').reduce((s, t) => s + BigInt(t.amountMinor), 0n);
      const [year, month, day] = today.split('-').map(Number);
      const closeDate = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-${String(Math.min(a.closingDay!, new Date(Date.UTC(y, m, 0)).getUTCDate())).padStart(2, '0')}`;
      let cutoff: string | undefined;
      if (a.closingDay) { cutoff = closeDate(year, month); if (cutoff >= today) cutoff = closeDate(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1); }
      let billed = cutoff && a.openingDate <= cutoff ? BigInt(a.openingMinor) : 0n;
      if (cutoff) for (const t of active.filter(t => t.date >= a.openingDate)) for (const e of t.entries.filter(e => e.accountId === a.id)) {
        const delta = BigInt(e.creditMinor) - BigInt(e.debitMinor);
        if (t.date <= cutoff || delta < 0n) billed += delta;
      }
      const total = balances[a.id] > 0n ? balances[a.id] : 0n;
      billed = billed < 0n ? 0n : billed > total ? total : billed;
      return { ...a, balanceMinor: balances[a.id].toString(), unconfirmedMinor: unconfirmed.toString(), cutoff,
        billedEstimateMinor: cutoff ? billed.toString() : undefined, unbilledEstimateMinor: cutoff ? (total - billed).toString() : undefined };
    }),
    lastStatementAt: state.observations.filter(o => o.source === 'statement' && o.status === 'linked').map(o => o.receivedAt).sort().at(-1),
  };
}
