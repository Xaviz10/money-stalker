import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import {
  exportRecords,
  parseImport,
  profiles,
  safeCell,
} from "../server/imports";
import { addTransaction, configure, ingest } from "../domain/ledger";
import { emptyState } from "../domain/model";
const now = "2026-10-17T18:00:00Z";
const fixture = readFileSync("tests/fixtures/interchange.csv");
const parse = (bytes: Uint8Array = fixture, name = "test.csv") =>
  parseImport(bytes, name, "bank", "cop-interchange-v1", now);
describe("CSV/XLSX parsing", () => {
  it("retains row multiplicity and exact Colombian amounts", () => {
    const result = parse();
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].observation?.amountMinor).toBe("1250000");
    expect(result.rows[1].observation?.id).not.toBe(
      result.rows[0].observation?.id,
    );
    expect(result.rows[0].observation?.merchant).toBe("Café de ejemplo");
  });
  it("infers opposite signed flows for bank accounts and credit cards", () => {
    const bytes = Buffer.from(
      "Fecha;Descripcion;Valor;Moneda;Tipo\n" +
        "2026-10-01;Movimiento positivo;25.000,00;COP;\n" +
        "2026-10-02;Movimiento negativo;-10.000,00;COP;",
    );
    const bank = {
      id: "bank",
      name: "Ahorros",
      kind: "bank" as const,
      openingMinor: "0",
      openingDate: "2026-01-01",
      eligible: true,
    };
    const card = {
      id: "card",
      name: "Visa",
      kind: "credit" as const,
      openingMinor: "0",
      openingDate: "2026-01-01",
      eligible: false,
    };
    const bankRows = parseImport(
      bytes,
      "bank.csv",
      bank.id,
      "cop-interchange-v1",
      now,
      profiles,
      [bank, card],
    ).rows;
    const cardRows = parseImport(
      bytes,
      "card.csv",
      card.id,
      "cop-interchange-v1",
      now,
      profiles,
      [bank, card],
    ).rows;
    expect(bankRows.map((row) => row.observation?.kind)).toEqual([
      "income",
      "expense",
    ]);
    expect(cardRows.map((row) => row.observation?.kind)).toEqual([
      "expense",
      "refund",
    ]);
    expect(cardRows.map((row) => row.observation?.amountMinor)).toEqual([
      "2500000",
      "1000000",
    ]);
  });
  it("uses an explicit transaction type before the amount sign", () => {
    const result = parse(
      Buffer.from(
        "Fecha;Descripcion;Valor;Moneda;Tipo\n2026-10-01;Abono manual;-25.000,00;COP;ingreso",
      ),
      "typed.csv",
    );
    expect(result.rows[0].observation).toMatchObject({
      kind: "income",
      amountMinor: "2500000",
    });
  });
  it("skips known headers and blank lines without dropping unknown totals", () => {
    const result = parse(
      Buffer.from(
        "Reporte sintético\n\n" + fixture.toString() + "\nTotal;;;;\n",
      ),
    );
    expect(result.rows).toHaveLength(4);
    expect(result.rows.at(-1)?.status).toBe("rejected");
    expect(result.skippedRows.length).toBeGreaterThan(1);
  });
  it("rejects unsupported currencies, dates, and ambiguous decimals", () => {
    const result = parse(
      Buffer.from(
        "Fecha;Descripcion;Valor;Moneda;Tipo\n2026-02-30;A;5.000;COP;gasto\n2026-10-01;B;20;USD;gasto\n2026-10-01;C;12.34;COP;gasto",
      ),
    );
    expect(result.rows.every((r) => r.status === "rejected")).toBe(true);
  });
  it("does not guess unknown profiles or accept PDF/multiple sheets", () => {
    expect(() => parse(Buffer.from("día,monto\n10,20"))).toThrow(/Encabezados/);
    expect(() => parse(fixture, "statement.pdf")).toThrow(/CSV/);
    expect(() =>
      parseImport(fixture, "test.csv", "bank", "unverified-bank", now),
    ).toThrow(/verificado/);
    const b = XLSX.utils.book_new();
    for (const name of ["One", "Two"])
      XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet([["a"]]), name);
    expect(() =>
      parse(XLSX.write(b, { type: "buffer", bookType: "xlsx" }), "test.xlsx"),
    ).toThrow(/sola hoja/);
  });
  it("parses Excel values and rejects formula rows without evaluation", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Fecha", "Descripcion", "Valor", "Moneda", "Tipo"],
      ["2026-10-01", "Café", 12500.25, "COP", "gasto"],
      ["2026-10-02", "Formula", 30, "COP", "gasto"],
    ]);
    sheet.C3 = { t: "n", v: 30, f: "10+20" };
    const b = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(b, sheet, "Movimientos");
    const result = parse(
      XLSX.write(b, { type: "buffer", bookType: "xlsx" }),
      "test.xlsx",
    );
    expect(result.rows[0].observation?.amountMinor).toBe("1250025");
    expect(result.rows[1].error).toMatch(/fórmulas/);
  });
  it("bounds rows and rejects unsafe file sizes", () => {
    expect(() => parse(new Uint8Array(5 * 1024 * 1024 + 1))).toThrow(/5 MB/);
    expect(() =>
      parse(
        Buffer.from(
          "Fecha;Descripcion;Valor;Moneda;Tipo\n" +
            "2026-10-01;A;1;COP;gasto\n".repeat(5001),
        ),
      ),
    ).toThrow(/5.000/);
  });
  it("namespace identities by account and never trusts reference text in interchange files", () => {
    const a = parse();
    const b = parseImport(
      fixture,
      "test.csv",
      "other",
      "cop-interchange-v1",
      now,
    );
    expect(a.rows[0].observation?.id).not.toBe(b.rows[0].observation?.id);
  });
  it("detects the verified Bancolombia quarterly savings format across repeated pages", () => {
    const rows = [
      ["Información General:"],
      ["DESDE", "HASTA", "TIPO CUENTA", "NRO CUENTA"],
      ["2025/06/30", "2025/09/30", "CUENTA DE AHORROS", "00000000000"],
      [],
      ["Movimientos:"],
      ["FECHA", "DESCRIPCIÓN", "SUCURSAL", "DCTO.", "VALOR", "SALDO"],
      ["1/07", "ABONO INTERESES AHORROS", "", "", "10.00", "1,000,010.00"],
      ["1/07", "TRANSFERENCIA A NEQUI", "", "", "-20,000.00", "980,010.00"],
      ["Información Cliente:"],
      ["DESDE", "HASTA", "TIPO CUENTA", "NRO CUENTA"],
      ["2025/06/30", "2025/09/30", "CUENTA DE AHORROS", "00000000000"],
      ["FECHA", "DESCRIPCIÓN", "SUCURSAL", "DCTO.", "VALOR", "SALDO"],
      ["31/07", "PAGO SUC VIRT TC VISA", "", "", "-300,000.00", "680,010.00"],
      [
        "30/09",
        "PAGO DE NOMI EJEMPLO SAS",
        "",
        "",
        "1,500,000.00",
        "2,180,010.00",
      ],
      ["", "FIN ESTADO DE CUENTA"],
    ];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Table1");
    const bytes = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    const accounts = [
      {
        id: "bank",
        name: "Ahorros",
        institution: "Bancolombia",
        kind: "bank" as const,
        openingMinor: "0",
        openingDate: "2025-01-01",
        eligible: true,
      },
      {
        id: "nequi",
        name: "Nequi",
        kind: "bank" as const,
        openingMinor: "0",
        openingDate: "2025-01-01",
        eligible: true,
      },
      {
        id: "visa",
        name: "Visa crédito",
        kind: "credit" as const,
        openingMinor: "0",
        openingDate: "2025-01-01",
        eligible: false,
      },
    ];
    const result = parseImport(
      bytes,
      "extracto.xlsx",
      "bank",
      "auto",
      now,
      profiles,
      accounts,
    );
    expect(result.profile).toBe("bancolombia-savings-quarterly-v1");
    expect(result.rows).toHaveLength(4);
    expect(result.rows.every((row) => row.status === "accepted")).toBe(true);
    expect(result.rows.map((row) => row.observation?.date)).toEqual([
      "2025-07-01",
      "2025-07-01",
      "2025-07-31",
      "2025-09-30",
    ]);
    expect(result.rows[0].observation?.amountMinor).toBe("1000");
    expect(result.rows[1].observation).toMatchObject({
      kind: "transfer",
      counterAccountId: "nequi",
      amountMinor: "2000000",
    });
    expect(result.rows[2].observation).toMatchObject({
      kind: "transfer",
      counterAccountId: "visa",
      amountMinor: "30000000",
    });
    expect(result.rows[3].observation).toMatchObject({
      kind: "income",
      amountMinor: "150000000",
    });

    const withoutNequi = parseImport(
      bytes,
      "extracto.xlsx",
      "bank",
      "auto",
      now,
      profiles,
      accounts.filter((account) => account.id !== "nequi"),
    );
    expect(withoutNequi.rows[1].observation).toMatchObject({
      kind: "expense",
      amountMinor: "2000000",
    });
    expect(withoutNequi.rows[1].observation?.counterAccountId).toBeUndefined();
  });
  it("detects Bancolombia Visa purchases and maps card payments back to the linked bank", () => {
    const rows = [
      ["Información de la Tarjeta", "************8645"],
      [],
      ["Movimientos durante el periodo"],
      [
        "Número de autorización",
        "Fecha",
        "Movimientos",
        "Valor Movimiento",
        "Número de cuotas",
        "Valor cuota/abono",
        "Interés mensual (%)",
        "Interés anual (%)",
        "Saldo pendiente",
      ],
      [
        "123456",
        "13/09/2026",
        "TIENDAS ARA",
        "180.389,00",
        "1/1",
        "180.389,00",
        "0,0000",
        "0,0000",
        "0,00",
      ],
      [
        "050077",
        "02/09/2026",
        "ABONO SUCURSAL VIRTUAL",
        "-5.895.956,00",
        "",
        "-5.895.956,00",
        "",
        "",
        "0,00",
      ],
    ];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "PESOS");
    const bytes = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
    const accounts = [
      {
        id: "bank",
        name: "Ahorros",
        kind: "bank" as const,
        openingMinor: "0",
        openingDate: "2026-01-01",
        eligible: true,
      },
      {
        id: "visa",
        name: "Visa",
        kind: "credit" as const,
        openingMinor: "0",
        openingDate: "2026-01-01",
        eligible: false,
        parentAccountId: "bank",
      },
    ];
    const result = parseImport(
      bytes,
      "visa.xlsx",
      "visa",
      "auto",
      now,
      profiles,
      accounts,
    );
    expect(result.profile).toBe("bancolombia-visa-detailed-v1");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].observation).toMatchObject({
      accountId: "visa",
      kind: "expense",
      amountMinor: "18038900",
      date: "2026-09-13",
    });
    expect(result.rows[1].observation).toMatchObject({
      accountId: "bank",
      counterAccountId: "visa",
      kind: "transfer",
      amountMinor: "589595600",
      date: "2026-09-02",
    });
    const state = emptyState();
    for (const account of accounts) configure(state, "accounts", account);
    const cardPayment = result.rows[1].observation!;
    ingest(
      state,
      {
        ...cardPayment,
        id: "bank-statement-payment",
        merchant: "PAGO SUC VIRT TC VISA",
      },
      now,
    );
    ingest(state, cardPayment, now);
    expect(state.transactions).toHaveLength(1);
    expect(state.observations[1]).toMatchObject({
      status: "review",
      candidates: [state.transactions[0].id],
    });
  });
});
describe("safe exports", () => {
  it("scopes product exports to direct and incoming transfer movements", () => {
    const s = emptyState();
    configure(s, "accounts", {
      id: "bank",
      name: "Ahorros",
      kind: "bank",
      openingMinor: "0",
      openingDate: "2026-01-01",
    });
    configure(s, "accounts", {
      id: "wallet",
      name: "Nequi",
      kind: "bank",
      openingMinor: "0",
      openingDate: "2026-01-01",
    });
    addTransaction(
      s,
      {
        id: "bank-expense",
        accountId: "bank",
        date: "2026-10-01",
        kind: "expense",
        amountMinor: "100000",
        merchant: "Compra del banco",
      },
      now,
    );
    addTransaction(
      s,
      {
        id: "wallet-expense",
        accountId: "wallet",
        date: "2026-10-02",
        kind: "expense",
        amountMinor: "200000",
        merchant: "Compra de Nequi",
      },
      now,
    );
    addTransaction(
      s,
      {
        id: "transfer",
        accountId: "bank",
        counterAccountId: "wallet",
        date: "2026-10-03",
        kind: "transfer",
        amountMinor: "300000",
        merchant: "Transferencia a Nequi",
      },
      now,
    );
    const csv = exportRecords(s, "csv", "wallet").bytes.toString();
    expect(csv).toContain("Compra de Nequi");
    expect(csv).toContain("Transferencia a Nequi");
    expect(csv).not.toContain("Compra del banco");
  });

  it("escapes CSV formulas and preserves exact strings in Excel", () => {
    const s = emptyState();
    configure(s, "accounts", {
      id: "bank",
      name: "Ahorros de prueba",
      kind: "bank",
      openingMinor: "10000000",
      openingDate: "2026-01-01",
    });
    const transaction = addTransaction(
      s,
      {
        id: "p",
        accountId: "bank",
        date: "2026-10-01",
        kind: "expense",
        amountMinor: "1250025",
        merchant: '=HYPERLINK("https://invalid")',
        note: "Bogotá",
      },
      now,
    );
    transaction.observationIds.push("wallet:location");
    s.observations.push({
      id: "wallet:location",
      source: "wallet",
      observedAt: now,
      receivedAt: now,
      date: "2026-10-01",
      accountId: "bank",
      amountMinor: "1250025",
      currency: "COP",
      merchant: "Comercio de prueba",
      kind: "expense",
      status: "linked",
      transactionId: "p",
      candidates: [],
      location: {
        latitude: 4.60971,
        longitude: -74.08175,
        accuracy: 24,
        observedAt: now,
      },
      parserVersion: "structured-capture-v1",
    });
    const csv = exportRecords(s, "csv").bytes.toString();
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("12500,25");
    expect(csv).toContain("Bogotá");
    const book = XLSX.read(exportRecords(s, "xlsx").bytes, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(
      book.Sheets.Movimientos,
    );
    expect(rows[0].ValorCOP).toBe("12500,25");
    expect(rows[0].Nota).toBe("Bogotá");
    expect(rows[0].Ubicaciones).toBe(`4.60971,-74.08175 ±24m ${now}`);
    expect(book.SheetNames).toContain("Cuentas");
    expect(safeCell("\t=cmd")).toBe("'\t=cmd");
  });
});
