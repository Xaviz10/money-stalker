import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { addTransaction, configure, dashboard, duplicateTransactions, recordInvestmentValue, recordStatement, undo } from "../domain/ledger";
import { emptyState, normalizeUnlinkedTransfers } from "../domain/model";
import { netWorthMinor } from "../domain/account-groups";
import { captureJob, processJob } from "../server/processing";
import { MemoryRepository, persistedStateItems } from "../server/repository";
import { MemoryFiles } from "../server/storage";
import { exportRecords, parseImport, profiles } from "../server/imports";

const at = "2026-10-18T18:00:00Z", day = "2026-10-18";
function setup() {
  const state = emptyState();
  configure(state, "accounts", { id: "bank", name: "Ahorros de prueba", kind: "bank", openingMinor: "100000000", openingDate: "2026-01-01" });
  configure(state, "instruments", { id: "debit", name: "Débito", accountId: "bank", aliases: ["1122"] });
  return state;
}
const withdrawal = (suffix = "1122", date = "18/10/2026") => `Bancolombia: Retiraste $100.000,00 en CAJERO EJEMPLO de tu T.Deb **${suffix} el ${date} a las 12:00.`;
async function capture(repo: MemoryRepository, eventId: string, message: string, location = false) {
  const job = captureJob("owner", "phone", { eventId, source: "sms", observedAt: at, message,
    ...(location ? { location: { latitude: 4, longitude: -74, accuracy: 30, observedAt: at } } : {}),
  }, at);
  await repo.putJob(job);
  await processJob(repo, new MemoryFiles(), "owner", job.id);
  return job;
}

describe("cash withdrawals", () => {
  it("creates cash once, transfers the balance without spending, retains location and supports undo", async () => {
    const repo = new MemoryRepository(); repo.states.set("owner", setup());
    const job = await capture(repo, "withdrawal", withdrawal(), true);
    await processJob(repo, new MemoryFiles(), "owner", job.id);
    const state = await repo.read("owner");
    const summary = dashboard(state, day);
    expect(summary.balances).toMatchObject({ bank: "90000000", "cash:auto": "10000000" });
    expect(summary.availableMinor).toBe("100000000");
    expect(summary.spendingMinor).toBe("0");
    expect(state.transactions).toHaveLength(1);
    expect(state.observations[0]).toMatchObject({ status: "linked", kind: "transfer", location: { accuracy: 30 } });
    const audit = state.audit.find(item => item.action === "auto-withdrawal")!;
    undo(state, audit.id, at);
    expect(dashboard(state, day).balances).toMatchObject({ bank: "100000000", "cash:auto": "0" });
    expect(state.observations[0].status).toBe("review");
  });
  it("keeps repeated captures with different event IDs for review instead of counting a possible duplicate twice", async () => {
    const repo = new MemoryRepository(); repo.states.set("owner", setup());
    await capture(repo, "first", withdrawal());
    await capture(repo, "second", withdrawal());
    const state = await repo.read("owner");
    expect(state.transactions).toHaveLength(1);
    expect(state.observations[1]).toMatchObject({ status: "review", kind: "transfer", candidates: [state.transactions[0].id] });
    expect(dashboard(state, day).availableMinor).toBe("100000000");
  });
  it("does not auto-post unknown suffixes, historical captures, missing amounts, or ambiguous cash destinations", async () => {
    const repo = new MemoryRepository(); const state = setup(); repo.states.set("owner", state);
    await capture(repo, "unknown", withdrawal("3344"));
    await capture(repo, "history", withdrawal("1122", "18/10/2025"));
    await capture(repo, "missing-value", withdrawal().replace("$100.000,00", "$1.000,000.50"));
    expect((await repo.read("owner")).transactions).toHaveLength(0);
    for (const id of ["cash-a", "cash-b"]) configure(state, "accounts", { id, name: id, kind: "cash", openingMinor: "0", openingDate: "2026-01-01" });
    repo.states.set("owner", state);
    await capture(repo, "ambiguous", withdrawal());
    const result = await repo.read("owner"); normalizeUnlinkedTransfers(result);
    expect(result.transactions).toHaveLength(0);
    expect(result.observations[0]).toMatchObject({ kind: "transfer", status: "review" });
    configure(result, "settings", { ...result.settings, cashAccountId: "cash-b" }); repo.states.set("owner", result);
    await capture(repo, "configured", withdrawal());
    expect((await repo.read("owner")).transactions[0].counterAccountId).toBe("cash-b");
  });
  it("classifies ATM statement rows as transfers and matches prior SMS movements without merging equal rows in the file", async () => {
    const repo = new MemoryRepository(); repo.states.set("owner", setup());
    await capture(repo, "atm", withdrawal());
    const state = await repo.read("owner");
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ["DESDE", "HASTA"], ["2026/10/01", "2026/10/31"],
      ["FECHA", "DESCRIPCIÓN", "SUCURSAL", "DCTO.", "VALOR", "SALDO"],
      ["18/10", "RETIRO CAJERO EJEMPLO", "", "", "-100,000.00", "900,000.00"],
      ["18/10", "RETIRO CAJERO EJEMPLO", "", "", "-100,000.00", "800,000.00"],
    ]), "Table1");
    const rows = parseImport(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), "statement.xlsx", "bank", "auto", at, profiles, state.accounts).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.status === "accepted")).toBe(true);
    expect(rows[0].observation).toMatchObject({ kind: "transfer", counterAccountId: "cash:auto", cashWithdrawal: true });
    expect(rows[0].observation?.id).not.toBe(rows[1].observation?.id);
    expect(duplicateTransactions(state, rows[0].observation as Parameters<typeof duplicateTransactions>[1])).toHaveLength(1);
    const fresh = setup();
    recordStatement(fresh, rows[0].observation!, at);
    expect(dashboard(fresh, day).balances).toMatchObject({ bank: "90000000", "cash:auto": "10000000" });
  });
});

