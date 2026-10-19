import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import {
  date,
  DomainError,
  type Account,
  type Observation,
  type State,
} from "../domain/model";
import { decimalCOP, parseCOP } from "../domain/money";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5000;
export type ImportRow = {
  row: number;
  status: "accepted" | "rejected";
  error?: string;
  observation?: Observation;
};
export type Profile = {
  id: string;
  label: string;
  verified: boolean;
  header: string[];
  columns: {
    date: string;
    merchant: string;
    amount: string;
    currency?: string;
    kind?: string;
    reference?: string;
    destination?: string;
  };
  strongReference: boolean;
  dateFormat: "iso" | "dmy" | "dm-statement-range";
  signed: boolean;
  fixedCurrency?: "COP";
  amountFormat?: "cop" | "english";
  extensions?: ("csv" | "xlsx")[];
  datedRowsOnly?: boolean;
  classify?: (
    merchant: string,
    amountMinor: string,
    accounts: Account[],
  ) => Pick<Observation, "kind" | "merchant"> & { counterAccountId?: string };
};
const normalizedAccountMatch = (
  accounts: Account[],
  text: string,
  kind?: Account["kind"],
) => {
  const key = normalize(text);
  const matches = accounts.filter(
    (a) =>
      (!kind || a.kind === kind) &&
      [a.name, a.institution].some(
        (value) => value && normalize(value).includes(key),
      ),
  );
  return matches.length === 1 ? matches[0].id : undefined;
};
const bancolombiaMovement = (
  merchant: string,
  amountMinor: string,
  accounts: Account[],
) => {
  const description = merchant.trim().replace(/\s+/g, " "),
    key = normalize(description);
  if (BigInt(amountMinor) > 0n)
    return { kind: "income" as const, merchant: description };
  if (/^pago suc virt tc\b/.test(key)) {
    const network = key.includes("master")
      ? "master"
      : key.includes("visa")
        ? "visa"
        : "";
    const byNetwork = network
      ? normalizedAccountMatch(accounts, network, "credit")
      : undefined;
    const creditAccounts = accounts.filter((a) => a.kind === "credit");
    return {
      kind: "transfer" as const,
      merchant: description,
      counterAccountId:
        byNetwork ??
        (creditAccounts.length === 1 ? creditAccounts[0].id : undefined),
    };
  }
  if (/^transferencias? a nequi\b/.test(key))
    return {
      kind: "transfer" as const,
      merchant: description,
      counterAccountId: normalizedAccountMatch(accounts, "nequi"),
    };
  return { kind: "expense" as const, merchant: description };
};
export const profiles: Profile[] = [
  {
    id: "bancolombia-savings-quarterly-v1",
    label: "Bancolombia · Cuenta de ahorros (XLSX trimestral)",
    verified: true,
    header: ["FECHA", "DESCRIPCIÓN", "SUCURSAL", "DCTO.", "VALOR", "SALDO"],
    columns: {
      date: "FECHA",
      merchant: "DESCRIPCIÓN",
      amount: "VALOR",
      reference: "DCTO.",
    },
    strongReference: false,
    dateFormat: "dm-statement-range",
    signed: true,
    fixedCurrency: "COP",
    amountFormat: "english",
    extensions: ["xlsx"],
    datedRowsOnly: true,
    classify: bancolombiaMovement,
  },
  {
    id: "cop-interchange-v1",
    label: "CSV/XLSX de intercambio COP (signo o tipo)",
    verified: true,
    header: ["Fecha", "Descripcion", "Valor", "Moneda", "Tipo"],
    columns: {
      date: "Fecha",
      merchant: "Descripcion",
      amount: "Valor",
      currency: "Moneda",
      kind: "Tipo",
      reference: "Referencia",
      destination: "Destino",
    },
    strongReference: false,
    dateFormat: "iso",
    signed: true,
  },
];
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const normalize = (v: unknown) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

function parseEnglishCOP(input: unknown): string {
  if (typeof input === "number") {
    if (
      !Number.isFinite(input) ||
      Math.abs(input) > Number.MAX_SAFE_INTEGER / 100
    )
      throw new DomainError("Valor fuera de rango");
    return BigInt(Math.round(input * 100)).toString();
  }
  let value = String(input ?? "")
    .trim()
    .replace(/^(COP|\$)\s*/i, "")
    .replace(/\s/g, "");
  if (
    !/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+)|\d+|\d*)(?:\.\d{1,2})?$/.test(value) ||
    !/\d/.test(value)
  )
    throw new DomainError("Valor del extracto inválido");
  const negative = value.startsWith("-");
  value = value.replace(/^[+-]/, "").replaceAll(",", "");
  const [whole = "0", decimal = ""] = value.split(".");
  const result = BigInt(whole || "0") * 100n + BigInt(decimal.padEnd(2, "0"));
  return (negative ? -result : result).toString();
}

