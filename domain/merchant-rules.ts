import { DomainError, type MerchantRule, type Observation, type State, type TransactionInput, type Transaction } from "./model";

export const merchantKey = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("es-CO").replace(/\s+/g, " ");
/** Preview and write use the same boundary; a merchant never redirects another loan. */
export function loanMerchantCandidates(state: State, selected: Transaction, loanId: string) {
  const key = merchantKey(selected.merchant);
  return state.transactions.filter(item => key && item.id !== selected.id && !item.voided
    && merchantKey(item.merchant) === key
    && state.accounts.some(account => account.id === item.accountId && ['bank', 'cash'].includes(account.kind))
    && (item.kind === 'expense' || (item.kind === 'loan_payment' && item.counterAccountId === loanId))
    && !state.observations.some(observation => item.observationIds.includes(observation.id) && observation.cashWithdrawal));
}
export function rememberMerchant(state: State, transaction: TransactionInput, originalMerchant?: string) {
  if (!transaction.merchant.trim()) throw new DomainError("Agrega el comercio antes de guardar una regla");
  const destination = state.accounts.find(account => account.id === transaction.counterAccountId && account.kind === "investment");
  const loan = state.accounts.find(account => account.id === transaction.counterAccountId && account.kind === 'loan');
  const keys = [...new Set([originalMerchant, transaction.merchant].filter((value): value is string => Boolean(value?.trim())).map(merchantKey))];
  for (const key of keys) {
    const previous = state.aliases.find(item => item.id === key);
    const rule: MerchantRule = { ...(previous?.place ? { place: structuredClone(previous.place) } : {}), id: key, merchant: key, categoryId: transaction.categoryId, note: transaction.note,
      ...(transaction.kind === "transfer" && destination ? { investmentAccountId: destination.id } : {}),
      ...(transaction.kind === 'loan_payment' && loan ? { loanAccountId: loan.id } : {}),
      ...(key !== merchantKey(transaction.merchant) ? { displayMerchant: transaction.merchant } : {}),
    };
    const index = state.aliases.findIndex(item => item.id === key);
    if (index < 0) state.aliases.push(rule); else state.aliases[index] = rule;
  }
}
/** Remember only the owner-selected place, independently from categorization. */
export function rememberMerchantPlace(state: State, transaction: TransactionInput, originalMerchant?: string) {
  if (!transaction.merchant.trim() || !transaction.place) throw new DomainError("Elige un comercio y una ubicación antes de recordarla");
  const keys = [...new Set([originalMerchant, transaction.merchant].filter((value): value is string => Boolean(value?.trim())).map(merchantKey))];
  for (const key of keys) {
    const index = state.aliases.findIndex(item => item.id === key);
    const rule: MerchantRule = { ...(index < 0 ? {} : state.aliases[index]), id: key, merchant: key, place: structuredClone(transaction.place) };
    if (index < 0) state.aliases.push(rule); else state.aliases[index] = rule;
  }
}
export function classifyImportedMerchant(state: Pick<State, "accounts" | "categories" | "aliases">, observation: Observation): Observation {
  const rule = state.aliases.find(item => item.merchant === merchantKey(observation.merchant));
  const result = { ...observation, categoryId: observation.categoryId ?? "uncategorized", note: observation.note ?? "" };
  if (!rule) return result;
  if (rule.loanAccountId && !observation.cashWithdrawal && ['expense', 'loan_payment'].includes(observation.kind)) {
    if (!state.accounts.some(a => a.id === rule.loanAccountId && a.kind === 'loan')) throw new DomainError('El crédito recordado ya no existe; corrige la asociación');
    result.kind = 'loan_payment'; result.counterAccountId = rule.loanAccountId;
    result.loanPayment = { purpose: 'unconfirmed' };
  }
  if (!result.place && rule.place) result.place = structuredClone(rule.place);
  if (rule.investmentAccountId && !observation.cashWithdrawal && (observation.kind === "expense" || observation.kind === "transfer") && observation.accountId !== rule.investmentAccountId) {
    if (!state.accounts.some(account => account.id === rule.investmentAccountId && account.kind === "investment")) throw new DomainError("La inversión recordada para este comercio ya no existe; corrige la regla antes de importar");
    if (observation.counterAccountId && observation.counterAccountId !== rule.investmentAccountId) throw new DomainError("El destino de la fila difiere de la inversión recordada para este comercio");
    result.kind = "transfer";
    result.counterAccountId = rule.investmentAccountId;
  }
  const category = state.categories.find(item => item.id === rule.categoryId);
  const scope = result.kind === "income" ? "income" : "expense";
  if (category && (category.scope === "both" || category.scope === scope)) result.categoryId = category.id;
  if (!result.note) result.note = rule.note ?? "";
  if (rule.displayMerchant) result.merchant = rule.displayMerchant;
  return result;
}
