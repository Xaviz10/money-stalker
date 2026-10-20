import type { Account, Instrument, State } from "./model";

export type BankAccountGroup = {
  account: Account;
  debitCards: Instrument[];
  creditCards: Account[];
};
export type InstitutionGroup = {
  id: string;
  name: string;
  accounts: BankAccountGroup[];
};

/** Organization only: instruments never contribute a second monetary balance. */
export function groupAccounts(state: Pick<State, "accounts" | "instruments">) {
  const banks = state.accounts.filter((a) => a.kind === "bank");
  const groups = new Map<string, InstitutionGroup>();
  for (const account of banks) {
    const name = account.institution?.trim() || account.name;
    const key =
      account.institution
        ?.trim()
        .normalize("NFKC")
        .toLocaleLowerCase("es-CO") || `account:${account.id}`;
    if (!groups.has(key)) groups.set(key, { id: key, name, accounts: [] });
    groups
      .get(key)!
      .accounts.push({
        account,
        debitCards: state.instruments.filter((i) => i.accountId === account.id),
        creditCards: state.accounts.filter(
          (a) => a.kind === "credit" && a.parentAccountId === account.id,
        ),
      });
  }
  return {
    institutions: [...groups.values()],
    standaloneCards: state.accounts.filter(
      (a) =>
        a.kind === "credit" && !banks.some((b) => b.id === a.parentAccountId),
    ),
    cash: state.accounts.filter((a) => a.kind === "cash"),
    pockets: state.accounts.filter((a) => a.kind === "pocket"),
    investments: state.accounts.filter((a) => a.kind === "investment"),
  };
}

export function netWorthMinor(
  accounts: Account[],
  balances: Record<string, string>,
): string {
  return accounts
    .reduce(
      (sum, a) =>
        sum + (a.kind === "credit" ? -1n : 1n) * BigInt(balances[a.id] ?? "0"),
      0n,
    )
    .toString();
}
