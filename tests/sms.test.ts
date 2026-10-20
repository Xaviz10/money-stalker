import { describe, expect, it } from "vitest";
import { emptyState } from "../domain/model";
import { configure } from "../domain/ledger";
import { captureJob, processJob } from "../server/processing";
import { MemoryRepository } from "../server/repository";
import { MemoryFiles } from "../server/storage";
import { parseBancolombiaSMS } from "../server/sms";

const now = "2026-10-18T18:00:00Z";

// Synthetic examples preserve bank wording without personal identifiers.
const formatCases = [
  {
    message:
      "Bancolombia: Compraste $22.000,00 en RESTAURANTE EJEMPLO con tu T.Deb *1122, el 18/10/2026 a las 10:55. Si tienes dudas, encuentranos aqui: 0000000000 o 000000000000. Estamos cerca.",
    amountMinor: "2200000",
    date: "2026-10-18",
    merchant: "RESTAURANTE EJEMPLO",
    kind: "expense",
    instrumentHint: "1122",
  },
  {
    message:
      "Bancolombia: Retiraste $1.060.000,00 en CAJERO_EJEMPLO de tu T.Deb **1122 el 29/08/2026 a las 12:06. Si tienes dudas, llamanos al 0000000000. Estamos cerca",
    amountMinor: "106000000",
    date: "2026-08-29",
    merchant: "CAJERO_EJEMPLO",
    kind: "transfer",
    instrumentHint: "1122",
  },
  {
    message:
      "Bancolombia: PERSONA, transferiste $12,000.00 a la llave 0000003344 desde tu cuenta *1122 a DESTINATARIO EJEMPLO el 10/10/26 a las 13:24. Con Bre-b es de una y gratis.",
    amountMinor: "1200000",
    date: "2026-10-10",
    merchant: "DESTINATARIO EJEMPLO",
    kind: "transfer",
    instrumentHint: "1122",
  },
  {
    message:
      "Bancolombia: PERSONA EJEMPLO pagaste $52,900.00 por codigo QR desde tu cuenta *1122 a la llave 0000003344 el 16/10/2026 a las 18:45. Con codigo QR es facil y de una.",
    amountMinor: "5290000",
    date: "2026-10-16",
    merchant: "Pago QR · llave •3344",
    kind: "expense",
    instrumentHint: "1122",
  },
  {
    message:
      "Bancolombia: Pagaste $1,312,000.00 a SERVICIO EJEMPLO desde tu producto 1122 el 12/10/2026 21:02:36. Estamos cerca",
    amountMinor: "131200000",
    date: "2026-10-12",
    merchant: "SERVICIO EJEMPLO",
    kind: "expense",
    instrumentHint: "1122",
  },
  {
    message:
      "Bancolombia: Transferiste $19,000.00 desde tu cuenta *1122 a la cuenta *0000005566 el 12/10/26 a las 11:09. Estamos cerca.",
    amountMinor: "1900000",
    date: "2026-10-12",
    merchant: "Transferencia a •5566",
    kind: "transfer",
    instrumentHint: "1122",
  },
  {
    message:
      "Bancolombia: Compraste COP9.900,00 en DLO*TIENDA ABC123 con tu T.Cred *7788, el 06/10/2026 a las 20:48. Estamos cerca.",
    amountMinor: "990000",
    date: "2026-10-06",
    merchant: "DLO*TIENDA ABC123",
    kind: "expense",
    instrumentHint: "7788",
  },
  {
    message:
      "Bancolombia: Compraste COP122.237,96 en TIENDA O*00-12345-6789 con tu T.Cred *7788, el 05/10/2026 a las 13:12. Estamos cerca.",
    amountMinor: "12223796",
    date: "2026-10-05",
    merchant: "TIENDA O*00-12345-6789",
    kind: "expense",
    instrumentHint: "7788",
  },
  {
    message:
      "Bancolombia: PERSONA, recibiste una transferencia de REMITENTE EJEMPLO por $741,000.00 en tu cuenta *1122 conectada a la llave 0000003344 el 04/10/26 a las 13:53. Con llaves es de una y gratis.",
    amountMinor: "74100000",
    date: "2026-10-04",
    merchant: "REMITENTE EJEMPLO",
    kind: "income",
    instrumentHint: "1122",
  },
] as const;

