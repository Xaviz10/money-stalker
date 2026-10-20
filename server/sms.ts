import { date, type Account, type State } from "../domain/model";

export type ParsedBankSMS = {
  matched: boolean;
  parserVersion: "bancolombia-sms-v1";
  amountMinor?: string;
  date?: string;
  merchant?: string;
  kind?: "expense" | "income" | "transfer";
  instrumentHint?: string;
  counterpartyHint?: string;
  counterInstrumentHint?: string;
};

const compact = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const clean = (value: string) => value.trim().replace(/\s+/g, " ");

function amountMinor(raw: string): string | undefined {
  const token = raw.trim();
  let value = token.replace(/^(COP|\$)\s*/i, "").replace(/\s/g, "");
  const colombian =
    /^COP/i.test(token) ||
    /,\d{1,2}$/.test(value) ||
    /^[+-]?\d{1,3}(?:\.\d{3})+$/.test(value);
  const pattern = colombian
    ? /^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/
    : /^[+-]?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d{1,2})?$/;
  if (!pattern.test(value)) return undefined;
  const negative = value.startsWith("-");
  value = value.replace(/^[+-]/, "");
  const parts = colombian
    ? value.replaceAll(".", "").split(",")
    : value.replaceAll(",", "").split(".");
  const result =
    BigInt(parts[0]) * 100n + BigInt((parts[1] ?? "").padEnd(2, "0"));
  return (negative ? -result : result).toString();
}

