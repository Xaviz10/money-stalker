import {
  captureSchema,
  DomainError,
  type Capture,
  type Observation,
} from "../domain/model";
import { ingestCapture, recordStatement } from "../domain/ledger";
import type { Repository, Job } from "./repository";
import { digest } from "./repository";
import type { Files } from "./storage";
import type { ImportRow } from "./imports";
import {
  parseBancolombiaSMS,
  resolveCapturedAccount,
  resolveCapturedDestination,
} from "./sms";

export const isSecurityMessage = (message: string) =>
  /\b(OTP|c[oó]digo\s+(?:de\s+)?(?:seguridad|verificaci[oó]n|acceso)|clave\s+(?:din[aá]mica|temporal)|contrase[nñ]a|inici[oa]\s+de\s+sesi[oó]n)\b/i.test(
    message,
  );
export function captureJob(
  householdId: string,
  deviceId: string,
  input: unknown,
  now: string,
): Job {
  const event = captureSchema.parse(input);
  if (event.message && isSecurityMessage(event.message))
    throw new DomainError("Mensaje de seguridad excluido; no se guardó", 422);
  const id = `${deviceId}:${event.eventId}`;
  return {
    id,
    householdId,
    kind: "capture",
    payload: event,
    digest: digest(event),
    status: "pending",
    createdAt: now,
  };
}
export async function processJob(
  repo: Repository,
  files: Files,
  householdId: string,
  id: string,
): Promise<void> {
  const job = await repo.job(householdId, id);
  if (!job || job.status === "done") return;
  try {
    if (job.kind === "capture") {
      const input = job.payload as Capture;
      await repo.mutate(householdId, (state) => {
        const parsed = input.message
          ? parseBancolombiaSMS(input.message)
          : undefined;
        const expectedKind =
          parsed?.instrumentHint &&
          parsed.kind === "expense" &&
          /Compraste/i.test(input.message ?? "") &&
          /T\.?Cred\b/i.test(input.message ?? "")
            ? "credit"
            : "bank";
        const accountId =
          input.accountId ??
          resolveCapturedAccount(
            state,
            input.instrumentHint,
            undefined,
            false,
          ) ??
          resolveCapturedAccount(state, parsed?.instrumentHint, expectedKind);
        const counterAccountId =
          input.counterAccountId ??
          (parsed ? resolveCapturedDestination(state, parsed) : undefined);
        const parsedKind = parsed?.kind ?? input.kind;
        const observation: Observation = {
          id: job.id,
          source: input.source,
          observedAt: input.observedAt,
          receivedAt: job.createdAt,
          date: input.date ?? parsed?.date,
          accountId,
          amountMinor: input.amountMinor ?? parsed?.amountMinor,
          currency: "COP",
          merchant: input.merchant || parsed?.merchant || "",
          kind:
            parsedKind === "transfer" && !counterAccountId
              ? "expense"
              : parsedKind,
          counterAccountId,
          reference: input.reference,
          // No bank-reference parser is verified yet. Client-supplied strings cannot establish strong identity.
          status: "review",
          candidates: [],
          location: input.location,
          parserVersion: parsed?.matched
            ? parsed.parserVersion
            : "structured-capture-v1",
        };
        ingestCapture(state, observation);
      });
    } else {
      const { batchId, offset } = job.payload as {
        batchId: string;
        offset: number;
      };
      const batch = await repo.batch(householdId, batchId);
      if (!batch?.previewKey)
        throw new DomainError("Vista previa no disponible");
      const preview = JSON.parse(
        Buffer.from(await files.get(batch.previewKey)).toString("utf8"),
      ) as { rows: ImportRow[] };
      const rows = preview.rows.filter((r) => r.status === "accepted");
      if (offset < batch.next) {
        if (batch.status === "committing")
          await enqueueImport(
            repo,
            householdId,
            batch.id,
            batch.next,
            job.createdAt,
          );
        await repo.finishJob(householdId, id);
        return;
      }
      if (offset !== batch.next)
        throw new DomainError("Lote fuera de secuencia");
      const part = rows.slice(offset, offset + 20);
      await repo.mutate(householdId, (state) => {
        for (const row of part)
          recordStatement(state, row.observation!, job.createdAt);
      });
      batch.next = offset + part.length;
      batch.status = batch.next >= rows.length ? "done" : "committing";
      batch.error = undefined;
      // Persist continuation before completing this job; recovery also repairs missing continuations.
      await repo.saveBatch(batch);
      if (batch.status !== "done")
        await enqueueImport(
          repo,
          batch.householdId,
          batch.id,
          batch.next,
          job.createdAt,
        );
    }
    await repo.finishJob(householdId, id);
  } catch (error) {
    // The operator sees a safe code, never a raw payload or SDK request in logs.
    await repo.finishJob(
      householdId,
      id,
      error instanceof DomainError ? error.message : "PROCESSING_FAILED",
    );
    throw error;
  }
}
export async function enqueueImport(
  repo: Repository,
  h: string,
  batchId: string,
  offset: number,
  now: string,
) {
  const payload = { batchId, offset };
  await repo.putJob({
    id: `import:${batchId}:${offset}`,
    householdId: h,
    kind: "import",
    payload,
    digest: digest(payload),
    status: "pending",
    createdAt: now,
  });
}