describe("Bancolombia SMS parsing", () => {
  it.each(formatCases)(
    "extracts $merchant with its amount and financial date",
    ({ message, ...expected }) => {
      expect(parseBancolombiaSMS(message)).toMatchObject({
        matched: true,
        ...expected,
      });
    },
  );

  it.each([
    ["$1.060.000,50", "106000050"],
    ["$1,060,000.50", "106000050"],
    ["$1.060.000", "106000000"],
    ["$1060000", "106000000"],
    ["$1.060,000.50", undefined],
  ])(
    "reads withdrawal amount %s without confusing separators",
    (amount, expected) => {
      expect(
        parseBancolombiaSMS(
          `Bancolombia: Retiraste ${amount} en CAJERO_EJEMPLO de tu T.Deb **1122 el 29/08/2026 a las 12:06.`,
        ).amountMinor,
      ).toBe(expected);
    },
  );

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
  it.each(formatCases)(
    "persists $merchant in Review and keeps retries idempotent",
    async ({ message, instrumentHint, kind, ...expected }) => {
      const state = emptyState();
      configure(state, "accounts", {
        id: "source",
        name: "Cuenta de prueba",
        institution: "Bancolombia",
        kind: instrumentHint === "7788" ? "credit" : "bank",
        openingMinor: "0",
        openingDate: "2026-01-01",
        eligible: true,
      });
      configure(state, "instruments", {
        id: "source-alias",
        name: "Instrumento de prueba",
        accountId: "source",
        aliases: [instrumentHint],
      });
      const repo = new MemoryRepository();
      const files = new MemoryFiles();
      repo.states.set("owner", state);
      const job = captureJob(
        "owner",
        "phone",
        { eventId: "format-case", source: "sms", observedAt: now, message },
        now,
      );
      await repo.putJob(job);
      await processJob(repo, files, "owner", job.id);
      await processJob(repo, files, "owner", job.id);
      const result = await repo.read("owner");
      expect(result.transactions).toHaveLength(0);
      expect(result.observations).toHaveLength(1);
      expect(result.observations[0]).toMatchObject({
        ...expected,
        accountId: "source",
        kind: kind === "transfer" ? "expense" : kind,
        status: "review",
      });
      expect(result.observations[0].counterAccountId).toBeUndefined();
    },
  );

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
    expect(result.transactions).toHaveLength(0);
    expect(result.observations[0]).toMatchObject({
      accountId: "bank",
      amountMinor: "4567890",
      kind: "expense",
      merchant: "Transferencia a Nequi",
      status: "review",
    });
    expect(result.observations[0].counterAccountId).toBeUndefined();
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
    expect(result.transactions).toHaveLength(0);
    expect(
      result.observations.find((t) => t.id.includes("purchase")),
    ).toMatchObject({
      accountId: "card",
      amountMinor: "1234567",
      kind: "expense",
      status: "review",
    });
    expect(result.observations.find((t) => t.id.includes("qr"))).toMatchObject({
      accountId: "bank",
      amountMinor: "2345678",
      kind: "expense",
    });
    expect(
      result.observations.find((t) => t.id.includes("transfer")),
    ).toMatchObject({
      accountId: "bank",
      counterAccountId: "nequi",
      amountMinor: "4567890",
      kind: "transfer",
    });
    expect(
      result.observations.every(
        (o) =>
          o.parserVersion === "bancolombia-sms-v1" && o.status === "review",
      ),
    ).toBe(true);
  });
});