function messageDate(message: string): string | undefined {
  const match = message.match(/\bel\s+(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/i);
  if (!match) return undefined;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  const value = `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return date.safeParse(value).success ? value : undefined;
}

function serviceHint(value: string): string | undefined {
  const key = compact(value);
  if (key.includes("nequi")) return "nequi";
  if (key.includes("breb")) return "bre-b";
  return undefined;
}

function trailingHint(value: string): string | undefined {
  const masked = value.match(/\*(\d{4,})/);
  return masked?.[1].slice(-4);
}

export function parseBancolombiaSMS(message: string): ParsedBankSMS {
  const text = clean(message),
    base = { matched: false, parserVersion: "bancolombia-sms-v1" as const };
  if (!/^Bancolombia:/i.test(text)) return base;
  const parsedDate = messageDate(text);

  const withdrawal = text.match(
    /Retiraste\s+((?:COP|\$)\s*[\d.,]+)\s+en\s+(.+?)\s+de\s+tu\s+T\.?Deb\s+\*{0,2}(\d{4})\s+el\s+\d{1,2}\/\d{1,2}\/\d{2,4}\b/i,
  );
  if (withdrawal)
    return {
      ...base,
      matched: true,
      amountMinor: amountMinor(withdrawal[1]),
      date: parsedDate,
      merchant: clean(withdrawal[2]),
      kind: "transfer",
      instrumentHint: withdrawal[3],
      // The owner confirms the cash destination in Review; never infer it from the ATM.
    };

  const purchase = text.match(
    /Compraste\s+((?:COP|\$)\s*[\d.,]+)\s+en\s+(.+?)(?=\s+con\s+tu\s+T\.?(?:Cred|Deb)\b|,\s*el\s+\d{1,2}\/\d{1,2}\/\d{2,4}\b)/i,
  );
  const card = text.match(/T\.?(?:Cred|Deb)\s+\*?(\d{4})\b/i);
  if (purchase && card)
    return {
      ...base,
      matched: true,
      amountMinor: amountMinor(purchase[1]),
      date: parsedDate,
      merchant: clean(purchase[2]),
      kind: "expense",
      instrumentHint: card[1],
    };

  const qr = text.match(
    /pagaste\s+((?:COP|\$)\s*[\d.,]+)\s+por\s+c[oó]digo\s+QR\s+desde\s+tu\s+cuenta\s+\*?(\d{4})\s+a\s+la\s+llave\s+([\w.+-]+)/i,
  );
  if (qr)
    return {
      ...base,
      matched: true,
      amountMinor: amountMinor(qr[1]),
      date: parsedDate,
      merchant: `Pago QR · llave •${qr[3].slice(-4)}`,
      kind: "expense",
      instrumentHint: qr[2],
      counterpartyHint: serviceHint(text),
    };

  const keyTransfer = text.match(
    /Transferiste\s+((?:COP|\$)\s*[\d.,]+)\s+a\s+la\s+llave\s+([\w.+-]+)\s+desde\s+tu\s+cuenta\s+\*?(\d{4})\s+a\s+(.+?)\s+el\s+\d{1,2}\/\d{1,2}\/\d{2,4}\b/i,
  );
  if (keyTransfer)
    return {
      ...base,
      matched: true,
      amountMinor: amountMinor(keyTransfer[1]),
      date: parsedDate,
      merchant: clean(keyTransfer[4]),
      kind: "transfer",
      instrumentHint: keyTransfer[3],
      // A Bre-B key is not an account alias; its digits cannot identify an owned account.
    };

  const received = text.match(
    /recibiste\s+una\s+transferencia\s+de\s+(.+?)\s+por\s+((?:COP|\$)\s*[\d.,]+)\s+en\s+tu\s+cuenta\s+\*?(\d{4})\b/i,
  );
  if (received)
    return {
      ...base,
      matched: true,
      amountMinor: amountMinor(received[2]),
      date: parsedDate,
      merchant: clean(received[1]),
      kind: "income",
      instrumentHint: received[3],
    };

  const transfer = text.match(
    /Transferiste\s+((?:COP|\$)\s*[\d.,]+)\s+desde\s+tu\s+cuenta\s+\*?(\d{4})\s+a\s+(.+?)\s+el\s+\d{1,2}\/\d{1,2}\/\d{2,4}\b/i,
  );
  if (transfer) {
    const service = serviceHint(transfer[3]),
      destination = trailingHint(transfer[3]);
    return {
      ...base,
      matched: true,
      amountMinor: amountMinor(transfer[1]),
      date: parsedDate,
      merchant: service
        ? `Transferencia a ${service === "bre-b" ? "Bre-B" : "Nequi"}`
        : destination
          ? `Transferencia a •${destination}`
          : "Transferencia bancaria",
      kind: "transfer",
      instrumentHint: transfer[2],
      counterpartyHint: service,
      counterInstrumentHint: destination,
    };
  }

  const payment = text.match(
    /Pagaste\s+((?:COP|\$)\s*[\d.,]+)\s+a\s+(.+?)\s+desde\s+tu\s+producto\s+\*?(\d{4})\b/i,
  );
  if (payment)
    return {
      ...base,
      matched: true,
      amountMinor: amountMinor(payment[1]),
      date: parsedDate,
      merchant: clean(payment[2]),
      kind: "expense",
      instrumentHint: payment[3],
    };

  return base;
}

function accountTextMatches(account: Account, hint: string) {
  const key = compact(hint);
  return [account.name, account.institution].some(
    (value) => value && compact(value).includes(key),
  );
}

export function resolveCapturedAccount(
  state: State,
  hint: string | undefined,
  kind?: Account["kind"],
  allowUnique = true,
): string | undefined {
  if (!hint) return undefined;
  const key = compact(hint);
  const instrumentMatches = state.instruments
    .filter((i) => i.aliases.some((alias) => compact(alias) === key))
    .map((i) => state.accounts.find((a) => a.id === i.accountId))
    .filter((a): a is Account => Boolean(a) && (!kind || a!.kind === kind));
  const direct = state.accounts.filter(
    (a) => (!kind || a.kind === kind) && accountTextMatches(a, hint),
  );
  const matches = [
    ...new Map(
      [...instrumentMatches, ...direct].map((a) => [a.id, a]),
    ).values(),
  ];
  if (matches.length === 1) return matches[0].id;
  if (!allowUnique) return undefined;
  const eligible = state.accounts.filter((a) => !kind || a.kind === kind);
  return eligible.length === 1 ? eligible[0].id : undefined;
}

export function resolveCapturedDestination(
  state: State,
  parsed: ParsedBankSMS,
): string | undefined {
  const byInstrument = resolveCapturedAccount(
    state,
    parsed.counterInstrumentHint,
    undefined,
    false,
  );
  if (byInstrument) return byInstrument;
  if (!parsed.counterpartyHint) return undefined;
  const matches = state.accounts.filter((a) =>
    accountTextMatches(a, parsed.counterpartyHint!),
  );
  return matches.length === 1 ? matches[0].id : undefined;
}