function parseSignedCOP(input: unknown): string {
  if (typeof input === "number") {
    if (
      !Number.isFinite(input) ||
      Math.abs(input) > Number.MAX_SAFE_INTEGER / 100
    )
      throw new DomainError("Valor fuera de rango");
    return BigInt(Math.round(input * 100)).toString();
  }
  const value = String(input ?? "").trim();
  const sign = value.startsWith("-") ? -1n : 1n;
  const unsigned = value.replace(/^[+-]/, "");
  return (sign * BigInt(parseCOP(unsigned))).toString();
}

function statementWindow(grid: unknown[][]): { from: string; to: string } {
  const windows = grid.flatMap((row, index) => {
    const from = row.findIndex((v) => normalize(v) === "desde"),
      to = row.findIndex((v) => normalize(v) === "hasta");
    if (from < 0 || to < 0 || !grid[index + 1]) return [];
    const parse = (value: unknown) =>
      String(value ?? "").replace(/^(\d{4})\/(\d{2})\/(\d{2})$/, "$1-$2-$3");
    return [
      { from: parse(grid[index + 1][from]), to: parse(grid[index + 1][to]) },
    ];
  });
  if (
    !windows.length ||
    windows.some((w) => w.from !== windows[0].from || w.to !== windows[0].to)
  )
    throw new DomainError(
      "No se pudo verificar el periodo del extracto Bancolombia",
    );
  date.parse(windows[0].from);
  date.parse(windows[0].to);
  if (windows[0].from > windows[0].to)
    throw new DomainError("Periodo del extracto inválido");
  return windows[0];
}

