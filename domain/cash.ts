import { DomainError, type State } from "./model";

export const DEFAULT_CASH_ID = "cash:auto";
export function withdrawalCashId(state: Pick<State, "accounts" | "settings">): string | undefined {
  const cash = state.accounts.filter((account) => account.kind === "cash");
  if (state.settings.cashAccountId && cash.some((account) => account.id === state.settings.cashAccountId)) return state.settings.cashAccountId;
  if (cash.length === 1) return cash[0].id;
  return cash.length === 0 ? DEFAULT_CASH_ID : undefined;
}
export function ensureWithdrawalCash(state: State, date: string, requestedId?: string): string | undefined {
  const id = requestedId ?? withdrawalCashId(state);
  if (!id) return undefined;
  const existing = state.accounts.find((account) => account.id === id);
  if (existing && existing.kind !== "cash") throw new DomainError("El destino automático de efectivo está ocupado; configura una cuenta de efectivo");
  if (!existing && id !== DEFAULT_CASH_ID) throw new DomainError("La cuenta de efectivo destino ya no existe");
  if (!existing) state.accounts.push({ id, name: "Efectivo", kind: "cash", openingMinor: "0", openingDate: date, eligible: true });
  return id;
}
