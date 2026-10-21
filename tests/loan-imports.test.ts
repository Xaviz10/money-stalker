import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseLoanDocument } from "../server/loan-imports";
import { createAPI } from "../server/api";
import { MemoryRepository } from "../server/repository";
import { MemoryFiles } from "../server/storage";
import { configure, addTransaction } from "../domain/ledger";
import { saveLoanTerms } from "../domain/loans";
import { getUvrQuotes, parseSuamecaUvr } from "../server/uvr";
const at = "2026-10-21T18:00:00Z";
function xlsx(rows: unknown[][]) {
  const w = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet(rows), "Extracto");
  return XLSX.write(w, { type: "buffer", bookType: "xlsx" });
}
const monthly = () =>
  xlsx([
    ["Estado de Crédito Hipotecario"],
    ["en: UVR"],
    [
      "Fecha De Pago",
      "Fecha En Que Se Generó El Extracto",
      "Valor A Pagar",
      "Saldo A La Fecha En Que Se Generó El Extracto",
    ],
    ["2026/10/20", "2026/09/30", "1000.00", "999999.99"],
    ["Tasa Interés Pactada:", "10.00"],
    ["Tasa Interés Subsidiada:", "4.00"],
    ["Plan:", "CUOTA CONSTANTE EN UVR"],
    ["Nro. cuotas pendientes para pago total:", "120"],
    ["Saldo de capital en UVR:", "2,000.1234"],
    ["Valor de la unidad UVR a la fecha de pago:", "400.0000"],
    ["*Valor seguro vida:", "10"],
    ["*Valor seguro incendio:", "20"],
    ["*Valor seguro terremoto:", "30"],
    ["Valor comisiones:", "0"],
    [
      "Fecha aplicación",
      "Descripción",
      "Capital",
      "Intereses Corriente",
      "Intereses Mora",
      "Seguros Vida",
      "Seguros Incendio",
      "Seguros Terremoto",
      "Otros Cargos",
      "Total",
    ],
    [
      "2026/09/20",
      "Pago Cuota Anticipado",
      "400.00",
      "0",
      "0",
      "0",
      "0",
      "0",
      "0",
      "400.00",
    ],
    [
      "2026/09/20",
      "Pago Cuota Anticipado",
      "0",
      "540.00",
      "0",
      "10",
      "20",
      "30",
      "0",
      "600.00",
    ],
    [
      "2026/09/20",
      "Beneficio por Cuota Anticipada",
      "1.00",
      "-1.00",
      "0",
      "0",
      "0",
      "0",
      "0",
      "0",
    ],
    ["Observaciones"],
  ]);
