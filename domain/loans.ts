import Decimal from "decimal.js";
import {
  DomainError,
  accountSchema,
  requireValue,
  type State,
  type Transaction,
  type TransactionInput,
  type Entry,
} from "./model";
import {
  loanSnapshotSchema,
  loanTermsSchema,
  loanScenarioSchema,
  type LoanScenarioInput,
  type LoanTerms,
} from "./loan-model";
import { bogotaDate } from "./money";
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const loanDecimal = D;
export const nativeMinor = (value: Decimal.Value) =>
  new D(value).mul(100).toFixed(0);
export const loanCostMinor = (
  t: Pick<TransactionInput, "kind" | "amountMinor" | "loanPayment">,
) =>
  t.kind === "loan_payment"
    ? t.loanPayment?.allocation
      ? ["interestMinor", "lateInterestMinor", "insuranceMinor", "feesMinor"]
          .reduce(
            (n, k) =>
              n + BigInt(t.loanPayment!.allocation![k as "interestMinor"]),
            0n,
          )
          .toString()
      : "0"
    : t.amountMinor;
export function expenseMovements(transactions: Transaction[]): Transaction[] {
  return transactions.flatMap((t) =>
    t.kind === "loan_payment"
      ? BigInt(loanCostMinor(t))
        ? [{ ...t, kind: "expense" as const, amountMinor: loanCostMinor(t) }]
        : []
      : [t],
  );
}
export const findLoan = (state: State, loanId: string) =>
  requireValue(
    state.accounts.find((a) => a.id === loanId && a.kind === "loan"),
    "Crédito desconocido",
  );
