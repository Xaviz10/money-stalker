import { DomainError, type MerchantRule, type Observation, type State, type TransactionInput } from "./model";

export const merchantKey = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("es-CO").replace(/\s+/g, " ");
export function rememberMerchant(state: State, transaction: TransactionInput, originalMerchant?: string) {
  if (!transaction.merchant.trim()) throw new DomainError("Agrega el comercio antes de guardar una regla");
  const destination = state.accounts.find(account => account.id === transaction.counterAccountId && account.kind === "investment");
  const keys = [...new Set([originalMerchant, transaction.merchant].filter((value): value is string => Boolean(value?.trim())).map(merchantKey))];
  for (const key of keys) {
    const rule: MerchantRule = { id: key, merchant: key, categoryId: transaction.categoryId, note: transaction.note,
      ...(transaction.kind === "transfer" && destination ? { investmentAccountId: destination.id } : {}),
      ...(key !== merchantKey(transaction.merchant) ? { displayMerchant: transaction.merchant } : {}),
    };
    const index = state.aliases.findIndex(item => item.id === key);
    if (index < 0) state.aliases.push(rule); else state.aliases[index] = rule;
  }
}
export function classifyImportedMerchant(state: Pick<State, "accounts" | "categories" | "aliases">, observation: Observation): Observation {
  const rule = state.aliases.find(item => item.merchant === merchantKey(observation.merchant));
  const result = { ...observation, categoryId: observation.categoryId ?? "uncategorized", note: observation.note ?? "" };
  if (!rule) return result;
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
