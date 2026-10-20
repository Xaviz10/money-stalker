import { useMemo, useState } from "react";
import type { State, Transaction } from "../../domain/model";
import { bogotaDate, formatCOP } from "../../domain/money";
import { CategoryIcon } from "./CategoryIcon";
import { EmptyState, Icon } from "../design-system/ui";

const colors = [
  "#235ac5",
  "#d95d39",
  "#16a06a",
  "#8b5cf6",
  "#d39a13",
  "#0f8fa8",
  "#d34c72",
  "#64748b",
];
const dayMs = 86400000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const parseDate = (value: string) => new Date(`${value}T12:00:00Z`);
const monthStart = (value: string) => `${value.slice(0, 7)}-01`;
const shiftDays = (value: string, days: number) =>
  iso(new Date(parseDate(value).getTime() + days * dayMs));
const compactCOP = (minor: bigint) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
    notation: "compact",
  }).format(Number(minor) / 100);
const signedExpense = (transaction: Transaction) =>
  (transaction.kind === "refund" ? -1n : 1n) * BigInt(transaction.amountMinor);

function categoryPath(state: State, id: string) {
  const category = state.categories.find((item) => item.id === id);
  if (!category) return "Sin categoría";
  const parent = state.categories.find((item) => item.id === category.parentId);
  return parent ? `${parent.name} › ${category.name}` : category.name;
}

function bucketKey(date: string, span: number) {
  if (span <= 45) return date;
  if (span <= 180) {
    const parsed = parseDate(date);
    const mondayOffset = (parsed.getUTCDay() + 6) % 7;
    return iso(new Date(parsed.getTime() - mondayOffset * dayMs));
  }
  return date.slice(0, 7);
}

function bucketLabel(key: string, span: number) {
  const date = parseDate(key.length === 7 ? `${key}-01` : key);
  return new Intl.DateTimeFormat(
    "es-CO",
    span > 180
      ? { month: "short", year: "2-digit", timeZone: "America/Bogota" }
      : { day: "numeric", month: "short", timeZone: "America/Bogota" },
  ).format(date);
}

