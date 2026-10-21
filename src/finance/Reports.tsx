import { useMemo, useState } from "react";
import { expenseMovements } from '../../domain/loans';
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
const othersSelection = Symbol("others");
type ChartSelection = string | typeof othersSelection | undefined;
type PieSegment = {
  id: string | typeof othersSelection;
  name: string;
  amount: bigint;
  members: string[];
};

function distribution(items: CategoryTotal[]) {
  const positive = items.filter((item) => item.amount > 0n);
  const main = positive.slice(
    0,
    positive.length > colors.length ? colors.length - 1 : colors.length,
  );
  const rest = positive.slice(main.length);
  const segments: PieSegment[] = main.map((item) => ({
    ...item,
    members: [item.id],
  }));
  if (rest.length)
    segments.push({
      id: othersSelection,
      name: "Otros",
      amount: rest.reduce((sum, item) => sum + item.amount, 0n),
      members: rest.map((item) => item.id),
    });
  const color = (id: string) => {
    const index = segments.findIndex((segment) => segment.members.includes(id));
    return index < 0 ? "var(--color-success)" : colors[index];
  };
  return {
    main: [...main, ...items.filter((item) => item.amount < 0n)],
    rest,
    segments,
    color,
  };
}

function spendingShare(amount: bigint, total: bigint) {
  if (amount <= 0n || total <= 0n) return "0%";
  if (amount * 1000n < total) return "<0,1%";
  const tenths = Number((amount * 1000n + total / 2n) / total) / 10;
  return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(tenths)}%`;
}

function SpendingPie({
  items,
  label,
  selectedId,
  onSelect,
}: {
  items: CategoryTotal[];
  label: string;
  selectedId: ChartSelection;
  onSelect: (id: ChartSelection) => void;
}) {
  const { segments } = distribution(items);
  const total = segments.reduce((sum, item) => sum + item.amount, 0n);
  const selected =
    selectedId === othersSelection
      ? segments.find((item) => item.id === othersSelection)
      : items.find((item) => item.id === selectedId);
  let angle = -Math.PI / 2;
  const point = (value: number) =>
    `${120 + 104 * Math.cos(value)},${120 + 104 * Math.sin(value)}`;
  return (
    <div className="report-pie-wrap">
      {total > 0n ? (
        <svg
          className="report-pie"
          viewBox="0 0 240 240"
          role="group"
          aria-label={label}
        >
          {segments.map((item, index) => {
            const start = angle;
            const sweep =
              (Number((item.amount * 1000000000n) / total) / 1000000000) *
              Math.PI *
              2;
            angle += sweep;
            const d = `M120,120 L${point(start)} A104,104 0 0 1 ${point(start + sweep / 2)} A104,104 0 0 1 ${point(angle)} Z`;
            return (
              <path
                key={typeof item.id === "symbol" ? "others" : item.id}
                d={d}
                fill={colors[index]}
                className="report-pie-slice"
                role="button"
                tabIndex={0}
                aria-label={`${item.name}: ${formatCOP(item.amount.toString())}`}
                aria-pressed={
                  selectedId === item.id ||
                  (typeof selectedId === "string" &&
                    item.members.includes(selectedId))
                }
                onClick={() => onSelect(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(item.id);
                  }
                }}
              >
                <title>
                  {item.name}: {formatCOP(item.amount.toString())}
                </title>
              </path>
            );
          })}
        </svg>
      ) : (
        <p className="report-chart-help">
          No hay gasto neto positivo para representar.
        </p>
      )}
      <div
        className="report-pie-selection"
        aria-live="polite"
        aria-atomic="true"
      >
        {selected ? (
          <>
            <strong>{selected.name}</strong>
            <span>
              {formatCOP(selected.amount.toString())} ·{" "}
              {selected.amount < 0n
                ? "Devolución neta"
                : `${spendingShare(selected.amount, total)} del gasto positivo`}
            </span>
          </>
        ) : total > 0n ? (
          <span>Selecciona una porción o una fila para ver el detalle.</span>
        ) : null}
      </div>
    </div>
  );
}

function CategoryChart({
  categories,
  rows,
}: {
  categories: CategoryTotal[];
  rows: Transaction[];
}) {
  const [selectedId, setSelectedId] = useState<ChartSelection>();
  const [showOthers, setShowOthers] = useState(false);
  const grouped = distribution(categories);
  const select = (id: ChartSelection) => {
    setSelectedId(id);
    if (id === othersSelection) setShowOthers(true);
  };
  const total = categories
    .filter((item) => item.amount > 0n)
    .reduce((sum, item) => sum + item.amount, 0n);
  const max = categories.reduce((value, category) => {
    const absolute = category.amount < 0n ? -category.amount : category.amount;
    return absolute > value ? absolute : value;
  }, 1n);
  const hasNegative = categories.some((category) => category.amount < 0n);
  const renderCategory = (category: CategoryTotal) => {
    const negative = category.amount < 0n;
    const expanded = selectedId === category.id;
    const width =
      Number(((negative ? -category.amount : category.amount) * 10000n) / max) /
      100;
    return (
      <div className="report-category-item" key={category.id}>
        <button
          type="button"
          className="report-category"
          aria-expanded={expanded}
          aria-controls={`report-category-${category.id}`}
          aria-pressed={expanded}
          onClick={() => select(expanded ? undefined : category.id)}
        >
          <span className="report-category-label">
            <span
              className="report-legend-dot"
              style={{ background: grouped.color(category.id) }}
              aria-hidden="true"
            />
            <CategoryIcon categoryId={category.id} size={18} />
            <span>{category.name}</span>
            <Icon name="chevron" size={14} />
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
                background: grouped.color(category.id),
              }}
            />
          </span>
          <small>
            {negative
              ? "Devolución neta"
              : `${spendingShare(category.amount, total)} del gasto positivo`}
          </small>
        </button>
        {expanded && (
          <div
            className="report-category-detail"
            id={`report-category-${category.id}`}
            role="region"
            aria-label={`Movimientos de ${category.name}`}
          >
            <div className="report-category-detail-heading">
              <h3>{category.name}</h3>
              <button
                type="button"
                aria-label="Cerrar detalle de categoría"
                onClick={(event) => {
                  event.currentTarget
                    .closest(".report-category-item")
                    ?.querySelector("button")
                    ?.focus();
                  select(undefined);
                }}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <ul>
              {rows
                .filter((row) => row.categoryId === category.id)
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
      </div>
    );
  };
  return (
    <>
      <SpendingPie
        items={categories}
        label="Distribución por subcategoría"
        selectedId={selectedId}
        onSelect={select}
      />
      <div
        className="report-category-chart"
        role="group"
        aria-label="Gráfico de gasto neto por categoría"
      >
        {grouped.main.map(renderCategory)}
        {grouped.rest.length > 0 && (
          <>
            <button
              type="button"
              className="report-more-toggle"
              aria-expanded={showOthers}
              aria-controls="other-categories"
              onClick={() => {
                setShowOthers(!showOthers);
                if (
                  showOthers &&
                  (selectedId === othersSelection ||
                    grouped.rest.some((item) => item.id === selectedId))
                )
                  select(undefined);
              }}
            >
              <span
                className="report-legend-dot"
                style={{ background: colors[7] }}
                aria-hidden="true"
              />
              {showOthers
                ? "Ocultar otras categorías"
                : `Ver otras ${grouped.rest.length} categorías`}
              <Icon name="chevron" size={14} />
            </button>
            <div id="other-categories" hidden={!showOthers}>
              {grouped.rest.map(renderCategory)}
            </div>
          </>
        )}
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
    </>
  );
}

function MerchantChart({ merchants }: { merchants: CategoryTotal[] }) {
  const [selectedId, setSelectedId] = useState<ChartSelection>();
  const [showOthers, setShowOthers] = useState(false);
  const grouped = distribution(merchants);
  const total = merchants
    .filter((item) => item.amount > 0n)
    .reduce((sum, item) => sum + item.amount, 0n);
  const select = (id: ChartSelection) => {
    setSelectedId(id);
    if (id === othersSelection) setShowOthers(true);
  };
  const renderMerchant = (merchant: CategoryTotal) => (
    <li key={merchant.id}>
      <button
        type="button"
        className="report-merchant-row"
        aria-pressed={selectedId === merchant.id}
        onClick={() => select(merchant.id)}
      >
        <span
          className="report-legend-dot"
          style={{ background: grouped.color(merchant.id) }}
          aria-hidden="true"
        />
        <span>
          <strong>{merchant.name}</strong>
          <small>
            {merchant.amount < 0n
              ? "Devolución neta"
              : `${spendingShare(merchant.amount, total)} del gasto positivo`}
          </small>
        </span>
        <b>{formatCOP(merchant.amount.toString())}</b>
      </button>
    </li>
  );
  return (
    <>
      <SpendingPie
        items={merchants}
        label="Distribución por comercio"
        selectedId={selectedId}
        onSelect={select}
      />
      <ol>{grouped.main.map(renderMerchant)}</ol>
      {grouped.rest.length > 0 && (
        <>
          <button
            type="button"
            className="report-more-toggle"
            aria-expanded={showOthers}
            aria-controls="other-merchants"
            onClick={() => {
              setShowOthers(!showOthers);
              if (
                showOthers &&
                (selectedId === othersSelection ||
                  grouped.rest.some((item) => item.id === selectedId))
              )
                select(undefined);
            }}
          >
            <span
              className="report-legend-dot"
              style={{ background: colors[7] }}
              aria-hidden="true"
            />
            {showOthers
              ? "Ocultar otros comercios"
              : `Ver otros ${grouped.rest.length} comercios`}
            <Icon name="chevron" size={14} />
          </button>
          <ol id="other-merchants" hidden={!showOthers}>
            {grouped.rest.map(renderMerchant)}
          </ol>
        </>
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
  const [categoryId, setCategoryId] = useState("");
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
      expenseMovements(state.transactions).filter(
        (transaction) =>
          !transaction.voided &&
          transaction.date >= from &&
          transaction.date <= to &&
          transaction.date <= today &&
          ["expense", "refund"].includes(transaction.kind) &&
          (!accountId || transaction.accountId === accountId) &&
          (!categoryId ||
            transaction.categoryId === categoryId ||
            state.categories.find(
              (category) => category.id === transaction.categoryId,
            )?.parentId === categoryId),
      ),
    [
      state.transactions,
      state.categories,
      from,
      to,
      accountId,
      categoryId,
      today,
    ],
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
      .filter(([, amount]) => amount !== 0n)
      .map(([name, amount]) => ({ id: name, name, amount }))
      .sort((a, b) => (a.amount > b.amount ? -1 : 1));
  }, [rows]);
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
          <label>
            <span>Categoría</span>
            <select
              aria-label="Categoría"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">Todas las categorías</option>
              {state.categories
                .filter(
                  (category) =>
                    !category.parentId && category.scope !== "income",
                )
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </div>
      {!validRange ? (
        <p className="notice danger" role="alert">
          {!from || !to
            ? "Completa las fechas Desde y Hasta."
            : "La fecha Desde debe ser anterior o igual a Hasta."}
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
            <div className="report-secondary-summary">
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
              <p className="report-chart-help report-distribution-note">
                Las devoluciones reducen el gasto. Las tortas muestran solo los
                totales positivos; los negativos se conservan en las listas.
                Selecciona una categoría para ver sus movimientos.
              </p>
              <div className="report-grid">
                <article className="panel report-category-panel">
                  <div className="report-panel-heading">
                    <div>
                      <h2>Gasto por categoría y subcategoría</h2>
                    </div>
                  </div>
                  <CategoryChart
                    key={`${from}:${to}:${accountId ?? "all"}:${categoryId}`}
                    categories={categories}
                    rows={rows}
                  />
                </article>
                <article className="panel report-merchants">
                  <div className="report-panel-heading">
                    <div>
                      <h2>Gasto por comercio</h2>
                    </div>
                  </div>
                  <MerchantChart
                    key={`${from}:${to}:${accountId ?? "all"}:${categoryId}`}
                    merchants={merchants}
                  />
                </article>
              </div>
            </>
          ) : (
            <div className="panel report-empty">
              <EmptyState title="No hay gastos en este período" icon="overview">
                Prueba otro rango de fechas, todas las cuentas o todas las
                categorías.
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