describe("SMS transfers to owned products", () => {
  it("automatically transfers to a pocket suffix or an exact investment name, preserving bank, available and product balances", async () => {
    const state = setup();
    configure(state, "accounts", { id: "pocket", name: "Viaje", kind: "pocket", openingMinor: "0", openingDate: "2026-01-01", captureAliases: ["3344"] });
    configure(state, "accounts", { id: "invest", name: "Fondo de prueba", kind: "investment", openingMinor: "0", openingDate: "2026-01-01" });
    const repo = new MemoryRepository(); repo.states.set("owner", state);
    const pocket = await capture(repo, "pocket-transfer", "Bancolombia: Transferiste $200.000,00 desde tu cuenta *1122 a tu bolsillo *3344 el 18/10/2026 a las 12:00.", true);
    await processJob(repo, new MemoryFiles(), "owner", pocket.id);
    await capture(repo, "investment-transfer", "Bancolombia: Transferiste $300.000,00 desde tu cuenta *1122 a Fondo de prueba el 18/10/2026 a las 12:05.");
    const result = await repo.read("owner");
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.map(transaction => transaction.kind)).toEqual(["transfer", "transfer"]);
    expect(dashboard(result, day)).toMatchObject({ availableMinor: "50000000", pocketsMinor: "20000000", investmentsMinor: "30000000", spendingMinor: "0", incomeMinor: "0", balances: { bank: "50000000" } });
    expect(result.observations.every(observation => observation.status === "linked")).toBe(true);
    expect(result.observations[0].location).toBeDefined();
    expect(result.audit.filter(entry => entry.action === "auto-product-transfer")).toHaveLength(2);
    undo(result, result.audit.filter(entry => entry.action === "auto-product-transfer")[0].id, at);
    expect(dashboard(result, day)).toMatchObject({ availableMinor: "70000000", pocketsMinor: "0" });
  });
  it("leaves conflicting values, unknown aliases and potential prior expenses in review", async () => {
    const state = setup();
    configure(state, "accounts", { id: "invest", name: "Fondo", kind: "investment", openingMinor: "0", openingDate: "2026-01-01", captureAliases: ["5566"] });
    const repo = new MemoryRepository(); repo.states.set("owner", state);
    const message = "Bancolombia: Transferiste $100.000,00 desde tu cuenta *1122 a inversión *5566 el 18/10/2026 a las 12:00.";
    const mismatch = captureJob("owner", "phone", { eventId: "conflict", source: "sms", message, observedAt: at, amountMinor: "20000000" }, at);
    await repo.putJob(mismatch); await processJob(repo, new MemoryFiles(), "owner", mismatch.id);
    await capture(repo, "unconfigured", message.replace("5566", "7788"));
    let result = await repo.read("owner");
    expect(result.transactions).toHaveLength(0);
    expect(result.observations.every(observation => observation.status === "review")).toBe(true);
    addTransaction(result, { id: "old-expense", accountId: "bank", amountMinor: "10000000", kind: "expense", date: day, merchant: "Movimiento anterior por comprobar" }, at);
    repo.states.set("owner", result);
    await capture(repo, "prior", message);
    result = await repo.read("owner");
    expect(result.transactions).toHaveLength(1);
    expect(result.observations.at(-1)?.reason).toContain("Existe un gasto");
    expect(() => configure(result, "accounts", { id: "other", name: "Otro bolsillo", kind: "pocket", openingMinor: "0", openingDate: "2026-01-01", captureAliases: ["5566"] })).toThrow(/alias/);
    expect(() => configure(result, "accounts", { id: "full-number", name: "Otro", kind: "pocket", openingMinor: "0", openingDate: "2026-01-01", captureAliases: ["000000000000"] })).toThrow();
  });
});