function SpendingTrend({
  rows,
  from,
  to,
}: {
  rows: Transaction[];
  from: string;
  to: string;
}) {
  const [selectedKey, setSelectedKey] = useState<string>();
  const span = Math.max(
    1,
    Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / dayMs) +
      1,
  );
  const values = new Map<string, bigint>();
  for (const row of rows)
    values.set(
      bucketKey(row.date, span),
      (values.get(bucketKey(row.date, span)) ?? 0n) + signedExpense(row),
    );
  const keys: string[] = [];
  if (span <= 180) {
    // Walking every date includes the final partial week as well.
    for (let date = from; date <= to; date = shiftDays(date, 1))
      keys.push(bucketKey(date, span));
  } else {
    let cursor = from.slice(0, 7);
    while (cursor <= to.slice(0, 7)) {
      keys.push(cursor);
      const date = parseDate(`${cursor}-01`);
      date.setUTCMonth(date.getUTCMonth() + 1);
      cursor = iso(date).slice(0, 7);
    }
  }
  const points = [...new Set(keys)].map((key) => ({
    key,
    value: values.get(key) ?? 0n,
  }));
  const max = points.reduce(
    (highest, point) => (point.value > highest ? point.value : highest),
    0n,
  );
  const min = points.reduce(
    (lowest, point) => (point.value < lowest ? point.value : lowest),
    0n,
  );
  const extent = max - min || 1n;
  const y = (value: bigint) =>
    max === min ? 50 : 10 + Number(((max - value) * 10000n) / extent) / 125;
  const x = (index: number) =>
    points.length === 1 ? 50 : 2 + (index * 96) / (points.length - 1);
  const selectedIndex = Math.max(
    0,
    selectedKey
      ? points.findIndex((point) => point.key === selectedKey)
      : points.findIndex((point) => point.value === (max || min)),
  );
  const selected = points[selectedIndex];
  const coordinates = points
    .map((point, index) => `${x(index)},${y(point.value)}`)
    .join(" ");
  const labelIndexes = [
    ...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]),
  ];
  const period = span <= 45 ? "Día" : span <= 180 ? "Semana del" : "Mes";
  const selectAt = (element: HTMLElement, clientX: number) => {
    const bounds = element.getBoundingClientRect();
    const index = Math.max(
      0,
      Math.min(
        points.length - 1,
        Math.round(
          ((((clientX - bounds.left) / bounds.width) * 100 - 2) / 96) *
            (points.length - 1),
        ),
      ),
    );
    setSelectedKey(points[index].key);
  };
  return (
    <div className="report-trend">
      <div
        className="report-chart-detail"
        aria-live="polite"
        aria-atomic="true"
      >
        <span>
          {period} {bucketLabel(selected.key, span)}
        </span>
        <strong>{formatCOP(selected.value.toString())}</strong>
        <small>
          Gasto neto ·{" "}
          {span <= 45 ? "por día" : span <= 180 ? "por semana" : "por mes"}
        </small>
      </div>
      <div className="report-chart-frame">
        <div className="report-chart-scale" aria-hidden="true">
          <span style={{ top: "10%" }}>{compactCOP(max)}</span>
          {max > 0n && min < 0n && (
            <span style={{ top: `${y(0n)}%` }}>$ 0</span>
          )}
          <span style={{ top: "90%" }}>{compactCOP(min)}</span>
        </div>
        <div
          className="report-chart-plot"
          role="slider"
          tabIndex={0}
          aria-label="Explorar gasto por período"
          aria-valuemin={1}
          aria-valuemax={points.length}
          aria-valuenow={selectedIndex + 1}
          aria-valuetext={`${period} ${bucketLabel(selected.key, span)}: ${formatCOP(selected.value.toString())}`}
          onPointerMove={(event) => {
            if (event.pointerType === "mouse" || event.buttons)
              selectAt(event.currentTarget, event.clientX);
          }}
          onPointerDown={(event) => {
            event.currentTarget.focus();
            selectAt(event.currentTarget, event.clientX);
          }}
          onKeyDown={(event) => {
            let next = selectedIndex;
            if (["ArrowRight", "ArrowUp"].includes(event.key)) next++;
            else if (["ArrowLeft", "ArrowDown"].includes(event.key)) next--;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = points.length - 1;
            else return;
            event.preventDefault();
            setSelectedKey(
              points[Math.max(0, Math.min(points.length - 1, next))].key,
            );
          }}
        >
          <svg
            viewBox="0 0 100 100"
            role="img"
            aria-label="Gasto neto a través del tiempo"
            preserveAspectRatio="none"
          >
            {[10, 50, 90].map((line) => (
              <path
                key={line}
                className="report-grid-line"
                d={`M0 ${line}H100`}
              />
            ))}
            <path className="report-zero-line" d={`M0 ${y(0n)}H100`} />
            <polyline points={coordinates} className="report-trend-line" />
          </svg>
          {points.map(
            (point, index) =>
              point.value !== 0n && (
                <span
                  aria-hidden="true"
                  key={point.key}
                  className="report-chart-dot"
                  style={{ left: `${x(index)}%`, top: `${y(point.value)}%` }}
                />
              ),
          )}
          <span
            aria-hidden="true"
            className="report-chart-cursor"
            style={{ left: `${x(selectedIndex)}%` }}
          />
          <span
            aria-hidden="true"
            className="report-chart-dot selected"
            style={{
              left: `${x(selectedIndex)}%`,
              top: `${y(selected.value)}%`,
            }}
          />
        </div>
        <div
          className={`report-axis${points.length === 1 ? " single" : ""}`}
          aria-hidden="true"
        >
          {labelIndexes.map((index) => (
            <span key={points[index].key}>
              {bucketLabel(points[index].key, span)}
            </span>
          ))}
        </div>
      </div>
      <p className="report-chart-help">
        Pasa el cursor o toca el gráfico para ver un valor. Con teclado, usa las
        flechas.
      </p>
    </div>
  );
}

