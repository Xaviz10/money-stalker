import { expect, it } from "vitest";
import { createAPI } from "../server/api";
import { MemoryRepository, persistedStateItems } from "../server/repository";
import { MemoryFiles } from "../server/storage";
import { addTransaction, configure } from "../domain/ledger";
import { saveLoanTerms } from "../domain/loans";
import { loanMerchantCandidates } from "../domain/merchant-rules";
import type { State } from "../domain/model";

const at = "2026-10-21T18:00:00Z";
const place = { id: "synthetic-place", name: "Oficina de prueba", address: "Bogotá", latitude: 4.6, longitude: -74.1 };
class LimitedRepository extends MemoryRepository {
  largestMutation = 0;
  override async mutate<T>(h: string, fn: (state: State) => T) {
    return super.mutate(h, state => {
      const before = persistedStateItems(state), result = fn(state), after = persistedStateItems(state);
      const actions = [...after].filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before.get(key))).length + 1;
      this.largestMutation = Math.max(this.largestMutation, actions);
      if (actions > 96) throw new Error("Mutation exceeds the repository limit");
      return result;
    });
  }
}
async function setup() {
  const repo = new LimitedRepository(), api = createAPI(repo, new MemoryFiles());
  await repo.mutate("owner", s => {
    for (const [id, kind] of [["bank", "bank"], ["card", "credit"], ["loan", "loan"], ["other-loan", "loan"]])
      configure(s, "accounts", { id, kind, name: id, openingMinor: kind === "bank" ? "100000000" : "0", openingDate: "2026-01-01" });
    saveLoanTerms(s, { id: "loan", denomination: "COP", principal: "1000000", balanceDate: "2026-10-01" }, at);
  });
  return { repo, send: (method: string, path: string, body?: unknown) => api({ method, path, body, subject: "owner" }) };
}
const expense = { kind: "expense", accountId: "bank", merchant: "Pago vivienda", date: "2026-10-10", amountMinor: "100000" };
const changes = { kind: "loan_payment", counterAccountId: "loan", categoryId: "loans-housing", note: "Vivienda", merchant: "Pago corregido", loanPayment: { purpose: "ordinary" } };

