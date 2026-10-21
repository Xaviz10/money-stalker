import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import type { State, Transaction } from "../../domain/model";
import { loanPurposes } from "../../domain/model";
import type {
  LoanDocument,
  LoanTerms,
  LoanScenarioInput,
  UvrQuote,
} from "../../domain/loan-model";
import {
  loanBalance,
  loanSignature,
  simulateLoan,
  addLoanMonth,
  loanDecimal as D,
  nativeMinor,
  type LoanSchedule,
} from "../../domain/loans";
import { dashboard } from "../../domain/ledger";
import {
  bogotaDate,
  decimalCOP,
  formatCOP,
  parseCOP,
} from "../../domain/money";
import { api, post } from "../api";
import { apiURL } from "../auth";
import { Field, Icon, EmptyState } from "../design-system/ui";
const displayDate = (date: string) =>
  new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
const str = (f: FormData, key: string) => String(f.get(key) ?? "").trim();
const money = (f: FormData, key: string) => parseCOP(str(f, key) || "0");
const decimal = (f: FormData, key: string) => str(f, key).replace(",", ".");
function LoanForm({
  children,
  submit,
  onSubmit,
  successMessage = "Guardado.",
}: {
  children: ReactNode;
  submit: string;
  successMessage?: string;
  onSubmit: (f: FormData, operationId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState("");
  const operationId = useRef(crypto.randomUUID());
  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    setDone("");
    try {
      await onSubmit(data, operationId.current);
      operationId.current = crypto.randomUUID();
      setDone(successMessage);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="loan-form" onSubmit={handle}>
      <fieldset disabled={busy}>
        {children}
        <button className="button primary" type="submit">
          {busy ? "Procesando…" : submit}
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="small-note">
          {done}
        </p>
      )}
    </form>
  );
}
export function Loans({
  state,
  summary,
  selectedAccount,
  refresh,
  edit,
  initialTab,
}: {
  initialTab?: string;
  state: State;
  summary?: ReturnType<typeof dashboard>;
  selectedAccount?: string;
  refresh: () => Promise<boolean>;
  edit: (t: Transaction | "new") => void;
}) {
  const accounts = state.accounts.filter((a) => a.kind === "loan");
  const createDisclosure = useRef<HTMLDetailsElement>(null);
  const [choice, setChoice] = useState(selectedAccount),
    [tab, setTab] = useState(initialTab ?? "summary");
  const [suggestion, setSuggestion] = useState<Partial<LoanTerms>>();
  useEffect(() => {
    if (accounts.some((a) => a.id === selectedAccount)) {
      setChoice(selectedAccount);
      setTab(initialTab ?? "summary");
    }
  }, [selectedAccount, initialTab]);
  const account = accounts.find((a) => a.id === choice) ?? accounts[0],
    terms = state.loans.find((l) => l.id === account?.id);
  const balance = account
    ? loanBalance(state, account.id, bogotaDate())
    : undefined;
  return (
    <div className="loans-workspace">
      <div className="loan-toolbar">
        {accounts.length > 0 && (
          <Field label="Crédito hipotecario">
            <select
              value={account?.id ?? ""}
              onChange={(e) => {
                setChoice(e.target.value);
                setSuggestion(undefined);
              }}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <details className="loan-create" ref={createDisclosure}>
          <summary>Agregar crédito hipotecario</summary>
          <LoanForm
            submit="Crear crédito"
            onSubmit={async (f, id) => {
              await post("/accounts", {
                id,
                name: str(f, "name"),
                kind: "loan",
                openingMinor: "0",
                openingDate: bogotaDate(),
                eligible: false,
              });
              await refresh();
              setChoice(id);
              if (createDisclosure.current)
                createDisclosure.current.open = false;
              setTab("summary");
            }}
          >
            <Field label="Nombre del crédito">
              <input
                name="name"
                maxLength={200}
                placeholder="Crédito de vivienda"
                required
              />
            </Field>
          </LoanForm>
        </details>
      </div>
      {!account ? (
        <EmptyState title="Tu crédito, con sus datos reales">
          Agrega tu hipoteca en pesos o UVR. Puedes empezar con el último
          extracto y completar los términos después.
        </EmptyState>
      ) : (
        <>
          <header className="loan-product-heading">
            <Icon name="loan" size={30} />
            <div>
              <h2>{account.name}</h2>
              <p>
                {terms?.denomination ?? "Denominación por confirmar"} ·{" "}
                {balance?.known
                  ? `Saldo de referencia al ${displayDate(balance.date)}`
                  : "Saldo pendiente de confirmar"}
              </p>
            </div>
            <div className="loan-current-balance">
              <span>Capital pendiente</span>
              <strong>
                {balance?.known && balance.balanceMinor !== undefined
                  ? formatCOP(balance.balanceMinor)
                  : "Sin confirmar"}
              </strong>
              {terms?.denomination === "UVR" && (
                <small>
                  {balance?.known
                    ? `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 4 }).format(Number(balance.principal))} UVR`
                    : "UVR por confirmar"}
                  {balance?.uvrDate
                    ? ` · conversión del ${displayDate(balance.uvrDate)}`
                    : ""}
                </small>
              )}
            </div>
          </header>
          <nav className="loan-tabs" aria-label="Secciones del crédito">
            {[
              ["summary", "Resumen"],
              ["movements", "Movimientos"],
              ["documents", "Documentos"],
              ["simulator", "Simulador"],
            ].map(([id, label]) => (
              <button
                type="button"
                key={id}
                className={tab === id ? "active" : ""}
                aria-current={tab === id ? "page" : undefined}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="loan-tab-content" key={`${account.id}:${tab}`}>
            {tab === "summary" && (
              <>
                {balance && balance.pendingPayments > 0 && (
                  <p className="notice">
                    {balance.pendingPayments} pagos posteriores al saldo de
                    referencia están pendientes de distribución.
                  </p>
                )}
                <dl className="loan-facts">
                  <div>
                    <dt>Próxima cuota confirmada</dt>
                    <dd>
                      {(balance?.snapshot?.nextDueMinor ?? terms?.nextDueMinor)
                        ? formatCOP(
                            (balance?.snapshot?.nextDueMinor ??
                              terms?.nextDueMinor)!,
                          )
                        : "Sin confirmar"}
                    </dd>
                  </div>
                  <div>
                    <dt>Próximo vencimiento</dt>
                    <dd>
                      {balance?.snapshot?.nextPaymentDate ??
                        terms?.nextPaymentDate ??
                        "Sin confirmar"}
                    </dd>
                  </div>
                  <div>
                    <dt>Cuotas restantes</dt>
                    <dd>
                      {balance?.snapshot?.remainingMonths ??
                        terms?.remainingMonths ??
                        "Sin confirmar"}
                    </dd>
                  </div>
                  <div>
                    <dt>Subsidio</dt>
                    <dd>
                      {terms?.subsidy
                        ? `${terms.subsidy.ratePercent}% · hasta ${terms.subsidy.endDate ?? "fecha por confirmar"}`
                        : "Sin configurar"}
                    </dd>
                  </div>
                </dl>
                <details className="loan-details" open={!terms || !!suggestion}>
                  <summary>Configurar datos del crédito</summary>
                  <LoanTermsForm
                    key={`${terms?.revision ?? 0}:${JSON.stringify(suggestion)}`}
                    loanId={account.id}
                    terms={terms}
                    suggestion={suggestion}
                    refresh={refresh}
                    onDone={() => setSuggestion(undefined)}
                  />
                </details>
                {terms && (
                  <LoanAdjustments
                    state={state}
                    loanId={account.id}
                    refresh={refresh}
                  />
                )}
              </>
            )}
            {tab === "movements" && (
              <LoanMovements
                state={state}
                loanId={account.id}
                refresh={refresh}
                edit={edit}
              />
            )}
            {tab === "documents" && (
              <LoanDocuments
                state={state}
                loanId={account.id}
                refresh={refresh}
                configure={(v) => {
                  setSuggestion(v);
                  setTab("summary");
                }}
              />
            )}
            {tab === "simulator" && (
              <LoanSimulator
                state={state}
                loanId={account.id}
                summary={summary}
                refresh={refresh}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
function LoanTermsForm({
  loanId,
  terms,
  suggestion,
  refresh,
  onDone,
}: {
  loanId: string;
  terms?: LoanTerms;
  suggestion?: Partial<LoanTerms> & { subsidyRateHint?: string };
  refresh: () => Promise<boolean>;
  onDone: () => void;
}) {
  const initial = { ...terms, ...suggestion },
    [denomination, setDenomination] = useState(initial.denomination ?? "COP"),
    [subsidy, setSubsidy] = useState(
      !!initial.subsidy || !!suggestion?.subsidyRateHint,
    );
  return (
    <LoanForm
      submit="Guardar datos del crédito"
      onSubmit={async (f) => {
        const data = {
          id: loanId,
          revision: terms?.revision ?? 0,
          denomination,
          rateConvention: str(f, "rateConvention"),
          method: str(f, "method"),
          dayCount: str(f, "dayCount"),
          notes: str(f, "notes"),
          ...(terms
            ? { principal: terms.principal, balanceDate: terms.balanceDate }
            : str(f, "principal")
              ? {
                  principal: decimal(f, "principal"),
                  balanceDate: str(f, "balanceDate"),
                }
              : {}),
          ...(str(f, "ratePercent")
            ? { ratePercent: decimal(f, "ratePercent") }
            : {}),
          ...(str(f, "remainingMonths")
            ? { remainingMonths: Number(str(f, "remainingMonths")) }
            : {}),
          ...(str(f, "nextPaymentDate")
            ? { nextPaymentDate: str(f, "nextPaymentDate") }
            : {}),
          ...(str(f, "nextDue") ? { nextDueMinor: money(f, "nextDue") } : {}),
          ...(str(f, "insurance")
            ? { insuranceMinor: money(f, "insurance") }
            : {}),
          ...(str(f, "fees") ? { feesMinor: money(f, "fees") } : {}),
          ...(denomination === "UVR" && str(f, "uvrValue")
            ? { uvrValue: decimal(f, "uvrValue"), uvrDate: str(f, "uvrDate") }
            : {}),
          ...(subsidy
            ? {
                subsidy: {
                  ratePercent: decimal(f, "subsidyRate"),
                  convention: str(f, "subsidyConvention"),
                  ...(str(f, "subsidyStart")
                    ? { startDate: str(f, "subsidyStart") }
                    : {}),
                  ...(str(f, "subsidyEnd")
                    ? { endDate: str(f, "subsidyEnd") }
                    : {}),
                },
              }
            : {}),
        };
        await post("/loans/terms", data);
        await refresh();
        onDone();
      }}
    >
      <p className="small-note">
        Confirma cada dato con tu contrato o extracto. Puedes guardar datos
        incompletos; el simulador indicará qué falta. Los decimales de UVR y
        tasas usan punto, sin separadores de miles.
      </p>
      <div className="form-grid">
        <Field label="Denominación">
          <select
            value={denomination}
            onChange={(e) => setDenomination(e.target.value as "COP" | "UVR")}
            disabled={!!terms}
          >
            <option value="COP">Pesos (COP)</option>
            <option value="UVR">UVR</option>
          </select>
        </Field>
        {!terms && (
          <>
            <Field label={`Capital inicial confirmado (${denomination})`}>
              <input
                name="principal"
                inputMode="decimal"
                defaultValue={initial.principal}
              />
            </Field>
            <Field label="Fecha del capital confirmado">
              <input
                name="balanceDate"
                type="date"
                max={bogotaDate()}
                defaultValue={initial.balanceDate}
              />
            </Field>
          </>
        )}
        <Field label="Tasa de interés contratada (%)">
          <input
            name="ratePercent"
            inputMode="decimal"
            defaultValue={initial.ratePercent}
          />
        </Field>
        <Field label="Convención de tasa">
          <select
            name="rateConvention"
            defaultValue={initial.rateConvention ?? "effectiveAnnual"}
          >
            <option value="effectiveAnnual">Efectiva anual</option>
            <option value="effectiveMonthly">Efectiva mensual</option>
          </select>
        </Field>
        <Field label="Método de amortización">
          <select name="method" defaultValue={initial.method ?? "constant"}>
            <option value="constant">Cuota constante en la denominación</option>
            <option value="unsupported">Otro / pendiente de confirmar</option>
          </select>
        </Field>
        <Field label="Convención de períodos">
          <select name="dayCount" defaultValue={initial.dayCount ?? "monthly"}>
            <option value="monthly">Mensual equivalente</option>
            <option value="other">Otra / requiere validación</option>
          </select>
        </Field>
        <Field label="Cuotas restantes">
          <input
            name="remainingMonths"
            type="number"
            min="1"
            max="600"
            defaultValue={initial.remainingMonths}
          />
        </Field>
        <Field label="Próximo vencimiento">
          <input
            name="nextPaymentDate"
            type="date"
            defaultValue={initial.nextPaymentDate}
          />
        </Field>
        <Field label="Próxima cuota total confirmada (COP)">
          <input
            name="nextDue"
            inputMode="decimal"
            defaultValue={
              initial.nextDueMinor === undefined
                ? ""
                : decimalCOP(initial.nextDueMinor)
            }
          />
        </Field>
        <Field label="Seguros mensuales confirmados (COP)">
          <input
            name="insurance"
            inputMode="decimal"
            defaultValue={
              initial.insuranceMinor === undefined
                ? ""
                : decimalCOP(initial.insuranceMinor)
            }
          />
        </Field>
        <Field label="Otros cargos mensuales (COP)">
          <input
            name="fees"
            inputMode="decimal"
            defaultValue={
              initial.feesMinor === undefined
                ? ""
                : decimalCOP(initial.feesMinor)
            }
          />
        </Field>
        {denomination === "UVR" && (
          <>
            <Field label="Valor de una UVR (COP)">
              <input
                name="uvrValue"
                inputMode="decimal"
                defaultValue={initial.uvrValue}
              />
            </Field>
            <Field label="Fecha de la cotización UVR">
              <input
                name="uvrDate"
                type="date"
                max={bogotaDate()}
                defaultValue={initial.uvrDate}
              />
            </Field>
          </>
        )}
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={subsidy}
          onChange={(e) => setSubsidy(e.target.checked)}
        />{" "}
        El crédito tiene subsidio de intereses
      </label>
      {subsidy && (
        <div className="form-grid">
          <Field label="Tasa de cobertura del subsidio (%)">
            <input
              name="subsidyRate"
              inputMode="decimal"
              defaultValue={
                initial.subsidy?.ratePercent ?? suggestion?.subsidyRateHint
              }
              required
            />
          </Field>
          <Field label="Convención del subsidio">
            <select
              name="subsidyConvention"
              defaultValue={initial.subsidy?.convention ?? "effectiveAnnual"}
            >
              <option value="effectiveAnnual">Efectiva anual</option>
              <option value="effectiveMonthly">Efectiva mensual</option>
            </select>
          </Field>
          <Field label="Inicio del subsidio">
            <input
              type="date"
              name="subsidyStart"
              defaultValue={initial.subsidy?.startDate}
            />
          </Field>
          <Field label="Fin del subsidio">
            <input
              type="date"
              name="subsidyEnd"
              defaultValue={initial.subsidy?.endDate}
            />
            <small>Necesario para proyectar todo el crédito.</small>
          </Field>
        </div>
      )}
      <Field label="Notas del contrato">
        <textarea name="notes" maxLength={1000} defaultValue={initial.notes} />
      </Field>
    </LoanForm>
  );
}
function LoanAdjustments({
  state,
  loanId,
  refresh,
  sourceDoc,
}: {
  state: State;
  loanId: string;
  refresh: () => Promise<boolean>;
  sourceDoc?: LoanDocument;
}) {
  const balance = loanBalance(state, loanId, bogotaDate()),
    history = state.loanSnapshots
      .filter((s) => s.loanId === loanId)
      .sort((a, b) => b.sequence - a.sequence);
  return (
    <details className="loan-details">
      <summary>Ajustar saldo según extracto</summary>
      <p>
        El saldo es al cierre de la fecha elegida: los pagos de ese día y
        anteriores ya están incluidos. Este ajuste no crea una salida de
        efectivo ni un gasto.
      </p>
      <LoanForm
        submit="Confirmar ajuste de deuda"
        onSubmit={async (f, id) => {
          await post("/loans/snapshots", {
            id,
            loanId,
            date: str(f, "date"),
            principal: decimal(f, "principal"),
            reason: str(f, "reason"),
            ...(str(f, "documentId")
              ? { documentId: str(f, "documentId") }
              : {}),
            ...(str(f, "remaining")
              ? { remainingMonths: Number(str(f, "remaining")) }
              : {}),
            ...(str(f, "next") ? { nextPaymentDate: str(f, "next") } : {}),
            ...(str(f, "snapshotDue")
              ? { nextDueMinor: money(f, "snapshotDue") }
              : {}),
            ...(balance.denomination === "UVR"
              ? { uvrValue: decimal(f, "uvr"), uvrDate: str(f, "uvrDate") }
              : {}),
          });
          await refresh();
        }}
      >
        <div className="form-grid">
          <Field label={`Capital confirmado (${balance.denomination})`}>
            <input
              name="principal"
              inputMode="decimal"
              required
              defaultValue={sourceDoc?.terms.principal ?? balance.principal}
            />
          </Field>
          <Field label="Fecha efectiva del ajuste">
            <input
              name="date"
              type="date"
              max={bogotaDate()}
              required
              defaultValue={sourceDoc?.terms.balanceDate ?? bogotaDate()}
            />
          </Field>
          <Field label="Próxima cuota total según extracto (COP)">
            <input
              name="snapshotDue"
              inputMode="decimal"
              defaultValue={
                sourceDoc?.terms.nextDueMinor
                  ? decimalCOP(sourceDoc.terms.nextDueMinor)
                  : ""
              }
            />
          </Field>
          <Field label="Cuotas restantes según extracto">
            <input
              name="remaining"
              type="number"
              min="0"
              max="600"
              defaultValue={sourceDoc?.terms.remainingMonths}
            />
          </Field>
          <Field label="Próximo vencimiento según extracto">
            <input
              name="next"
              type="date"
              defaultValue={sourceDoc?.terms.nextPaymentDate}
            />
          </Field>
          {balance.denomination === "UVR" && (
            <>
              <Field label="Cotización UVR del saldo">
                <input
                  name="uvr"
                  inputMode="decimal"
                  required
                  defaultValue={sourceDoc?.terms.uvrValue ?? balance.uvrValue}
                />
              </Field>
              <Field label="Fecha de cotización del saldo">
                <input
                  name="uvrDate"
                  type="date"
                  max={bogotaDate()}
                  required
                  defaultValue={sourceDoc ? undefined : balance.uvrDate}
                />
              </Field>
            </>
          )}
          <Field label="Documento de soporte (opcional)">
            <select name="documentId" defaultValue={sourceDoc?.id ?? ""}>
              <option value="">Ajuste manual</option>
              {state.loanDocuments
                .filter((d) => d.loanId === loanId && d.status === "confirmed")
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.filename}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Field label="Motivo del ajuste">
          <textarea name="reason" required maxLength={1000} />
        </Field>
      </LoanForm>
      <h3>Historial de saldos confirmados</h3>
      {!history.length && <p>Sin ajustes registrados.</p>}
      <ul className="loan-history">
        {history.map((s) => (
          <li key={s.id}>
            <div>
              <strong>
                {displayDate(s.date)} · {s.principal} {balance.denomination}
              </strong>
              <p>
                Anterior: {s.beforePrincipal} · Diferencia: {s.difference}
              </p>
              <p>{s.reason}</p>
              {s.voided && <small>Ajuste anulado</small>}
            </div>
            {!s.voided &&
              !history.some(
                (other) => !other.voided && other.sequence > s.sequence,
              ) && (
                <LoanForm
                  submit="Deshacer ajuste"
                  onSubmit={async () => {
                    await post("/undo", { auditId: `loan-snapshot:${s.id}` });
                    await refresh();
                  }}
                >
                  <span className="sr-only">Deshacer saldo de {s.date}</span>
                </LoanForm>
              )}
          </li>
        ))}
      </ul>
    </details>
  );
}
function LoanMovements({
  state,
  loanId,
  refresh,
  edit,
}: {
  state: State;
  loanId: string;
  refresh: () => Promise<boolean>;
  edit: (t: Transaction | "new") => void;
}) {
  const payments = state.transactions
    .filter(
      (t) =>
        !t.voided && t.kind === "loan_payment" && t.counterAccountId === loanId,
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const [merchant, setMerchant] = useState(""),
    [selected, setSelected] = useState<string[]>([]);
  const candidates = state.transactions.filter(
    (t) =>
      !t.voided &&
      t.kind === "expense" &&
      merchant.trim() &&
      t.merchant.toLocaleLowerCase("es-CO") ===
        merchant.trim().toLocaleLowerCase("es-CO") &&
      state.accounts.some(
        (a) => a.id === t.accountId && ["bank", "cash"].includes(a.kind),
      ),
  );
  return (
    <>
      <div className="section-heading">
        <h3>Pagos relacionados</h3>
        <button className="button secondary" onClick={() => edit("new")}>
          Registrar pago
        </button>
      </div>
      <p className="small-note">
        Elige Pago de crédito hipotecario en el formulario y confirma cómo
        aplicó el banco cada pago.
      </p>
      <div className="loan-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Descripción</th>
              <th>Aplicación</th>
              <th>Total</th>
              <th>Capital</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((t) => (
              <tr key={t.id}>
                <td>{displayDate(t.date)}</td>
                <td>{t.merchant}</td>
                <td>{loanPurposes[t.loanPayment?.purpose ?? "unconfirmed"]}</td>
                <td>{formatCOP(t.amountMinor)}</td>
                <td>
                  {t.loanPayment?.allocation
                    ? formatCOP(t.loanPayment.allocation.principalMinor)
                    : "Pendiente de distribuir"}
                </td>
                <td>
                  <button className="text-button" onClick={() => edit(t)}>
                    Editar pago
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!payments.length && <p>Sin pagos relacionados.</p>}
      <details className="loan-details">
        <summary>Asociar gastos históricos a este crédito</summary>
        <Field label="Comercio exacto de los pagos">
          <input
            value={merchant}
            onChange={(e) => {
              setMerchant(e.target.value);
              setSelected([]);
            }}
          />
        </Field>
        <p>
          Selecciona hasta 20 movimientos por lote. Se conserva la salida de
          dinero y queda pendiente confirmar tipo y desglose.
        </p>
        <LoanForm
          submit="Asociar movimientos seleccionados"
          onSubmit={async () => {
            if (!selected.length)
              throw new Error("Selecciona al menos un movimiento");
            await post(`/loans/${loanId}/associate`, {
              movements: candidates
                .filter((t) => selected.includes(t.id))
                .map((t) => ({ id: t.id, revision: t.revision })),
            });
            setSelected([]);
            await refresh();
          }}
        >
          <div className="loan-candidates">
            {candidates.map((t) => (
              <label className="checkbox" key={t.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(t.id)}
                  disabled={!selected.includes(t.id) && selected.length >= 20}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, t.id]
                        : ids.filter((id) => id !== t.id),
                    )
                  }
                />
                {t.date} · {t.merchant} · {formatCOP(t.amountMinor)}
              </label>
            ))}
          </div>
        </LoanForm>
      </details>
    </>
  );
}
function LoanDocuments({
  state,
  loanId,
  refresh,
  configure,
}: {
  state: State;
  loanId: string;
  refresh: () => Promise<boolean>;
  configure: (v: Partial<LoanTerms>) => void;
}) {
  const docs = state.loanDocuments.filter((d) => d.loanId === loanId),
    [doc, setDoc] = useState<LoanDocument & { candidates?: Transaction[] }>(),
    [selectedRows, setRows] = useState<string[]>([]),
    [offset, setOffset] = useState(0),
    [messages, setMessages] = useState<string[]>([]),
    [loadError, setLoadError] = useState("");
  const confirmed =
    doc &&
    state.loanDocuments.some(
      (d) => d.id === doc.id && d.status === "confirmed",
    );
  const covered = [
    ...new Set(
      docs
        .filter(
          (d) => d.status === "confirmed" && d.profile === "mortgage-monthly",
        )
        .map((d) => d.period)
        .filter((p): p is string => !!p),
    ),
  ].sort();
  const gaps: string[] = [];
  if (covered.length)
    for (
      let day = `${covered[0]}-01`;
      day.slice(0, 7) <= covered.at(-1)!;
      day = addLoanMonth(day, 1)
    )
      if (!covered.includes(day.slice(0, 7))) gaps.push(day.slice(0, 7));
  async function load(id: string) {
    setLoadError("");
    try {
      const next = await api<LoanDocument & { candidates: Transaction[] }>(
        `/loans/documents/${id}`,
      );
      setDoc(next);
      setRows([]);
      setOffset(0);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }
  return (
    <>
      <h3>Extractos y proyección del banco</h3>
      <p>
        Empieza con el último extracto y la proyección anual vigente. Agrega el
        historial disponible para contrastar pagos, subsidio y evolución de la
        deuda. Cada archivo se revisa antes de confirmarse.
      </p>
      <p className="small-note">
        Extractos mensuales confirmados: {covered.join(", ") || "ninguno"}.{" "}
        {gaps.length
          ? `Meses faltantes entre extractos: ${gaps.join(", ")}.`
          : "Sin huecos dentro del período cubierto."}{" "}
        No se presume completa la historia anterior o posterior.
      </p>
      <LoanForm
        submit="Preparar documentos"
        successMessage="Documentos preparados. Confirma cada archivo."
        onSubmit={async (f) => {
          const uploads = f.getAll("files") as File[];
          if (!uploads.some((f) => f.size))
            throw new Error("Selecciona uno o más archivos XLSX");
          setMessages([]);
          for (const file of uploads) {
            try {
              if (
                !file.size ||
                file.size > 5 * 1024 * 1024 ||
                !/\.xlsx$/i.test(file.name)
              )
                throw new Error("Usa un XLSX de hasta 5 MiB");
              const created = await post<{
                id: string;
                upload: {
                  url: string;
                  fields: Record<string, string>;
                  local?: boolean;
                };
              }>("/loans/imports", { loanId, filename: file.name });
              let response: Response;
              if (created.upload.local)
                response = await fetch(
                  `${apiURL}/local-upload?key=${encodeURIComponent(created.upload.fields.key)}`,
                  { method: "PUT", body: file },
                );
              else {
                const payload = new FormData();
                Object.entries(created.upload.fields).forEach(([key, value]) =>
                  payload.append(key, value),
                );
                payload.append("file", file);
                response = await fetch(created.upload.url, {
                  method: "POST",
                  body: payload,
                });
              }
              if (!response.ok) throw new Error("No se pudo subir el archivo");
              const next = await post<LoanDocument & { duplicate?: boolean }>(
                `/loans/imports/${created.id}/preview`,
                {},
              );
              setDoc(next);
              setRows([]);
              setOffset(0);
              setMessages((lines) => [
                ...lines,
                `${file.name}: ${next.duplicate ? "ya estaba cargado" : "vista previa preparada"}`,
              ]);
            } catch (e) {
              setMessages((lines) => [
                ...lines,
                `${file.name}: ${(e as Error).message}`,
              ]);
            }
          }
          await refresh();
        }}
      >
        <Field label="Extractos hipotecarios XLSX">
          <input name="files" type="file" accept=".xlsx" multiple required />
        </Field>
      </LoanForm>
      <ul className="loan-document-list">
        {docs.map((d) => (
          <li key={d.id}>
            <button className="text-button" onClick={() => void load(d.id)}>
              {d.filename}
            </button>
            <span>
              {d.status === "confirmed" ? "Confirmado" : "Por confirmar"} ·{" "}
              {d.profile === "mortgage-monthly"
                ? "Extracto mensual"
                : "Historia y proyección anual"}
            </span>
          </li>
        ))}
      </ul>
      {messages.length > 0 && (
        <ul role="status">
          {messages.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      {loadError && (
        <p role="alert" className="error">
          {loadError}
        </p>
      )}
      {doc && (
        <section
          aria-label="Vista previa hipotecaria"
          className="loan-document-preview"
        >
          <h3>{doc.filename}</h3>
          <p>
            {doc.rows.length} filas ·{" "}
            {confirmed
              ? "Documento confirmado"
              : "Revisa y confirma este documento"}
          </p>
          {doc.warnings.map((w, i) => (
            <p key={i} className="small-note">
              {w}
            </p>
          ))}
          <dl className="loan-facts">
            {Object.entries(doc.terms)
              .filter(([k]) =>
                [
                  "denomination",
                  "principal",
                  "balanceDate",
                  "remainingMonths",
                  "nextPaymentDate",
                  "uvrValue",
                ].includes(k),
              )
              .map(([key, value]) => (
                <div key={key}>
                  <dt>
                    {
                      {
                        denomination: "Denominación",
                        principal: "Capital reportado",
                        balanceDate: "Fecha de corte",
                        remainingMonths: "Cuotas restantes",
                        nextPaymentDate: "Vencimiento",
                        uvrValue: "Cotización UVR sin fecha confirmada",
                      }[key]
                    }
                  </dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
          </dl>
          <div className="loan-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Usar</th>
                  <th>Origen</th>
                  <th>Fecha</th>
                  <th>Descripción</th>
                  <th>Capital reportado</th>
                  <th>Total (COP)</th>
                </tr>
              </thead>
              <tbody>
                {doc.rows.slice(offset, offset + 50).map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.section === "history" &&
                        row.allocation &&
                        BigInt(row.totalMinor ?? "0") > 0n && (
                          <input
                            type="checkbox"
                            aria-label={`Usar fila ${row.row}`}
                            checked={selectedRows.includes(row.id)}
                            disabled={
                              !selectedRows.includes(row.id) &&
                              selectedRows.length >= 30
                            }
                            onChange={(e) =>
                              setRows((ids) =>
                                e.target.checked
                                  ? [...ids, row.id]
                                  : ids.filter((id) => id !== row.id),
                              )
                            }
                          />
                        )}
                    </td>
                    <td>
                      {row.section === "history"
                        ? "Historia"
                        : row.section === "projection"
                          ? "Proyección"
                          : "Subsidio"}
                    </td>
                    <td>{row.date ?? "—"}</td>
                    <td>{row.description}</td>
                    <td>{row.principal ?? "—"}</td>
                    <td>
                      {row.totalMinor
                        ? formatCOP(row.totalMinor)
                        : "Sin salida de caja"}
                      {row.roundingDifferenceMinor &&
                        BigInt(row.roundingDifferenceMinor) !== 0n && (
                          <small>
                            {" "}
                            · Diferencia de componentes:{" "}
                            {formatCOP(row.roundingDifferenceMinor)}
                          </small>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {doc.rows.length > 50 && (
            <div className="button-row">
              <button
                className="button quiet"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                Filas anteriores
              </button>
              <span>
                {offset + 1}–{Math.min(offset + 50, doc.rows.length)} de{" "}
                {doc.rows.length}
              </span>
              <button
                className="button quiet"
                disabled={offset + 50 >= doc.rows.length}
                onClick={() => setOffset(offset + 50)}
              >
                Siguientes filas
              </button>
            </div>
          )}
          {!confirmed ? (
            <LoanForm
              submit="Confirmar documento"
              onSubmit={async () => {
                await post(`/loans/documents/${doc.id}/confirm`, {});
                await refresh();
                await load(doc.id);
              }}
            >
              <p>
                Confirma que pertenece a este crédito. Se conserva como
                evidencia y no crea movimientos de efectivo.
              </p>
            </LoanForm>
          ) : (
            <>
              <button
                className="button secondary"
                onClick={() => configure(doc.terms)}
              >
                Completar datos con este documento
              </button>
              <h3>Conciliar con un pago existente</h3>
              <p>
                Selecciona los componentes de un mismo pago y luego el
                movimiento de ahorros. La suma y la fecha deben coincidir. Las
                coincidencias se limitan a movimientos existentes antes de subir
                este archivo.
              </p>
              <LoanForm
                submit="Confirmar conciliación"
                onSubmit={async (f) => {
                  const transactionId = str(f, "transactionId"),
                    t = state.transactions.find((t) => t.id === transactionId);
                  if (!t) throw new Error("Elige un movimiento");
                  await post(`/loans/documents/${doc.id}/reconcile`, {
                    transactionId,
                    expectedRevision: t.revision,
                    rowIds: selectedRows,
                    purpose: str(f, "purpose"),
                    roundingMinor: money(f, "rounding"),
                    ...(str(f, "principalUnits")
                      ? {
                          principalUnits: decimal(f, "principalUnits"),
                          uvrValue: decimal(f, "uvrValue"),
                        }
                      : {}),
                  });
                  setRows([]);
                  await refresh();
                  await load(doc.id);
                }}
              >
                <div className="form-grid">
                  <Field label="Pago existente para conciliar">
                    <select name="transactionId" required>
                      <option value="">Selecciona un pago</option>
                      {(
                        doc.candidates ??
                        state.transactions.filter(
                          (t) =>
                            doc.comparisonIds.includes(t.id) &&
                            !t.voided &&
                            ["expense", "loan_payment"].includes(t.kind),
                        )
                      ).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.date} · {t.merchant} · {formatCOP(t.amountMinor)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Diferencia de redondeo confirmada (COP)">
                    <input
                      name="rounding"
                      inputMode="decimal"
                      defaultValue="0"
                    />
                    <small>
                      Solo si el total difiere de sus componentes. Se aplica
                      explícitamente a intereses, hasta $1,00. Usa signo
                      negativo para restar.
                    </small>
                  </Field>
                  <Field label="Aplicación confirmada por el banco">
                    <select name="purpose" required>
                      {Object.entries(loanPurposes)
                        .filter(([key]) => key !== "unconfirmed")
                        .map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                    </select>
                  </Field>
                  {state.loans.find((l) => l.id === loanId)?.denomination ===
                    "UVR" && (
                    <>
                      <Field label="Capital del pago en UVR">
                        <input
                          name="principalUnits"
                          inputMode="decimal"
                          required
                        />
                      </Field>
                      <Field label="Cotización UVR de la aplicación">
                        <input name="uvrValue" inputMode="decimal" required />
                      </Field>
                    </>
                  )}
                </div>
                <p>
                  {selectedRows.length} filas seleccionadas. Solo se aceptan
                  filas históricas de pago.
                </p>
              </LoanForm>
              {state.loans.some((l) => l.id === loanId) && (
                <LoanAdjustments
                  key={doc.id}
                  state={state}
                  loanId={loanId}
                  refresh={refresh}
                  sourceDoc={doc}
                />
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
const labels = {
  base: "Sin abonos",
  term: "Reducir plazo",
  installment: "Reducir cuota",
};
function LoanSimulator({
  state,
  loanId,
  summary,
  refresh,
}: {
  state: State;
  loanId: string;
  summary?: ReturnType<typeof dashboard>;
  refresh: () => Promise<boolean>;
}) {
  const balance = loanBalance(state, loanId, bogotaDate()),
    terms = state.loans.find((l) => l.id === loanId);
  const [savedChoice, setSavedChoice] = useState(""),
    [result, setResult] = useState<ReturnType<typeof simulateLoan>>(),
    [lastInput, setInput] = useState<LoanScenarioInput>(),
    [schedule, setSchedule] = useState<LoanSchedule["strategy"]>("base"),
    [page, setPage] = useState(0);
  const saved = state.loanScenarios.find((s) => s.id === savedChoice),
    stale = result && result.signature !== loanSignature(state, loanId);
  const [uvr, setUvr] = useState<{
      quotes: UvrQuote[];
      stale: boolean;
      warning?: string;
    }>(),
    [uvrError, setUvrError] = useState("");
  const chosenSchedule = result?.schedules.find((s) => s.strategy === schedule);
  const available = summary ? BigInt(summary.availableMinor) : undefined;
  return (
    <>
      <h3>Compara el efecto de un abono</h3>
      <p>
        La misma fecha y el mismo abono en tres alternativas. Reducir cuota
        conserva el dinero liberado en efectivo, salvo que elijas mantener un
        presupuesto mensual.
      </p>
      <Field label="Escenario guardado">
        <select
          value={savedChoice}
          onChange={(e) => {
            setSavedChoice(e.target.value);
            setResult(undefined);
            setInput(undefined);
          }}
        >
          <option value="">Nueva comparación</option>
          {state.loanScenarios
            .filter((s) => s.loanId === loanId)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.signature !== loanSignature(state, loanId)
                  ? " · requiere recalcular"
                  : ""}
              </option>
            ))}
        </select>
      </Field>
      <div key={savedChoice} onInput={() => setResult(undefined)}>
        <LoanForm
          submit="Simular abono"
          successMessage="Comparación calculada. Aún no está guardada."
          onSubmit={async (f, id) => {
            const input: LoanScenarioInput = {
              id: saved?.id ?? id,
              loanId,
              name: str(f, "name") || "Comparación de abonos",
              expectedRevision: saved?.revision ?? 0,
              asOf: str(f, "asOf"),
              extraMinor: money(f, "extra"),
              extraDate: str(f, "extraDate"),
              recurringMinor: money(f, "recurring"),
              ...(str(f, "recurringStart")
                ? { recurringStart: str(f, "recurringStart") }
                : {}),
              ...(str(f, "recurringEnd")
                ? { recurringEnd: str(f, "recurringEnd") }
                : {}),
              ...(str(f, "budget")
                ? { monthlyBudgetMinor: money(f, "budget") }
                : {}),
              keepBudget: f.get("keepBudget") === "on",
              inflationPercent: decimal(f, "inflation") || "3",
            };
            const next = await post<ReturnType<typeof simulateLoan>>(
              "/loans/simulate",
              input,
            );
            setInput(input);
            setResult(next);
            setPage(0);
          }}
        >
          <div className="form-grid">
            <Field label="Nombre del escenario">
              <input
                name="name"
                defaultValue={saved?.name ?? ""}
                maxLength={100}
              />
            </Field>
            <Field label="Fecha de inicio del análisis">
              <input
                type="date"
                name="asOf"
                defaultValue={saved?.asOf ?? bogotaDate()}
                max={bogotaDate()}
                required
              />
            </Field>
            <Field label="Abono único (COP)">
              <input
                name="extra"
                inputMode="decimal"
                defaultValue={saved ? decimalCOP(saved.extraMinor) : "0"}
              />
            </Field>
            <Field label="Fecha del abono único">
              <input
                name="extraDate"
                type="date"
                defaultValue={saved?.extraDate ?? bogotaDate()}
                required
              />
            </Field>
            <Field label="Abono adicional mensual (COP)">
              <input
                name="recurring"
                inputMode="decimal"
                defaultValue={saved ? decimalCOP(saved.recurringMinor) : "0"}
              />
            </Field>
            <Field label="Inicio de abonos mensuales">
              <input
                name="recurringStart"
                type="date"
                defaultValue={saved?.recurringStart}
              />
            </Field>
            <Field label="Fin de abonos mensuales">
              <input
                name="recurringEnd"
                type="date"
                defaultValue={saved?.recurringEnd}
              />
            </Field>
            <Field label="Presupuesto mensual total para el crédito (COP)">
              <input
                name="budget"
                inputMode="decimal"
                defaultValue={
                  saved?.monthlyBudgetMinor
                    ? decimalCOP(saved.monthlyBudgetMinor)
                    : ""
                }
              />
              <small>
                Incluye cuota, seguros, cargos y abonos recurrentes. Necesario
                para abonos mensuales.
              </small>
            </Field>
            {terms?.denomination === "UVR" && (
              <Field label="Inflación anual supuesta (%)">
                <input
                  name="inflation"
                  inputMode="decimal"
                  defaultValue={saved?.inflationPercent ?? "3"}
                  required
                />
                <small>
                  Supuesto editable, no pronóstico ni UVR oficial futura.
                </small>
              </Field>
            )}
          </div>
          <label className="checkbox">
            <input
              name="keepBudget"
              type="checkbox"
              defaultChecked={saved?.keepBudget}
            />{" "}
            Mantener el presupuesto mensual y abonar a capital la diferencia
            disponible
          </label>
          <p className="small-note">
            Simular no registra un pago. Se necesita saldo, plazo y próximo
            vencimiento actualizados. Capital confirmado:{" "}
            {balance.known
              ? `${balance.principal} ${balance.denomination}`
              : "pendiente"}
            .
          </p>
        </LoanForm>
      </div>
      {terms?.denomination === "UVR" && (
        <details className="loan-details">
          <summary>Consultar UVR oficial</summary>
          <LoanForm
            submit="Consultar cotización oficial"
            successMessage="Consulta completada."
            onSubmit={async (f) => {
              setUvrError("");
              try {
                const day = str(f, "date");
                setUvr(await api(`/loans/uvr?from=${day}&to=${day}`));
              } catch (e) {
                setUvrError((e as Error).message);
              }
            }}
          >
            <Field label="Fecha de UVR a consultar">
              <input
                type="date"
                name="date"
                defaultValue={bogotaDate()}
                max={bogotaDate()}
                required
              />
            </Field>
          </LoanForm>
          {uvr?.warning && <p role="status">{uvr.warning}</p>}
          {uvrError && <p role="alert">{uvrError}</p>}
          {uvr?.quotes.map((q) => (
            <p key={q.date}>
              {q.date}: {q.value} COP por UVR · consulta{" "}
              {q.fetchedAt.slice(0, 10)}
              {uvr.stale ? " · sin actualización" : ""}
            </p>
          ))}
          <p className="small-note">
            La consulta no modifica tus saldos ni reemplaza cotizaciones del
            extracto.
          </p>
        </details>
      )}
      {result && lastInput && (
        <section
          className="loan-simulation-result"
          aria-label="Resultado de la simulación"
        >
          <h3>Comparación de alternativas</h3>
          {stale && (
            <p role="alert" className="notice">
              Los datos del crédito cambiaron. Vuelve a simular antes de usar o
              guardar esta comparación.
            </p>
          )}
          {result.warnings.map((w) => (
            <p key={w} className="small-note">
              {w}
            </p>
          ))}
          {available !== undefined && (
            <p
              className={
                available < BigInt(lastInput.extraMinor)
                  ? "notice danger"
                  : "notice"
              }
            >
              Disponible después de compromisos y reserva:{" "}
              {formatCOP(available.toString())}. Después del abono único:{" "}
              {formatCOP((available - BigInt(lastInput.extraMinor)).toString())}
              .
              {available < BigInt(lastInput.extraMinor)
                ? " El abono supera el disponible protegido."
                : ""}{" "}
              Es una comparación con el efectivo actual, sin anticipar ingresos
              futuros.
            </p>
          )}
          <LoanChart schedules={result.schedules} />
          <div className="loan-table-scroll">
            <table className="loan-comparison">
              <thead>
                <tr>
                  <th>Resultado</th>
                  {result.schedules.map((s) => (
                    <th key={s.strategy}>{labels[s.strategy]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["Termina", (s: LoanSchedule) => displayDate(s.payoffDate)],
                  [
                    "Meses ahorrados",
                    (s: LoanSchedule) => String(s.monthsSaved),
                  ],
                  [
                    "Primera cuota estimada",
                    (s: LoanSchedule) => formatCOP(s.firstPaymentMinor),
                  ],
                  [
                    "Intereses brutos",
                    (s: LoanSchedule) => formatCOP(s.interestMinor),
                  ],
                  ["Subsidios", (s: LoanSchedule) => formatCOP(s.subsidyMinor)],
                  ["Seguros", (s: LoanSchedule) => formatCOP(s.insuranceMinor)],
                  ["Otros cargos", (s: LoanSchedule) => formatCOP(s.feesMinor)],
                  [
                    "Desembolso total",
                    (s: LoanSchedule) => formatCOP(s.totalMinor),
                  ],
                  [
                    "Menor desembolso frente al caso base",
                    (s: LoanSchedule) => formatCOP(s.savingsMinor),
                  ],
                ].map(([label, value]) => (
                  <tr key={label as string}>
                    <th>{label as string}</th>
                    {result.schedules.map((s) => (
                      <td key={s.strategy}>
                        {(value as (s: LoanSchedule) => string)(s)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <LoanForm
            submit="Guardar escenario"
            onSubmit={async () => {
              if (stale)
                throw new Error("Vuelve a simular con los datos actuales");
              await post("/loans/scenarios", {
                ...lastInput,
                expectedSignature: result.signature,
              });
              await refresh();
            }}
          >
            <p>
              Guarda los supuestos; deberás recalcular si cambian el saldo o los
              pagos.
            </p>
          </LoanForm>
          <Field label="Tabla de amortización">
            <select
              value={schedule}
              onChange={(e) => {
                setSchedule(e.target.value as typeof schedule);
                setPage(0);
              }}
            >
              {result.schedules.map((s) => (
                <option key={s.strategy} value={s.strategy}>
                  {labels[s.strategy]}
                </option>
              ))}
            </select>
          </Field>
          {chosenSchedule && (
            <>
              <button
                className="button secondary"
                onClick={() =>
                  exportSchedule(chosenSchedule, terms?.denomination ?? "COP")
                }
              >
                Exportar tabla CSV
              </button>
              <div className="loan-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Saldo inicial ({terms?.denomination})</th>
                      <th>Capital</th>
                      <th>Interés COP</th>
                      <th>Subsidio COP</th>
                      <th>Cuota COP</th>
                      <th>Abono COP</th>
                      <th>Salida total COP</th>
                      <th>Saldo final ({terms?.denomination})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chosenSchedule.rows
                      .slice(page * 24, page * 24 + 24)
                      .map((r) => (
                        <tr key={r.date}>
                          <td>{r.date}</td>
                          <td>
                            {terms?.denomination === "COP"
                              ? formatCOP(nativeMinor(r.openingPrincipal))
                              : r.openingPrincipal}
                          </td>
                          <td>
                            {terms?.denomination === "COP"
                              ? formatCOP(nativeMinor(r.principal))
                              : r.principal}
                          </td>
                          <td>{formatCOP(r.interestMinor)}</td>
                          <td>{formatCOP(r.subsidyMinor)}</td>
                          <td>{formatCOP(r.installmentMinor)}</td>
                          <td>{formatCOP(r.extraMinor)}</td>
                          <td>{formatCOP(r.paymentMinor)}</td>
                          <td>
                            {terms?.denomination === "COP"
                              ? formatCOP(nativeMinor(r.closingPrincipal))
                              : r.closingPrincipal}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="button-row">
                <button
                  className="button quiet"
                  disabled={!page}
                  onClick={() => setPage(page - 1)}
                >
                  Períodos anteriores
                </button>
                <span>
                  {page * 24 + 1}–
                  {Math.min(chosenSchedule.rows.length, page * 24 + 24)} de{" "}
                  {chosenSchedule.rows.length}
                </span>
                <button
                  className="button quiet"
                  disabled={(page + 1) * 24 >= chosenSchedule.rows.length}
                  onClick={() => setPage(page + 1)}
                >
                  Siguientes períodos
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
function LoanChart({ schedules }: { schedules: LoanSchedule[] }) {
  const max = Math.max(
      ...schedules.flatMap((s) => s.rows.map((r) => Number(r.balanceMinor))),
    ),
    length = Math.max(...schedules.map((s) => s.rows.length));
  return (
    <figure className="loan-chart">
      <figcaption>Capital pendiente estimado en COP</figcaption>
      <svg
        role="img"
        aria-label="Evolución del saldo en las tres estrategias"
        viewBox="0 0 700 220"
      >
        <line
          x1="16"
          y1="200"
          x2="684"
          y2="200"
          stroke="currentColor"
          opacity=".3"
        />
        {schedules.map((s) => (
          <polyline
            key={s.strategy}
            className={`loan-line-${s.strategy}`}
            fill="none"
            strokeWidth="3"
            points={s.rows
              .map(
                (r, i) =>
                  `${16 + (i / Math.max(1, length - 1)) * 668},${200 - (Number(r.balanceMinor) / Math.max(1, max)) * 180}`,
              )
              .join(" ")}
          >
            <title>{labels[s.strategy]}</title>
          </polyline>
        ))}
      </svg>
      <ul className="loan-chart-legend">
        {schedules.map((s) => (
          <li className={`loan-line-${s.strategy}`} key={s.strategy}>
            {labels[s.strategy]}
          </li>
        ))}
      </ul>
    </figure>
  );
}
function exportSchedule(s: LoanSchedule, denomination: "COP" | "UVR") {
  const columns = [
    "Fecha",
    `SaldoInicial${denomination}`,
    `Capital${denomination}`,
    "InteresesCOP",
    "SubsidioCOP",
    "SegurosCOP",
    "OtrosCargosCOP",
    "AbonoCOP",
    "CuotaCOP",
    "SalidaTotalCOP",
    `SaldoFinal${denomination}`,
    "SaldoFinalCOP",
    "ValorUVRProyectadaCOP",
  ];
  const csv =
    "\ufeff" +
    columns.join(";") +
    "\n" +
    s.rows
      .map((r) =>
        [
          r.date,
          r.openingPrincipal.replace(".", ","),
          r.principal.replace(".", ","),
          decimalCOP(r.interestMinor),
          decimalCOP(r.subsidyMinor),
          decimalCOP(r.insuranceMinor),
          decimalCOP(r.feesMinor),
          decimalCOP(r.extraMinor),
          decimalCOP(r.installmentMinor),
          decimalCOP(r.paymentMinor),
          r.closingPrincipal.replace(".", ","),
          decimalCOP(r.balanceMinor),
          r.uvrValue?.replace(".", ",") ?? "",
        ].join(";"),
      )
      .join("\n");
  const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    ),
    link = document.createElement("a");
  link.href = url;
  link.download = `amortizacion-${s.strategy}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
