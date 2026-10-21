import { resolveGoogleMapsLink } from "./places";
import { classifyImportedMerchant, loanMerchantCandidates } from "../domain/merchant-rules";
import { randomUUID } from "node:crypto";
import { loanAPI } from './loan-api';
import { z } from "zod";
import {
  addTransaction,
  configure,
  dashboard,
  deleteTransaction,
  duplicateTransactions,
  editTransaction,
  merchantKey,
  mergeObservation,
  resolveObservation,
  refreshCaptureCandidates,
  recordInvestmentValue,
  undo,
} from "../domain/ledger";
import { bogotaDate } from "../domain/money";
import {
  DomainError,
  id,
  normalizeUnlinkedTransfers,
  transactionInput,
  transactionPlaceSchema,
  movementOptionsSchema,
} from "../domain/model";
import {
  exportRecords,
  MAX_FILE_BYTES,
  MAX_ROWS,
  parseImport,
  profiles,
} from "./imports";
import type { ImportRow } from "./imports";
import type { Repository, Batch } from "./repository";
import type { Files } from "./storage";
import { captureJob, enqueueImport } from "./processing";

export type Request = {
  method: string;
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  token?: string;
  subject?: string;
};
export type Response = {
  status: number;
  body: unknown;
  type?: string;
  filename?: string;
};
export function createAPI(repo: Repository, files: Files) {
  return async (request: Request): Promise<Response> => {
    try {
      const now = new Date().toISOString(),
        { method, path } = request,
        body = request.body;
      if (method === "POST" && path === "/capture-events") {
        const device = await repo.authenticateDevice(request.token ?? "");
        const job = captureJob(device.householdId, device.id, body, now);
        await repo.putJob(job);
        return {
          status: 202,
          body: { eventId: job.id, status: "durably_saved" },
        };
      }
      if (!request.subject)
        throw new DomainError("Inicia sesión para continuar", 401);
      // For the personal release, each verified Cognito sub owns exactly one household.
      // Never accept household IDs from request bodies, headers or query parameters.
      const h = request.subject;
      const loanResponse = await loanAPI(request, repo, files, h, now);
      if (loanResponse) return loanResponse;
      if (method === "POST" && path === "/places/resolve-link") {
        const input = z.object({ url: z.string().trim().min(1).max(2000) }).strict().parse(body);
        return { status: 200, body: await resolveGoogleMapsLink(input.url) };
      }
      if (method === "GET" && path === "/state") {
        const state = await repo.read(h);
        normalizeUnlinkedTransfers(state);
        refreshCaptureCandidates(state);
        // The journal remains server-side. Keep review evidence plus linked location
        // evidence so the owner can remember where a movement was captured.
        return {
          status: 200,
          body: {
            ...state,
            transactions: state.transactions.map(
              ({ requestSignature, ...t }) => ({ ...t, entries: [] }),
            ),
            observations: state.observations.filter(
              (o) => o.status === "review" || Boolean(o.location),
            ),
            audit: state.audit.slice(-50),
          },
        };
      }
      const evidence = path.match(/^\/observations\/([^/]+)\/evidence$/);
      if (evidence && method === "GET") {
        const job = await repo.job(h, evidence[1]);
        if (!job || job.kind !== "capture")
          throw new DomainError(
            "La evidencia original ya no está disponible (retención de 30 días)",
            404,
          );
        const payload = job.payload as { message?: string; observedAt: string };
        return {
          status: 200,
          body: { message: payload.message, observedAt: payload.observedAt },
        };
      }
      if (method === "GET" && path === "/dashboard")
        return {
          status: 200,
          body: dashboard(await repo.read(h), bogotaDate()),
        };
      if (method === "GET" && path === "/health")
        return {
          status: 200,
          body: {
            captureProfiles: ["structured-capture-v1", "bancolombia-sms-v1"],
            bankProfilesVerified: true,
            pending: (await repo.pendingJobs())
              .filter((j) => j.householdId === h)
              .map((j) => ({
                id: j.id,
                error: j.error,
                createdAt: j.createdAt,
              })),
          },
        };
      if (
        method === "POST" &&
        /^\/(accounts|instruments|categories|bills|settings)$/.test(path)
      ) {
        await repo.mutate(h, (s) => configure(s, path.slice(1), body));
        return { status: 200, body: { saved: true } };
      }
      if (method === "POST" && path === "/investment-values") {
        return { status: 201, body: await repo.mutate(h, state => recordInvestmentValue(state, body, now)) };
      }
      if (method === "POST" && path === "/transactions") {
        const submitted = z
          .object({ duplicateConfirmed: z.boolean().optional() })
          .passthrough()
          .parse(body);
        const { duplicateConfirmed, ...input } = submitted;
        return {
          status: 201,
          body: await repo.mutate(h, (s) => {
            const movement = transactionInput.parse(input);
            if (
              !duplicateConfirmed &&
              duplicateTransactions(s, movement).some(match => match.id !== movement.id)
            )
              throw new DomainError(
                "Este movimiento parece estar registrado. Confirma si deseas guardarlo otra vez.",
                409,
              );
            return addTransaction(s, input, now);
          }),
        };
      }
      const transaction = path.match(/^\/transactions\/([^/]+)$/);
      if (transaction && method === "PATCH") {
        const b = z
          .object({
            changes: z.record(z.string(), z.unknown()),
            remember: z.boolean().default(false),
            applyToSimilar: z.boolean().default(false),
            applyPlaceToSimilar: z.boolean().default(false),
            rememberMerchantPlace: z.boolean().default(false),
            rememberMerchant: z.boolean().default(false),
            expectedRevision: z.number().int().min(1),
            loanAssociations: z.array(z.object({ id, revision: z.number().int().min(1) })).max(20).optional(),
          })
          .parse(body);
        const applyToSimilar = b.applyToSimilar || b.remember;
        if (!applyToSimilar && !b.applyPlaceToSimilar) {
          await repo.mutate(h, (s) =>
            editTransaction(
              s,
              transaction[1],
              b.changes,
              now,
              b.rememberMerchant,
              b.expectedRevision,
              b.rememberMerchantPlace,
            ),
          );
          return { status: 200, body: { saved: true, updated: 1 } };
        }

        const snapshot = await repo.read(h);
        const selected = snapshot.transactions.find(
          (item) => item.id === transaction[1] && !item.voided,
        );
        if (!selected) throw new DomainError("Movimiento desconocido", 404);
        if (selected.revision !== b.expectedRevision)
          throw new DomainError(
            "El movimiento cambió; actualiza antes de editar",
            409,
          );
        const sharedPlace = b.applyPlaceToSimilar ? transactionPlaceSchema.parse(b.changes.place) : undefined;
        const investmentProduct = movementOptionsSchema.parse(b.changes).investmentProduct;
        const destinationId = b.changes.counterAccountId ?? selected.counterAccountId;
        const investmentTransfer = (b.changes.kind ?? selected.kind) === 'transfer' && typeof destinationId === 'string'
          && (snapshot.accounts.some(account => account.id === destinationId && account.kind === 'investment') || investmentProduct?.id === destinationId);
        const loanProduct = movementOptionsSchema.parse(b.changes).loanProduct;
        const loanPayment = (b.changes.kind ?? selected.kind) === 'loan_payment' && typeof destinationId === 'string'
          && (snapshot.accounts.some(account => account.id === destinationId && account.kind === 'loan') || loanProduct?.id === destinationId);
        const loanCandidates = loanPayment ? loanMerchantCandidates(snapshot, selected, destinationId as string) : [];
        if (loanPayment && applyToSimilar && !b.loanAssociations?.length)
          throw new DomainError('Revisa y selecciona los movimientos antes de asociarlos al crédito');
        if (b.loanAssociations?.length && (!loanPayment || !applyToSimilar))
          throw new DomainError('La selección histórica requiere una asociación de crédito');
        if (new Set(b.loanAssociations?.map(item => item.id)).size !== (b.loanAssociations?.length ?? 0))
          throw new DomainError('La selección contiene movimientos repetidos');
        for (const item of b.loanAssociations ?? []) {
          const candidate = loanCandidates.find(candidate => candidate.id === item.id);
          if (!candidate) throw new DomainError('Un movimiento seleccionado no corresponde a este comercio y crédito');
          if (candidate.revision !== item.revision) throw new DomainError('Un movimiento histórico cambió; actualiza la vista previa', 409);
        }
        // An investment choice changes the financial event, not just its label.
        // Do not redirect income, refunds, withdrawals or transfers to other products.
        const compatible = (item: typeof selected) => loanPayment
          ? loanCandidates.some(candidate => candidate.id === item.id)
          : investmentTransfer
          ? item.accountId !== destinationId && (item.kind === 'expense' || (item.kind === 'transfer' && item.counterAccountId === destinationId))
          : item.kind === selected.kind;
        const key = merchantKey(selected.merchant);
        if (!key)
          throw new DomainError(
            "Agrega un comercio o descripción para aplicar el cambio a movimientos similares",
          );
        const revisions = new Map(
          snapshot.transactions.map((item) => [item.id, item.revision]),
        );
        const matchingIds = [
          selected.id,
          ...snapshot.transactions
            .filter(
              (item) =>
                item.id !== selected.id &&
                !item.voided &&
                (b.applyPlaceToSimilar || (loanPayment ? b.loanAssociations?.some(selected => selected.id === item.id) : compatible(item))) &&
                merchantKey(item.merchant) === key,
            )
            .map((item) => item.id),
        ];
        const sharedChanges = {
          ...(investmentTransfer ? { kind: 'transfer', counterAccountId: destinationId, billId: null } : {}),
          categoryId:
            typeof b.changes.categoryId === "string"
              ? b.changes.categoryId
              : selected.categoryId,
          note:
            typeof b.changes.note === "string" ? b.changes.note : selected.note,
        };
        let updated = 0;
        // Investment conversion can also unlink a bill per movement, in addition
        // to its transaction and audit row. Leave room for product/rule creation.
        const chunkSize = loanPayment && applyToSimilar ? 20 : investmentTransfer && applyToSimilar ? 25 : 35;
        for (let offset = 0; offset < matchingIds.length; offset += chunkSize) {
          const chunk = matchingIds.slice(offset, offset + chunkSize);
          updated += await repo.mutate(h, (s) => {
            let changed = 0;
            for (const id of chunk) {
              const current = s.transactions.find(
                (item) => item.id === id && !item.voided,
              );
              if (!current) continue;
              const propagated = {
                ...(applyToSimilar && compatible(current) && (!loanPayment || b.loanAssociations?.some(item => item.id === current.id)) ? {
                  ...sharedChanges,
                  ...(loanPayment ? {
                    kind: 'loan_payment', counterAccountId: destinationId,
                    // Never copy the selected payment's allocation, due date or document.
                    loanPayment: current.kind === 'loan_payment' ? current.loanPayment : { purpose: 'unconfirmed' },
                  } : {}),
                } : {}),
                ...(sharedPlace ? { place: sharedPlace } : {}),
              };
              const changes = id === selected.id ? b.changes : propagated;
              if (id !== selected.id && Object.entries(propagated).every(([key, value]) => JSON.stringify(current[key as keyof typeof current]) === JSON.stringify(value))) continue;
              editTransaction(
                s,
                id,
                changes,
                now,
                id === selected.id && (b.rememberMerchant || applyToSimilar),
                revisions.get(id),
                id === selected.id && b.rememberMerchantPlace,
              );
              changed++;
            }
            return changed;
          });
        }
        return { status: 200, body: { saved: true, updated } };
      }
      if (transaction && method === "DELETE") {
        const b = z.object({ expectedRevision: z.number().int().min(1) }).parse(body);
        await repo.mutate(h, (s) => deleteTransaction(s, transaction[1], now, b.expectedRevision));
        return { status: 200, body: { deleted: true } };
      }
      if (method === "POST" && path === "/matches") {
        const b = z
          .object({ observationId: id, transactionId: id })
          .parse(body);
        await repo.mutate(h, (s) =>
          mergeObservation(s, b.observationId, b.transactionId, now),
        );
        return { status: 200, body: { saved: true } };
      }
      if (method === "POST" && path === "/reviews") {
        const b = z
          .object({
            observationId: id,
            action: z.enum(["separate", "ignore"]),
            details: z.record(z.string(), z.unknown()).optional(),
          })
          .parse(body);
        await repo.mutate(h, (s) =>
          resolveObservation(s, b.observationId, b.action, now, b.details),
        );
        return { status: 200, body: { saved: true } };
      }
      if (method === "POST" && path === "/reviews/batch") {
        const b = z
          .object({
            observationIds: z
              .array(id)
              .min(1)
              .max(500)
              .refine(
                (values) => new Set(values).size === values.length,
                "No repitas evidencias en el lote",
              ),
            action: z.literal("separate"),
          })
          .parse(body);
        let resolved = 0;
        const batchId = randomUUID();
        // Resolving one clue writes four items: its observation, the new
        // movement, the movement creation audit, and the review audit. Keep
        // each repository mutation below DynamoDB's 100-action transaction
        // limit, including the household revision item.
        const chunkSize = 20;
        for (
          let offset = 0;
          offset < b.observationIds.length;
          offset += chunkSize
        ) {
          const chunk = b.observationIds.slice(offset, offset + chunkSize);
          resolved += await repo.mutate(h, (s) => {
            let saved = 0;
            for (const observationId of chunk) {
              const observation = s.observations.find(
                (item) => item.id === observationId,
              );
              if (!observation || observation.status !== "review") continue;
              resolveObservation(s, observationId, b.action, now, undefined, {
                id: batchId,
                size: b.observationIds.length,
              });
              saved++;
            }
            return saved;
          });
        }
        return { status: 200, body: { saved: true, resolved, batchId } };
      }
      if (method === "POST" && path === "/undo/batch") {
        const b = z.object({ batchId: id }).parse(body);
        const snapshot = await repo.read(h);
        const auditIds = snapshot.audit
          .filter((entry) => entry.batchId === b.batchId && !entry.undone)
          .map((entry) => entry.id);
        if (!auditIds.length)
          throw new DomainError("Este lote ya fue deshecho o no existe", 404);
        let undone = 0;
        // Undo touches the movement, observation, original audit, and a new
        // audit record. Twenty at a time stays below the storage limit.
        for (let offset = 0; offset < auditIds.length; offset += 20) {
          const chunk = auditIds.slice(offset, offset + 20);
          undone += await repo.mutate(h, (s) => {
            let saved = 0;
            for (const auditId of chunk) {
              const entry = s.audit.find((item) => item.id === auditId);
              if (!entry || entry.undone) continue;
              undo(s, auditId, now);
              saved++;
            }
            return saved;
          });
        }
        return { status: 200, body: { saved: true, undone } };
      }
      if (method === "POST" && path === "/undo") {
        const b = z.object({ auditId: z.string().max(300) }).parse(body);
        await repo.mutate(h, (s) => undo(s, b.auditId, now));
        return { status: 200, body: { saved: true } };
      }
      if (path === "/devices" && method === "GET")
        return {
          status: 200,
          body: (await repo.devices(h)).map(
            ({ tokenHash, householdId, ...d }) => d,
          ),
        };
      if (path === "/devices" && method === "POST") {
        const b = z
          .object({ name: z.string().trim().min(1).max(100) })
          .parse(body);
        if ((await repo.devices(h)).filter((d) => !d.revoked).length >= 5)
          throw new DomainError("Máximo 5 dispositivos activos");
        const { device, token } = await repo.createDevice(h, b.name);
        return {
          status: 201,
          body: { id: device.id, name: device.name, token },
        };
      }
      const device = path.match(/^\/devices\/([^/]+)$/);
      if (device && method === "DELETE") {
        await repo.revokeDevice(h, device[1]);
        return { status: 200, body: { revoked: true } };
      }
      if (path === "/import-profiles" && method === "GET")
        return {
          status: 200,
          body: profiles.map(({ id, label, verified }) => ({
            id,
            label,
            verified,
          })),
        };
      if (path === "/imports" && method === "GET")
        return { status: 200, body: await repo.batches(h) };
      if (path === "/imports" && method === "POST") {
        const b = z
          .object({
            filename: z
              .string()
              .max(150)
              .regex(/\.(csv|xlsx)$/i),
            accountId: id,
            profile: z.string(),
            size: z.number().int().min(1).max(MAX_FILE_BYTES),
          })
          .parse(body);
        if (
          b.profile !== "auto" &&
          !profiles.some((p) => p.id === b.profile && p.verified)
        )
          throw new DomainError("Perfil no verificado");
        const beforeUpload = await repo.read(h);
        if (!beforeUpload.accounts.some((a) => a.id === b.accountId))
          throw new DomainError("Cuenta desconocida");
        const batchId = randomUUID(),
          originalKey = `original/${h}/${batchId}/file`;
        const batch: Batch = {
          id: batchId,
          householdId: h,
          ...b,
          status: "uploading",
          originalKey,
          comparisonKey: `normalized/${h}/${batchId}/comparison.json`,
          createdAt: now,
          next: 0,
        };
        await files.put(batch.comparisonKey!, Buffer.from(JSON.stringify(beforeUpload.transactions.filter(transaction => !transaction.voided).map(transaction => transaction.id))));
        await repo.saveBatch(batch);
        return {
          status: 201,
          body: { batch, upload: await files.upload(originalKey) },
        };
      }
      const imported = path.match(
        /^\/imports\/([^/]+)(?:\/(preview|commit))?$/,
      );
      if (imported) {
        const batch = await repo.batch(h, imported[1]);
        if (!batch) throw new DomainError("Importación desconocida", 404);
        if (method === "POST" && imported[2] === "preview") {
          if (batch.status !== "uploading") return { status: 200, body: batch };
          const bytes = await files.get(batch.originalKey);
          const state = await repo.read(h);
          const preview = parseImport(
            bytes,
            batch.filename,
            batch.accountId,
            batch.profile,
            now,
            profiles,
            state.accounts,
            state.settings.cashAccountId,
          );
          if (!batch.comparisonKey) throw new DomainError("Vuelve a subir el archivo para comparar solo con movimientos anteriores a la carga");
          const priorIds = new Set(JSON.parse(Buffer.from(await files.get(batch.comparisonKey)).toString("utf8")) as string[]);
          const comparisonState = { ...state, transactions: state.transactions.filter(transaction => priorIds.has(transaction.id)) };
          for (const row of preview.rows) {
            if (row.status !== "accepted" || !row.observation) continue;
            try {
              row.observation = classifyImportedMerchant(state, row.observation);
            } catch (error) {
              row.status = "rejected";
              row.error = error instanceof DomainError ? error.message : "No se pudo aplicar la regla de este comercio";
              continue;
            }
            const candidates = duplicateTransactions(comparisonState, {
              accountId: row.observation.accountId!,
              counterAccountId: row.observation.counterAccountId,
              date: row.observation.date!,
              amountMinor: row.observation.amountMinor!,
              kind: row.observation.kind,
              merchant: row.observation.merchant,
              reference: row.observation.reference,
            });
            if (candidates.length) {
              row.status = "duplicate";
              row.duplicateCandidates = candidates.map(
                (candidate) => candidate.id,
              );
            }
          }
          const duplicate = (await repo.batches(h)).find(
            (b) =>
              b.id !== batch.id &&
              b.hash === preview.hash &&
              b.accountId === batch.accountId &&
              ["committing", "done"].includes(b.status),
          );
          if (duplicate)
            return { status: 200, body: { ...duplicate, duplicate: true } };
          batch.hash = preview.hash;
          batch.profile = preview.profile;
          batch.previewKey = `normalized/${h}/${batch.id}/preview.json`;
          batch.total = preview.rows.length;
          batch.accepted = preview.rows.filter(
            (r) => r.status === "accepted",
          ).length;
          batch.duplicates = preview.rows.filter(
            (r) => r.status === "duplicate",
          ).length;
          batch.rejected = preview.rows.filter(
            (r) => r.status === "rejected",
          ).length;
          batch.skipped = preview.skippedRows.length;
          batch.status = "preview";
          await files.put(
            batch.previewKey,
            Buffer.from(JSON.stringify(preview)),
          );
          await repo.saveBatch(batch);
          return { status: 200, body: batch };
        }
        if (method === "POST" && imported[2] === "commit") {
          const commit = z
            .object({
              includeDuplicateRows: z
                .array(z.number().int().positive())
                .max(MAX_ROWS)
                .default([]),
            })
            .parse(body ?? {});
          if (!["preview", "committing", "done"].includes(batch.status))
            throw new DomainError("Genera primero la vista previa");
          if (batch.status === "preview" && batch.previewKey) {
            const preview = JSON.parse(
              Buffer.from(await files.get(batch.previewKey)).toString("utf8"),
            ) as { rows: ImportRow[]; [key: string]: unknown };
            const included = new Set(commit.includeDuplicateRows);
            const duplicateRows = new Set(
              preview.rows
                .filter((row) => row.status === "duplicate")
                .map((row) => row.row),
            );
            if ([...included].some((row) => !duplicateRows.has(row)))
              throw new DomainError(
                "La selección de duplicados no corresponde a esta vista previa",
              );
            for (const row of preview.rows) {
              if (row.status !== "duplicate") continue;
              row.status = included.has(row.row) ? "accepted" : "skipped";
              if (row.status === "skipped")
                row.error = "Omitido porque ya estaba registrado";
            }
            batch.accepted = preview.rows.filter(
              (row) => row.status === "accepted",
            ).length;
            batch.omittedDuplicates = preview.rows.filter(
              (row) => row.status === "skipped",
            ).length;
            await files.put(
              batch.previewKey,
              Buffer.from(JSON.stringify(preview)),
            );
          }
          if (!batch.accepted) {
            batch.status = "done";
            await repo.saveBatch(batch);
            return { status: 200, body: batch };
          }
          if (batch.status !== "done") {
            batch.status = "committing";
            await repo.saveBatch(batch);
            await enqueueImport(repo, h, batch.id, batch.next, now);
          }
          return { status: 202, body: batch };
        }
        if (method === "GET") {
          const offset = Math.max(0, Number(request.query?.offset) || 0);
          const preview = batch.previewKey
            ? JSON.parse(
                Buffer.from(await files.get(batch.previewKey)).toString("utf8"),
              )
            : { rows: [] };
          return {
            status: 200,
            body: {
              ...batch,
              rows: preview.rows.slice(offset, offset + 100),
              offset,
              more: offset + 100 < preview.rows.length,
            },
          };
        }
      }
      if (path === "/exports" && method === "GET") {
        const format = request.query?.format === "xlsx" ? "xlsx" : "csv";
        const output = exportRecords(
          await repo.read(h),
          format,
          request.query?.accountId,
        );
        return {
          status: 200,
          body: output.bytes,
          type: output.type,
          filename: `money-stalker-${bogotaDate()}.${format}`,
        };
      }
      throw new DomainError("Ruta no encontrada", 404);
    } catch (error) {
      if (error instanceof z.ZodError)
        return {
          status: 400,
          body: {
            error: "Datos inválidos",
            fields: error.issues.map((i) => ({
              field: i.path.join("."),
              message: i.message,
            })),
          },
        };
      if (error instanceof DomainError)
        return { status: error.status, body: { error: error.message } };
      return {
        status: 500,
        body: { error: "No se pudo completar la operación; vuelve a intentar" },
      };
    }
  };
}
