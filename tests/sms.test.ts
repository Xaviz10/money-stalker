import { describe, expect, it } from "vitest";
import { emptyState } from "../domain/model";
import { configure } from "../domain/ledger";
import { captureJob, processJob } from "../server/processing";
import { MemoryRepository } from "../server/repository";
import { MemoryFiles } from "../server/storage";
import { parseBancolombiaSMS } from "../server/sms";

const now = "2026-10-18T18:00:00Z";

describe("Bancolombia SMS parsing", () => {
  it("reads credit-card purchases with Colombian amount punctuation", () => {
    expect(
      parseBancolombiaSMS(
        "Bancolombia: Compraste COP12.345,67 en TIENDA EJEMPLO con tu T.Cred *7788, el 03/09/2026 a las 12:39.",
      ),
    ).toMatchObject({
      matched: true,
      amountMinor: "1234567",
      date: "2026-09-03",
      merchant: "TIENDA EJEMPLO",
      kind: "expense",
      instrumentHint: "7788",
    });
    expect(
      parseBancolombiaSMS(
        "Bancolombia: Compraste COP54.321,00 en COMERCIO DIGITAL, el 04/09/2026 a las 17:47. Esta compra esta asociada a T.Cred *7788.",
      ),
    ).toMatchObject({
      matched: true,
      amountMinor: "5432100",
      date: "2026-09-04",
      merchant: "COMERCIO DIGITAL",
      kind: "expense",
      instrumentHint: "7788",
    });
  });

  it("reads QR payments and account payments with English amount punctuation", () => {
    expect(
      parseBancolombiaSMS(
        "Bancolombia: PERSONA EJEMPLO pagaste $23,456.78 por codigo QR desde tu cuenta *1122 a la llave 0000003344 el 05/09/2026 a las 12:24.",
      ),
    ).toMatchObject({
      matched: true,
      amountMinor: "2345678",
      date: "2026-09-05",
      merchant: "Pago QR · llave •3344",
      kind: "expense",
      instrumentHint: "1122",
    });
    expect(
      parseBancolombiaSMS(
        "Bancolombia: Pagaste $987,654.32 a SERVICIO EJEMPLO desde tu producto 1122 el 05/09/2026 21:02:36.",
      ),
    ).toMatchObject({
      matched: true,
      amountMinor: "98765432",
      merchant: "SERVICIO EJEMPLO",
      kind: "expense",
      instrumentHint: "1122",
    });
  });

  it("keeps account-to-account messages as transfers", () => {
    expect(
      parseBancolombiaSMS(
        "Bancolombia: Transferiste $45,678.90 desde tu cuenta *1122 a NEQUI *0000005566 el 06/09/26 a las 10:00.",
      ),
    ).toMatchObject({
      matched: true,
      amountMinor: "4567890",
      date: "2026-09-06",
      merchant: "Transferencia a Nequi",
      kind: "transfer",
      instrumentHint: "1122",
      counterpartyHint: "nequi",
      counterInstrumentHint: "5566",
    });
  });
});

describe("Bancolombia SMS capture", () => {
  it("records a transfer-shaped SMS as an expense when no owned destination account exists", async () => {
    const state = emptyState();
    configure(state, "accounts", {
      id: "bank",
      name: "Ahorros",
      institution: "Bancolombia",
      kind: "bank",
      openingMinor: "200000000",
      openingDate: "2026-01-01",
      eligible: true,
    });
    configure(state, "instruments", {
      id: "bank-sms",
      name: "Cuenta *1122",
      accountId: "bank",
      aliases: ["1122"],
    });
    const repo = new MemoryRepository();
    const files = new MemoryFiles();
    repo.states.set("owner", state);
    const job = captureJob(
      "owner",
      "phone",
      {
        eventId: "external-nequi",
        source: "sms",
        observedAt: now,
        message:
          "Bancolombia: Transferiste $45,678.90 desde tu cuenta *1122 a NEQUI *0000005566 el 06/09/26 a las 10:00.",
      },
      now,
    );
    await repo.putJob(job);
    await processJob(repo, files, "owner", job.id);

    const result = await repo.read("owner");
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({
      accountId: "bank",
      amountMinor: "4567890",
      kind: "expense",
      merchant: "Transferencia a Nequi",
    });
    expect(result.transactions[0].counterAccountId).toBeUndefined();
  });

  it("maps account and card suffixes, then records transfers without counting them as spending", async () => {
    const state = emptyState();
    configure(state, "accounts", {
      id: "bank",
      name: "Ahorros",
      institution: "Bancolombia",
      kind: "bank",
      openingMinor: "200000000",
      openingDate: "2026-01-01",
      eligible: true,
    });
    configure(state, "accounts", {
      id: "nequi",
      name: "Nequi",
      institution: "Nequi",
      kind: "bank",
      openingMinor: "0",
      openingDate: "2026-01-01",
      eligible: true,
    });
    configure(state, "accounts", {
      id: "card",
      name: "Visa crédito",
      institution: "Bancolombia",
      kind: "credit",
      openingMinor: "0",
      openingDate: "2026-01-01",
      eligible: false,
    });
    configure(state, "instruments", {
      id: "bank-sms",
      name: "Cuenta *1122",
      accountId: "bank",
      aliases: ["1122"],
    });
    configure(state, "instruments", {
      id: "card-sms",
      name: "Crédito *7788",
      accountId: "card",
      aliases: ["7788"],
    });
    const repo = new MemoryRepository(),
      files = new MemoryFiles();
    repo.states.set("owner", state);
    const messages = [
      [
        "purchase",
        "Bancolombia: Compraste COP12.345,67 en TIENDA EJEMPLO con tu T.Cred *7788, el 03/09/2026 a las 12:39.",
      ],
      [
        "qr",
        "Bancolombia: PERSONA EJEMPLO pagaste $23,456.78 por codigo QR desde tu cuenta *1122 a la llave 0000003344 el 05/09/2026 a las 12:24.",
      ],
      [
        "transfer",
        "Bancolombia: Transferiste $45,678.90 desde tu cuenta *1122 a NEQUI *0000005566 el 06/09/26 a las 10:00.",
      ],
    ];
    for (const [eventId, message] of messages) {
      const job = captureJob(
        "owner",
        "phone",
        { eventId, source: "sms", observedAt: now, message },
        now,
      );
      await repo.putJob(job);
      await processJob(repo, files, "owner", job.id);
    }
    const result = await repo.read("owner");
    expect(result.transactions).toHaveLength(3);
    expect(
      result.transactions.find((t) => t.id.includes("purchase")),
    ).toMatchObject({
      accountId: "card",
      amountMinor: "1234567",
      kind: "expense",
      status: "provisional",
    });
    expect(result.transactions.find((t) => t.id.includes("qr"))).toMatchObject({
      accountId: "bank",
      amountMinor: "2345678",
      kind: "expense",
    });
    expect(
      result.transactions.find((t) => t.id.includes("transfer")),
    ).toMatchObject({
      accountId: "bank",
      counterAccountId: "nequi",
      amountMinor: "4567890",
      kind: "transfer",
    });
    expect(
      result.observations.every(
        (o) =>
          o.parserVersion === "bancolombia-sms-v1" && o.status === "linked",
      ),
    ).toBe(true);
  });
});
