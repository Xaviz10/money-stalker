import { describe, it, expect } from "vitest";
import { emptyState } from "../domain/model";
import {
  configure,
  addTransaction,
  editTransaction,
  deleteTransaction,
  undo,
  dashboard,
} from "../domain/ledger";
import {
  saveLoanTerms,
  adjustLoanBalance,
  loanBalance,
  simulateLoan,
  expenseMovements,
  loanSignature,
  saveLoanScenario,
} from "../domain/loans";
import { netWorthMinor } from "../domain/account-groups";
const at = "2026-10-21T18:00:00Z";
function setup(denomination: "COP" | "UVR" = "COP") {
  const state = emptyState();
  configure(state, "accounts", {
    id: "bank",
    name: "Ahorros sintéticos",
    kind: "bank",
    openingMinor: "2000000000",
    openingDate: "2026-01-01",
  });
  configure(state, "accounts", {
    id: "loan",
    name: "Hipoteca de prueba",
    kind: "loan",
    openingMinor: "0",
    openingDate: "2026-01-01",
  });
  saveLoanTerms(
    state,
    {
      id: "loan",
      denomination,
      principal: denomination === "COP" ? "10000000" : "25000",
      balanceDate: "2026-09-20",
      ratePercent: "12",
      remainingMonths: 120,
      nextPaymentDate: "2026-10-20",
      insuranceMinor: "500000",
      feesMinor: "0",
      ...(denomination === "UVR"
        ? { uvrValue: "400", uvrDate: "2026-09-20" }
        : {}),
    },
    at,
  );
  return state;
}
const allocation = {
  principalMinor: "10000000",
  interestMinor: "900000",
  lateInterestMinor: "0",
  insuranceMinor: "100000",
  feesMinor: "0",
};
const payment = {
  id: "pay",
  kind: "loan_payment",
  accountId: "bank",
  counterAccountId: "loan",
  date: "2026-10-01",
  amountMinor: "11000000",
  merchant: "Pago hipotecario",
  categoryId: "loans-housing",
  loanPayment: { purpose: "ordinary", allocation },
};
const scenario = {
  id: "scenario",
  loanId: "loan",
  name: "Abono",
  asOf: "2026-09-20",
  extraMinor: "100000000",
  extraDate: "2026-10-20",
  recurringMinor: "0",
  inflationPercent: "3",
};
describe("mortgage payments and confirmed balances", () => {
  it("records cash once, reduces only principal, and exposes only costs as spending", () => {
    const s = setup();
    const t = addTransaction(s, payment, at);
    expect(
      t.entries.reduce(
        (n, e) => n + BigInt(e.debitMinor) - BigInt(e.creditMinor),
        0n,
      ),
    ).toBe(0n);
    const d = dashboard(s, "2026-10-21");
    expect(d.balances.bank).toBe("1989000000");
    expect(d.balances.loan).toBe("990000000");
    expect(d.spendingMinor).toBe("1000000");
    expect(expenseMovements(s.transactions)[0].amountMinor).toBe("1000000");
    expect(netWorthMinor(s.accounts, d.balances)).toBe("999000000");
  });
  it("leaves pending payments out of principal and refuses incompatible sources and splits", () => {
    const s = setup();
    addTransaction(s, { ...payment, loanPayment: { purpose: "term" } }, at);
    expect(loanBalance(s, "loan", "2026-10-21").principal).toBe("10000000.00");
    expect(dashboard(s, "2026-10-21").spendingMinor).toBe("0");
    expect(() =>
      addTransaction(s, { ...payment, id: "bad", amountMinor: "10" }, at),
    ).toThrow("sumar");
    expect(() =>
      addTransaction(s, { ...payment, id: "bad", accountId: "loan" }, at),
    ).toThrow("ahorros");
    expect(() =>
      addTransaction(s, { ...payment, id: "bad", kind: "transfer" }, at),
    ).toThrow("pago de crédito");
  });
  it("rebases on a closing-date snapshot without changing cash, including out-of-order import and undo", () => {
    const s = setup();
    addTransaction(s, payment, at);
    const cash = dashboard(s, "2026-10-21").balances.bank;
    const snapshot = {
      id: "snap",
      loanId: "loan",
      date: "2026-10-01",
      principal: "9890000",
      reason: "Conciliación sintética",
      remainingMonths: 119,
      nextPaymentDate: "2026-11-20",
    };
    adjustLoanBalance(s, snapshot, at);
    adjustLoanBalance(s, snapshot, at);
    expect(s.loanSnapshots).toHaveLength(1);
    expect(loanBalance(s, "loan", "2026-10-21").principal).toBe("9890000.00");
    adjustLoanBalance(
      s,
      { ...snapshot, id: "older", date: "2026-09-25", principal: "9990000" },
      at,
    );
    expect(loanBalance(s, "loan", "2026-10-21").principal).toBe("9890000.00");
    expect(dashboard(s, "2026-10-21").balances.bank).toBe(cash);
    undo(s, "loan-snapshot:older", at);
    undo(s, "loan-snapshot:snap", at);
    expect(loanBalance(s, "loan", "2026-10-21").principal).toBe("9900000.00");
  });
  it("edits, soft deletes and restores the same payment without losing evidence", () => {
    const s = setup();
    const t = addTransaction(s, payment, at);
    t.observationIds.push("evidence");
    editTransaction(
      s,
      "pay",
      { loanPayment: { purpose: "term" } },
      at,
      false,
      1,
    );
    expect(loanBalance(s, "loan", "2026-10-21").principal).toBe("10000000.00");
    undo(s, "edit:pay:2", at);
    expect(s.transactions[0].observationIds).toEqual(["evidence"]);
    deleteTransaction(s, "pay", at, 3);
    expect(dashboard(s, "2026-10-21").spendingMinor).toBe("0");
    undo(s, "delete:pay:4", at);
    expect(dashboard(s, "2026-10-21").spendingMinor).toBe("1000000");
  });
  it("requires UVR units and a dated conversion, never subtracts COP from UVR principal", () => {
    const s = setup("UVR");
    expect(() => addTransaction(s, payment, at)).toThrow("capital en UVR");
    expect(() =>
      addTransaction(
        s,
        {
          ...payment,
          id: "free-principal",
          loanPayment: {
            purpose: "ordinary",
            allocation: {
              principalMinor: "0",
              interestMinor: payment.amountMinor,
              principalUnits: "250",
            },
          },
        },
        at,
      ),
    ).toThrow("capital en UVR");
    addTransaction(
      s,
      {
        ...payment,
        loanPayment: {
          purpose: "ordinary",
          allocation: {
            ...allocation,
            principalUnits: "250",
            uvrValue: "400",
            uvrDate: payment.date,
          },
        },
      },
      at,
    );
    expect(loanBalance(s, "loan", "2026-10-21").principal).toBe(
      "24750.00000000",
    );
    expect(() =>
      adjustLoanBalance(
        s,
        {
          id: "snap",
          loanId: "loan",
          date: "2026-10-20",
          principal: "24700",
          reason: "Saldo",
        },
        at,
      ),
    ).toThrow("cotización");
  });
  it("protects the upcoming installment once and does not deduct the entire mortgage from cash", () => {
    const s = setup();
    s.settings.payday = 28;
    s.loans[0].nextDueMinor = "11000000";
    s.loans[0].nextPaymentDate = "2026-10-25";
    expect(dashboard(s, "2026-10-21").billsMinor).toBe("11000000");
    configure(s, "bills", {
      id: "bill",
      name: "Cuota",
      amountMinor: "11000000",
      dueDate: "2026-10-25",
      loanId: "loan",
    });
    expect(dashboard(s, "2026-10-21").billsMinor).toBe("11000000");
    const t = addTransaction(
      s,
      {
        ...payment,
        billId: "bill",
        loanPayment: { ...payment.loanPayment, dueDate: "2026-10-25" },
      },
      at,
    );
    expect(dashboard(s, "2026-10-21").billsMinor).toBe("0");
    expect(t.amountMinor).toBe("11000000");
    expect(dashboard(s, "2026-10-21").availableMinor).toBe("1989000000");
  });
});
describe("monthly COP and UVR calculator", () => {
  it("compares identical budgets and keeps scenarios separate from actual debt", () => {
    const s = setup(),
      before = JSON.stringify(s),
      result = simulateLoan(s, scenario);
    const [base, term, installment] = result.schedules;
    expect(term.monthsSaved).toBeGreaterThan(0);
    expect(BigInt(installment.firstPaymentMinor)).toBeLessThan(
      BigInt(base.firstPaymentMinor),
    );
    expect(BigInt(term.interestMinor)).toBeLessThan(BigInt(base.interestMinor));
    for (const schedule of result.schedules)
      expect(schedule.rows.at(-1)?.closingPrincipal).toBe("0.00");
    expect(JSON.stringify(s)).toBe(before);
  });
  it("handles zero interest and payoff without negative principal or excess abons", () => {
    const s = setup();
    s.loans[0].ratePercent = "0";
    s.loans[0].insuranceMinor = "0";
    const result = simulateLoan(s, { ...scenario, extraMinor: "2000000000" });
    expect(result.schedules[1].rows).toHaveLength(1);
    expect(result.schedules[1].totalMinor).toBe("1000000000");
    expect(result.schedules[1].interestMinor).toBe("0");
  });
  it("uses the same inflation path for all UVR alternatives and needs subsidy end dates", () => {
    const s = setup("UVR");
    const low = simulateLoan(s, { ...scenario, inflationPercent: "0" }),
      high = simulateLoan(s, { ...scenario, inflationPercent: "8" });
    expect(new Set(high.schedules.map((s) => s.rows[0].uvrValue)).size).toBe(1);
    expect(BigInt(high.schedules[0].totalMinor)).toBeGreaterThan(
      BigInt(low.schedules[0].totalMinor),
    );
    s.loans[0].subsidy = {
      ratePercent: "4",
      convention: "effectiveAnnual",
      startDate: "2026-01-01",
    };
    expect(() => simulateLoan(s, scenario)).toThrow("fin del subsidio");
    s.loans[0].subsidy.endDate = "2026-11-20";
    const rows = simulateLoan(s, scenario).schedules[0].rows;
    expect(BigInt(rows[0].subsidyMinor)).toBeGreaterThan(0n);
    expect(rows[2].subsidyMinor).toBe("0");
  });
  it("requires explicit recurring budget, rejects unsupported terms and invalidates saved scenarios", () => {
    const s = setup();
    expect(() =>
      simulateLoan(s, { ...scenario, recurringMinor: "10000" }),
    ).toThrow("presupuesto");
    const input = {
      ...scenario,
      recurringMinor: "10000",
      recurringStart: "2026-10-20",
      recurringEnd: "2027-10-20",
      monthlyBudgetMinor: "30000000",
    };
    expect(simulateLoan(s, input).schedules[1].monthsSaved).toBeGreaterThan(0);
    saveLoanScenario(s, input, at);
    const signature = loanSignature(s, "loan");
    addTransaction(s, payment, at);
    expect(loanSignature(s, "loan")).not.toBe(signature);
    expect(s.loanScenarios[0].signature).toBe(signature);
    s.loans[0].method = "unsupported";
    expect(() => simulateLoan(s, scenario)).toThrow("motor específico");
  });
  it("blocks simulation when principal distributions are pending", () => {
    const s = setup();
    addTransaction(s, { ...payment, loanPayment: { purpose: "ordinary" } }, at);
    expect(() =>
      simulateLoan(s, {
        ...scenario,
        asOf: "2026-10-01",
        extraDate: "2026-10-20",
      }),
    ).toThrow("pendientes");
  });
});
