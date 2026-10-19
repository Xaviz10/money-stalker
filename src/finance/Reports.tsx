import { useMemo, useState } from "react";
import type { State, Transaction } from "../../domain/model";
import { bogotaDate, formatCOP } from "../../domain/money";
import { CategoryIcon } from "./CategoryIcon";
import { EmptyState, Icon } from "../design-system/ui";

const colors = ["#235ac5", "#d95d39", "#16a06a", "#8b5cf6", "#d39a13", "#0f8fa8", "#d34c72", "#64748b"];
const dayMs = 86400000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const parseDate = (value: string) => new Date(`${value}T12:00:00Z`);
const monthStart = (value: string) => `${value.slice(0, 7)}-01`;
const shiftDays = (value: string, days: number) => iso(new Date(parseDate(value).getTime() + days * dayMs));
const compactCOP = (minor: bigint) => new Intl.NumberFormat("es-CO", {
  style: "currency", currency: "COP", maximumFractionDigits: 0, notation: "compact",
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
  return new Intl.DateTimeFormat("es-CO", span > 180
    ? { month: "short", year: "2-digit", timeZone: "America/Bogota" }
    : { day: "numeric", month: "short", timeZone: "America/Bogota" }).format(date);
}

function SpendingTrend({ rows, from, to }: { rows: Transaction[]; from: string; to: string }) {
  const span = Math.max(1, Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / dayMs) + 1);
  const values = new Map<string, bigint>();
  for (const row of rows) values.set(bucketKey(row.date, span), (values.get(bucketKey(row.date, span)) ?? 0n) + signedExpense(row));
  const step = span <= 45 ? 1 : span <= 180 ? 7 : 0;
  const keys: string[] = [];
  if (step) for (let date = from; date <= to; date = shiftDays(date, step)) keys.push(bucketKey(date, span));
  else {
    let cursor = from.slice(0, 7);
    const end = to.slice(0, 7);
    while (cursor <= end) {
      keys.push(cursor);
      const date = parseDate(`${cursor}-01`); date.setUTCMonth(date.getUTCMonth() + 1); cursor = iso(date).slice(0, 7);
    }
  }
  const unique = [...new Set(keys)];
  const points = unique.map((key) => ({ key, value: values.get(key) ?? 0n }));
  const max = points.reduce((highest, point) => point.value > highest ? point.value : highest, 0n);
  const coordinates = points.map((point, index) => {
    const x = points.length === 1 ? 50 : 4 + (index * 92) / (points.length - 1);
    const positive = point.value > 0n ? point.value : 0n;
    const y = max ? 92 - Number((positive * 76n) / max) : 92;
    return `${x},${y}`;
  }).join(" ");
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  return <div className="report-trend">
    <div className="report-chart-scale"><span>{max ? compactCOP(max) : "$ 0"}</span><span>$ 0</span></div>
    <svg viewBox="0 0 100 100" role="img" aria-label="Gasto neto a través del tiempo" preserveAspectRatio="none">
      <defs><linearGradient id="report-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#235ac5" stopOpacity=".26"/><stop offset="1" stopColor="#235ac5" stopOpacity=".02"/></linearGradient></defs>
      <path className="report-grid-line" d="M4 16H96M4 54H96M4 92H96" />
      {points.length > 1 && <polygon points={`4,92 ${coordinates} 96,92`} fill="url(#report-area)" />}
      <polyline points={coordinates} className="report-trend-line" />
      {points.map((point, index) => <circle key={point.key} cx={points.length === 1 ? 50 : 4 + (index * 92) / (points.length - 1)} cy={max ? 92 - Number(((point.value > 0n ? point.value : 0n) * 76n) / max) : 92} r="1.4"><title>{bucketLabel(point.key, span)}: {formatCOP(point.value.toString())}</title></circle>)}
    </svg>
    <div className="report-axis">{labelIndexes.map((index) => points[index] && <span key={points[index].key}>{bucketLabel(points[index].key, span)}</span>)}</div>
  </div>;
}