export function loanPaymentEntries(state: State, t: TransactionInput): Entry[] {
  if (t.kind !== "loan_payment") {
    if (t.loanPayment)
      throw new DomainError(
        "El desglose solo corresponde a un pago de crédito",
      );
    if (
      [t.accountId, t.counterAccountId].some((id) =>
        state.accounts.some((a) => a.id === id && a.kind === "loan"),
      )
    )
      throw new DomainError(
        "Usa Pago de crédito para registrar pagos hipotecarios",
      );
    return [];
  }
  if (
    !state.accounts.some(
      (a) => a.id === t.accountId && ["bank", "cash"].includes(a.kind),
    )
  )
    throw new DomainError("Paga el crédito desde ahorros o efectivo");
  findLoan(state, requireValue(t.counterAccountId, "Selecciona el crédito"));
  const payment = requireValue(t.loanPayment, "Indica el tipo de pago");
  if (
    payment.documentId &&
    !state.loanDocuments.some(
      (d) =>
        d.id === payment.documentId &&
        d.loanId === t.counterAccountId &&
        d.status === "confirmed",
    )
  )
    throw new DomainError(
      "El extracto asociado no pertenece a este crédito o no está confirmado",
    );
  if (payment.documentRowIds?.length && !payment.documentId)
    throw new DomainError("Falta el documento de soporte de las filas");
  if (
    payment.documentRowIds?.some((rowId) =>
      state.transactions.some(
        (other) =>
          other.id !== t.id &&
          !other.voided &&
          other.loanPayment?.documentRowIds?.includes(rowId),
      ),
    )
  )
    throw new DomainError(
      "Una fila del extracto ya está vinculada a otro pago",
      409,
    );
  const a = payment.allocation;
  const line = (accountId: string, debitMinor: string, creditMinor = "0") => ({
    accountId,
    debitMinor,
    creditMinor,
  });
  if (!a)
    return [
      line(t.accountId, "0", t.amountMinor),
      line(`loan-pending:${t.counterAccountId}`, t.amountMinor),
    ];
  if (payment.purpose === "unconfirmed")
    throw new DomainError("Confirma el tipo de pago antes de distribuirlo");
  const total =
    BigInt(a.principalMinor) +
    BigInt(a.interestMinor) +
    BigInt(a.lateInterestMinor) +
    BigInt(a.insuranceMinor) +
    BigInt(a.feesMinor);
  if (total !== BigInt(t.amountMinor))
    throw new DomainError(
      "Capital, intereses, mora, seguros y cargos deben sumar el pago completo",
    );
  const terms = state.loans.find((l) => l.id === t.counterAccountId);
  if (!terms)
    throw new DomainError(
      "Configura la denominación del crédito antes de distribuir el pago",
    );
  if (
    !loanBalance(state, t.counterAccountId!, t.date).known &&
    BigInt(a.principalMinor) > 0n
  )
    throw new DomainError(
      "Confirma el saldo del crédito antes de distribuir capital",
    );
  if (
    terms?.denomination === "UVR" &&
    (BigInt(a.principalMinor) > 0n ||
      (a.principalUnits !== undefined && new D(a.principalUnits).gt(0)))
  ) {
    if (
      !a.principalUnits ||
      !a.uvrValue ||
      a.uvrDate !== t.date ||
      new D(a.uvrValue).lte(0)
    )
      throw new DomainError(
        "Confirma capital en UVR y valor de UVR en la fecha de aplicación",
      );
    if (
      new D(nativeMinor(new D(a.principalUnits).mul(a.uvrValue)))
        .minus(a.principalMinor)
        .abs()
        .gt(2)
    )
      throw new DomainError(
        "El capital en UVR y COP no coincide con la cotización (tolerancia $0,02)",
      );
  }
  if (terms?.denomination !== "UVR" && a.principalUnits)
    throw new DomainError("No uses unidades UVR en un crédito en pesos");
  const category = state.categories.find((c) => c.id === t.categoryId);
  if (!category || !["both", "expense"].includes(category.scope))
    throw new DomainError("Selecciona una categoría de gasto para los costos");
  loanBalance(
    {
      ...state,
      transactions: [
        ...state.transactions.filter((old) => old.id !== t.id),
        { ...t, entries: [], observationIds: [], revision: 0 },
      ],
    },
    t.counterAccountId!,
    bogotaDate(),
  );
  return [
    line(t.accountId, "0", t.amountMinor),
    line(t.counterAccountId!, a.principalMinor),
    line(`expense:${t.categoryId}`, loanCostMinor(t)),
  ].filter((e) => e.debitMinor !== "0" || e.creditMinor !== "0");
}
export function saveLoanTerms(state: State, input: unknown, at: string) {
  const value = loanTermsSchema.parse(input);
  findLoan(state, value.id);
  if (
    (value.balanceDate && value.balanceDate > bogotaDate(new Date(at))) ||
    (value.uvrDate && value.uvrDate > bogotaDate(new Date(at)))
  )
    throw new DomainError(
      "No uses fechas futuras para saldos o cotizaciones confirmadas",
    );
  const old = state.loans.find((l) => l.id === value.id);
  if (
    old &&
    old.revision === value.revision + 1 &&
    JSON.stringify({ ...old, revision: 0 }) ===
      JSON.stringify({ ...value, revision: 0 })
  )
    return old;
  if (old && old.revision !== value.revision)
    throw new DomainError("El crédito cambió; actualiza los datos", 409);
  if (
    old &&
    ["principal", "balanceDate", "denomination"].some(
      (k) => old[k as keyof LoanTerms] !== value[k as keyof LoanTerms],
    )
  )
    throw new DomainError(
      "Usa Ajustar saldo para cambiar la deuda; la denominación no se modifica",
    );
  const result = { ...value, revision: (old?.revision ?? 0) + 1 };
  if (old) Object.assign(old, result);
  else state.loans.push(result);
  state.audit.push({
    id: `loan-terms:${value.id}:${result.revision}`,
    at,
    action: "loan-terms",
  });
  return result;
}
export function createLoanForMovement(
  state: State,
  input: { id: string; name: string },
  date: string,
) {
  if (state.accounts.some((a) => a.id === input.id))
    throw new DomainError("El producto ya existe", 409);
  state.accounts.push(
    accountSchema.parse({
      ...input,
      kind: "loan",
      openingMinor: "0",
      openingDate: date,
      eligible: false,
    }),
  );
}
export function loanBalance(state: State, loanId: string, asOf: string) {
  const account = findLoan(state, loanId),
    terms = state.loans.find((l) => l.id === loanId);
  const snapshot = state.loanSnapshots
    .filter((s) => s.loanId === loanId && !s.voided && s.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date) || a.sequence - b.sequence)
    .at(-1);
  const date = snapshot?.date ?? terms?.balanceDate ?? account.openingDate;
  const native = terms?.denomination ?? "COP";
  let principal = new D(
    date <= asOf
      ? (snapshot?.principal ??
        terms?.principal ??
        (native === "COP"
          ? new D(account.openingMinor).div(100).toFixed()
          : "0"))
      : "0",
  );
  let uvrValue = snapshot?.uvrValue ?? terms?.uvrValue;
  let uvrDate = snapshot?.uvrDate ?? terms?.uvrDate;
  const payments = state.transactions.filter(
    (t) =>
      !t.voided &&
      t.kind === "loan_payment" &&
      t.counterAccountId === loanId &&
      t.date > date &&
      t.date <= asOf,
  );
  for (const t of payments) {
    const a = t.loanPayment?.allocation;
    if (a)
      principal = principal.minus(
        native === "UVR"
          ? (a.principalUnits ?? "0")
          : new D(a.principalMinor).div(100),
      );
    if (a?.uvrValue && a.uvrDate && (!uvrDate || a.uvrDate > uvrDate)) {
      uvrValue = a.uvrValue;
      uvrDate = a.uvrDate;
    }
  }
  if (principal.lt(0))
    throw new DomainError(
      "Los abonos superan el saldo confirmado; concilia el crédito",
    );
  return {
    principal: principal.toFixed(native === "UVR" ? 8 : 2),
    date,
    denomination: native,
    uvrValue,
    uvrDate,
    balanceMinor:
      native === "COP"
        ? nativeMinor(principal)
        : uvrValue
          ? nativeMinor(principal.mul(uvrValue))
          : undefined,
    snapshot,
    pendingPayments: payments.filter((t) => !t.loanPayment?.allocation).length,
    known:
      date <= asOf &&
      (snapshot !== undefined ||
        terms?.principal !== undefined ||
        (native === "COP" && BigInt(account.openingMinor) > 0n)),
  };
}
export function adjustLoanBalance(state: State, input: unknown, at: string) {
  const v = loanSnapshotSchema.parse(input);
  findLoan(state, v.loanId);
  const signature = JSON.stringify(v),
    old = state.loanSnapshots.find((s) => s.id === v.id);
  if (old) {
    if (old.requestSignature !== signature)
      throw new DomainError("Identificador de ajuste reutilizado", 409);
    return old;
  }
  if (v.date > bogotaDate(new Date(at)))
    throw new DomainError("El saldo confirmado no puede tener fecha futura");
  if (
    v.documentId &&
    !state.loanDocuments.some(
      (d) =>
        d.id === v.documentId &&
        d.loanId === v.loanId &&
        d.status === "confirmed",
    )
  )
    throw new DomainError(
      "Confirma el documento antes de usarlo como evidencia",
    );
  const terms = state.loans.find((l) => l.id === v.loanId);
  if (!terms)
    throw new DomainError(
      "Configura la denominación del crédito antes de ajustar",
    );
  if (
    terms.denomination === "UVR" &&
    (!v.uvrValue || !v.uvrDate || v.uvrDate > v.date)
  )
    throw new DomainError(
      "Indica la cotización UVR y su fecha, sin usar una cotización futura",
    );
  const before = loanBalance(state, v.loanId, v.date);
  const snapshot = {
    ...v,
    at,
    sequence: Math.max(0, ...state.loanSnapshots.map((s) => s.sequence)) + 1,
    beforePrincipal: before.principal,
    difference: new D(v.principal).minus(before.principal).toFixed(),
    requestSignature: signature,
  };
  loanBalance(
    { ...state, loanSnapshots: [...state.loanSnapshots, snapshot] },
    v.loanId,
    bogotaDate(new Date(at)),
  );
  state.loanSnapshots.push(snapshot);
  state.audit.push({
    id: `loan-snapshot:${v.id}`,
    at,
    action: "loan-snapshot",
    loanSnapshotId: v.id,
  });
  return snapshot;
}
export function loanSignature(state: State, loanId: string) {
  const text = JSON.stringify([
    state.loans.find((l) => l.id === loanId),
    state.loanSnapshots.filter((s) => s.loanId === loanId),
    state.transactions
      .filter((t) => t.counterAccountId === loanId)
      .map((t) => [t.id, t.revision, t.voided]),
    state.loanDocuments
      .filter((d) => d.loanId === loanId && d.status === "confirmed")
      .map((d) => d.id),
  ]);
  let hash = 0x6c62272e07bb014262b821756295c58dn;
  for (const char of text)
    hash = BigInt.asUintN(
      128,
      (hash ^ BigInt(char.codePointAt(0)!)) * 0x1000000000000000000013bn,
    );
  return hash.toString(16).padStart(32, "0");
}
export function saveLoanScenario(state: State, input: unknown, at: string) {
  const value = loanScenarioSchema.parse(input);
  findLoan(state, value.loanId);
  const old = state.loanScenarios.find((s) => s.id === value.id);
  if (old && old.loanId !== value.loanId)
    throw new DomainError("El escenario pertenece a otro crédito");
  const signature = loanSignature(state, value.loanId);
  if (value.expectedSignature && value.expectedSignature !== signature)
    throw new DomainError(
      "Los datos del crédito cambiaron; vuelve a simular",
      409,
    );
  if (old && old.revision !== (value.expectedRevision ?? 0)) {
    const comparable = (v: typeof value) =>
      JSON.stringify({
        ...v,
        expectedRevision: undefined,
        expectedSignature: undefined,
        signature: undefined,
        at: undefined,
        revision: undefined,
      });
    if (
      old.revision === (value.expectedRevision ?? 0) + 1 &&
      comparable(old) === comparable(value) &&
      old.signature === signature
    )
      return old;
    throw new DomainError(
      "El escenario cambió; actualiza antes de guardar",
      409,
    );
  }
  const result = {
    ...value,
    signature,
    at,
    revision: (old?.revision ?? 0) + 1,
  };
  if (old) Object.assign(old, result);
  else state.loanScenarios.push(result);
  return result;
}
export const addLoanMonth = (date: string, months: number) => {
  const [y, m, d] = date.split("-").map(Number),
    end = new Date(Date.UTC(y, m - 1 + months + 1, 0));
  return `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, end.getUTCDate())).padStart(2, "0")}`;
};
const monthlyRate = (rate: string, convention: string) =>
  convention === "effectiveMonthly"
    ? new D(rate).div(100)
    : new D(1).plus(new D(rate).div(100)).pow(new D(1).div(12)).minus(1);
