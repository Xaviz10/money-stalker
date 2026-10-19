import { useEffect, useMemo, useState } from "react";
import type { State, Observation, Transaction } from "../../domain/model";
import { formatCOP } from "../../domain/money";
import { api, post } from "../api";
import { Icon as Glyph, Eyes as SidekickMark } from "../design-system/ui";

const REVIEW_PROGRESS_KEY = "money-stalker.review-progress.v2";
const REVIEW_FILTER_KEY = "money-stalker.review-filters.v1";
const REVIEW_ACTIVE_KEY = "money-stalker.review-active.v1";
const LEGACY_REVIEW_SESSION_KEY = "money-stalker.review-session.v1";
type Filters = { query: string; accountId: string; source: string; reason: string; from: string; to: string };
const emptyFilters: Filters = { query: "", accountId: "", source: "", reason: "", from: "", to: "" };

function readStorage<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; }
  catch { return fallback; }
}
function loadReviewSession(fallback: string[]) {
  try {
    const parsed = JSON.parse(localStorage.getItem(REVIEW_PROGRESS_KEY) ?? sessionStorage.getItem(LEGACY_REVIEW_SESSION_KEY) ?? "null");
    if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string")) {
      const ids = [...new Set<string>(parsed)]; saveReviewSession(ids); return ids;
    }
  } catch { /* Start a fresh durable review. */ }
  saveReviewSession(fallback); return fallback;
}
function saveReviewSession(ids: string[]) {
  try { localStorage.setItem(REVIEW_PROGRESS_KEY, JSON.stringify(ids)); }
  catch { /* The queue still works when storage is blocked. */ }
}
function shortDate(value?: string) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Bogota" })
    .format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
}
function accountName(state: State, id?: string) { return state.accounts.find((account) => account.id === id)?.name ?? "Sin cuenta"; }
function sourceName(source: Observation["source"]) { return source === "statement" ? "Extracto" : source === "sms" ? "SMS" : "Wallet"; }
function SourceTag({ source }: { source: Observation["source"] }) {
  return <span className="trail-tag"><Glyph name="source" size={15} />{sourceName(source)}</span>;
}
function canSeparate(observation: Observation) {
  return Boolean(observation.accountId && observation.amountMinor && observation.date && (observation.kind !== "transfer" || observation.counterAccountId));
}
function reasonKind(observation: Observation) {
  if (!canSeparate(observation)) return "incomplete";
  if (observation.candidates.length) return "candidate";
  return "unmatched";
}
function normalized(value: string) { return value.normalize("NFKC").trim().toLocaleLowerCase("es-CO").replace(/\s+/g, " "); }
function groupKey(observation: Observation) {
  return [normalized(observation.merchant || "sin comercio"), observation.amountMinor ?? "sin valor", observation.accountId ?? "sin cuenta", observation.kind, reasonKind(observation)].join("|");
}
function EvidenceMessage({ id }: { id: string }) {
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <div>
    <button className="text-button" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try { const result = await api<{ message?: string }>(`/observations/${id}/evidence`); setText(result.message ?? "Sin mensaje original"); }
      catch { setError("No pudimos cargar el mensaje. Intenta de nuevo."); }
      finally { setBusy(false); }
    }}>{busy ? "Cargando mensaje…" : "Ver mensaje original"}</button>
    {text && <p className="evidence-message">{text}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
}

