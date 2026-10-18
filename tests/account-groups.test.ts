import { describe, expect, it } from "vitest";
import { configure, dashboard } from "../domain/ledger";
import { emptyState } from "../domain/model";
import { groupAccounts, netWorthMinor } from "../domain/account-groups";
const base = { openingMinor: "10000000", openingDate: "2026-01-01" };
describe("bank accounts and payment cards", () => {
  it("groups debit instruments and linked credit debt without counting balances twice", () => {
    const s = emptyState();
    configure(s, "accounts", {
      ...base,
      id: "bank",
      name: "Ahorros",
      institution: "Bancolombia",
      kind: "bank",
    });
    configure(s, "accounts", {
      ...base,
      id: "credit",
      name: "Mastercard",
      kind: "credit",
      parentAccountId: "bank",
    });
    configure(s, "instruments", {
      id: "debit",
      name: "Visa débito",
      accountId: "bank",
      aliases: ["1234"],
    });
    configure(s, "instruments", {
      id: "wallet",
      name: "Wallet débito",
      accountId: "bank",
      aliases: ["wallet"],
    });
    const grouped = groupAccounts(s),
      d = dashboard(s, "2026-10-18");
    expect(grouped.institutions[0].name).toBe("Bancolombia");
    expect(grouped.institutions[0].accounts[0].debitCards).toHaveLength(2);
    expect(grouped.institutions[0].accounts[0].creditCards[0].id).toBe(
      "credit",
    );
    expect(grouped.standaloneCards).toHaveLength(0);
    expect(d.liquidMinor).toBe("10000000");
    expect(d.cardDebtMinor).toBe("10000000");
    expect(netWorthMinor(s.accounts, d.balances)).toBe("0");
  });
  it("supports a credit card before any bank account exists and can link or unlink it later", () => {
    const s = emptyState();
    configure(s, "accounts", { ...base, id: "nu", name: "Nu", kind: "credit" });
    expect(groupAccounts(s).standaloneCards[0].id).toBe("nu");
    configure(s, "accounts", {
      ...base,
      id: "bank",
      name: "Ahorros",
      kind: "bank",
    });
    configure(s, "accounts", { ...s.accounts[0], parentAccountId: "bank" });
    expect(groupAccounts(s).standaloneCards).toHaveLength(0);
    const { parentAccountId: _, ...card } = s.accounts[0];
    configure(s, "accounts", card);
    expect(groupAccounts(s).standaloneCards).toHaveLength(1);
  });
  it("rejects invalid parents, cycles and converting a bank that still owns linked cards", () => {
    const s = emptyState();
    configure(s, "accounts", {
      ...base,
      id: "bank",
      name: "Bank",
      kind: "bank",
    });
    configure(s, "accounts", {
      ...base,
      id: "cash",
      name: "Cash",
      kind: "cash",
    });
    for (const parentAccountId of ["missing", "cash", "credit"])
      expect(() =>
        configure(s, "accounts", {
          ...base,
          id: "credit",
          name: "Card",
          kind: "credit",
          parentAccountId,
        }),
      ).toThrow();
    expect(() =>
      configure(s, "accounts", {
        ...base,
        id: "bad",
        name: "Bank",
        kind: "bank",
        parentAccountId: "bank",
      }),
    ).toThrow();
    configure(s, "accounts", {
      ...base,
      id: "credit",
      name: "Card",
      kind: "credit",
      parentAccountId: "bank",
    });
    expect(() =>
      configure(s, "accounts", { ...s.accounts[0], kind: "cash" }),
    ).toThrow(/Desvincula/);
  });
  it("keeps existing ungrouped accounts working and groups explicitly named institutions", () => {
    const s = emptyState();
    for (const [id, institution] of [
      ["one", "Bancolombia"],
      ["two", "bancolombia"],
      ["legacy", undefined],
    ])
      configure(s, "accounts", {
        ...base,
        id,
        name: id,
        kind: "bank",
        institution,
      });
    expect(groupAccounts(s).institutions.map((g) => g.accounts.length)).toEqual(
      [2, 1],
    );
  });
});