const installment = (principal: Decimal, rate: Decimal, n: number) =>
  rate.isZero()
    ? principal.div(n)
    : principal.mul(rate).div(new D(1).minus(new D(1).plus(rate).pow(-n)));
export type LoanScheduleRow = {
  date: string;
  openingPrincipal: string;
  principal: string;
  interestMinor: string;
  subsidyMinor: string;
  insuranceMinor: string;
  feesMinor: string;
  extraMinor: string;
  paymentMinor: string;
  closingPrincipal: string;
  balanceMinor: string;
  uvrValue?: string;
  installmentMinor: string;
  installmentUnits: string;
};
export type LoanSchedule = {
  strategy: "base" | "term" | "installment";
  rows: LoanScheduleRow[];
  payoffDate: string;
  totalMinor: string;
  interestMinor: string;
  subsidyMinor: string;
  insuranceMinor: string;
  feesMinor: string;
  monthsSaved: number;
  savingsMinor: string;
  firstPaymentMinor: string;
};
export function simulateLoan(
  state: State,
  input: unknown,
): { schedules: LoanSchedule[]; warnings: string[]; signature: string } {
  const v: LoanScenarioInput = loanScenarioSchema.parse(input),
    terms = requireValue(
      state.loans.find((l) => l.id === v.loanId),
      "Configura el crédito",
    );
  const balance = loanBalance(state, v.loanId, v.asOf),
    snapshot = balance.snapshot;
  const missing: string[] = [];
  if (!balance.known) missing.push("saldo y fecha");
  if (terms.ratePercent === undefined) missing.push("tasa contratada");
  if (!terms.remainingMonths && !snapshot?.remainingMonths)
    missing.push("plazo restante");
  if (snapshot && snapshot.remainingMonths === undefined)
    missing.push("cuotas restantes del saldo ajustado");
  if (snapshot && !snapshot.nextPaymentDate)
    missing.push("próximo vencimiento del saldo ajustado");
  if (!terms.nextPaymentDate && !snapshot?.nextPaymentDate)
    missing.push("próxima fecha de pago");
  if (terms.insuranceMinor === undefined || terms.feesMinor === undefined)
    missing.push("seguros y cargos (confirma cero si no aplican)");
  if (terms.denomination === "UVR" && (!balance.uvrValue || !balance.uvrDate))
    missing.push("cotización UVR y fecha");
  if (terms.subsidy && !terms.subsidy.endDate)
    missing.push("fecha de fin del subsidio");
  if (terms.subsidy && !terms.subsidy.startDate)
    missing.push("fecha de inicio del subsidio");
  if (missing.length)
    throw new DomainError(`Falta confirmar: ${missing.join(", ")}`);
  if (v.asOf > bogotaDate() || (balance.uvrDate && balance.uvrDate > v.asOf))
    throw new DomainError(
      "El inicio debe corresponder a datos reales y la cotización UVR no puede ser posterior",
    );
  if (terms.method !== "constant" || terms.dayCount !== "monthly")
    throw new DomainError(
      "Este método o convención requiere un motor específico; puedes mantener el seguimiento documental",
    );
  if (
    v.extraDate < v.asOf ||
    (v.recurringStart && v.recurringStart < v.asOf) ||
    (v.recurringEnd && v.recurringStart && v.recurringEnd < v.recurringStart)
  )
    throw new DomainError("Revisa las fechas de los abonos");
  if (
    BigInt(v.recurringMinor) > 0n &&
    (!v.recurringStart || !v.recurringEnd || !v.monthlyBudgetMinor)
  )
    throw new DomainError(
      "Para abonos recurrentes indica fechas inicial/final y presupuesto mensual",
    );
  if (v.keepBudget && !v.monthlyBudgetMinor)
    throw new DomainError("Indica el presupuesto mensual");
  if (balance.pendingPayments)
    throw new DomainError("Distribuye los pagos pendientes antes de simular");
  const firstDate = snapshot?.nextPaymentDate ?? terms.nextPaymentDate!;
  if (firstDate <= v.asOf)
    throw new DomainError(
      "Actualiza el saldo, el plazo restante y la próxima fecha de pago para simular desde esa fecha",
    );
  const n = snapshot?.remainingMonths ?? terms.remainingMonths!;
  if (!n || new D(balance.principal).isZero())
    throw new DomainError("El crédito ya está cancelado");
  if (BigInt(v.extraMinor) > 0n && v.extraDate > addLoanMonth(firstDate, n - 1))
    throw new DomainError(
      "El abono único queda después del último vencimiento",
    );
  const grossRate = monthlyRate(terms.ratePercent!, terms.rateConvention),
    subsidyRate = terms.subsidy
      ? monthlyRate(terms.subsidy.ratePercent, terms.subsidy.convention)
      : new D(0);
  if (subsidyRate.gt(grossRate))
    throw new DomainError("El subsidio no puede superar el interés contratado");
  const isUvr = terms.denomination === "UVR",
    decimals = isUvr ? 4 : 2;
  const quoteAt = (day: string) =>
    isUvr
      ? new D(balance.uvrValue!).mul(
          new D(1)
            .plus(new D(v.inflationPercent).div(100))
            .pow(
              new D(Date.parse(day) - Date.parse(balance.uvrDate!))
                .div(86400000)
                .div(365),
            ),
        )
      : new D(1);
  const warnings = [
    "Modelo mensual: los abonos entre vencimientos se descuentan en su fecha y afectan la siguiente cuota. No reproduce intereses diarios, descuentos por pago anticipado ni reglas no confirmadas del banco.",
    "Seguros y cargos futuros conservan los valores confirmados; no son una cotización del banco.",
  ];
  if (isUvr)
    warnings.push(
      `UVR futura estimada con inflación anual de ${v.inflationPercent}%; todas las estrategias comparten ese supuesto.`,
    );
  let referenceRows: LoanScheduleRow[] = [];
  const build = (strategy: LoanSchedule["strategy"]): LoanSchedule => {
    let p = new D(balance.principal),
      regular = installment(p, grossRate.minus(subsidyRate), n).toDecimalPlaces(
        decimals,
      ),
      lumpApplied = false;
    // A subsidy changes the owner's installment, not the contracted gross interest.
    const rows: LoanScheduleRow[] = [];
    let previousSubsidy = true;
    for (let i = 0; i < n && p.gt(0); i++) {
      const day = addLoanMonth(firstDate, i),
        quote = quoteAt(day),
        opening = p;
      const activeSubsidy =
        !!terms.subsidy &&
        day >= terms.subsidy.startDate! &&
        day <= terms.subsidy.endDate!;
      const r = grossRate.minus(activeSubsidy ? subsidyRate : 0);
      if (i === 0 || activeSubsidy !== previousSubsidy) {
        if (strategy === "term" && referenceRows[i])
          regular = new D(referenceRows[i].installmentUnits);
        else regular = installment(p, r, n - i).toDecimalPlaces(decimals);
      }
      previousSubsidy = activeSubsidy;
      let extra = new D(0);
      if (strategy !== "base" && !lumpApplied && v.extraDate <= day) {
        extra = D.min(
          p,
          new D(v.extraMinor).div(100).div(quoteAt(v.extraDate)),
        ).toDecimalPlaces(decimals);
        lumpApplied = true;
      }
      p = D.max(0, p.minus(extra));
      const canceledByLump = p.isZero() && extra.gt(0);
      if (strategy === "installment" && extra.gt(0))
        regular = installment(p, r, n - i).toDecimalPlaces(decimals);
      const interest = p.mul(grossRate).toDecimalPlaces(decimals),
        subsidy = p
          .mul(activeSubsidy ? subsidyRate : 0)
          .toDecimalPlaces(decimals);
      const costs = new D(terms.insuranceMinor!)
        .plus(terms.feesMinor!)
        .div(100);
      let duePrincipal = D.min(
        p,
        D.max(0, regular.minus(interest.minus(subsidy))),
      ).toDecimalPlaces(decimals);
      if (i === n - 1) duePrincipal = p;
      p = D.max(0, p.minus(duePrincipal));
      let recurring =
        strategy !== "base" &&
        v.recurringStart &&
        day >= v.recurringStart &&
        day <= v.recurringEnd!
          ? new D(v.recurringMinor).div(100)
          : new D(0);
      const scheduledCash = duePrincipal
        .plus(interest)
        .minus(subsidy)
        .mul(quote)
        .plus(costs);
      if (strategy !== "base" && v.keepBudget && v.monthlyBudgetMinor)
        recurring = D.max(
          recurring,
          new D(v.monthlyBudgetMinor).div(100).minus(scheduledCash),
        );
      if (
        recurring.gt(0) &&
        v.monthlyBudgetMinor &&
        recurring.plus(scheduledCash).gt(new D(v.monthlyBudgetMinor).div(100))
      )
        throw new DomainError(
          `El abono recurrente supera el presupuesto mensual en ${day}`,
        );
      const recurringUnits = D.min(p, recurring.div(quote)).toDecimalPlaces(
        decimals,
      );
      p = D.max(0, p.minus(recurringUnits));
      extra = extra.plus(recurringUnits);
      if (strategy === "installment" && recurringUnits.gt(0) && i < n - 1)
        regular = installment(p, r, n - i - 1).toDecimalPlaces(decimals);
      const extraCash = extra
        .minus(recurringUnits)
        .mul(quoteAt(v.extraDate))
        .plus(recurringUnits.mul(quote));
      rows.push({
        date: canceledByLump ? v.extraDate : day,
        openingPrincipal: opening.toFixed(decimals),
        principal: duePrincipal.toFixed(decimals),
        interestMinor: nativeMinor(interest.mul(quote)),
        subsidyMinor: nativeMinor(subsidy.mul(quote)),
        insuranceMinor: terms.insuranceMinor!,
        feesMinor: terms.feesMinor!,
        extraMinor: nativeMinor(extraCash),
        paymentMinor: nativeMinor(scheduledCash.plus(extraCash)),
        installmentMinor: nativeMinor(scheduledCash),
        installmentUnits: duePrincipal
          .plus(interest)
          .minus(subsidy)
          .toFixed(decimals),
        closingPrincipal: p.toFixed(decimals),
        balanceMinor: nativeMinor(p.mul(quote)),
        ...(isUvr ? { uvrValue: quote.toFixed(8) } : {}),
      });
    }
    const sum = (
      key:
        | "paymentMinor"
        | "interestMinor"
        | "subsidyMinor"
        | "insuranceMinor"
        | "feesMinor",
    ) => rows.reduce((s, row) => s + BigInt(row[key]), 0n).toString();
    return {
      strategy,
      rows,
      payoffDate: rows.at(-1)!.date,
      totalMinor: sum("paymentMinor"),
      interestMinor: sum("interestMinor"),
      subsidyMinor: sum("subsidyMinor"),
      insuranceMinor: sum("insuranceMinor"),
      feesMinor: sum("feesMinor"),
      monthsSaved: 0,
      savingsMinor: "0",
      firstPaymentMinor: rows[0].installmentMinor,
    };
  };
  const base = build("base");
  referenceRows = base.rows;
  const schedules = [base, build("term"), build("installment")];
  for (const s of schedules) {
    s.monthsSaved = base.rows.length - s.rows.length;
    s.savingsMinor = (
      BigInt(base.totalMinor) - BigInt(s.totalMinor)
    ).toString();
  }
  return { schedules, warnings, signature: loanSignature(state, v.loanId) };
}