type CategoryTotal = { id: string; name: string; amount: bigint };
function CategoryChart({
  categories,
  rows,
}: {
  categories: CategoryTotal[];
  rows: Transaction[];
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = categories.find((category) => category.id === selectedId);
  const max = categories.reduce((value, category) => {
    const absolute = category.amount < 0n ? -category.amount : category.amount;
    return absolute > value ? absolute : value;
  }, 1n);
  const hasNegative = categories.some((category) => category.amount < 0n);
  const total = categories
    .filter((category) => category.amount > 0n)
    .reduce((sum, category) => sum + category.amount, 0n);
  return (
    <>
      <p className="report-chart-help">
        Selecciona una categoría para ver sus movimientos. Las devoluciones
        reducen cada total.
      </p>
      <div
        className="report-category-chart"
        role="group"
        aria-label="Gráfico de gasto neto por categoría"
      >
        {categories.map((category, index) => {
          const negative = category.amount < 0n;
          const width =
            Number(
              ((negative ? -category.amount : category.amount) * 10000n) / max,
            ) / 100;
          return (
            <button
              type="button"
              className="report-category"
              key={category.id}
              aria-pressed={selected?.id === category.id}
              onClick={() =>
                setSelectedId(
                  selected?.id === category.id ? undefined : category.id,
                )
              }
            >
              <span className="report-category-label">
                <CategoryIcon categoryId={category.id} size={18} />
                <span>{category.name}</span>
              </span>
              <strong>{formatCOP(category.amount.toString())}</strong>
              <span
                className={`report-category-track${hasNegative ? " signed" : ""}`}
                aria-hidden="true"
              >
                <span
                  style={{
                    width: `${width / (hasNegative ? 2 : 1)}%`,
                    left: `${hasNegative ? (negative ? 50 - width / 2 : 50) : 0}%`,
                    background: negative
                      ? "var(--color-success)"
                      : colors[index % colors.length],
                  }}
                />
              </span>
              <small>
                {negative
                  ? "Devolución neta"
                  : total
                    ? `${Number((category.amount * 1000n) / total) / 10}% del gasto positivo`
                    : "Sin gasto neto"}
              </small>
            </button>
          );
        })}
        {!categories.length && (
          <p className="report-chart-help">
            Los gastos y las devoluciones se compensan: el neto por categoría es
            $ 0.
          </p>
        )}
      </div>
      {hasNegative && (
        <p className="report-chart-help">
          Izquierda: devolución neta · Derecha: gasto neto
        </p>
      )}
      {selected && (
        <div className="report-category-detail">
          <div className="report-category-detail-heading">
            <h3>{selected.name}</h3>
            <button
              type="button"
              onClick={() => setSelectedId(undefined)}
              aria-label="Cerrar detalle de categoría"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <ul>
            {rows
              .filter((row) => row.categoryId === selected.id)
              .map((row) => (
                <li key={row.id}>
                  <span>
                    <strong>{row.merchant || "Sin descripción"}</strong>
                    <small>
                      {bucketLabel(row.date, 1)} ·{" "}
                      {row.kind === "refund" ? "Devolución" : "Gasto"}
                    </small>
                  </span>
                  <b>{formatCOP(signedExpense(row).toString())}</b>
                </li>
              ))}
          </ul>
        </div>
      )}
    </>
  );
}

export function Reports({
  state,
  accountId,
  onAccountChange,
}: {
  state: State;
  accountId?: string;
  onAccountChange: (id?: string) => void;
}) {
  const today = bogotaDate();
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [preset, setPreset] = useState("month");
  const choosePreset = (next: string) => {
    setPreset(next);
    if (next === "month") {
      setFrom(monthStart(today));
      setTo(today);
    }
    if (next === "30") {
      setFrom(shiftDays(today, -29));
      setTo(today);
    }
    if (next === "year") {
      setFrom(`${today.slice(0, 4)}-01-01`);
      setTo(today);
    }
  };
  const rows = useMemo(
    () =>
      state.transactions.filter(
        (transaction) =>
          !transaction.voided &&
          transaction.date >= from &&
          transaction.date <= to &&
          transaction.date <= today &&
          ["expense", "refund"].includes(transaction.kind) &&
          (!accountId || transaction.accountId === accountId),
      ),
    [state.transactions, from, to, accountId, today],
  );
  const spending = rows
    .filter((row) => row.kind === "expense")
    .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);
  const refunds = rows
    .filter((row) => row.kind === "refund")
    .reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);
  const net = spending - refunds;
  const days = Math.max(
    1,
    Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / dayMs) +
      1,
  );
  const categories = useMemo(() => {
    const totals = new Map<string, bigint>();
    for (const row of rows)
      totals.set(
        row.categoryId,
        (totals.get(row.categoryId) ?? 0n) + signedExpense(row),
      );
    return [...totals]
      .filter(([, amount]) => amount !== 0n)
      .map(([id, amount]) => ({ id, amount, name: categoryPath(state, id) }))
      .sort((a, b) => (a.amount > b.amount ? -1 : 1));
  }, [rows, state.categories]);
  const merchants = useMemo(() => {
    const totals = new Map<string, bigint>();
    for (const row of rows) {
      const name = row.merchant || "Sin descripción";
      totals.set(name, (totals.get(name) ?? 0n) + signedExpense(row));
    }
    return [...totals]
      .filter(([, amount]) => amount > 0n)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => (a.amount > b.amount ? -1 : 1))
      .slice(0, 6);
  }, [rows]);
  const categoryTotal = categories
    .filter((item) => item.amount > 0n)
    .reduce((sum, item) => sum + item.amount, 0n);
  const validRange = Boolean(from && to && from <= to);
  return (
    <section className="reports" aria-label="Reportes de gastos">
      <div className="report-toolbar panel">
        <div className="report-presets" aria-label="Período rápido">
          {[
            ["month", "Este mes"],
            ["30", "Últimos 30 días"],
            ["year", "Este año"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={preset === id ? "active" : ""}
              aria-pressed={preset === id}
              onClick={() => choosePreset(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="report-filters">
          <label>
            <span>Desde</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(event) => {
                setFrom(event.target.value);
                setPreset("custom");
              }}
            />
          </label>
          <label>
            <span>Hasta</span>
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(event) => {
                setTo(event.target.value);
                setPreset("custom");
              }}
            />
          </label>
          <label>
            <span>Producto</span>
            <select
              value={accountId ?? ""}
              onChange={(event) =>
                onAccountChange(event.target.value || undefined)
              }
            >
              <option value="">Todas las cuentas</option>
              {state.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {!validRange ? (
        <p className="notice danger" role="alert">
          La fecha inicial debe ser anterior a la fecha final.
        </p>
      ) : (
        <>
          <div className="report-summary">
            <article className="report-primary-stat">
              <span>Gasto neto</span>
              <strong>{formatCOP(net.toString())}</strong>
              <small>
                {rows.length} {rows.length === 1 ? "movimiento" : "movimientos"}{" "}
                en {days} {days === 1 ? "día" : "días"}
              </small>
            </article>
            <article>
              <span>Compras y gastos</span>
              <strong>{formatCOP(spending.toString())}</strong>
              <small>Antes de devoluciones</small>
            </article>
            <article>
              <span>Devoluciones</span>
              <strong>{formatCOP(refunds.toString())}</strong>
              <small>Restadas del gasto</small>
            </article>
            <article>
              <span>Promedio diario</span>
              <strong>{formatCOP((net / BigInt(days)).toString())}</strong>
              <small>Durante el período</small>
            </article>
          </div>
          {rows.length ? (
            <>
              <article className="panel report-time-panel">
                <div className="report-panel-heading">
                  <div>
                    <h2>Gasto en el tiempo</h2>
                  </div>
                  <span className="report-range">
                    {from} — {to}
                  </span>
                </div>
                <SpendingTrend rows={rows} from={from} to={to} />
              </article>
              <div className="report-grid">
                <article className="panel report-category-panel">
                  <div className="report-panel-heading">
                    <div>
                      <h2>En qué gastaste</h2>
                    </div>
                  </div>
                  <CategoryChart
                    key={`${from}:${to}:${accountId ?? "all"}`}
                    categories={categories}
                    rows={rows}
                  />
                </article>
                <article className="panel report-merchants">
                  <div className="report-panel-heading">
                    <div>
                      <span className="eyebrow">Detalle</span>
                      <h2>Comercios principales</h2>
                    </div>
                  </div>
                  <ol>
                    {merchants.map((merchant, index) => (
                      <li key={merchant.name}>
                        <span>{index + 1}</span>
                        <div>
                          <strong>{merchant.name}</strong>
                          <small>
                            {categoryTotal
                              ? Number((merchant.amount * 100n) / categoryTotal)
                              : 0}
                            % del gasto positivo
                          </small>
                        </div>
                        <b>{formatCOP(merchant.amount.toString())}</b>
                      </li>
                    ))}
                  </ol>
                  {!merchants.length && (
                    <p className="report-chart-help">
                      No hay comercios con gasto neto positivo en este período.
                    </p>
                  )}
                </article>
              </div>
            </>
          ) : (
            <div className="panel report-empty">
              <EmptyState title="No hay gastos en este período" icon="overview">
                Prueba otro rango de fechas o selecciona todas las cuentas.
              </EmptyState>
              <a className="button secondary" href="#/movimientos">
                <Icon name="arrows" size={16} /> Ver movimientos
              </a>
            </div>
          )}
        </>
      )}
    </section>
  );
}
