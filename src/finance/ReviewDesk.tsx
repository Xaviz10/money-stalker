import { appleMapsURL, googleMapsURL, capturedAddress } from "../../domain/location";
import { useEffect, useMemo, useRef, useState } from "react";
import type { State, Observation, Transaction } from "../../domain/model";
import { formatCOP, parseCOP } from "../../domain/money";
import { post } from "../api";
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
function loadReviewSession(fallback: string[], reset: boolean) {
  if (reset) { saveReviewSession([]); return []; }
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
function missingCaptureFields(observation: Observation) {
  return [!observation.accountId && "la cuenta", !observation.amountMinor && "el valor", !observation.date && "la fecha", observation.kind === "transfer" && !observation.counterAccountId && "la cuenta de destino"].filter((field): field is string => Boolean(field));
}
function canSeparate(observation: Observation) {
  return missingCaptureFields(observation).length === 0;
}
function reasonKind(observation: Observation) {
  if (!canSeparate(observation)) return "incomplete";
  if (observation.candidates.length) return "candidate";
  return "unmatched";
}
function normalized(value: string) { return value.normalize("NFKC").trim().toLocaleLowerCase("es-CO").replace(/\s+/g, " "); }
function timestamp(value: string) {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" }).format(new Date(value));
}
function captureTime(value: string) {
  return new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" }).format(new Date(value));
}
function recordLabel(state: State, record?: Partial<Pick<Transaction, "merchant" | "amountMinor" | "accountId">>) {
  if (!record) return "Sin datos del movimiento";
  return `${record.merchant || "Sin comercio"} · ${record.amountMinor ? formatCOP(record.amountMinor) : "Sin valor"} · ${accountName(state, record.accountId)}`;
}
function HistoryContext({ entry, state }: { entry: State["audit"][number]; state: State }) {
  const before = entry.beforeTransaction ?? entry.beforeObservation;
  const batch = entry.batchId ? state.audit.filter((item) => item.batchId === entry.batchId) : [];
  const current = state.transactions.find((item) => item.id === entry.transactionId);
  const summary = batch.length ? `${batch.length} movimientos · Total ${formatCOP(batch.reduce((sum, item) => sum + BigInt(item.beforeObservation?.amountMinor ?? "0"), 0n).toString())}` : recordLabel(state, before);
  return <>
    <p className="history-record">{summary}</p>
    <small><time dateTime={entry.at}>{timestamp(entry.at)}</time></small>
    <details className="history-context"><summary>Ver cambio y efecto de deshacer</summary>
      {batch.length ? <><ul>{batch.map((item) => <li key={item.id}>{recordLabel(state, item.beforeObservation)} · {shortDate(item.beforeObservation?.date)}</li>)}</ul><p>Al deshacer, se retiran estos movimientos y sus capturas vuelven a estar pendientes.</p></> : <>
        {entry.beforeTransaction && <p>Antes: {recordLabel(state, entry.beforeTransaction)} · {shortDate(entry.beforeTransaction.date)}</p>}
        {current && !entry.undone && current.revision === entry.expectedRevision && <p>Después: {current.voided ? "Movimiento eliminado" : `${recordLabel(state, current)} · ${shortDate(current.date)}`}</p>}
        {current && !entry.undone && current.revision !== entry.expectedRevision && <p>Hay cambios posteriores. Deshaz primero las correcciones más recientes de este movimiento.</p>}
        <p>{entry.action === "merge" ? "Al deshacer, se restaura el movimiento anterior y la evidencia vuelve a estar pendiente." : (entry.action === "separate" || entry.action === "auto-withdrawal" || entry.action === "auto-product-transfer") ? "Al deshacer, se retira el movimiento y la evidencia vuelve a estar pendiente." : entry.action === "ignore" ? "Al deshacer, la evidencia vuelve a estar pendiente." : "Al deshacer, se restaura el movimiento anterior."}</p>
      </>}
    </details>
  </>;
}
export function ReviewDesk({ state, act, edit, stale }: {
  state: State;
  act: (fn: () => Promise<unknown>, message?: string) => Promise<void>;
  edit: (observation: Observation) => void;
  stale: boolean;
}) {
  const rawPending = state.observations.filter((observation) => observation.status === "review");
  const rawPendingIds = rawPending.map((observation) => observation.id);
  const hasReviewHistory = state.audit.some((entry) => ["merge", "separate", "ignore", "auto-withdrawal", "auto-product-transfer"].includes(entry.action));
  const resetReviewSession = !rawPending.length && !hasReviewHistory;
  const [sessionIds, setSessionIds] = useState<string[]>(() => loadReviewSession(rawPendingIds, resetReviewSession));
  const [resolvedLocally, setResolvedLocally] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Filters>(() => readStorage(REVIEW_FILTER_KEY, emptyFilters));
  const [activeId, setActiveId] = useState(() => readStorage(REVIEW_ACTIVE_KEY, ""));
  const [storageAvailable] = useState(() => {
    try {
      const key = "money-stalker.storage-check";
      localStorage.setItem(key, "1"); localStorage.removeItem(key); return true;
    } catch { return false; }
  });
  const listRef = useRef<HTMLElement>(null);
  const activeRowRef = useRef<HTMLButtonElement>(null);
  const filterDetailsRef = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState<string>(), [lastAction, setLastAction] = useState(""), [actionError, setActionError] = useState("");

  useEffect(() => { try { localStorage.setItem(REVIEW_FILTER_KEY, JSON.stringify(filters)); } catch { /* no-op */ } }, [filters]);
  useEffect(() => { try { localStorage.setItem(REVIEW_ACTIVE_KEY, JSON.stringify(activeId)); } catch { /* no-op */ } }, [activeId]);
  useEffect(() => {
    setResolvedLocally((current) => {
      const next = new Set([...current].filter((id) => rawPending.some((item) => item.id === id)));
      return next.size === current.size ? current : next;
    });
    setSessionIds((current) => {
      if (resetReviewSession) {
        if (current.length) saveReviewSession([]);
        return current.length ? [] : current;
      }
      const pendingIds = new Set(rawPendingIds), currentIds = new Set(current);
      const unresolved = current.filter((id) => pendingIds.has(id));
      const incoming = rawPendingIds.filter((id) => !currentIds.has(id));
      const next = !current.length || (!unresolved.length && incoming.length) ? rawPendingIds : incoming.length ? [...current, ...incoming] : current;
      if (next !== current) saveReviewSession(next); return next;
    });
  }, [state.observations, resetReviewSession]);

  const pending = rawPending.filter((observation) => !resolvedLocally.has(observation.id));
  const unresolvedSession = new Set(pending.map((observation) => observation.id));
  const resolved = sessionIds.filter((id) => !unresolvedSession.has(id)).length;
  const total = Math.max(sessionIds.length, resolved + pending.length);
  const filtered = useMemo(() => {
    const query = normalized(filters.query);
    let queryAmount: string | undefined;
    try { queryAmount = parseCOP(filters.query); } catch { /* Merchant searches are not currency values. */ }
    return pending.filter((observation) => {
      if (filters.accountId && observation.accountId !== filters.accountId) return false;
      if (filters.source && observation.source !== filters.source) return false;
      if (filters.reason && reasonKind(observation) !== filters.reason) return false;
      if (filters.from && (!observation.date || observation.date < filters.from)) return false;
      if (filters.to && (!observation.date || observation.date > filters.to)) return false;
      return !query || normalized(observation.merchant).includes(query) || (queryAmount !== undefined && observation.amountMinor === queryAmount);
    });
  }, [pending, filters]);
  const ordered = useMemo(() => [...filtered].sort((a, b) => (b.date ?? b.receivedAt).localeCompare(a.date ?? a.receivedAt)), [filtered]);
  const active = ordered.find((observation) => observation.id === activeId) ?? ordered[0];
  useEffect(() => {
    if (!active) { setActiveId(""); return; }
    if (active.id !== activeId) setActiveId(active.id);
  }, [active?.id, activeId]);
  useEffect(() => {
    const list = listRef.current, row = activeRowRef.current;
    if (!list || !row) return;
    const listBounds = list.getBoundingClientRect(), rowBounds = row.getBoundingClientRect();
    if (rowBounds.top < listBounds.top || rowBounds.bottom > listBounds.bottom) {
      list.scrollTop += rowBounds.top - listBounds.top - (list.clientHeight - row.clientHeight) / 2;
    }
  }, [active?.id, ordered.length]);

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
      setLastAction(message); return true;
    } catch (error) {
      const message = (error as Error).message || "No se pudo guardar.";
      setActionError(`${message} ${resolvedIds.length > 1 ? "Actualizamos la lista con lo que sí alcanzó a guardarse." : "La captura continúa pendiente."}`);
      return false;
    }
    finally { setBusy(undefined); }
  };
  const clearFilters = () => setFilters(emptyFilters);
  const filtersActive = Object.values(filters).some(Boolean);
  const filterChips: Array<{ key: keyof Filters; label: string }> = [
    ...(filters.accountId ? [{ key: "accountId" as const, label: `Cuenta: ${accountName(state, filters.accountId)}` }] : []),
    ...(filters.source ? [{ key: "source" as const, label: `Origen: ${sourceName(filters.source as Observation["source"])}` }] : []),
    ...(filters.reason ? [{ key: "reason" as const, label: `Tipo: ${{ candidate: "Posible coincidencia", incomplete: "Datos incompletos", unmatched: "Sin coincidencia" }[filters.reason]}` }] : []),
    ...(filters.from ? [{ key: "from" as const, label: `Desde: ${shortDate(filters.from)}` }] : []),
    ...(filters.to ? [{ key: "to" as const, label: `Hasta: ${shortDate(filters.to)}` }] : []),
  ];
  const candidates = active ? active.candidates.map((id) => state.transactions.find((item) => item.id === id && !item.voided)).filter((item): item is Transaction => Boolean(item)) : [];
  return <>
    {!pending.length && <section className="review-brief review-complete">
      <SidekickMark happy={!pending.length} />
      <div><h2>{pending.length ? `${pending.length} ${pending.length === 1 ? "captura pendiente" : "capturas pendientes"}.` : "Todo en su lugar"}</h2><p>{pending.length ? "Revisa cada captura antes de convertirla en movimiento." : "No tienes capturas pendientes. Cuando llegue una nueva, podrás revisarla aquí."}</p></div>
      <span className="review-count"><Glyph name={pending.length ? "search" : "check"} />{pending.length ? "Por revisar" : "Revisión al día"}</span>
    </section>}
    {stale && <p className="review-caution" role="status">No se pudieron actualizar los datos. Actualiza antes de tomar una decisión.</p>}
    {(pending.length > 0 || resolved > 0 || lastAction) && <section className="review-progress" aria-label="Progreso de revisión">
      <div className="review-progress-numbers"><span><strong>{pending.length}</strong> pendientes</span><span><strong>{resolved}</strong> resueltas</span></div>
      <span className="review-progress-saved">{busy ? "Guardando…" : storageAvailable ? "Progreso guardado" : "Progreso en esta pestaña"}</span>
      <progress max={Math.max(total, 1)} value={resolved}>{resolved} de {total}</progress>
      <p role="status" aria-live="polite">{lastAction || (pending.length ? `${resolved} de ${total} resueltas. Puedes salir y continuar después.` : `${resolved} de ${total} capturas resueltas. Puedes cambiar de sección sin perder este progreso.`)}</p>
      {actionError && <p className="review-action-error" role="alert">{actionError}</p>}
    </section>}

    {pending.length > 0 && <section className="review-inbox" aria-label="Capturas por revisar">
      <div className="review-inbox-toolbar">
        <label className="review-search"><span>Buscar capturas</span><input type="search" value={filters.query} placeholder="Comercio o valor…" onChange={(event) => setFilters({ ...filters, query: event.target.value })} /></label>
        <details ref={filterDetailsRef} className="review-filter-menu"><summary><Glyph name="search" size={16} /> Filtrar{filtersActive ? " · Activo" : ""}</summary><div className="review-filter-grid">
          <button type="button" className="review-filter-close" onClick={() => { if (filterDetailsRef.current) filterDetailsRef.current.open = false; }}><Glyph name="close" size={16} />Cerrar filtros</button>
          <label>Cuenta<select value={filters.accountId} onChange={(event) => setFilters({ ...filters, accountId: event.target.value })}><option value="">Todas</option>{state.accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
          <label>Origen<select value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })}><option value="">Todos</option><option value="sms">SMS</option><option value="wallet">Wallet</option></select></label>
          <label>Tipo<select value={filters.reason} onChange={(event) => setFilters({ ...filters, reason: event.target.value })}><option value="">Todos</option><option value="candidate">Posible coincidencia</option><option value="incomplete">Datos incompletos</option><option value="unmatched">Sin coincidencia</option></select></label>
          <label>Desde<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
          <label>Hasta<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
          {filtersActive && <button type="button" className="text-button" onClick={clearFilters}>Limpiar filtros</button>}
        </div></details>
      </div>
      {filtersActive && <div className="review-active-filters" aria-label="Filtros activos">
        {filterChips.map((chip) => <button type="button" className="review-filter-chip" key={chip.key} onClick={() => setFilters((current) => ({ ...current, [chip.key]: "" }))} aria-label={`Quitar filtro ${chip.label}`}><span>{chip.label}</span><Glyph name="close" size={14} /></button>)}
        {filters.query && <span className="review-query-state">Búsqueda: “{filters.query}”</span>}
        <button type="button" className="text-button" onClick={clearFilters}>Limpiar búsqueda y filtros</button>
      </div>}
      <div className="review-workspace">
        <aside ref={listRef} className="review-group-list" aria-label="Lista de capturas pendientes">
          <div className="review-group-list-heading"><strong>{filtersActive ? `${ordered.length} de ${pending.length}` : ordered.length} {ordered.length === 1 ? "captura" : "capturas"}</strong><span>{filtersActive ? "Filtradas" : "Todas las pendientes"}</span></div>
          {ordered.map((observation) => {
            const selected = observation.id === active?.id;
            return <button ref={selected ? activeRowRef : undefined} type="button" className={`review-group ${selected ? "active" : ""}`} aria-pressed={selected} aria-current={selected ? "true" : undefined} key={observation.id} onClick={() => setActiveId(observation.id)}>
              <span className="review-group-main"><strong>{observation.merchant || "Movimiento sin comercio"}</strong><b>{observation.amountMinor ? formatCOP(observation.amountMinor) : "Sin valor"}</b></span>
              <span>{accountName(state, observation.accountId)} · {sourceName(observation.source)}</span>
              <span className="review-capture-meta"><span>{shortDate(observation.date)} · Capturada {captureTime(observation.observedAt)}</span>{selected && <strong>En revisión</strong>}</span>
            </button>;
          })}
          {!ordered.length && <div className="review-no-results"><strong>No hay capturas con estos filtros</strong><button className="text-button" onClick={clearFilters}>Ver todas</button></div>}
        </aside>

        {active && <article className="clue review-focus" key={active.id} aria-labelledby={`review-capture-${active.id}`}>
          <div className="clue-header"><SourceTag source={active.source} /><div className="clue-header-actions"><span className="clue-state">Captura {ordered.findIndex((item) => item.id === active.id) + 1} de {ordered.length}</span></div></div>
          <div className={`clue-comparison ${candidates.length ? "" : "without-candidate"}`}>
            <div className="source-evidence"><h2 id={`review-capture-${active.id}`}>{active.merchant || "Movimiento sin comercio"}</h2><strong className="evidence-amount">{active.amountMinor ? formatCOP(active.amountMinor) : "Falta el valor"}</strong><p>{accountName(state, active.accountId)}<br />{shortDate(active.date)} · Capturada {captureTime(active.observedAt)}</p>{active.reason && !["Captura de Shortcut pendiente de confirmación", "Posible coincidencia: confirma antes de unir"].includes(active.reason) && <p className="clue-reason">{active.reason}</p>}<details className="evidence-details"><summary>Detalles de la evidencia</summary><p>Recibida: {timestamp(active.receivedAt)}<br />Tipo: {{ expense: "Gasto", income: "Ingreso", transfer: "Transferencia", refund: "Devolución", loan_payment: "Pago de crédito" }[active.kind]}</p>{active.location && <p>Ubicación: {active.location.latitude.toFixed(4)}, {active.location.longitude.toFixed(4)} · {active.location.accuracy === undefined ? "precisión no disponible" : `precisión ${Math.round(active.location.accuracy)} m`}. Puede ser posterior al pago.<br />{active.location.timestampSource === "event" ? "Hora del evento (muestra sin fecha propia)" : "Muestra tomada"}: {timestamp(active.location.observedAt)}<br />{capturedAddress(active.location)}<br /><a href={appleMapsURL(active.location.latitude, active.location.longitude)} target="_blank" rel="noreferrer">Apple Maps</a>{" · "}<a href={googleMapsURL(active.location.latitude, active.location.longitude)} target="_blank" rel="noreferrer">Google Maps</a></p>}</details></div>
            <div className="evidence-connector"><Glyph name="arrow" size={22} /></div>
            <div className="candidate-evidence"><h4>{candidates.length ? "Compara antes de decidir" : canSeparate(active) ? "Lista para revisar" : "Datos por completar"}</h4>{candidates.length ? candidates.map((transaction) => {
              const exact = transaction.amountMinor === active.amountMinor && transaction.date === active.date && transaction.accountId === active.accountId;
              const accountDiffers = transaction.accountId !== active.accountId;
              return <div className="candidate" key={transaction.id}><div className="candidate-heading"><strong>{transaction.merchant || "Movimiento"}</strong><b>{formatCOP(transaction.amountMinor)}</b></div><p>{accountName(state, transaction.accountId)} · {shortDate(transaction.date)}</p><span className={`match-detail ${exact ? "" : "different"}`}>{transaction.amountMinor === active.amountMinor ? "Mismo valor" : "Valor diferente"} · {transaction.date === active.date ? "Misma fecha" : "Fecha diferente"} · {accountDiffers ? "Cuenta diferente" : "Misma cuenta"}</span>{transaction.amountMinor !== active.amountMinor && active.source === "statement" && active.amountMinor && <p className="amount-change">Al unir, el valor cambiará a {formatCOP(active.amountMinor)} según el extracto.</p>}{accountDiffers ? <div className="account-conflict" role="status"><strong>No se pueden unir</strong><p>La captura pertenece a {accountName(state, active.accountId)} y el movimiento a {accountName(state, transaction.accountId)}. Usa Revisar para guardar la captura como un movimiento separado.</p></div> : <button className={`button ${exact ? "primary" : "secondary"}`} disabled={Boolean(busy) || stale} onClick={() => void run(active.id, () => post("/matches", { observationId: active.id, transactionId: transaction.id }), "Evidencias unidas. El movimiento quedó actualizado.", [active.id])}><Glyph name="check" size={17} />{busy === active.id ? "Guardando…" : exact ? `Unir con ${transaction.merchant || "movimiento"}` : "Unir de todos modos"}</button>}</div>;
            }) : <p>{canSeparate(active) ? "Recibimos la captura, pero aún no está guardada como movimiento. Revísala y confirma sus datos antes de guardar." : `Completa ${new Intl.ListFormat("es-CO").format(missingCaptureFields(active))} antes de guardarla.`}</p>}</div>
          </div>
          <div className="clue-actions">
            <button className="button primary" disabled={Boolean(busy) || stale} onClick={() => edit(active)}>Revisar</button>
            <details className="discard-menu"><summary>Más opciones</summary><p>Descartar retira esta evidencia sin crear ni modificar un movimiento. Podrás deshacerlo en el historial.</p><button className="text-button discard-clue" disabled={Boolean(busy) || stale} onClick={() => void run(active.id, () => post("/reviews", { observationId: active.id, action: "ignore" }), "Evidencia descartada. Puedes deshacerlo en el historial.", [active.id])}>Descartar evidencia</button></details>
          </div>
        </article>}
        {active && <p className="sr-only" role="status" aria-live="polite">Mostrando {active.merchant || "movimiento sin comercio"}, {active.amountMinor ? formatCOP(active.amountMinor) : "sin valor"}, capturada {captureTime(active.observedAt)}.</p>}
      </div>
    </section>}

    {!pending.length && <div className="review-next"><Glyph name="check" /><p>{history.length ? "Una captura menos, una vista más clara." : "Tu próxima captura aparecerá aquí."}</p><a href="#/resumen" className="button secondary">Volver a mi resumen <Glyph name="arrow" size={17} /></a></div>}
        {history.length > 0 && <section className="correction-history"><div className="section-heading"><h2>Historial de correcciones</h2><span className="muted">Puedes volver atrás</span></div>{history.map((entry) => <div className="audit-row" key={entry.batchId ? `batch:${entry.batchId}` : entry.id}><div><strong>{entry.action === "batch-separate" ? `${entry.batchCount} movimientos separados` : ({ "auto-withdrawal": "Retiro transferido a efectivo", "auto-product-transfer": "Transferencia a producto propio", merge: "Evidencias unidas", edit: "Movimiento editado", delete: "Movimiento eliminado", ignore: "Evidencia descartada", separate: "Movimiento separado" } as Record<string, string>)[entry.action] ?? entry.action}</strong><HistoryContext entry={entry} state={state} /></div><button className="text-button" disabled={Boolean(busy) || Boolean(entry.undone) || Boolean(entry.batchUndone) || stale} onClick={() => void run(entry.batchId ? `batch:${entry.batchId}` : entry.id, () => entry.batchId ? post("/undo/batch", { batchId: entry.batchId }) : post("/undo", { auditId: entry.id }), entry.batchId ? "Lote deshecho. Las capturas vuelven a estar pendientes." : "Corrección deshecha. Recuperamos el estado anterior.")}>{entry.undone || entry.batchUndone ? "Deshecho" : busy === (entry.batchId ? `batch:${entry.batchId}` : entry.id) ? "Deshaciendo…" : "Deshacer"}</button></div>)}</section>}
  </>;
}