function statementDate(
  value: unknown,
  window: { from: string; to: string },
): string {
  const match = String(value ?? "")
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) throw new DomainError("Fecha del extracto inválida");
  const endYear = Number(window.to.slice(0, 4));
  let result = `${endYear}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  date.parse(result);
  if (result > window.to) result = `${endYear - 1}-${result.slice(5)}`;
  if (result < window.from || result > window.to)
    throw new DomainError("Fecha fuera del periodo del extracto");
  return result;
}

export function parseImport(
  bytes: Uint8Array,
  filename: string,
  accountId: string,
  profileId: string,
  now: string,
  registry: Profile[] = profiles,
  accounts: Account[] = [],
): { hash: string; rows: ImportRow[]; profile: string; skippedRows: number[] } {
  if (!bytes.length || bytes.length > MAX_FILE_BYTES)
    throw new DomainError("El archivo debe pesar entre 1 byte y 5 MB");
  if (!/\.(csv|xlsx)$/i.test(filename))
    throw new DomainError("Solo CSV y XLSX; usa el PDF como referencia");
  const isCSV = /\.csv$/i.test(filename);
  let book: XLSX.WorkBook;
  try {
    const text = isCSV
      ? new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      : undefined;
    book = XLSX.read(text ?? bytes, {
      type: isCSV ? "string" : "array",
      raw: true,
      cellDates: false,
      cellFormula: true,
      sheetRows: MAX_ROWS + 100,
    });
  } catch {
    throw new DomainError(
      "Archivo inválido o codificación no soportada por este perfil (UTF-8)",
    );
  }
  if (book.SheetNames.length !== 1)
    throw new DomainError(
      "Se requiere una sola hoja; registra el formato multihoja en Phase 0",
    );
  const sheet = book.Sheets[book.SheetNames[0]];
  const range = sheet["!fullref"] ?? sheet["!ref"];
  if (range && XLSX.utils.decode_range(range).e.r > MAX_ROWS + 50)
    throw new DomainError("Máximo 5.000 movimientos por archivo");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
  });
  const extension = isCSV ? "csv" : "xlsx";
  const available = registry.filter(
    (p) => p.verified && (!p.extensions || p.extensions.includes(extension)),
  );
  const matching = available.filter((p) =>
    grid
      .slice(0, 31)
      .some((row) =>
        p.header.every((h) => row.some((v) => normalize(v) === normalize(h))),
      ),
  );
  const profile =
    profileId === "auto"
      ? matching.length === 1
        ? matching[0]
        : undefined
      : available.find((p) => p.id === profileId);
  if (!profile)
    throw new DomainError(
      profileId === "auto"
        ? "No pudimos detectar el formato; selecciona un perfil compatible"
        : "Perfil no verificado; necesitamos una muestra antes de habilitarlo",
    );
  if (
    profile.id === "bancolombia-savings-quarterly-v1" &&
    accounts.length &&
    accounts.find((a) => a.id === accountId)?.kind !== "bank"
  )
    throw new DomainError(
      "El extracto Bancolombia de ahorros debe importarse en una cuenta bancaria",
    );
  const headerIndex = grid.findIndex((row) =>
    profile.header.every((h) => row.some((v) => normalize(v) === normalize(h))),
  );
  if (headerIndex < 0 || headerIndex > 30)
    throw new DomainError(
      "Encabezados no reconocidos por el perfil; no se importó ningún movimiento",
    );
  const headers = grid[headerIndex].map(normalize);
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length)
    throw new DomainError("Encabezados duplicados");
  const read = (row: unknown[], name?: string) =>
    name ? row[headers.indexOf(normalize(name))] : undefined;
  const window =
    profile.dateFormat === "dm-statement-range"
      ? statementWindow(grid)
      : undefined;
  const fileHash = hash(bytes),
    rows: ImportRow[] = [],
    skippedRows = Array.from({ length: headerIndex + 1 }, (_, i) => i + 1);
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i];
    if (row.every((v) => v === "" || v == null)) {
      skippedRows.push(i + 1);
      continue;
    }
    if (
      profile.header.every((h) =>
        row.some((v) => normalize(v) === normalize(h)),
      )
    ) {
      skippedRows.push(i + 1);
      continue;
    }
    if (
      profile.datedRowsOnly &&
      !/^\d{1,2}\/\d{1,2}$/.test(
        String(read(row, profile.columns.date) ?? "").trim(),
      )
    ) {
      skippedRows.push(i + 1);
      continue;
    }
    if (rows.length >= MAX_ROWS)
      throw new DomainError("Máximo 5.000 movimientos por archivo");
    try {
      if (
        row.some((_, col) => sheet[XLSX.utils.encode_cell({ r: i, c: col })]?.f)
      )
        throw new DomainError("Las fórmulas no se evalúan");
      const currency =
        profile.fixedCurrency ??
        String(read(row, profile.columns.currency)).trim().toUpperCase();
      if (currency !== "COP")
        throw new DomainError("Moneda no soportada; solo COP");
      const rawDate = String(read(row, profile.columns.date) ?? "").trim();
      const day =
        profile.dateFormat === "dmy"
          ? rawDate.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1")
          : profile.dateFormat === "dm-statement-range"
            ? statementDate(rawDate, window!)
            : rawDate;
      date.parse(day);
      const rawAmount = read(row, profile.columns.amount);
      const amount =
        profile.amountFormat === "english"
          ? parseEnglishCOP(rawAmount)
          : profile.signed
            ? parseSignedCOP(rawAmount)
          : typeof rawAmount === "number"
            ? (() => {
                if (
                  !Number.isFinite(rawAmount) ||
                  Math.abs(rawAmount) > Number.MAX_SAFE_INTEGER / 100
                )
                  throw new DomainError("Valor fuera de rango");
                return parseCOP(rawAmount.toFixed(2).replace(".", ","));
              })()
            : parseCOP(String(rawAmount));
      const rawKind = normalize(read(row, profile.columns.kind));
      const kinds: Record<string, Observation["kind"]> = {
        gasto: "expense",
        ingreso: "income",
        transferencia: "transfer",
        devolucion: "refund",
      };
      const account = accounts.find((candidate) => candidate.id === accountId);
      const inferredKind =
        account?.kind === "credit"
          ? BigInt(amount) < 0n
            ? "refund"
            : "expense"
          : BigInt(amount) < 0n
            ? "expense"
            : "income";
      const merchant = String(read(row, profile.columns.merchant) ?? "")
        .trim()
        .slice(0, 200);
      const classified = profile.classify?.(merchant, amount, accounts);
      const kind =
        classified?.kind ??
        kinds[rawKind] ??
        (profile.signed ? inferredKind : undefined);
      if (!kind)
        throw new DomainError(
          "Tipo desconocido: gasto, ingreso, transferencia o devolución",
        );
      if ((!profile.signed && BigInt(amount) <= 0n) || BigInt(amount) === 0n)
        throw new DomainError("Valor debe ser positivo");
      const absolute = (
        BigInt(amount) < 0n ? -BigInt(amount) : BigInt(amount)
      ).toString();
      const reference = profile.strongReference
        ? String(read(row, profile.columns.reference) ?? "").trim() || undefined
        : undefined;
      rows.push({
        row: i + 1,
        status: "accepted",
        observation: {
          id: `import:${hash(Buffer.from(accountId)).slice(0, 12)}:${fileHash.slice(0, 32)}:${i + 1}`,
          source: "statement",
          observedAt: now,
          receivedAt: now,
          date: day,
          accountId,
          amountMinor: absolute,
          currency: "COP",
          merchant: classified?.merchant ?? merchant,
          kind,
          counterAccountId:
            classified?.counterAccountId ??
            (String(read(row, profile.columns.destination) ?? "").trim() ||
              undefined),
          reference,
          status: "review",
          candidates: [],
          parserVersion: profile.id,
        },
      });
    } catch (error) {
      rows.push({
        row: i + 1,
        status: "rejected",
        error:
          error instanceof DomainError
            ? error.message
            : "Fecha o fila inválida",
      });
    }
  }
  if (!rows.length) throw new DomainError("No se encontraron movimientos");
  return { hash: fileHash, profile: profile.id, rows, skippedRows };
}
export const safeCell = (value: string) =>
  /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
export function exportRecords(
  state: State,
  format: "csv" | "xlsx",
  accountId?: string,
): { bytes: Buffer; type: string } {
  const records = state.transactions
    .filter(
      (t) =>
        !t.voided &&
        (!accountId ||
          t.accountId === accountId ||
          t.counterAccountId === accountId),
    )
    .map((t) => ({
      ID: t.id,
      Fecha: t.date,
      Cuenta:
        state.accounts.find((a) => a.id === t.accountId)?.name ?? t.accountId,
      Destino:
        state.accounts.find((a) => a.id === t.counterAccountId)?.name ?? "",
      Tipo: t.kind,
      ValorCOP: decimalCOP(t.amountMinor),
      Moneda: "COP",
      Comercio: t.merchant,
      Categoria:
        state.categories.find((c) => c.id === t.categoryId)?.name ?? "",
      Estado: t.status,
      Evidencias: t.observationIds.join("|"),
      Ubicaciones: state.observations
        .filter((o) => o.transactionId === t.id && o.location)
        .map(
          (o) =>
            `${o.location!.latitude.toFixed(5)},${o.location!.longitude.toFixed(5)} ±${Math.round(o.location!.accuracy)}m ${o.location!.observedAt}`,
        )
        .join(" | "),
      Referencia: t.reference ?? "",
      Nota: t.note,
    }));
  const columns = [
    "ID",
    "Fecha",
    "Cuenta",
    "Destino",
    "Tipo",
    "ValorCOP",
    "Moneda",
    "Comercio",
    "Categoria",
    "Estado",
    "Evidencias",
    "Ubicaciones",
    "Referencia",
    "Nota",
  ];
  const sanitized = records.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, safeCell(v)])),
  );
  const sheet = XLSX.utils.json_to_sheet(sanitized, { header: columns });
  if (format === "csv")
    return {
      bytes: Buffer.from(
        "\uFEFF" + XLSX.utils.sheet_to_csv(sheet, { FS: ";" }),
        "utf8",
      ),
      type: "text/csv; charset=utf-8",
    };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Movimientos");
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.json_to_sheet(
      state.accounts
        .filter((a) => !accountId || a.id === accountId)
        .map((a) => ({
          ID: a.id,
          Nombre: safeCell(a.name),
          Tipo: a.kind,
          SaldoInicialCOP: decimalCOP(a.openingMinor),
          FechaInicial: a.openingDate,
        })),
    ),
    "Cuentas",
  );
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.json_to_sheet(
      state.categories.map((c) => ({ ID: c.id, Nombre: safeCell(c.name) })),
    ),
    "Categorias",
  );
  return {
    bytes: XLSX.write(book, { type: "buffer", bookType: "xlsx" }),
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}
