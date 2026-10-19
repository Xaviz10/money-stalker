import { useState } from "react";
import type { dashboard } from "../../domain/ledger";
import type { State, Transaction } from "../../domain/model";
import { formatCOP } from "../../domain/money";
import {
  Badge,
  Button,
  EmptyState,
  Eyes,
  Icon,
  Panel,
} from "../design-system/ui";
import { CategoryIcon, categoryIcons } from "./CategoryIcon";
type Summary = ReturnType<typeof dashboard>;
const categoryColors = [
  "#2356db",
  "#25826c",
  "#cc7b29",
  "#9b67b1",
  "#3d81ab",
  "#c6695c",
  "#7c8c35",
];
export function displayDate(date: string) {
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    timeZone: "America/Bogota",
  }).format(new Date(date.length === 10 ? `${date}T12:00:00Z` : date));
}
export function SurfaceLoading({ failed }: { failed: boolean }) {
  return (
    <section className="surface-loading" role="status">
      <Eyes />
      <h2>{failed ? "Nos falta una pieza." : "Buscando tus pistas…"}</h2>
      <p>
        {failed
          ? "No pudimos cargar tus datos. Usa Actualizar datos para intentar de nuevo."
          : "Estamos cargando tus cuentas y movimientos."}
      </p>
    </section>
  );
}
function Activity({
  state,
  transactions,
  open,
}: {
  state: State;
  transactions: Transaction[];
  open: (t: Transaction) => void;
}) {
  return (
    <div className="activity-ledger">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Descripción</th>
            <th className="category-column">Categoría</th>
            <th className="account-column">Cuenta</th>
            <th className="number">Monto</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr key={t.id}>
              <td className="activity-date">
                <Icon name="calendar" size={15} />
                <span>{displayDate(t.date)}</span>
              </td>
              <td>
                <button className="activity-name" onClick={() => open(t)}>
                  <span className={`activity-icon ${t.kind}`}>
                    <Icon
                      name={
                        t.kind === "income"
                          ? "incoming"
                          : t.kind === "transfer"
                            ? "arrows"
                            : (categoryIcons[t.categoryId] ?? "other")
                      }
                      size={17}
                    />
                  </span>
                  <span>
                    <strong>
                      {t.merchant ||
                        {
                          expense: "Gasto",
                          income: "Ingreso",
                          transfer: "Transferencia",
                          refund: "Devolución",
                        }[t.kind]}
                    </strong>
                    <small className="mobile-transaction-meta">
                      {state.accounts.find((a) => a.id === t.accountId)?.name} ·{" "}
                      {displayDate(t.date)}
                    </small>
                    {t.status === "provisional" && (
                      <small className="pending-text">Por confirmar</small>
                    )}
                  </span>
                </button>
              </td>
              <td className="category-column">
                <span className="category-label">
                  {state.categories.find((c) => c.id === t.categoryId)?.name ??
                    "Sin categoría"}
                </span>
              </td>
              <td className="account-column">
                {state.accounts.find((a) => a.id === t.accountId)?.name}
              </td>
              <td
                className={`number transaction-amount ${t.kind === "income" || t.kind === "refund" ? "money-in" : ""}`}
              >
                {t.kind === "income" || t.kind === "refund"
                  ? "+"
                  : t.kind === "expense"
                    ? "−"
                    : ""}
                {formatCOP(t.amountMinor)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Dashboard({
  state,
  summary: s,
  selectedAccount,
  open,
  refreshedAt,
  stale,
  refreshing,
}: {
  state: State;
  summary: Summary;
  selectedAccount?: string;
  open: (t: Transaction | "new") => void;
  refreshedAt?: Date;
  stale: boolean;
  refreshing: boolean;
}) {
  const [tab, setTab] = useState<"activity" | "bills">("activity");
  const selected = state.accounts.find((a) => a.id === selectedAccount);
  const transactions = state.transactions
    .filter(
      (t) =>
        !t.voided &&
        t.date <= s.today &&
        (!selected ||
          t.accountId === selected.id ||
          t.counterAccountId === selected.id),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const categories = state.categories
    .map((c) => ({
      ...c,
      amount: transactions
        .filter(
          (t) =>
            t.date.startsWith(s.today.slice(0, 7)) &&
            t.categoryId === c.id &&
            ["expense", "refund"].includes(t.kind),
        )
        .reduce(
          (n, t) =>
            n + (t.kind === "refund" ? -1n : 1n) * BigInt(t.amountMinor),
          0n,
        ),
    }))
    .filter((c) => c.amount > 0n)
    .sort((a, b) => (a.amount > b.amount ? -1 : 1));
  const total = categories.reduce((n, c) => n + c.amount, 0n);
  const committed = (
    BigInt(s.cardDebtMinor) +
    BigInt(s.billsMinor) +
    BigInt(s.reserveMinor) +
    BigInt(s.uncertainMinor)
  ).toString();
  const pending = state.observations.filter((o) => o.status === "review");
  const clue = pending.find((o) => o.candidates.length) || pending[0];
  const candidate =
    clue &&
    state.transactions.find((t) => clue.candidates.includes(t.id) && !t.voided);
  if (!state.accounts.length)
    return (
      <Panel className="first-account">
        <div className="first-account-art">
          <Eyes />
        </div>
        <div>
          <h2>
            Cada peso tiene
            <br />
            un punto de partida.
          </h2>
          <p>
            Agrega una cuenta bancaria, efectivo o una tarjeta de crédito
            independiente para empezar.
          </p>
          <a href="#/cuentas" className="button primary">
            Agregar mi primera cuenta <Icon name="arrow" />
          </a>
          <small>
            Tus tarjetas débito usarán el saldo de su cuenta bancaria.
          </small>
        </div>
      </Panel>
    );
  return (
    <div className="accounts-dashboard">
      <div className="dashboard-main">
        <div className="dashboard-intro">
          <h1>Cada peso, localizado.</h1>
          <p>Tus cuentas, tus tarjetas y lo que realmente puedes usar.</p>
        </div>
        <div className="funds-equation">
          <section className="funds-inputs">
            <div className="equation-part">
              <h2>Fondos en cuentas</h2>
              <strong>{formatCOP(s.liquidMinor)}</strong>
              <p>Saldo de tus cuentas y efectivo elegibles.</p>
              <a href="#/cuentas" className="text-link">
                Ver cuentas <Icon name="arrow" size={15} />
              </a>
            </div>
            <span className="equation-operator">
              <Icon name="minus" size={18} />
            </span>
            <div className="equation-part">
              <h2>Compromisos</h2>
              <strong>{formatCOP(committed)}</strong>
              <p>Tarjetas, facturas, reserva y evidencias pendientes.</p>
              <details className="commitments-details">
                <summary>Ver detalle</summary>
                <dl>
                  {[
                    ["Tarjetas", s.cardDebtMinor],
                    ["Facturas", s.billsMinor],
                    ["Reserva", s.reserveMinor],
                    ["Por revisar", s.uncertainMinor],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{formatCOP(value)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </div>
            <span className="equation-arrow">
              <Icon name="arrow" size={21} />
            </span>
          </section>
          <section className="available-card available-total">
            <div className="available-title">
              <h2>Disponible total</h2>
              <Eyes />
            </div>
            <strong className={BigInt(s.availableMinor) < 0n ? "negative" : ""}>
              {formatCOP(s.availableMinor)}
            </strong>
            <p>Después de tus compromisos, en todas tus cuentas.</p>
            <div
              className={`balance-status ${stale || s.incomplete ? "needs-attention" : ""}`}
            >
              <Icon name={stale || s.pending ? "search" : "check"} size={15} />
              <span>
                {stale
                  ? "Datos sin actualizar. Mostramos la última consulta."
                  : s.incomplete
                    ? `${s.incomplete} evidencia${s.incomplete === 1 ? "" : "s"} sin valor. El disponible está incompleto.`
                    : s.pending
                      ? `${s.pending} por revisar · ${formatCOP(s.uncertainMinor)} reservados`
                      : "Sin evidencias pendientes."}
              </span>
            </div>
          </section>
        </div>
        <p className="funds-freshness">
          {refreshing
            ? "Actualizando…"
            : refreshedAt
              ? `Consulta: ${refreshedAt.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" })}`
              : "Sin consulta reciente"}{" "}
          ·{" "}
          {s.lastStatementAt
            ? `Extracto conciliado: ${displayDate(s.lastStatementAt)}`
            : "Sin extractos conciliados"}{" "}
          · El disponible depende de que tus datos estén completos.
        </p>
        <Panel className="activity-panel">
          <div className="activity-toolbar">
            <div
              className="activity-tabs"
              role="group"
              aria-label="Vista del resumen"
            >
              <button
                id="activity-tab"
                aria-pressed={tab === "activity"}
                onClick={() => setTab("activity")}
              >
                Movimientos recientes
              </button>
              <button
                id="bills-tab"
                aria-pressed={tab === "bills"}
                onClick={() => setTab("bills")}
              >
                Próximos pagos
              </button>
            </div>
            <a href="#/movimientos" className="text-link">
              Ver todos <Icon name="arrow" size={14} />
            </a>
          </div>
          {tab === "activity" ? (
            <div
              role="region"
              id="activity-content"
              aria-labelledby="activity-tab"
            >
              {selected && (
                <div className="activity-scope">
                  <Icon
                    name={selected.kind === "credit" ? "card" : "wallet"}
                    size={15}
                  />
                  Movimientos de {selected.name}
                  <span>El disponible superior es de todas tus cuentas.</span>
                </div>
              )}
              {transactions.length ? (
                <Activity
                  state={state}
                  transactions={transactions.slice(0, 8)}
                  open={open}
                />
              ) : (
                <EmptyState
                  title={
                    selected
                      ? "Esta cuenta todavía no tiene movimientos."
                      : "Tu primera pista está por llegar."
                  }
                  action={
                    <Button variant="secondary" onClick={() => open("new")}>
                      <Icon name="plus" size={16} />
                      Registrar movimiento
                    </Button>
                  }
                >
                  Registra un movimiento o importa tu archivo.
                </EmptyState>
              )}
            </div>
          ) : (
            <div role="region" id="bills-content" aria-labelledby="bills-tab">
              {s.dueBills.length ? (
                s.dueBills.map((b) => (
                  <div className="payment-row" key={b.id}>
                    <span className="activity-icon expense">
                      <Icon name="calendar" size={18} />
                    </span>
                    <div>
                      <strong>{b.name}</strong>
                      <small>{displayDate(b.dueDate)}</small>
                    </div>
                    <b>{formatCOP(b.amountMinor)}</b>
                  </div>
                ))
              ) : (
                <EmptyState
                  title="Sin facturas antes del próximo ingreso."
                  icon="calendar"
                >
                  Las facturas pendientes que configures aparecerán aquí.
                </EmptyState>
              )}
              <a href="#/cuentas" className="text-link payment-settings">
                Administrar facturas <Icon name="arrow" size={15} />
              </a>
            </div>
          )}
        </Panel>
      </div>
      <aside className="dashboard-insights">
        <Panel
          title="Conecta las pistas"
          action={
            <Badge tone={pending.length ? "danger" : "success"}>
              {pending.length ? `${pending.length} por revisar` : "Al día"}
            </Badge>
          }
          className="review-preview"
        >
          <p>Compara las evidencias con tus movimientos. Tú decides.</p>
          {clue ? (
            <>
              <h3>{clue.merchant || "Movimiento por completar"}</h3>
              <small className="preview-date">
                {clue.date ? displayDate(clue.date) : "Sin fecha"}
              </small>
              <div className="preview-comparison">
                <div>
                  <span className="preview-source">
                    <Icon name="source" size={16} />
                    {clue.source === "statement"
                      ? "Extracto"
                      : clue.source === "sms"
                        ? "SMS"
                        : "Wallet"}
                  </span>
                  <strong>
                    {clue.amountMinor
                      ? formatCOP(clue.amountMinor)
                      : "Sin valor"}
                  </strong>
                  <small>
                    {state.accounts.find((a) => a.id === clue.accountId)
                      ?.name ?? "Sin cuenta"}
                  </small>
                </div>
                <span className="preview-link">
                  <Icon name="arrows" size={17} />
                </span>
                <div>
                  <span className="preview-source">
                    <Icon name="wallet" size={16} />
                    Tu movimiento
                  </span>
                  <strong>
                    {candidate
                      ? formatCOP(candidate.amountMinor)
                      : "Por completar"}
                  </strong>
                  <small>
                    {candidate ? candidate.merchant : "Completa los datos"}
                  </small>
                </div>
              </div>
              <p className="preview-warning">
                <Icon name="search" size={16} />
                {!clue.amountMinor
                  ? "Esta evidencia no tiene valor."
                  : candidate && candidate.amountMinor !== clue.amountMinor
                    ? `Diferencia de ${formatCOP((BigInt(clue.amountMinor) > BigInt(candidate.amountMinor) ? BigInt(clue.amountMinor) - BigInt(candidate.amountMinor) : BigInt(candidate.amountMinor) - BigInt(clue.amountMinor)).toString())}. ¿Es la misma compra?`
                    : "Confirma si las pistas cuentan la misma compra."}
              </p>
              <a href="#/revisar" className="button primary">
                Revisar coincidencia <Icon name="arrow" size={16} />
              </a>
            </>
          ) : (
            <EmptyState title="Todo en su lugar" icon="check">
              No tienes evidencias pendientes de revisión.
            </EmptyState>
          )}
          <Eyes className="preview-eyes" happy={!pending.length} />
        </Panel>
        <Panel
          title="Gasto por categoría"
          action={<span className="muted">Este mes</span>}
          className="category-panel"
        >
          {selected && <p className="category-scope">{selected.name}</p>}
          {categories.length ? (
            categories.map((c, i) => (
              <div className="expense-category" key={c.id}>
                <span className={`category-symbol category-${i % 7}`}>
                  <CategoryIcon categoryId={c.id} size={18} />
                </span>
                <div>
                  <div className="expense-category-title">
                    <span>{c.name}</span>
                    <strong>{formatCOP(c.amount.toString())}</strong>
                  </div>
                  <div className="expense-bar">
                    <span
                      style={{
                        width: `${Number((c.amount * 100n) / total)}%`,
                        background: categoryColors[i % 7],
                      }}
                    />
                  </div>
                </div>
                <small>{Number((c.amount * 100n) / total)}%</small>
              </div>
            ))
          ) : (
            <EmptyState title="Cada gasto tendrá su lugar." icon="overview">
              Las categorías aparecerán al registrar tus gastos.
            </EmptyState>
          )}
        </Panel>
      </aside>
    </div>
  );
}
