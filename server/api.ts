import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  addTransaction,
  configure,
  dashboard,
  editTransaction,
  mergeObservation,
  resolveObservation,
  undo,
} from "../domain/ledger";
import { bogotaDate } from "../domain/money";
import { DomainError, id } from "../domain/model";
import {
  exportRecords,
  MAX_FILE_BYTES,
  parseImport,
  profiles,
} from "./imports";
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
      if (method === "GET" && path === "/state") {
        const state = await repo.read(h);
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
      if (method === "POST" && path === "/transactions")
        return {
          status: 201,
          body: await repo.mutate(h, (s) => addTransaction(s, body, now)),
        };
      const transaction = path.match(/^\/transactions\/([^/]+)$/);
      if (transaction && method === "PATCH") {
        const b = z
          .object({
            changes: z.record(z.string(), z.unknown()),
            remember: z.boolean().default(false),
            expectedRevision: z.number().int().min(1),
          })
          .parse(body);
        await repo.mutate(h, (s) =>
          editTransaction(
            s,
            transaction[1],
            b.changes,
            now,
            b.remember,
            b.expectedRevision,
          ),
        );
        return { status: 200, body: { saved: true } };
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
        if (!(await repo.read(h)).accounts.some((a) => a.id === b.accountId))
          throw new DomainError("Cuenta desconocida");
        const batchId = randomUUID(),
          originalKey = `original/${h}/${batchId}/file`;
        const batch: Batch = {
          id: batchId,
          householdId: h,
          ...b,
          status: "uploading",
          originalKey,
          createdAt: now,
          next: 0,
        };
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
          );
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
          batch.rejected = batch.total - batch.accepted;
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
          if (!["preview", "committing", "done"].includes(batch.status))
            throw new DomainError("Genera primero la vista previa");
          if (!batch.accepted) throw new DomainError("No hay filas aceptadas");
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