it("associates only previewed bank/cash payments, preserves application, evidence and cash, and supports undo", async () => {
  const { repo, send } = await setup();
  await repo.mutate("owner", s => {
    addTransaction(s, { ...expense, id: "selected" }, at);
    addTransaction(s, { ...expense, id: "history", date: "2026-10-09", place }, at);
    addTransaction(s, { ...expense, id: "omitted", date: "2026-10-08" }, at);
    addTransaction(s, { ...expense, id: "card-expense", accountId: "card" }, at);
    addTransaction(s, { ...expense, id: "income", kind: "income" }, at);
    addTransaction(s, { ...expense, id: "refund", kind: "refund" }, at);
    addTransaction(s, { ...expense, id: "withdrawal" }, at);
    addTransaction(s, { ...expense, id: "other", kind: "loan_payment", counterAccountId: "other-loan", loanPayment: { purpose: "term" } }, at);
    s.loanDocuments.push({ id: "doc", loanId: "loan", filename: "synthetic.xlsx", originalKey: "", normalizedKey: "", hash: "synthetic", importedAt: at, comparisonIds: [], status: "confirmed", profile: "mortgage-monthly", terms: {}, rows: [], warnings: [], overlapIds: [] });
    addTransaction(s, { ...expense, id: "confirmed", kind: "loan_payment", counterAccountId: "loan", loanPayment: { purpose: "installment", dueDate: "2026-10-20", documentId: "doc", documentRowIds: ["synthetic-row"], allocation: { principalMinor: "80000", interestMinor: "10000", insuranceMinor: "10000", lateInterestMinor: "0", feesMinor: "0" } } }, at);
    s.observations.push({ id: "evidence", source: "sms", receivedAt: at, observedAt: at, currency: "COP", merchant: "Pago vivienda", kind: "expense", status: "linked", transactionId: "history", parserVersion: "synthetic", candidates: [], location: { latitude: 4.6, longitude: -74.1, accuracy: 20, observedAt: at } });
    s.transactions.find(t => t.id === "history")!.observationIds.push("evidence");
    s.observations.push({ ...s.observations[0], id: "withdrawal-evidence", transactionId: "withdrawal", cashWithdrawal: true });
    s.transactions.find(t => t.id === "withdrawal")!.observationIds.push("withdrawal-evidence");
  });
  const before = await repo.read("owner"), beforeDashboard = (await send("GET", "/dashboard")).body;
  expect(loanMerchantCandidates(before, before.transactions[0], "loan").map(t => t.id)).toEqual(["history", "omitted", "confirmed"]);
  for (const id of ["other", "income", "card-expense", "withdrawal"])
    expect((await send("PATCH", "/transactions/selected", { expectedRevision: 1, changes, applyToSimilar: true, loanAssociations: [{ id, revision: 1 }] })).status).toBe(400);
  const result = await send("PATCH", "/transactions/selected", { expectedRevision: 1, changes, applyToSimilar: true, rememberMerchant: true, loanAssociations: [{ id: "history", revision: 1 }, { id: "confirmed", revision: 1 }] });
  expect(result).toMatchObject({ status: 200, body: { updated: 3 } });
  const after = await repo.read("owner");
  expect(after.transactions.find(t => t.id === "history")).toMatchObject({ counterAccountId: "loan", kind: "loan_payment", loanPayment: { purpose: "unconfirmed" }, place, observationIds: ["evidence"] });
  expect(after.transactions.find(t => t.id === "confirmed")!.loanPayment).toEqual(before.transactions.find(t => t.id === "confirmed")!.loanPayment);
  for (const id of ["omitted", "card-expense", "income", "refund", "other", "withdrawal"])
    expect(after.transactions.find(t => t.id === id)).toEqual(before.transactions.find(t => t.id === id));
  expect(after.observations).toEqual(before.observations);
  expect(after.aliases.find(rule => rule.merchant === "pago vivienda")).toMatchObject({ loanAccountId: "loan", categoryId: "loans-housing", displayMerchant: "Pago corregido" });
  expect((await send("GET", "/dashboard")).body).toMatchObject({ balances: (beforeDashboard as { balances: unknown }).balances });
  expect((await send("POST", "/undo", { auditId: "edit:history:2" })).status).toBe(200);
  expect((await repo.read("owner")).transactions.find(t => t.id === "history")).toMatchObject({ kind: "expense", place, observationIds: ["evidence"] });
});

it("rejects stale or unpreviewed associations before writing and bounds a large merchant to the confirmed batch", async () => {
  const { repo, send } = await setup();
  for (let i = 0; i < 43; i++) await repo.mutate("owner", s => addTransaction(s, { ...expense, id: `pay-${i}`, date: "2026-10-01" }, at));
  const before = await repo.read("owner");
  expect((await send("PATCH", "/transactions/pay-0", { expectedRevision: 1, changes, applyToSimilar: true })).status).toBe(400);
  expect((await send("PATCH", "/transactions/pay-0", { expectedRevision: 1, changes, applyToSimilar: true, loanAssociations: [{ id: "pay-1", revision: 2 }] })).status).toBe(409);
  expect((await repo.read("owner")).transactions).toEqual(before.transactions);
  const preview = Array.from({ length: 20 }, (_, i) => ({ id: `pay-${i + 1}`, revision: 1 }));
  expect((await send("PATCH", "/transactions/pay-0", { expectedRevision: 1, changes, applyToSimilar: true, loanAssociations: preview })).status).toBe(200);
  const after = await repo.read("owner");
  expect(after.transactions.filter(t => t.kind === "loan_payment")).toHaveLength(21);
  expect(after.transactions.filter(t => t.kind === "expense")).toHaveLength(22);
  expect(repo.largestMutation).toBeLessThanOrEqual(96);
});
