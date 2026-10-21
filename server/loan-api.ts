import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DomainError, id, date } from "../domain/model";
import {
  adjustLoanBalance,
  findLoan,
  loanBalance,
  loanSignature,
  saveLoanScenario,
  saveLoanTerms,
  simulateLoan,
} from "../domain/loans";
import { editTransaction } from "../domain/ledger";
import type { LoanDocument } from "../domain/loan-model";
import type { Repository } from "./repository";
import type { Files } from "./storage";
import type { Request, Response } from "./api";
import { parseLoanDocument } from "./loan-imports";
import { getUvrQuotes } from "./uvr";
const json = (v: unknown) => Buffer.from(JSON.stringify(v));
const metadata = (doc: LoanDocument): LoanDocument => ({
  ...doc,
  warnings: doc.warnings.slice(0, 20),
  rows: [],
  comparisonIds: [],
  overlapIds: [],
});
export async function loanAPI(
  request: Request,
  repo: Repository,
  files: Files,
  h: string,
  now: string,
): Promise<Response | undefined> {
  const { method, path, body } = request;
  if (!path.startsWith("/loans")) return undefined;
  if (method === "POST" && path === "/loans/terms")
    return {
      status: 200,
      body: await repo.mutate(h, (s) => saveLoanTerms(s, body, now)),
    };
  if (method === "POST" && path === "/loans/snapshots")
    return {
      status: 201,
      body: await repo.mutate(h, (s) => adjustLoanBalance(s, body, now)),
    };
  if (method === "POST" && path === "/loans/simulate")
    return { status: 200, body: simulateLoan(await repo.read(h), body) };
  if (method === "POST" && path === "/loans/scenarios")
    return {
      status: 200,
      body: await repo.mutate(h, (s) => saveLoanScenario(s, body, now)),
    };
  if (method === "GET" && path === "/loans/uvr") {
    const q = z.object({ from: date, to: date }).parse(request.query);
    return { status: 200, body: await getUvrQuotes(files, q.from, q.to, now) };
  }
  if (method === "GET" && path === "/loans") {
    const s = await repo.read(h),
      asOf = date.parse(request.query?.asOf ?? now.slice(0, 10));
    return {
      status: 200,
      body: s.accounts
        .filter((a) => a.kind === "loan")
        .map((a) => ({
          account: a,
          terms: s.loans.find((l) => l.id === a.id),
          balance: loanBalance(s, a.id, asOf),
          signature: loanSignature(s, a.id),
        })),
    };
  }
  if (method === "POST" && path === "/loans/imports") {
    const v = z
      .object({
        loanId: id,
        filename: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .regex(/\.xlsx$/i),
      })
      .parse(body);
    const state = await repo.read(h);
    findLoan(state, v.loanId);
    const batchId = randomUUID(),
      originalKey = `original/${h}/${batchId}.xlsx`,
      comparisonKey = `normalized/${h}/${batchId}-loan-comparison.json`;
    await files.put(
      comparisonKey,
      json(state.transactions.filter((t) => !t.voided).map((t) => t.id)),
    );
    await repo.saveBatch({
      id: batchId,
      householdId: h,
      filename: v.filename.replace(/[\r\n\x00-\x1f]/g, ""),
      accountId: v.loanId,
      profile: "mortgage",
      status: "uploading",
      originalKey,
      comparisonKey,
      next: 0,
      createdAt: now,
    });
    return {
      status: 201,
      body: { id: batchId, upload: await files.upload(originalKey) },
    };
  }
  const preview = path.match(/^\/loans\/imports\/([^/]+)\/preview$/);
  if (preview && method === "POST") {
    const batch = await repo.batch(h, preview[1]);
    if (!batch || batch.profile !== "mortgage")
      throw new DomainError("Importación desconocida", 404);
    const state = await repo.read(h);
    findLoan(state, batch.accountId);
    const normalizedKey = `normalized/${h}/${batch.id}-loan.json`;
    const doc = parseLoanDocument(await files.get(batch.originalKey), {
      id: batch.id,
      loanId: batch.accountId,
      filename: batch.filename,
      originalKey: batch.originalKey,
      normalizedKey,
      importedAt: batch.createdAt,
      comparisonIds: JSON.parse(
        Buffer.from(await files.get(batch.comparisonKey!)).toString(),
      ),
    });
    const configured = state.loans.find((l) => l.id === doc.loanId);
    if (
      configured &&
      doc.terms.denomination &&
      configured.denomination !== doc.terms.denomination
    )
      throw new DomainError(
        "El documento usa otra denominación; verifica el crédito destino",
      );
    const same = state.loanDocuments.find(
      (d) => d.loanId === doc.loanId && d.hash === doc.hash,
    );
    if (same)
      return {
        status: 200,
        body: {
          ...JSON.parse(
            Buffer.from(await files.get(same.normalizedKey)).toString(),
          ),
          status: same.status,
          duplicate: true,
        },
      };
    for (const old of state.loanDocuments.filter(
      (d) => d.loanId === doc.loanId && d.status === "confirmed",
    )) {
      const prior = JSON.parse(
        Buffer.from(await files.get(old.normalizedKey)).toString(),
      ) as LoanDocument;
      doc.overlapIds.push(
        ...doc.rows
          .filter((row) => prior.rows.some((p) => p.id === row.id))
          .map((row) => row.id),
      );
    }
    if (doc.overlapIds.length)
      doc.warnings.push(
        `${doc.overlapIds.length} filas también aparecen en documentos confirmados. No se duplican pagos automáticamente.`,
      );
    await files.put(normalizedKey, json(doc));
    await repo.mutate(h, (s) => {
      if (!s.loanDocuments.some((d) => d.id === doc.id))
        s.loanDocuments.push(metadata(doc));
    });
    batch.status = "preview";
    await repo.saveBatch(batch);
    return { status: 200, body: doc };
  }
  const document = path.match(
    /^\/loans\/documents\/([^/]+)(?:\/(confirm|reconcile))?$/,
  );
  if (document) {
    const state = await repo.read(h),
      saved = state.loanDocuments.find((d) => d.id === document[1]);
    if (!saved) throw new DomainError("Documento desconocido", 404);
    const doc = {
      ...JSON.parse(
        Buffer.from(await files.get(saved.normalizedKey)).toString(),
      ),
      status: saved.status,
    } as LoanDocument;
    if (!document[2] && method === "GET") {
      const candidates = state.transactions.filter(
        (t) =>
          doc.comparisonIds.includes(t.id) &&
          !t.voided &&
          ["expense", "loan_payment"].includes(t.kind) &&
          state.accounts.some(
            (a) => a.id === t.accountId && ["bank", "cash"].includes(a.kind),
          ),
      );
      return { status: 200, body: { ...doc, candidates } };
    }
    if (document[2] === "confirm" && method === "POST") {
      await repo.mutate(h, (s) => {
        const d = s.loanDocuments.find((d) => d.id === doc.id)!;
        if (d.status === "confirmed") return;
        d.status = "confirmed";
        d.confirmedAt = now;
        s.audit.push({
          id: `loan-document:${d.id}`,
          action: "loan-document",
          at: now,
        });
      });
      return { status: 200, body: { saved: true } };
    }
    if (document[2] === "reconcile" && method === "POST") {
      const v = z
        .object({
          transactionId: id,
          expectedRevision: z.number().int().positive(),
          rowIds: z.array(id).min(1).max(30),
          purpose: z.enum(["ordinary", "term", "installment", "advance"]),
          principalUnits: z.string().optional(),
          uvrValue: z.string().optional(),
          roundingMinor: z
            .string()
            .regex(/^-?\d{1,4}$/)
            .optional(),
        })
        .parse(body);
      if (new Set(v.rowIds).size !== v.rowIds.length)
        throw new DomainError("Selecciona cada fila solo una vez");
      if (saved.status !== "confirmed")
        throw new DomainError("Confirma el documento antes de conciliar");
      if (!doc.comparisonIds.includes(v.transactionId))
        throw new DomainError(
          "El movimiento debe existir antes de cargar el documento",
        );
      const rows = v.rowIds.map((id) => doc.rows.find((row) => row.id === id));
      if (
        rows.some(
          (r) =>
            !r ||
            r.section !== "history" ||
            !r.allocation ||
            BigInt(r.totalMinor ?? "0") === 0n,
        )
      )
        throw new DomainError(
          "Selecciona filas históricas de pago con componentes positivos",
        );
      const dates = new Set(rows.map((r) => r!.date));
      if (dates.size !== 1)
        throw new DomainError(
          "Concilia por separado pagos de fechas distintas",
        );
      const allocation = {
        principalMinor: "0",
        interestMinor: "0",
        lateInterestMinor: "0",
        insuranceMinor: "0",
        feesMinor: "0",
      };
      for (const row of rows)
        for (const key of Object.keys(
          allocation,
        ) as (keyof typeof allocation)[])
          allocation[key] = (
            BigInt(allocation[key]) + BigInt(row!.allocation![key])
          ).toString();
      if (v.roundingMinor !== undefined && BigInt(v.roundingMinor) !== 0n) {
        const difference = rows.reduce(
          (sum, row) => sum + BigInt(row!.roundingDifferenceMinor ?? "0"),
          0n,
        );
        const adjustment = BigInt(v.roundingMinor);
        if (
          adjustment !== difference ||
          adjustment > 100n ||
          adjustment < -100n
        )
          throw new DomainError(
            "El ajuste debe coincidir con la diferencia reportada y no superar $1,00",
          );
        const interest = BigInt(allocation.interestMinor) + adjustment;
        if (interest < 0n)
          throw new DomainError("El ajuste no puede crear intereses negativos");
        allocation.interestMinor = interest.toString();
      }
      await repo.mutate(h, (s) => {
        if (
          s.transactions.some(
            (t) =>
              !t.voided &&
              t.id !== v.transactionId &&
              t.loanPayment?.documentRowIds?.some((id) =>
                v.rowIds.includes(id),
              ),
          )
        )
          throw new DomainError("Una fila ya está vinculada a otro pago", 409);
        const t = s.transactions.find(
          (t) => t.id === v.transactionId && !t.voided,
        );
        if (
          !t ||
          !["expense", "loan_payment"].includes(t.kind) ||
          (t.counterAccountId && t.counterAccountId !== doc.loanId)
        )
          throw new DomainError("Elige un pago compatible con este crédito");
        if (t.date !== rows[0]!.date)
          throw new DomainError(
            "Confirma la fecha de aplicación en el movimiento antes de conciliar",
          );
        const intended = {
          purpose: v.purpose,
          ...(["ordinary", "advance"].includes(v.purpose) &&
          t.loanPayment?.dueDate
            ? { dueDate: t.loanPayment.dueDate }
            : {}),
          allocation: {
            ...allocation,
            ...(v.principalUnits
              ? {
                  principalUnits: v.principalUnits,
                  uvrValue: v.uvrValue,
                  uvrDate: t.date,
                }
              : {}),
          },
          documentId: doc.id,
          documentRowIds: v.rowIds,
        };
        if (
          t.revision === v.expectedRevision + 1 &&
          t.kind === "loan_payment" &&
          t.counterAccountId === doc.loanId &&
          JSON.stringify(t.loanPayment) === JSON.stringify(intended)
        )
          return;
        editTransaction(
          s,
          t.id,
          {
            kind: "loan_payment",
            counterAccountId: doc.loanId,
            loanPayment: intended,
            categoryId: "loans-housing",
          },
          now,
          false,
          v.expectedRevision,
        );
      });
      return { status: 200, body: { saved: true } };
    }
  }
  const associate = path.match(/^\/loans\/([^/]+)\/associate$/);
  if (associate && method === "POST") {
    const v = z
      .object({
        movements: z
          .array(z.object({ id, revision: z.number().int().positive() }))
          .min(1)
          .max(20),
      })
      .parse(body);
    await repo.mutate(h, (s) => {
      findLoan(s, associate[1]);
      for (const m of v.movements) {
        const t = s.transactions.find((t) => t.id === m.id && !t.voided);
        if (!t || t.kind !== "expense")
          throw new DomainError("Selecciona salidas clasificadas como gasto");
        editTransaction(
          s,
          t.id,
          {
            kind: "loan_payment",
            counterAccountId: associate[1],
            loanPayment: { purpose: "unconfirmed" },
            billId: null,
          },
          now,
          false,
          m.revision,
        );
      }
    });
    return { status: 200, body: { saved: true } };
  }
  throw new DomainError("Ruta de créditos desconocida", 404);
}