describe("pockets and investments", () => {
  it("does not automatically register structured Wallet transfers to owned pockets or investments", async () => {
    const state = setup();
    for (const kind of ["pocket", "investment"]) configure(state, "accounts", { id: kind, name: kind, kind, openingMinor: "0", openingDate: "2026-01-01" });
    const repo = new MemoryRepository(); repo.states.set("owner", state);
    for (const destination of ["pocket", "investment"]) {
      const job = captureJob("owner", "phone", { eventId: `wallet-${destination}`, source: "wallet", observedAt: at, date: day, accountId: "bank", counterAccountId: destination, amountMinor: "1000000", kind: "transfer", merchant: "Transferencia por revisar" }, at);
      await repo.putJob(job); await processJob(repo, new MemoryFiles(), "owner", job.id);
    }
    const result = await repo.read("owner");
    expect(result.transactions).toHaveLength(0);
    expect(result.observations).toHaveLength(2);
    expect(result.observations.every(observation => observation.status === "review")).toBe(true);
    expect(dashboard(result, day).balances).toMatchObject({ bank: "100000000", pocket: "0", investment: "0" });
  });

  it("keeps reserved products out of available money and includes new cash income", () => {
    const state = setup();
    for (const kind of ["pocket", "investment", "cash"]) configure(state, "accounts", { id: kind, name: kind, kind, openingMinor: "0", openingDate: "2026-01-01", eligible: true });
    for (const [destination, amountMinor] of [["pocket", "20000000"], ["investment", "30000000"]]) addTransaction(state, { id: destination, kind: "transfer", date: day, accountId: "bank", counterAccountId: destination, amountMinor }, at);
    addTransaction(state, { id: "cash-gift", kind: "income", date: day, accountId: "cash", amountMinor: "1000000", merchant: "Regalo" }, at);
    const summary = dashboard(state, day);
    expect(summary).toMatchObject({ availableMinor: "51000000", cashMinor: "1000000", pocketsMinor: "20000000", investmentsMinor: "30000000", spendingMinor: "0", incomeMinor: "1000000" });
    expect(netWorthMinor(state.accounts, summary.balances)).toBe("101000000");
    expect(state.accounts.find(account => account.id === "pocket")?.eligible).toBe(false);
    addTransaction(state, { id: "release", kind: "transfer", date: day, accountId: "pocket", counterAccountId: "bank", amountMinor: "5000000" }, at);
    expect(dashboard(state, day).availableMinor).toBe("56000000");
  });
  it("tracks declared gains and losses separately from contributions, withdrawals, cash and expense reports", () => {
    const state = setup(); configure(state, "accounts", { id: "invest", name: "Fondo", kind: "investment", openingMinor: "0", openingDate: "2026-01-01" });
    addTransaction(state, { id: "contribution", kind: "transfer", date: day, accountId: "bank", counterAccountId: "invest", amountMinor: "20000000" }, at);
    const first = recordInvestmentValue(state, { id: "v1", accountId: "invest", date: day, valueMinor: "23000000" }, at);
    expect(first.adjustmentMinor).toBe("3000000");
    expect(dashboard(state, day)).toMatchObject({ availableMinor: "80000000", investmentsMinor: "23000000", incomeMinor: "0", spendingMinor: "0" });
    addTransaction(state, { id: "more", kind: "transfer", date: day, accountId: "bank", counterAccountId: "invest", amountMinor: "5000000" }, at);
    const second = recordInvestmentValue(state, { id: "v2", accountId: "invest", date: day, valueMinor: "24000000", note: "Valor del extracto" }, at);
    expect(second.beforeMinor).toBe("28000000"); expect(second.adjustmentMinor).toBe("-4000000");
    expect(dashboard(state, day)).toMatchObject({ availableMinor: "75000000", investmentsMinor: "24000000", incomeMinor: "0", spendingMinor: "0" });
    // Storage order is not chronological; sequence must determine which undo is safe.
    state.valuations.reverse();
    expect(() => undo(state, "valuation:v1", at)).toThrow(/más reciente/);
    undo(state, "valuation:v2", at);
    expect(dashboard(state, day).investmentsMinor).toBe("28000000");
    expect(persistedStateItems(state).has("valuations#v2")).toBe(true);
    expect(exportRecords(state, "csv", "invest").bytes.toString()).toContain("valoracion");
    const exported = XLSX.read(exportRecords(state, "xlsx", "invest").bytes);
    expect(exported.SheetNames).toContain("Valoraciones");
  });
  it("validates valuation dates and products, permits total losses, and preserves retry idempotency", () => {
    const state = setup(); configure(state, "accounts", { id: "invest", name: "Fondo", kind: "investment", openingMinor: "1000000", openingDate: "2026-01-01" });
    expect(() => recordInvestmentValue(state, { id: "bank-v", accountId: "bank", date: day, valueMinor: "0" }, at)).toThrow(/inversión/);
    expect(() => recordInvestmentValue(state, { id: "future", accountId: "invest", date: "2026-10-19", valueMinor: "0" }, at)).toThrow(/fecha/);
    const input = { id: "loss", accountId: "invest", date: day, valueMinor: "0" };
    recordInvestmentValue(state, input, at); recordInvestmentValue(state, input, at);
    expect(state.valuations).toHaveLength(1); expect(dashboard(state, day).investmentsMinor).toBe("0");
    expect(() => recordInvestmentValue(state, { ...input, valueMinor: "1" }, at)).toThrow(/Identificador/);
    expect(() => recordInvestmentValue(state, { id: "older", accountId: "invest", date: "2026-10-17", valueMinor: "0" }, at)).toThrow(/orden/);
    expect(() => configure(state, "accounts", { ...state.accounts.find(account => account.id === "invest"), openingMinor: "20" })).toThrow(/saldo inicial/);
  });
});
