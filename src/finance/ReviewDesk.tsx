import { useEffect, useState } from "react";
import type { State, Observation, Transaction } from "../../domain/model";
import { formatCOP } from "../../domain/money";
import { api, post } from "../api";
import { Icon as Glyph, Eyes as SidekickMark } from "../design-system/ui";

const REVIEW_PROGRESS_KEY = "money-stalker.review-progress.v2";
const LEGACY_REVIEW_SESSION_KEY = "money-stalker.review-session.v1";

function loadReviewSession(fallback: string[]) {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(REVIEW_PROGRESS_KEY) ??
        sessionStorage.getItem(LEGACY_REVIEW_SESSION_KEY) ??
        "null",
    );
    if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string")) {
      const ids = [...new Set<string>(parsed)];
      saveReviewSession(ids);
      return ids;
    }
    saveReviewSession(fallback);
    return fallback;
  } catch {
    return fallback;
  }
}

function saveReviewSession(ids: string[]) {
  try {
    localStorage.setItem(REVIEW_PROGRESS_KEY, JSON.stringify(ids));
  } catch {
    // The queue still works when private browsing blocks web storage.
  }
}

function shortDate(value?: string) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Bogota",
  }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
}
function accountName(state: State, id?: string) {
  return state.accounts.find((a) => a.id === id)?.name ?? "Sin cuenta";
}
function SourceTag({ source }: { source: Observation["source"] }) {
  return (
    <span className="trail-tag">
      <Glyph name="source" size={15} />
      {source === "statement"
        ? "Extracto"
        : source === "sms"
          ? "SMS"
          : "Wallet"}
    </span>
  );
}
function EvidenceMessage({ id }: { id: string }) {
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div>
      <button
        className="text-button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await api<{ message?: string }>(
              `/observations/${id}/evidence`,
            );
            setText(result.message ?? "Sin mensaje original");
          } catch {
            setError("No pudimos cargar el mensaje. Intenta de nuevo.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Cargando mensaje…" : "Ver mensaje original"}
      </button>
      {text && <p className="evidence-message">{text}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
export function ReviewDesk({
  state,
  act,
  edit,
  stale,
}: {
  state: State;
  act: (fn: () => Promise<unknown>, message?: string) => Promise<void>;
  edit: (o: Observation) => void;
  stale: boolean;
}) {
  const rawPending = state.observations.filter((o) => o.status === "review");
  const rawPendingIds = rawPending.map((o) => o.id);
  const [sessionIds, setSessionIds] = useState<string[]>(() =>
    loadReviewSession(rawPendingIds),
  );
  const [resolvedLocally, setResolvedLocally] = useState<Set<string>>(
    new Set(),
  );
  useEffect(() => {
    setResolvedLocally((current) => {
      const next = new Set(
        [...current].filter((id) => rawPending.some((o) => o.id === id)),
      );
      return next.size === current.size ? current : next;
    });
    setSessionIds((current) => {
      const pendingIds = new Set(rawPendingIds);
      const currentIds = new Set(current);
      const unresolved = current.filter((id) => pendingIds.has(id));
      const incoming = rawPendingIds.filter((id) => !currentIds.has(id));
      const next =
        !current.length || (!unresolved.length && incoming.length)
          ? rawPendingIds
          : incoming.length
            ? [...current, ...incoming]
            : current;
      if (next !== current) saveReviewSession(next);
      return next;
    });
  }, [state.observations]);
  const pending = rawPending.filter((o) => !resolvedLocally.has(o.id));
  const unresolvedSession = new Set(pending.map((o) => o.id));
  const resolved = sessionIds.filter((id) => !unresolvedSession.has(id)).length;
  const total = Math.max(sessionIds.length, resolved + pending.length);
  const visible = pending.slice(0, 10);
  const history = state.audit
    .filter((a) => a.beforeObservation || a.beforeTransaction)
    .slice(-10)
    .reverse();
  const [busy, setBusy] = useState<string>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastAction, setLastAction] = useState("");
  const [actionError, setActionError] = useState("");
  const canSeparate = (o: Observation) =>
    Boolean(
      o.accountId &&
        o.amountMinor &&
        o.date &&
        (o.kind !== "transfer" || o.counterAccountId),
    );
  const selectable = visible.filter(canSeparate).map((o) => o.id);
  const selectedIds = [...selected].filter((id) =>
    pending.some((o) => o.id === id && canSeparate(o)),
  );
  const allVisibleSelected =
    selectable.length > 0 && selectable.every((id) => selected.has(id));
  const run = async (
    id: string,
    fn: () => Promise<unknown>,
    message: string,
    resolvedObservationIds: string[] = [],
  ) => {
    setBusy(id);
    setActionError("");
    try {
      await act(fn, "");
      if (resolvedObservationIds.length)
        setResolvedLocally((current) => {
          const next = new Set(current);
          for (const observationId of resolvedObservationIds)
            next.add(observationId);
          return next;
        });
      setLastAction(message);
      return true;
    } catch (error) {
      setActionError(
        (error as Error).message ||
          "No se pudo guardar. La pista continúa pendiente.",
      );
      return false;
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <>
      <section
        className={`review-brief ${!pending.length ? "review-complete" : ""}`}
      >
        <SidekickMark happy={!pending.length} />
        <div>
          <h2>
            {pending.length
              ? `${pending.length} ${pending.length === 1 ? "pista necesita" : "pistas necesitan"} tu ojo.`
              : "Todo en su lugar"}
          </h2>
          <p>
            {pending.length
              ? "Yo acerco las pistas. Tú confirmas si cuentan la misma compra."
              : "Sin evidencias pendientes. Cuando llegue otra pista, podrás revisarla aquí."}
          </p>
        </div>
        <span className="review-count">
          <Glyph name={pending.length ? "search" : "check"} />
          {pending.length ? "Por revisar" : "Revisión al día"}
        </span>
      </section>
      {stale && (
        <p className="review-caution" role="status">
          No se pudieron actualizar los datos. Actualiza antes de tomar una
          decisión.
        </p>
      )}
      {(pending.length > 0 || resolved > 0 || lastAction) && (
        <>
          <section
            className="review-progress"
            aria-label="Progreso de revisión"
          >
            <div className="review-progress-numbers">
              <span>
                <strong>{pending.length}</strong> pendientes
              </span>
              <span>
                <strong>{resolved}</strong> resueltas en esta revisión
              </span>
            </div>
            <progress max={Math.max(total, 1)} value={resolved}>
              {resolved} de {total}
            </progress>
            <p role="status" aria-live="polite">
              {lastAction ||
                (pending.length
                  ? `Mostrando pistas ${resolved + 1}–${resolved + visible.length} de ${total}.`
                  : `${resolved} de ${total} pistas resueltas. Puedes cambiar de sección sin perder este progreso.`)}
            </p>
            {actionError && (
              <p className="review-action-error" role="alert">
                {actionError} La selección continúa pendiente.
              </p>
            )}
            {selectable.length > 0 && (
              <div className="review-batch-actions">
                <button
                  type="button"
                  className="text-button"
                  disabled={Boolean(busy) || stale}
                  onClick={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      for (const id of selectable)
                        if (allVisibleSelected) next.delete(id);
                        else next.add(id);
                      return next;
                    })
                  }
                >
                  {allVisibleSelected
                    ? "Quitar selección"
                    : `Seleccionar ${selectable.length} visibles`}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={!selectedIds.length || Boolean(busy) || stale}
                  onClick={() =>
                    void run(
                      "batch",
                      () =>
                        post("/reviews/batch", {
                          observationIds: selectedIds,
                          action: "separate",
                        }),
                      selectedIds.length === pending.length
                        ? `${selectedIds.length} ${selectedIds.length === 1 ? "pista resuelta" : "pistas resueltas"}. La revisión quedó al día.`
                        : `${selectedIds.length} ${selectedIds.length === 1 ? "pista resuelta y retirada" : "pistas resueltas y retiradas"} de pendientes. Ahora ves ${selectedIds.length === 1 ? "la siguiente" : "las siguientes"}.`,
                      selectedIds,
                    ).then((saved) => {
                      if (saved) setSelected(new Set());
                    })
                  }
                >
                  {busy === "batch"
                    ? "Guardando selección…"
                    : `Registrar ${selectedIds.length || "selección"} como distintos`}
                </button>
              </div>
            )}
          </section>
          {pending.length > 0 && (
            <p className="review-guidance">
              <Glyph name="shield" size={18} />
              Las coincidencias son sugerencias. Une solo evidencias de la misma
              compra. Si son peajes u otras compras repetidas, regístralas como
              movimientos distintos; puedes seleccionar hasta 10 a la vez.
            </p>
          )}
        </>
      )}
      <div className="clue-list">
        {visible.map((o, index) => {
          const candidates = o.candidates
            .map((id) =>
              state.transactions.find((t) => t.id === id && !t.voided),
            )
            .filter((t): t is Transaction => Boolean(t));
          return (
            <article className="clue" key={o.id}>
              <div className="clue-header">
                <SourceTag source={o.source} />
                <div className="clue-header-actions">
                  <span className="clue-state">
                    Pista {resolved + index + 1} de {total}
                  </span>
                  {canSeparate(o) && (
                    <label className="clue-select">
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        disabled={Boolean(busy) || stale}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(o.id);
                            else next.delete(o.id);
                            return next;
                          })
                        }
                      />
                      Seleccionar
                    </label>
                  )}
                </div>
              </div>
              <div className="clue-comparison">
                <div className="source-evidence">
                  <h3>{o.merchant || "Movimiento sin comercio"}</h3>
                  <strong className="evidence-amount">
                    {o.amountMinor
                      ? formatCOP(o.amountMinor)
                      : "Falta el valor"}
                  </strong>
                  <p>
                    {accountName(state, o.accountId)}
                    <br />
                    {shortDate(o.date)}
                  </p>
                  {o.reason && <p className="clue-reason">{o.reason}</p>}
                  {o.source === "sms" && <EvidenceMessage id={o.id} />}
                  <details className="evidence-details">
                    <summary>Detalles de la evidencia</summary>
                    <p>
                      Recibida: {shortDate(o.receivedAt)}
                      <br />
                      Tipo:{" "}
                      {
                        {
                          expense: "Gasto",
                          income: "Ingreso",
                          transfer: "Transferencia",
                          refund: "Devolución",
                        }[o.kind]
                      }
                    </p>
                    {o.location && (
                      <p>
                        Ubicación: {o.location.latitude.toFixed(4)},{" "}
                        {o.location.longitude.toFixed(4)} · precisión{" "}
                        {Math.round(o.location.accuracy)} m. Puede ser posterior
                        al pago.
                      </p>
                    )}
                  </details>
                </div>
                <div className="evidence-connector">
                  <Glyph name="arrow" size={22} />
                </div>
                <div className="candidate-evidence">
                  <h4>
                    {candidates.length
                      ? "¿Es este el mismo movimiento?"
                      : "Todavía falta una pieza."}
                  </h4>
                  {candidates.length ? (
                    candidates.map((t) => (
                      <div className="candidate" key={t.id}>
                        <div className="candidate-heading">
                          <strong>{t.merchant || "Movimiento"}</strong>
                          <b>{formatCOP(t.amountMinor)}</b>
                        </div>
                        <p>
                          {accountName(state, t.accountId)} ·{" "}
                          {shortDate(t.date)}
                        </p>
                        <span
                          className={`match-detail ${t.amountMinor !== o.amountMinor || t.date !== o.date || t.accountId !== o.accountId ? "different" : ""}`}
                        >
                          {t.amountMinor === o.amountMinor
                            ? "Mismo valor"
                            : "El valor es diferente"}{" "}
                          ·{" "}
                          {t.date === o.date
                            ? "Misma fecha"
                            : "Fecha diferente"}
                        </span>
                        {t.amountMinor !== o.amountMinor &&
                          o.source === "statement" &&
                          o.amountMinor && (
                            <p className="amount-change">
                              Al unir, el valor cambiará a{" "}
                              {formatCOP(o.amountMinor)} según el extracto.
                            </p>
                          )}
                        <button
                          className="button primary"
                          disabled={Boolean(busy) || stale}
                          onClick={() =>
                            void run(
                              o.id,
                              () =>
                                post("/matches", {
                                  observationId: o.id,
                                  transactionId: t.id,
                                }),
                              "Pistas unidas y retiradas de pendientes. El movimiento quedó actualizado.",
                              [o.id],
                            )
                          }
                        >
                          <Glyph name="check" size={17} />
                          {busy === o.id
                            ? "Guardando…"
                            : `Unir con ${t.merchant || "movimiento"}`}
                        </button>
                      </div>
                    ))
                  ) : (
                    <p>
                      Completa los datos o registra este movimiento por
                      separado. No lo uniremos automáticamente.
                    </p>
                  )}
                </div>
              </div>
              <div className="clue-actions">
                {canSeparate(o) ? (
                  <>
                    <button
                      className="button secondary"
                      disabled={Boolean(busy) || stale}
                      onClick={() =>
                        void run(
                          o.id,
                          () =>
                            post("/reviews", {
                              observationId: o.id,
                              action: "separate",
                            }),
                          pending.length === 1
                            ? "Pista resuelta. La revisión quedó al día."
                            : "Pista resuelta y retirada de pendientes. Ahora ves la siguiente.",
                          [o.id],
                        )
                      }
                    >
                      {busy === o.id
                        ? "Guardando…"
                        : "Registrar como movimiento distinto"}
                    </button>
                    <button
                      className="text-button"
                      disabled={Boolean(busy) || stale}
                      onClick={() => edit(o)}
                    >
                      Editar antes de registrar
                    </button>
                  </>
                ) : (
                  <button
                    className="button secondary"
                    disabled={Boolean(busy) || stale}
                    onClick={() => edit(o)}
                  >
                    Completar datos
                  </button>
                )}
                <button
                  className="text-button discard-clue"
                  disabled={Boolean(busy) || stale}
                  onClick={() =>
                    void run(
                      o.id,
                      () =>
                        post("/reviews", {
                          observationId: o.id,
                          action: "ignore",
                        }),
                      "Evidencia descartada y retirada de pendientes. Puedes deshacerlo en el historial.",
                      [o.id],
                    )
                  }
                >
                  Descartar evidencia
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {!pending.length && (
        <div className="review-next">
          <Glyph name="check" />
          <p>
            {history.length
              ? "Una pista menos, una vista más clara."
              : "Tu próxima pista aparecerá aquí."}
          </p>
          <a href="#/resumen" className="button secondary">
            Volver a mi resumen <Glyph name="arrow" size={17} />
          </a>
        </div>
      )}
      <section className="correction-history">
        <div className="section-heading">
          <h2>Historial de correcciones</h2>
          <span className="muted">Puedes volver atrás</span>
        </div>
        {history.length ? (
          history.map((a) => (
            <div className="audit-row" key={a.id}>
              <div>
                <strong>
                  {(
                    {
                      merge: "Evidencias unidas",
                      edit: "Movimiento editado",
                      ignore: "Evidencia descartada",
                      separate: "Movimiento separado",
                    } as Record<string, string>
                  )[a.action] ?? a.action}
                </strong>
                <small>{shortDate(a.at)}</small>
              </div>
              <button
                className="text-button"
                disabled={Boolean(busy) || Boolean(a.undone) || stale}
                onClick={() =>
                  void run(
                    a.id,
                    () => post("/undo", { auditId: a.id }),
                    "Corrección deshecha. Recuperamos el estado anterior.",
                  )
                }
              >
                {a.undone
                  ? "Deshecho"
                  : busy === a.id
                    ? "Deshaciendo…"
                    : "Deshacer"}
              </button>
            </div>
          ))
        ) : (
          <p className="history-empty">
            Aquí quedará el rastro de tus correcciones.
          </p>
        )}
      </section>
    </>
  );
}