export function Reports({ state, accountId, onAccountChange }: {
  state: State; accountId?: string; onAccountChange: (id?: string) => void;
}) {
  const today = bogotaDate();
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [preset, setPreset] = useState("month");
  const choosePreset = (next: string) => {
    setPreset(next);
    if (next === "month") { setFrom(monthStart(today)); setTo(today); }
    if (next === "30") { setFrom(shiftDays(today, -29)); setTo(today); }
    if (next === "year") { setFrom(`${today.slice(0, 4)}-01-01`); setTo(today); }
  };
  const rows = useMemo(() => state.transactions.filter((transaction) =>
    !transaction.voided && transaction.date >= from && transaction.date <= to
    && ["expense", "refund"].includes(transaction.kind)
    && (!accountId || transaction.accountId === accountId)), [state.transactions, from, to, accountId]);
  const spending = rows.filter((row) => row.kind === "expense").reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);
  const refunds = rows.filter((row) => row.kind === "refund").reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);
  const net = spending - refunds;
  const days = Math.max(1, Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / dayMs) + 1);
  const categories = useMemo(() => {
    const totals = new Map<string, bigint>();
    for (const row of rows) totals.set(row.categoryId, (totals.get(row.categoryId) ?? 0n) + signedExpense(row));
    return [...totals].filter(([, amount]) => amount > 0n).map(([id, amount]) => ({ id, amount, name: categoryPath(state, id) })).sort((a, b) => a.amount > b.amount ? -1 : 1);
  }, [rows, state.categories]);
  const merchants = useMemo(() => {
    const totals = new Map<string, bigint>();
    for (const row of rows) { const name = row.merchant || "Sin descripción"; totals.set(name, (totals.get(name) ?? 0n) + signedExpense(row)); }
    return [...totals].filter(([, amount]) => amount > 0n).map(([name, amount]) => ({ name, amount })).sort((a, b) => a.amount > b.amount ? -1 : 1).slice(0, 6);
  }, [rows]);
  const categoryTotal = categories.reduce((sum, item) => sum + item.amount, 0n);
  const validRange = from <= to;
  return <section className="reports" aria-label="Reportes de gastos">
    <div className="report-toolbar panel">
      <div className="report-presets" aria-label="Período rápido">{[["month", "Este mes"], ["30", "Últimos 30 días"], ["year", "Este año"]].map(([id, label]) => <button key={id} className={preset === id ? "active" : ""} aria-pressed={preset === id} onClick={() => choosePreset(id)}>{label}</button>)}</div>
      <div className="report-filters">
        <label><span>Desde</span><input type="date" value={from} max={to} onChange={(event) => { setFrom(event.target.value); setPreset("custom"); }} /></label>
        <label><span>Hasta</span><input type="date" value={to} min={from} max={today} onChange={(event) => { setTo(event.target.value); setPreset("custom"); }} /></label>
        <label><span>Producto</span><select value={accountId ?? ""} onChange={(event) => onAccountChange(event.target.value || undefined)}><option value="">Todas las cuentas</option>{state.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      </div>
    </div>
    {!validRange ? <p className="notice danger" role="alert">La fecha inicial debe ser anterior a la fecha final.</p> : <>
      <div className="report-summary">
        <article className="report-primary-stat"><span>Gasto neto</span><strong>{formatCOP(net.toString())}</strong><small>{rows.length} {rows.length === 1 ? "movimiento" : "movimientos"} en {days} días</small></article>
        <article><span>Compras y gastos</span><strong>{formatCOP(spending.toString())}</strong><small>Antes de devoluciones</small></article>
        <article><span>Devoluciones</span><strong>{formatCOP(refunds.toString())}</strong><small>Restadas del gasto</small></article>
        <article><span>Promedio diario</span><strong>{formatCOP((net / BigInt(days)).toString())}</strong><small>Durante el período</small></article>
      </div>
      {rows.length ? <>
        <article className="panel report-time-panel"><div className="report-panel-heading"><div><span className="eyebrow">Evolución</span><h2>Gasto en el tiempo</h2></div><span className="report-range">{from} — {to}</span></div><SpendingTrend rows={rows} from={from} to={to} /></article>
        <div className="report-grid">
          <article className="panel report-category-panel"><div className="report-panel-heading"><div><span className="eyebrow">Distribución</span><h2>En qué gastaste</h2></div></div><div className="report-category-list">{categories.map((category, index) => <div className="report-category" key={category.id}><span className="report-category-icon" style={{ background: `${colors[index % colors.length]}18`, color: colors[index % colors.length] }}><CategoryIcon categoryId={category.id} size={18}/></span><div><div><span>{category.name}</span><strong>{formatCOP(category.amount.toString())}</strong></div><div className="report-category-bar"><span style={{ width: `${categoryTotal ? Number((category.amount * 100n) / categoryTotal) : 0}%`, background: colors[index % colors.length] }}/></div></div><small>{categoryTotal ? Number((category.amount * 100n) / categoryTotal) : 0}%</small></div>)}</div></article>
          <article className="panel report-merchants"><div className="report-panel-heading"><div><span className="eyebrow">Detalle</span><h2>Comercios principales</h2></div></div><ol>{merchants.map((merchant, index) => <li key={merchant.name}><span>{index + 1}</span><div><strong>{merchant.name}</strong><small>{categoryTotal ? Number((merchant.amount * 100n) / categoryTotal) : 0}% del gasto neto</small></div><b>{formatCOP(merchant.amount.toString())}</b></li>)}</ol></article>
        </div>
      </> : <div className="panel report-empty"><EmptyState title="No hay gastos en este período" icon="overview">Prueba otro rango de fechas o selecciona todas las cuentas.</EmptyState><a className="button secondary" href="#/movimientos"><Icon name="arrows" size={16}/> Ver movimientos</a></div>}
    </>}
  </section>;
}
