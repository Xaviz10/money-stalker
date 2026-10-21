import * as XLSX from "xlsx";
import { createHash } from "node:crypto";
import { DomainError } from "../domain/model";
import { loanDecimal as D, nativeMinor } from "../domain/loans";
import type { LoanDocument, LoanDocumentRow } from "../domain/loan-model";
import { MAX_FILE_BYTES, MAX_ROWS } from "./imports";
const hash = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const norm = (v: unknown) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
const number = (v: unknown, spanish = false) => {
  const s = String(v ?? "0")
    .trim()
    .replace(/\s/g, "");
  const normalized = spanish
    ? s.replace(/\./g, "").replace(",", ".")
    : s.replace(/,/g, "");
  if (!/^-?\d{1,17}(\.\d{1,8})?$/.test(normalized))
    throw new DomainError(
      "El documento contiene un valor numérico no reconocido",
    );
  return new D(normalized).toFixed();
};
const financialDate = (v: unknown): string | undefined => {
  const raw = String(v ?? "").trim();
  const ymd = raw.match(/^(\d{4})[/-](\d{2})[/-](\d{2})$/),
    dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const value = ymd
    ? `${ymd[1]}-${ymd[2]}-${ymd[3]}`
    : dmy
      ? `${dmy[3]}-${dmy[2]}-${dmy[1]}`
      : undefined;
  return value &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
    ? value
    : undefined;
};
export function parseLoanDocument(
  bytes: Uint8Array,
  metadata: Pick<
    LoanDocument,
    | "id"
    | "loanId"
    | "filename"
    | "originalKey"
    | "normalizedKey"
    | "importedAt"
    | "comparisonIds"
  >,
): LoanDocument {
  if (bytes.byteLength > MAX_FILE_BYTES)
    throw new DomainError("El archivo supera 5 MiB", 413);
  const book = XLSX.read(bytes, {
    type: "array",
    cellFormula: false,
    cellHTML: false,
    sheetRows: MAX_ROWS + 1,
  });
  const grid = XLSX.utils.sheet_to_json<unknown[]>(
    book.Sheets[book.SheetNames[0]],
    { header: 1, raw: false, defval: "" },
  );
  if (grid.length > MAX_ROWS)
    throw new DomainError("El documento supera 5.000 filas", 413);
  const monthly = grid.some(
    (row) => norm(row[0]) === "estado de credito hipotecario",
  );
  const annual = grid.some((row) =>
    /proyeccion de pagos del credito hipotecario/.test(norm(row[0])),
  );
  if (!monthly && !annual)
    throw new DomainError(
      "Formato hipotecario no reconocido: usa XLSX de Bancolombia",
    );
  const doc: LoanDocument = {
    ...metadata,
    hash: hash(bytes),
    status: "preview",
    profile: monthly ? "mortgage-monthly" : "mortgage-annual",
    terms: {},
    rows: [],
    warnings: [],
    overlapIds: [],
  };
  const get = (label: RegExp) =>
    grid.find((row) => label.test(norm(row[0])))?.[1];
  const occurrences = new Map<string, number>();
  const add = (row: Omit<LoanDocumentRow, "id" | "signature">) => {
    const signature = hash(JSON.stringify({ ...row, row: undefined })),
      count = (occurrences.get(signature) ?? 0) + 1;
    occurrences.set(signature, count);
    doc.rows.push({
      ...row,
      signature,
      id: `lr:${hash(metadata.loanId).slice(0, 12)}:${signature.slice(0, 32)}:${count}`,
    });
  };
  if (monthly) {
    doc.terms.denomination = grid.some((row) => /^en:.*uvr/.test(norm(row[0])))
      ? "UVR"
      : "COP";
    const summaryIndex = grid.findIndex(
      (row) => norm(row[0]) === "fecha de pago",
    );
    if (summaryIndex >= 0) {
      const summary = grid[summaryIndex + 1];
      doc.terms.nextPaymentDate = financialDate(summary?.[0]);
      doc.terms.balanceDate = financialDate(summary?.[1]);
      doc.period = doc.terms.balanceDate?.slice(0, 7);
      if (summary?.[2])
        doc.terms.nextDueMinor = nativeMinor(number(summary[2]));
    }
    const principal = get(/^saldo de capital en uvr/);
    if (principal !== undefined && doc.terms.denomination === "UVR")
      doc.terms.principal = number(principal);
    // The total balance explicitly includes interest/insurance. Never treat it as principal.
    if (doc.terms.denomination === "COP") {
      const pesoPrincipal = get(/^saldo de capital(?: en pesos)?:/);
      if (pesoPrincipal !== undefined)
        doc.terms.principal = number(pesoPrincipal);
    }
    const quote = get(/^valor de la unidad uvr/);
    if (quote !== undefined) doc.terms.uvrValue = number(quote);
    const rate = get(/^tasa interes pactada/);
    if (rate !== undefined) doc.terms.ratePercent = number(rate);
    const remaining = get(/^nro\. cuotas pendientes/);
    if (remaining !== undefined)
      doc.terms.remainingMonths = Number(number(remaining));
    const insurance = [
      /^\*?valor seguro vida/,
      /^\*?valor seguro incendio/,
      /^\*?valor seguro terremoto/,
    ].map((re) => get(re));
    if (insurance.every((x) => x !== undefined))
      doc.terms.insuranceMinor = nativeMinor(
        insurance.reduce<InstanceType<typeof D>>(
          (sum, v) => sum.plus(number(v)),
          new D(0),
        ),
      );
    const fees = get(/^valor comisiones/);
    if (fees !== undefined) doc.terms.feesMinor = nativeMinor(number(fees));
    const plan = norm(get(/^plan:/));
    doc.terms.method = /cuota constante/.test(plan)
      ? "constant"
      : "unsupported";
    doc.terms.rateConvention = "effectiveAnnual";
    doc.terms.dayCount = "monthly";
    doc.warnings.push(
      "Confirma la fecha efectiva del capital y la fecha de la cotización UVR: corte, vencimiento y aplicación pueden ser distintos.",
      "La convención de tasa y el modelo mensual son sugerencias: confírmalos con el contrato.",
    );
    if (Number(number(get(/^tasa interes subsidiada/) ?? "0")) > 0)
      doc.warnings.push(
        `Subsidio reportado: ${number(get(/^tasa interes subsidiada/))}%. Confirma convención y fechas de inicio/fin; no se infieren del desembolso.`,
      );
    if (Number(number(get(/^tasa interes subsidiada/) ?? "0")) > 0)
      doc.terms.subsidyRateHint = number(get(/^tasa interes subsidiada/));
    let movements = false;
    let movementHeaders: string[] = [];
    for (let i = 0; i < grid.length; i++) {
      const row = grid[i];
      if (/^fecha aplicacion$/.test(norm(row[0]))) {
        movements = true;
        movementHeaders = row.map(norm);
        if (
          [
            "capital",
            "intereses corriente",
            "intereses mora",
            "seguros vida",
            "seguros incendio",
            "seguros terremoto",
            "otros cargos",
            "total",
          ].some((label) => !movementHeaders.includes(label))
        )
          throw new DomainError(
            "Faltan encabezados de componentes del crédito; no se infieren valores",
          );
        continue;
      }
      if (/^observaciones$/.test(norm(row[0]))) movements = false;
      const day = financialDate(row[0]);
      if (!movements || !day) continue;
      const column = (label: string, fallback = "0") => {
        const index = movementHeaders.indexOf(label);
        return index < 0 ? fallback : number(row[index]);
      };
      const protectedInsurance = column("empleado o independiente protegido");
      const values = [
        column("capital"),
        column("intereses corriente"),
        column("intereses mora"),
        column("seguros vida"),
        column("seguros incendio"),
        column("seguros terremoto"),
        column("otros cargos"),
        column("total"),
      ];
      values[3] = new D(values[3]).plus(protectedInsurance).toFixed();
      if (values.length !== 8)
        throw new DomainError("Fila hipotecaria incompleta");
      if (new D(values[7]).lt(0))
        throw new DomainError(
          "Pago negativo no soportado: revisa el documento",
        );
      const signed = values.slice(0, 7).some((v) => new D(v).lt(0));
      const total = nativeMinor(values[7]);
      const allocation = !signed
        ? {
            principalMinor: nativeMinor(values[0]),
            interestMinor: nativeMinor(values[1]),
            lateInterestMinor: nativeMinor(values[2]),
            insuranceMinor: nativeMinor(
              new D(values[3]).plus(values[4]).plus(values[5]),
            ),
            feesMinor: nativeMinor(values[6]),
          }
        : undefined;
      if (
        new D(values.slice(0, 7).reduce((s, v) => s.plus(v), new D(0)))
          .minus(values[7])
          .abs()
          .gt("0.02")
      )
        doc.warnings.push(
          `Fila ${i + 1}: los componentes no coinciden con el total; confirma manualmente.`,
        );
      add({
        row: i + 1,
        section: "history",
        date: day,
        description: String(row[1]).slice(0, 200),
        totalMinor: total,
        roundingDifferenceMinor: (
          BigInt(total) -
          values
            .slice(0, 7)
            .reduce((sum, v) => sum + BigInt(nativeMinor(v)), 0n)
        ).toString(),
        ...(allocation ? { allocation } : {}),
        principal: values[0],
        interest: values[1],
      });
    }
  } else {
    doc.terms.denomination = grid.some((row) =>
      row.some((v) => norm(v).includes("valores en uvr")),
    )
      ? "UVR"
      : "COP";
    let section: LoanDocumentRow["section"] = "history";
    let projectedSubsidy = false;
    for (let i = 0; i < grid.length; i++) {
      const row = grid[i],
        text = norm(row[0]);
      if (/proyeccion de pagos/.test(text)) section = "projection";
      if (/informacion del subsidio/.test(text)) section = "subsidy";
      if (
        section === "subsidy" &&
        row.some((v) => /proyeccion del subsidio/.test(norm(v)))
      )
        projectedSubsidy = true;
      const day = financialDate(section === "projection" ? row[1] : row[0]);
      if (day && section !== "subsidy") {
        // Annual exports have merged headers offset by one column in the COP block.
        const offset = section === "projection" ? 1 : 0;
        const initial = number(row[section === "projection" ? 3 : 1], true),
          interest = number(row[3 + offset], true),
          principal = number(row[4 + offset], true),
          closingPrincipal = number(row[5 + offset], true);
        const allocation = {
          principalMinor: nativeMinor(number(row[11], true)),
          interestMinor: nativeMinor(number(row[10], true)),
          lateInterestMinor:
            section === "projection" ? "0" : nativeMinor(number(row[7], true)),
          insuranceMinor: nativeMinor(number(row[8], true)),
          feesMinor: nativeMinor(number(row[9], true)),
        };
        const totalMinor = Object.values(allocation)
          .reduce((s, v) => s + BigInt(v), 0n)
          .toString();
        add({
          row: i + 1,
          section,
          date: day,
          description:
            section === "projection"
              ? "Proyección del banco"
              : "Pago histórico reportado",
          principal,
          openingPrincipal: initial,
          ...(section === "projection"
            ? { uvrValue: number(row[2], true) }
            : {}),
          closingPrincipal,
          interest,
          totalMinor,
          allocation,
        });
        if (
          new D(initial)
            .minus(principal)
            .minus(closingPrincipal)
            .abs()
            .gt("0.0002")
        )
          doc.warnings.push(
            `Fila ${i + 1}: diferencia en amortización reportada.`,
          );
        doc.period ??= day.slice(0, 4);
      }
      if (
        section === "subsidy" &&
        /^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)$/.test(
          text,
        )
      )
        add({
          row: i + 1,
          section,
          description: `Subsidio: ${String(row[0])}`,
          interest: number(row[projectedSubsidy ? 3 : 2], true),
          subsidyUnits: number(row[projectedSubsidy ? 2 : 1], true),
          ...(projectedSubsidy ? { uvrValue: number(row[1], true) } : {}),
        });
    }
    doc.warnings.push(
      "Este documento combina historia y proyección. Las filas futuras y el subsidio no crean pagos reales.",
      "La UVR proyectada por el banco conserva su carácter de estimación.",
    );
  }
  if (!doc.rows.length)
    throw new DomainError("No se encontraron filas hipotecarias reconocibles");
  return doc;
}