export function ReviewDesk({ state, act, edit, stale }: {
  state: State;
  act: (fn: () => Promise<unknown>, message?: string) => Promise<void>;
  edit: (observation: Observation) => void;
  stale: boolean;
}) {
  const rawPending = state.observations.filter((observation) => observation.status === "review");
  const rawPendingIds = rawPending.map((observation) => observation.id);
  const [sessionIds, setSessionIds] = useState<string[]>(() => loadReviewSession(rawPendingIds));
  const [resolvedLocally, setResolvedLocally] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Filters>(() => readStorage(REVIEW_FILTER_KEY, emptyFilters));
  const [activeId, setActiveId] = useState(() => readStorage(REVIEW_ACTIVE_KEY, ""));
  const [activeGroupKey, setActiveGroupKey] = useState("");
  const [batchPreview, setBatchPreview] = useState<string[]>([]);
  const [busy, setBusy] = useState<string>(), [lastAction, setLastAction] = useState(""), [actionError, setActionError] = useState("");

  useEffect(() => { try { localStorage.setItem(REVIEW_FILTER_KEY, JSON.stringify(filters)); } catch { /* no-op */ } }, [filters]);
  useEffect(() => { try { localStorage.setItem(REVIEW_ACTIVE_KEY, JSON.stringify(activeId)); } catch { /* no-op */ } }, [activeId]);
  useEffect(() => {
    setResolvedLocally((current) => {
      const next = new Set([...current].filter((id) => rawPending.some((item) => item.id === id)));
      return next.size === current.size ? current : next;
    });
    setSessionIds((current) => {
      const pendingIds = new Set(rawPendingIds), currentIds = new Set(current);
      const unresolved = current.filter((id) => pendingIds.has(id));
      const incoming = rawPendingIds.filter((id) => !currentIds.has(id));
      const next = !current.length || (!unresolved.length && incoming.length) ? rawPendingIds : incoming.length ? [...current, ...incoming] : current;
      if (next !== current) saveReviewSession(next); return next;
    });
  }, [state.observations]);

  const pending = rawPending.filter((observation) => !resolvedLocally.has(observation.id));
  const unresolvedSession = new Set(pending.map((observation) => observation.id));
  const resolved = sessionIds.filter((id) => !unresolvedSession.has(id)).length;
  const total = Math.max(sessionIds.length, resolved + pending.length);
  const filtered = useMemo(() => {
    const query = normalized(filters.query);
    return pending.filter((observation) => {
      if (filters.accountId && observation.accountId !== filters.accountId) return false;
      if (filters.source && observation.source !== filters.source) return false;
      if (filters.reason && reasonKind(observation) !== filters.reason) return false;
      if (filters.from && (!observation.date || observation.date < filters.from)) return false;
      if (filters.to && (!observation.date || observation.date > filters.to)) return false;
      return !query || normalized(`${observation.merchant} ${observation.amountMinor ?? ""}`).includes(query);
    });
  }, [pending, filters]);
  const groups = useMemo(() => {
    const map = new Map<string, Observation[]>();
    for (const observation of filtered) { const key = groupKey(observation); map.set(key, [...(map.get(key) ?? []), observation]); }
    return [...map.entries()].map(([key, observations]) => ({ key, observations: observations.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")) }))
      .sort((a, b) => b.observations.length - a.observations.length || (b.observations[0].date ?? "").localeCompare(a.observations[0].date ?? ""));
  }, [filtered]);
  const activeGroup = groups.find((group) => group.key === activeGroupKey) ?? groups[0];
  const active = activeGroup?.observations.find((observation) => observation.id === activeId) ?? activeGroup?.observations[0];
  useEffect(() => {
    if (!activeGroup) { setActiveGroupKey(""); setActiveId(""); return; }
    if (activeGroup.key !== activeGroupKey) setActiveGroupKey(activeGroup.key);
    if (!activeGroup.observations.some((observation) => observation.id === activeId)) setActiveId(activeGroup.observations[0].id);
  }, [activeGroup?.key, activeId]);

  const history = (() => {
    const rows: Array<
      State["audit"][number] & { batchCount?: number; batchUndone?: boolean }
    > = [];
    const seenBatches = new Set<string>();
    for (const entry of [...state.audit].reverse()) {
      if (!entry.beforeObservation && !entry.beforeTransaction) continue;
      if (entry.batchId) {
        if (seenBatches.has(entry.batchId)) continue;
        seenBatches.add(entry.batchId);
        const batch = state.audit.filter((item) => item.batchId === entry.batchId);
        rows.push({
          ...entry,
          action: "batch-separate",
          batchCount: batch.length,
          batchUndone: batch.every((item) => item.undone),
        });
      } else rows.push(entry);
      if (rows.length === 10) break;
    }
    return rows;
  })();
  const run = async (id: string, fn: () => Promise<unknown>, message: string, resolvedIds: string[] = []) => {
    setBusy(id); setActionError("");
    try {
      await act(fn, "");
      if (resolvedIds.length) setResolvedLocally((current) => { const next = new Set(current); for (const item of resolvedIds) next.add(item); return next; });
      setLastAction(message); setBatchPreview([]); return true;
    } catch (error) {
      const message = (error as Error).message || "No se pudo guardar.";
      setActionError(`${message} ${resolvedIds.length > 1 ? "Actualizamos la lista con lo que sí alcanzó a guardarse." : "La pista continúa pendiente."}`);
      return false;
    }
    finally { setBusy(undefined); }
  };
  const clearFilters = () => setFilters(emptyFilters);
  const filtersActive = Object.values(filters).some(Boolean);
  const candidates = active ? active.candidates.map((id) => state.transactions.find((item) => item.id === id && !item.voided)).filter((item): item is Transaction => Boolean(item)) : [];
  const groupCanSeparate = Boolean(activeGroup?.observations.length) && activeGroup!.observations.every(canSeparate);
  const groupTotal = batchPreview.reduce((sum, id) => sum + BigInt(pending.find((item) => item.id === id)?.amountMinor ?? "0"), 0n);
  const exactCandidate = active ? candidates.some((item) => item.amountMinor === active.amountMinor && item.date === active.date && item.accountId === active.accountId) : false;

  return <>
    <section className={`review-brief ${!pending.length ? "review-complete" : ""}`}>
      <SidekickMark happy={!pending.length} />
      <div><h2>{pending.length ? `${pending.length} ${pending.length === 1 ? "pista pendiente" : "pistas pendientes"}.` : "Todo en su lugar"}</h2><p>{pending.length ? "Agrupa lo repetido, revisa lo dudoso y continúa donde lo dejaste." : "Sin evidencias pendientes. Cuando llegue otra pista, podrás revisarla aquí."}</p></div>
      <span className="review-count"><Glyph name={pending.length ? "search" : "check"} />{pending.length ? "Por revisar" : "Revisión al día"}</span>
    </section>
    {stale && <p className="review-caution" role="status">No se pudieron actualizar los datos. Actualiza antes de tomar una decisión.</p>}
    {(pending.length > 0 || resolved > 0 || lastAction) && <section className="review-progress" aria-label="Progreso de revisión">
      <div className="review-progress-numbers"><span><strong>{pending.length}</strong> pendientes</span><span><strong>{resolved}</strong> resueltas</span></div>
      <span className="review-progress-saved">{busy ? "Guardando…" : "Progreso guardado"}</span>
      <progress max={Math.max(total, 1)} value={resolved}>{resolved} de {total}</progress>
      <p role="status" aria-live="polite">{lastAction || (pending.length ? `${resolved} de ${total} resueltas. Puedes salir y continuar después.` : `${resolved} de ${total} pistas resueltas. Puedes cambiar de sección sin perder este progreso.`)}</p>
      {actionError && <p className="review-action-error" role="alert">{actionError}</p>}
    </section>}

    {pending.length > 0 && <section className="review-inbox" aria-label="Bandeja de pistas">
      <div className="review-inbox-toolbar">
        <label className="review-search"><span>Buscar pistas</span><input type="search" value={filters.query} placeholder="Comercio o valor…" onChange={(event) => setFilters({ ...filters, query: event.target.value })} /></label>
        <details className="review-filter-menu"><summary><Glyph name="search" size={16} /> Filtrar{filtersActive ? " · Activo" : ""}</summary><div className="review-filter-grid">
          <label>Cuenta<select value={filters.accountId} onChange={(event) => setFilters({ ...filters, accountId: event.target.value })}><option value="">Todas</option>{state.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
          <label>Origen<select value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })}><option value="">Todos</option><option value="statement">Extracto</option><option value="sms">SMS</option><option value="wallet">Wallet</option></select></label>
          <label>Tipo<select value={filters.reason} onChange={(event) => setFilters({ ...filters, reason: event.target.value })}><option value="">Todos</option><option value="candidate">Posible coincidencia</option><option value="incomplete">Datos incompletos</option><option value="unmatched">Sin coincidencia</option></select></label>
          <label>Desde<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
          <label>Hasta<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
          {filtersActive && <button type="button" className="text-button" onClick={clearFilters}>Limpiar filtros</button>}
        </div></details>
      </div>
      <div className="review-workspace">
        <aside className="review-group-list" aria-label="Grupos de pistas">
          <div className="review-group-list-heading"><strong>{filtered.length} visibles</strong><span>{groups.length} {groups.length === 1 ? "grupo" : "grupos"}</span></div>
          {groups.map((group) => {
            const first = group.observations[0], dates = group.observations.map((item) => item.date).filter((date): date is string => Boolean(date)).sort();
            return <button type="button" className={`review-group ${group.key === activeGroup?.key ? "active" : ""}`} aria-pressed={group.key === activeGroup?.key} key={group.key} onClick={() => { setActiveGroupKey(group.key); setActiveId(first.id); setBatchPreview([]); }}>
              <span className="review-group-main"><strong>{first.merchant || "Movimiento sin comercio"}</strong><b>{first.amountMinor ? formatCOP(first.amountMinor) : "Sin valor"}</b></span>
              <span>{accountName(state, first.accountId)} · {sourceName(first.source)}</span>
              <span>{group.observations.length > 1 ? `${group.observations.length} pistas · ${shortDate(dates[0])}–${shortDate(dates.at(-1))}` : shortDate(first.date)}</span>
            </button>;
          })}
          {!groups.length && <div className="review-no-results"><strong>No hay pistas con estos filtros</strong><button className="text-button" onClick={clearFilters}>Ver todas</button></div>}
        </aside>

        {active && activeGroup && <article className="clue review-focus" key={active.id}>
          <div className="clue-header"><SourceTag source={active.source} /><div className="clue-header-actions"><span className="clue-state">{activeGroup.observations.findIndex((item) => item.id === active.id) + 1} de {activeGroup.observations.length} en este grupo</span>{activeGroup.observations.length > 1 && <span className="review-group-count">{activeGroup.observations.length} similares</span>}</div></div>
          <div className="clue-comparison">
            <div className="source-evidence"><h3>{active.merchant || "Movimiento sin comercio"}</h3><strong className="evidence-amount">{active.amountMinor ? formatCOP(active.amountMinor) : "Falta el valor"}</strong><p>{accountName(state, active.accountId)}<br />{shortDate(active.date)}</p>{active.reason && <p className="clue-reason">{active.reason}</p>}{active.source === "sms" && <EvidenceMessage id={active.id} />}<details className="evidence-details"><summary>Detalles de la evidencia</summary><p>Recibida: {shortDate(active.receivedAt)}<br />Tipo: {{ expense: "Gasto", income: "Ingreso", transfer: "Transferencia", refund: "Devolución" }[active.kind]}</p>{active.location && <p>Ubicación: {active.location.latitude.toFixed(4)}, {active.location.longitude.toFixed(4)} · precisión {Math.round(active.location.accuracy)} m. Puede ser posterior al pago.</p>}</details></div>
            <div className="evidence-connector"><Glyph name="arrow" size={22} /></div>
            <div className="candidate-evidence"><h4>{candidates.length ? "Compara antes de decidir" : "Todavía falta una pieza"}</h4>{candidates.length ? candidates.map((transaction) => {
              const exact = transaction.amountMinor === active.amountMinor && transaction.date === active.date && transaction.accountId === active.accountId;
              return <div className="candidate" key={transaction.id}><div className="candidate-heading"><strong>{transaction.merchant || "Movimiento"}</strong><b>{formatCOP(transaction.amountMinor)}</b></div><p>{accountName(state, transaction.accountId)} · {shortDate(transaction.date)}</p><span className={`match-detail ${exact ? "" : "different"}`}>{transaction.amountMinor === active.amountMinor ? "Mismo valor" : "Valor diferente"} · {transaction.date === active.date ? "Misma fecha" : "Fecha diferente"}</span>{transaction.amountMinor !== active.amountMinor && active.source === "statement" && active.amountMinor && <p className="amount-change">Al unir, el valor cambiará a {formatCOP(active.amountMinor)} según el extracto.</p>}<button className={`button ${exact ? "primary" : "secondary"}`} disabled={Boolean(busy) || stale} onClick={() => void run(active.id, () => post("/matches", { observationId: active.id, transactionId: transaction.id }), "Pistas unidas. El movimiento quedó actualizado.", [active.id])}><Glyph name="check" size={17} />{busy === active.id ? "Guardando…" : exact ? `Unir con ${transaction.merchant || "movimiento"}` : "Unir de todos modos"}</button></div>;
            }) : <p>Completa los datos o registra esta evidencia por separado. No la uniremos automáticamente.</p>}</div>
          </div>
          <div className="clue-actions">
            {canSeparate(active) ? <button className={`button ${exactCandidate ? "secondary" : "primary"}`} disabled={Boolean(busy) || stale} onClick={() => void run(active.id, () => post("/reviews", { observationId: active.id, action: "separate" }), pending.length === 1 ? "Pista resuelta. La revisión quedó al día." : "Pista registrada como movimiento distinto.", [active.id])}>{busy === active.id ? "Guardando…" : "Registrar como movimiento distinto"}</button> : <button className="button primary" disabled={Boolean(busy) || stale} onClick={() => edit(active)}>Completar datos</button>}
            {canSeparate(active) && <button className="text-button" disabled={Boolean(busy) || stale} onClick={() => edit(active)}>Editar antes de registrar</button>}
            <details className="discard-menu"><summary>Más opciones</summary><p>Descartar retira esta evidencia sin crear ni modificar un movimiento. Podrás deshacerlo en el historial.</p><button className="text-button discard-clue" disabled={Boolean(busy) || stale} onClick={() => void run(active.id, () => post("/reviews", { observationId: active.id, action: "ignore" }), "Evidencia descartada. Puedes deshacerlo en el historial.", [active.id])}>Descartar evidencia</button></details>
          </div>
          <div className="review-focus-navigation"><button type="button" className="button quiet" disabled={activeGroup.observations[0].id === active.id} onClick={() => setActiveId(activeGroup.observations[Math.max(0, activeGroup.observations.findIndex((item) => item.id === active.id) - 1)].id)}>Anterior</button><span>{activeGroup.observations.findIndex((item) => item.id === active.id) + 1} / {activeGroup.observations.length}</span><button type="button" className="button quiet" disabled={activeGroup.observations.at(-1)?.id === active.id} onClick={() => setActiveId(activeGroup.observations[Math.min(activeGroup.observations.length - 1, activeGroup.observations.findIndex((item) => item.id === active.id) + 1)].id)}>Siguiente</button></div>
          {activeGroup.observations.length > 1 && groupCanSeparate && <div className="review-group-action"><div><strong>¿Son compras repetidas?</strong><span>Registra cada pista como un movimiento independiente. No se fusionarán.</span></div><button className="button secondary" disabled={Boolean(busy) || stale} onClick={() => setBatchPreview(activeGroup.observations.map((item) => item.id))}>Preparar {activeGroup.observations.length} como distintos</button></div>}
          {batchPreview.length > 0 && <div className="review-batch-confirm" role="region" aria-label="Confirmar registro por lote"><div><strong>Registrar {batchPreview.length} pistas como {batchPreview.length} movimientos distintos</strong><span>Total observado: {formatCOP(groupTotal.toString())}. Cada fecha y evidencia se conservará por separado.</span></div><div><button className="button quiet" onClick={() => setBatchPreview([])}>Cancelar</button><button className="button primary" disabled={Boolean(busy) || stale} onClick={() => void run("batch", () => post("/reviews/batch", { observationIds: batchPreview, action: "separate" }), `${batchPreview.length} pistas registradas como movimientos distintos.`, batchPreview)}>{busy === "batch" ? "Guardando lote…" : `Confirmar ${batchPreview.length}`}</button></div></div>}
        </article>}
      </div>
    </section>}

    {!pending.length && <div className="review-next"><Glyph name="check" /><p>{history.length ? "Una pista menos, una vista más clara." : "Tu próxima pista aparecerá aquí."}</p><a href="#/resumen" className="button secondary">Volver a mi resumen <Glyph name="arrow" size={17} /></a></div>}
    <section className="correction-history"><div className="section-heading"><h2>Historial de correcciones</h2><span className="muted">Puedes volver atrás</span></div>{history.length ? history.map((entry) => <div className="audit-row" key={entry.batchId ? `batch:${entry.batchId}` : entry.id}><div><strong>{entry.action === "batch-separate" ? `${entry.batchCount} movimientos separados` : ({ merge: "Evidencias unidas", edit: "Movimiento editado", ignore: "Evidencia descartada", separate: "Movimiento separado" } as Record<string, string>)[entry.action] ?? entry.action}</strong><small>{shortDate(entry.at)}</small></div><button className="text-button" disabled={Boolean(busy) || Boolean(entry.undone) || Boolean(entry.batchUndone) || stale} onClick={() => void run(entry.batchId ? `batch:${entry.batchId}` : entry.id, () => entry.batchId ? post("/undo/batch", { batchId: entry.batchId }) : post("/undo", { auditId: entry.id }), entry.batchId ? "Lote deshecho. Las pistas vuelven a estar pendientes." : "Corrección deshecha. Recuperamos el estado anterior.")}>{entry.undone || entry.batchUndone ? "Deshecho" : busy === (entry.batchId ? `batch:${entry.batchId}` : entry.id) ? "Deshaciendo…" : "Deshacer"}</button></div>) : <p className="history-empty">Aquí quedará el rastro de tus correcciones.</p>}</section>
  </>;
}