const metadata = {
  id: "doc",
  loanId: "loan",
  filename: "synthetic.xlsx",
  originalKey: "original/test.xlsx",
  normalizedKey: "normalized/test.json",
  importedAt: at,
  comparisonIds: [],
};
describe("mortgage document profiles", () => {
  it("reads whitelisted monthly data without confusing total debt, due date or zero-cash adjustments", () => {
    const d = parseLoanDocument(monthly(), metadata);
    expect(d.terms.principal).toBe("2000.1234");
    expect(d.terms.balanceDate).toBe("2026-09-30");
    expect(d.terms.nextPaymentDate).toBe("2026-10-20");
    expect(d.terms.uvrDate).toBeUndefined();
    expect(d.terms.insuranceMinor).toBe("6000");
    expect(d.rows).toHaveLength(3);
    expect(d.rows[2].totalMinor).toBe("0");
    expect(d.rows[2].allocation).toBeUndefined();
    expect(d.rows[0].description).toBe("Pago Cuota Anticipado");
    expect(d.terms.subsidy).toBeUndefined();
    expect(d.terms.subsidyRateHint).toBe("4");
  });
  it("uses protected-employment insurance headings and preserves explicit rounding differences", () => {
    const book = XLSX.read(monthly(), { type: "buffer" });
    const grid = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets.Extracto, {
      header: 1,
    });
    grid[14].splice(8, 0, "Empleado o independiente protegido");
    for (const index of [15, 16, 17])
      grid[index].splice(8, 0, index === 16 ? "5.00" : "0.00");
    grid[16][10] = "605.10";
    const doc = parseLoanDocument(xlsx(grid), metadata);
    expect(doc.rows[1].allocation?.insuranceMinor).toBe("6500");
    expect(doc.rows[1].totalMinor).toBe("60510");
    expect(doc.rows[1].roundingDifferenceMinor).toBe("10");
    expect(doc.warnings.some((w) => w.startsWith("Fila"))).toBe(true);
  });
  it("preserves repeated equal rows and gives reimports stable evidence IDs", () => {
    const raw = XLSX.read(monthly(), { type: "buffer" });
    const grid = XLSX.utils.sheet_to_json<unknown[]>(raw.Sheets.Extracto, {
      header: 1,
    });
    grid.splice(17, 0, grid[15]);
    const d = parseLoanDocument(xlsx(grid), metadata),
      same = parseLoanDocument(xlsx(grid), { ...metadata, id: "other" });
    expect(d.rows).toHaveLength(4);
    expect(new Set(d.rows.map((r) => r.id)).size).toBe(4);
    expect(d.rows.map((r) => r.id)).toEqual(same.rows.map((r) => r.id));
  });
  it("keeps annual history, forecast and subsidy separate with Colombian decimal conventions", () => {
    const d = parseLoanDocument(
      xlsx([
        ["Comportamiento del crédito hipotecario en el año 2025"],
        ["Valores en UVR"],
        [
          "20/12/2025",
          "2.000,0000",
          "0,0000",
          "10,0000",
          "5,0000",
          "1.995,0000",
          "800.000,00",
          "0,00",
          "60,00",
          "0,00",
          "4.000,00",
          "2.000,00",
          "798.000,00",
        ],
        ["Proyección de pagos del crédito hipotecario en el año 2026"],
        [
          "44",
          "20/01/2026",
          "400,0000",
          "1.995,0000",
          "10,0000",
          "5,0000",
          "1.990,0000",
          "798.000,00",
          "60,00",
          "0,00",
          "4.000,00",
          "2.000,00",
          "796.000,00",
        ],
        ["Información del subsidio del gobierno del crédito hipotecario"],
        ["Enero", "400,0000", "5,0000", "15,0000", "2.000,00", "6.000,00"],
      ]),
      metadata,
    );
    expect(d.rows.map((r) => r.section)).toEqual([
      "history",
      "projection",
      "subsidy",
    ]);
    expect(d.rows[0].principal).toBe("5");
    expect(d.rows[0].allocation?.principalMinor).toBe("200000");
    expect(d.rows[1].date).toBe("2026-01-20");
    expect(d.rows[1].principal).toBe("5");
  });
});
describe("loan import API", () => {
  async function setup() {
    const repo = new MemoryRepository(),
      files = new MemoryFiles(),
      api = createAPI(repo, files);
    const call = (
      method: string,
      path: string,
      body?: unknown,
      subject = "owner",
    ) => api({ method, path, body, subject });
    await repo.mutate("owner", (s) => {
      configure(s, "accounts", {
        id: "bank",
        name: "Ahorros",
        kind: "bank",
        openingMinor: "1000000",
        openingDate: "2026-01-01",
      });
      configure(s, "accounts", {
        id: "loan",
        name: "Hipoteca",
        kind: "loan",
        openingMinor: "0",
        openingDate: "2026-01-01",
      });
      saveLoanTerms(
        s,
        {
          id: "loan",
          denomination: "UVR",
          principal: "2500",
          balanceDate: "2026-08-31",
          uvrValue: "400",
          uvrDate: "2026-08-31",
        },
        at,
      );
      addTransaction(
        s,
        {
          id: "payment",
          accountId: "bank",
          kind: "expense",
          amountMinor: "100000",
          date: "2026-09-20",
          categoryId: "loans-housing",
          merchant: "Hipoteca",
        },
        at,
      );
    });
    const created = (
      await call("POST", "/loans/imports", {
        loanId: "loan",
        filename: "sample.xlsx",
      })
    ).body as { id: string; upload: { fields: { key: string } } };
    await files.put(created.upload.fields.key, monthly());
    const preview = await call(
      "POST",
      `/loans/imports/${created.id}/preview`,
      {},
    );
    return {
      repo,
      files,
      call,
      doc: preview.body as ReturnType<typeof parseLoanDocument>,
    };
  }
  it("confirms evidence without creating cash movements and reconciles several components into one payment", async () => {
    const { repo, call, doc } = await setup();
    expect(doc.profile).toBe("mortgage-monthly");
    expect(
      (await call("POST", `/loans/documents/${doc.id}/confirm`, {})).status,
    ).toBe(200);
    expect((await repo.read("owner")).transactions).toHaveLength(1);
    const response = await call(
      "POST",
      `/loans/documents/${doc.id}/reconcile`,
      {
        transactionId: "payment",
        expectedRevision: 1,
        rowIds: doc.rows.slice(0, 2).map((r) => r.id),
        purpose: "ordinary",
        principalUnits: "1",
        uvrValue: "400",
      },
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const retry = await call("POST", `/loans/documents/${doc.id}/reconcile`, {
      transactionId: "payment",
      expectedRevision: 1,
      rowIds: doc.rows.slice(0, 2).map((r) => r.id),
      purpose: "ordinary",
      principalUnits: "1",
      uvrValue: "400",
    });
    expect(retry.status).toBe(200);
    const s = await repo.read("owner");
    expect(s.transactions).toHaveLength(1);
    expect(s.transactions[0].loanPayment?.allocation?.principalMinor).toBe(
      "40000",
    );
    expect(s.transactions[0].loanPayment?.allocation?.insuranceMinor).toBe(
      "6000",
    );
    expect(
      (await call("GET", `/loans/documents/${doc.id}`, undefined, "other"))
        .status,
    ).toBe(404);
  });
  it("rejects future projection rows, repeated selections, conflicting revisions and post-upload candidates", async () => {
    const { repo, files, call, doc } = await setup();
    await call("POST", `/loans/documents/${doc.id}/confirm`, {});
    const payload = {
      transactionId: "payment",
      expectedRevision: 1,
      rowIds: [doc.rows[0].id, doc.rows[0].id],
      purpose: "ordinary",
    };
    expect(
      (await call("POST", `/loans/documents/${doc.id}/reconcile`, payload))
        .status,
    ).toBe(400);
    await repo.mutate("owner", (s) =>
      addTransaction(
        s,
        {
          id: "late",
          accountId: "bank",
          kind: "expense",
          amountMinor: "100000",
          date: "2026-09-20",
        },
        at,
      ),
    );
    expect(
      (
        await call("POST", `/loans/documents/${doc.id}/reconcile`, {
          ...payload,
          transactionId: "late",
          rowIds: [doc.rows[0].id],
        })
      ).status,
    ).toBe(400);
    const detail = (await call("GET", `/loans/documents/${doc.id}`)).body as {
      candidates: { id: string }[];
    };
    expect(detail.candidates.map((t) => t.id)).toEqual(["payment"]);
    await files.put(
      doc.normalizedKey,
      Buffer.from(
        JSON.stringify({
          ...doc,
          rows: doc.rows.map((row) => ({ ...row, section: "projection" })),
        }),
      ),
    );
    expect(
      (
        await call("POST", `/loans/documents/${doc.id}/reconcile`, {
          ...payload,
          rowIds: [doc.rows[0].id],
        })
      ).status,
    ).toBe(400);
  });
});
describe("official UVR cache", () => {
  it("selects peso-per-UVR levels and retains dated quotes when refresh fails", async () => {
    expect(
      parseSuamecaUvr(
        [
          {
            id: 850,
            unidad: "Pesos colombianos por UVR",
            data: [[Date.parse("2026-01-01T05:00:00Z"), 400.1234]],
          },
        ],
        at,
      ),
    ).toHaveLength(1);
    const files = new MemoryFiles();
    const response = await getUvrQuotes(
      files,
      "2026-01-01",
      "2026-01-01",
      at,
      async () =>
        new Response(
          JSON.stringify([
            {
              id: 850,
              unidad: "Pesos colombianos por UVR",
              data: [[Date.parse("2026-01-01T05:00:00Z"), 400.1234]],
            },
          ]),
        ),
    );
    expect(response.quotes[0].value).toBe("400.1234");
    const stale = await getUvrQuotes(
      files,
      "2026-01-01",
      "2026-01-01",
      "2026-10-23T18:00:00Z",
      async () => {
        throw new Error("Offline");
      },
    );
    expect(stale.stale).toBe(true);
    expect(stale.quotes[0].date).toBe("2026-01-01");
    expect(
      (
        await getUvrQuotes(files, "2026-01-02", "2026-01-02", at, async () => {
          throw new Error("Offline");
        })
      ).quotes,
    ).toEqual([]);
  });
});
