import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  emptyState,
  accountKindLabels,
  type State,
  type Observation,
  type Transaction,
  type TransactionPlace,
} from "../domain/model";
import { dashboard, duplicateTransactions } from "../domain/ledger";
import { bogotaDate, decimalCOP, formatCOP, parseCOP } from "../domain/money";
import { api, download, post } from "./api";
import {
  apiURL,
  configured,
  initializeAuth,
  local,
  login,
  logout,
} from "./auth";
import { Dashboard, displayDate, SurfaceLoading } from "./finance/Dashboard";
import { ReviewDesk } from "./finance/ReviewDesk";
import { Reports } from "./finance/Reports";
import { AccountRail } from "./finance/AccountRail";
import { AccountArtwork } from "./finance/AccountArtwork";
import { CategoryIcon } from "./finance/CategoryIcon";
import { TransactionMap } from "./finance/TransactionMap";
import { DesignSystem } from "./design-system/DesignSystem";
import {
  Icon,
  Eyes,
  EvidenceTrail,
  Badge as SystemBadge,
  DisclosureEditor,
  EmptyState,
  Field,
} from "./design-system/ui";

type Summary = ReturnType<typeof dashboard>;
type Batch = {
  id: string;
  accountId?: string;
  filename: string;
  profile?: string;
  status: string;
  total?: number;
  accepted?: number;
  rejected?: number;
  skipped?: number;
  duplicates?: number;
  omittedDuplicates?: number;
  next: number;
  duplicate?: boolean;
  error?: string;
  rows?: {
    row: number;
    status: string;
    error?: string;
    duplicateCandidates?: string[];
    observation?: Observation;
  }[];
  offset?: number;
  more?: boolean;
};
type ImportProfile = { id: string; label: string; verified: boolean };
function CopyCaptureValue({ label, value, sensitive = false }: { label: string; value: string; sensitive?: boolean }) {
  const [feedback, setFeedback] = useState("");
  return <div className="capture-copy-value"><strong>{label}</strong><code className={sensitive ? "token" : ""}>{value}</code><button type="button" className="button secondary" onClick={async () => {
    try { await navigator.clipboard.writeText(value); setFeedback("Copiado"); }
    catch { setFeedback("No se pudo copiar. Selecciona el texto y cópialo manualmente."); }
  }}>Copiar {label.toLocaleLowerCase("es-CO")}</button><span role="status">{feedback}</span></div>;
}
const MAX_ACCOUNT_IMAGE_BYTES = 5 * 1024 * 1024;
async function prepareAccountArtwork(file: File) {
  if (!file.size) return undefined;
  if (
    file.size > MAX_ACCOUNT_IMAGE_BYTES ||
    !["image/jpeg", "image/png", "image/webp"].includes(file.type)
  )
    throw new Error("Elige una imagen JPG, PNG o WebP de hasta 5 MB");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("No pudimos leer esa imagen"));
    });
    for (const [side, quality] of [
      [96, 0.82],
      [72, 0.74],
      [56, 0.68],
    ] as const) {
      const canvas = document.createElement("canvas");
      canvas.width = side;
      canvas.height = side;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Tu navegador no pudo preparar la imagen");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      const inset = Math.round(side * 0.08);
      const scale = Math.min(
        (side - inset * 2) / image.naturalWidth,
        (side - inset * 2) / image.naturalHeight,
      );
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(
        image,
        (side - width) / 2,
        (side - height) / 2,
        width,
        height,
      );
      const data = canvas.toDataURL("image/webp", quality);
      if (data.length <= 14000) return data;
    }
    throw new Error(
      "La imagen sigue siendo demasiado compleja; elige una más simple",
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
const nav = [
  ["resumen", "Resumen", "overview"],
  ["movimientos", "Movimientos", "arrows"],
  ["reportes", "Reportes", "overview"],
  ["revisar", "Revisar", "check"],
  ["cuentas", "Cuentas y ajustes", "wallet"],
] as const;
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <EmptyState title={title}>{children}</EmptyState>;
}
function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <SystemBadge
      tone={
        tone === "green" ? "success" : tone === "amber" ? "warning" : "neutral"
      }
    >
      {children}
    </SystemBadge>
  );
}
type FlowRecord = Pick<Observation, "kind" | "accountId" | "counterAccountId">;
function isIncoming(record: FlowRecord, selectedAccount: string) {
  return (
    record.kind === "income" ||
    record.kind === "refund" ||
    (record.kind === "transfer" && record.counterAccountId === selectedAccount)
  );
}
function flowLabel(record: FlowRecord, selectedAccount: string, state: State) {
  const selected = state.accounts.find(
    (account) => account.id === selectedAccount,
  );
  if (record.kind === "income") return "Ingreso";
  if (record.kind === "refund") return "Devolución";
  if (record.kind === "expense")
    return selected?.kind === "credit" ? "Compra" : "Gasto";
  const incoming = isIncoming(record, selectedAccount);
  if (incoming && selected?.kind === "credit") return "Pago recibido";
  const destination = state.accounts.find(
    (account) => account.id === record.counterAccountId,
  );
  if (!incoming && destination?.kind === "credit") return "Pago de tarjeta";
  return incoming ? "Transferencia recibida" : "Transferencia enviada";
}
function categoryLabel(state: State, categoryId: string) {
  const category = state.categories.find((item) => item.id === categoryId);
  if (!category) return "Sin categoría";
  const parent = category.parentId
    ? state.categories.find((item) => item.id === category.parentId)
    : undefined;
  return parent ? `${parent.name} › ${category.name}` : category.name;
}
function categoryMatches(state: State, transactionCategoryId: string, filterId: string) {
  if (!filterId) return true;
  const category = state.categories.find((item) => item.id === transactionCategoryId);
  return transactionCategoryId === filterId || category?.parentId === filterId;
}
function FlowIndicator({
  record,
  selectedAccount,
  state,
}: {
  record: FlowRecord;
  selectedAccount: string;
  state: State;
}) {
  const incoming = isIncoming(record, selectedAccount);
  return (
    <span className={`transaction-flow ${incoming ? "incoming" : "outgoing"}`}>
      <Icon name={incoming ? "incoming" : "outgoing"} size={12} />
      {flowLabel(record, selectedAccount, state)}
    </span>
  );
}
function AppForm({
  children,
  onSubmit,
  submit = "Guardar",
  className = "",
}: {
  children: ReactNode;
  onSubmit: (f: FormData) => Promise<unknown>;
  submit?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    try {
      const result = await onSubmit(new FormData(form));
      if (result !== false) form.reset();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={handle} className={`form ${className}`}>
      {children}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="button primary" disabled={busy}>
        {busy ? "Guardando…" : submit}
      </button>
    </form>
  );
}
const str = (f: FormData, key: string) => String(f.get(key) ?? "");
const amount = (f: FormData, key: string) => parseCOP(str(f, key));
const freshId = () => crypto.randomUUID();

export function App() {
  const [state, setState] = useState<State>(emptyState),
    [summary, setSummary] = useState<Summary>();
  const [signedIn, setSignedIn] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const initialPage = location.hash.slice(2) || "resumen";
  const [page, setPage] = useState(
    initialPage === "importar" ? "movimientos" : initialPage,
  );
  const [editing, setEditing] = useState<Transaction | Observation | "new">();
  const [movementPreset, setMovementPreset] = useState<{ accountId: string; kind: "income" }>();
  const [importing, setImporting] = useState(initialPage === "importar");
  const [loading, setLoading] = useState(false),
    [notice, setNotice] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<string>();
  const [movementAccount, setMovementAccount] = useState<string>();
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date>();
  const [stale, setStale] = useState(false);
  const alive = useRef(true);
  const refreshSequence = useRef(0);
  const refreshController = useRef<AbortController | null>(null);
  const refreshInFlight = useRef(false);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    refreshInFlight.current = true;
    setLoading(true);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("La actualización tardó demasiado. Intenta de nuevo."));
      }, 15000);
    });
    try {
      const [s, d] = await Promise.race([Promise.all([
        api<State>("/state", { signal: controller.signal }),
        api<Summary>("/dashboard", { signal: controller.signal }),
      ]), timeout]);
      if (sequence !== refreshSequence.current) return true;
      setState(s);
      setSummary(d);
      setRefreshedAt(new Date());
      setStale(false);
      setError("");
      return true;
    } catch (e) {
      if (sequence !== refreshSequence.current) return false;
      setStale(true);
      setError(controller.signal.aborted ? "La actualización tardó demasiado. Intenta de nuevo." : (e as Error).message);
      return false;
    } finally {
      clearTimeout(timeoutId);
      if (sequence === refreshSequence.current) {
        refreshInFlight.current = false;
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void initializeAuth()
      .then((ok) => {
        if (alive.current) {
          setSignedIn(ok);
          setReady(true);
        }
      })
      .catch((e) => {
        setError(e.message);
        setReady(true);
      });
    const route = () => {
      const next = location.hash.slice(2) || "resumen";
      if (next === "importar") {
        setPage("movimientos");
        setImporting(true);
        history.replaceState(null, "", "#/movimientos");
      } else setPage(next);
    };
    const expired = () => {
      setSignedIn(false);
      setState(emptyState());
      setSummary(undefined);
    };
    addEventListener("hashchange", route);
    addEventListener("session-expired", expired);
    return () => {
      alive.current = false;
      removeEventListener("hashchange", route);
      removeEventListener("session-expired", expired);
    };
  }, []);
  useEffect(() => {
    if (signedIn) {
      void refresh();
      const timer = setInterval(() => {
        if (document.visibilityState === "visible" && !refreshInFlight.current) void refresh();
      }, 30000);
      let returnTimer: ReturnType<typeof setTimeout> | undefined;
      const refreshOnReturn = () => {
        clearTimeout(returnTimer);
        if (document.visibilityState !== "visible") return;
        // A single return can emit visibilitychange, focus and pageshow together.
        returnTimer = setTimeout(() => {
          if (document.visibilityState === "visible" && !refreshInFlight.current) void refresh();
        }, 200);
      };
      document.addEventListener("visibilitychange", refreshOnReturn);
      window.addEventListener("focus", refreshOnReturn);
      window.addEventListener("pageshow", refreshOnReturn);
      window.addEventListener("online", refreshOnReturn);
      return () => {
        clearInterval(timer);
        clearTimeout(returnTimer);
        document.removeEventListener("visibilitychange", refreshOnReturn);
        window.removeEventListener("focus", refreshOnReturn);
        window.removeEventListener("pageshow", refreshOnReturn);
        window.removeEventListener("online", refreshOnReturn);
        refreshSequence.current++;
        refreshController.current?.abort();
        refreshInFlight.current = false;
      };
    }
  }, [signedIn, refresh]);
  useEffect(() => {
    if (!state.accounts.length) {
      setMovementAccount(undefined);
      return;
    }
    if (
      !movementAccount ||
      !state.accounts.some((a) => a.id === movementAccount)
    )
      setMovementAccount(state.accounts[0].id);
  }, [state.accounts, movementAccount]);
  const act = async (
    fn: () => Promise<unknown>,
    message = "Cambios guardados",
  ) => {
    setNotice("");
    try {
      await fn();
      if (message) setNotice(message);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      // Some server operations intentionally span several bounded DynamoDB
      // transactions. If a later chunk fails, reload the durable state so the
      // interface reflects every chunk that did finish.
      try {
        await refresh();
      } catch {
        // Preserve the mutation error; the regular stale-state UI handles a
        // refresh failure separately.
      }
      throw e;
    }
  };
  const title = nav.find((n) => n[0] === page)?.[1] ?? "Resumen";
  if (!ready)
    return <div className="loading-screen">Preparando tu espacio…</div>;
  if (!signedIn)
    return (
      <main className="welcome">
        <div className="welcome-mark">
          <Eyes />
        </div>
        <p className="welcome-name">Money Stalker</p>
        <h1>
          Tu dinero.
          <br />
          Sin puntos ciegos.
        </h1>
        <p>
          Una vista clara de lo que tienes, lo que debes
          <br />y lo que realmente puedes gastar.
        </p>
        {!configured ? (
          <div className="notice">
            El sitio está listo. Falta conectar la API y el acceso privado antes
            de usar tus datos.
          </div>
        ) : (
          <button
            className="button primary"
            onClick={() => void login().catch((e) => setError(e.message))}
          >
            Entrar a mi espacio <Icon name="arrow" />
          </button>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <small>Tus cuentas y movimientos requieren acceso autorizado.</small>
      </main>
    );
  const selectAccount = (id?: string) => {
    if (page === "movimientos") {
      setMovementAccount(id ?? state.accounts[0]?.id);
      setAccountsOpen(false);
      return;
    }
    if (page === "reportes") {
      setSelectedAccount(id);
      setAccountsOpen(false);
      return;
    }
    setSelectedAccount(id);
    setAccountsOpen(false);
    location.hash = "#/resumen";
  };
  return (
    <div className={`app-shell ${accountsOpen ? "accounts-open" : ""}`}>
      <header className="app-header">
        <a
          className="app-brand"
          href="#/resumen"
          onClick={() => setSelectedAccount(undefined)}
        >
          <span className="brand-mark">
            <Eyes />
          </span>
          <strong>
            money stalker<span>.</span>
          </strong>
        </a>
        <nav className="top-nav" aria-label="Navegación principal">
          {nav.map(([slug, label]) => (
            <a
              key={slug}
              href={`#/${slug}`}
              onClick={() => {
                setSelectedAccount(undefined);
                setAccountsOpen(false);
              }}
              className={page === slug ? "active" : ""}
              aria-current={page === slug ? "page" : undefined}
            >
              {slug === "cuentas" ? "Cuentas" : label}
              {slug === "revisar" &&
                state.observations.some((o) => o.status === "review") && (
                  <span className="nav-count">
                    {
                      state.observations.filter((o) => o.status === "review")
                        .length
                    }
                  </span>
                )}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <time className="header-date">
            <Icon name="calendar" size={17} />
            {new Intl.DateTimeFormat("es-CO", {
              day: "numeric",
              month: "long",
              timeZone: "America/Bogota",
            }).format(new Date())}
          </time>
          <button
            className={`icon-button refresh-button ${loading ? "is-refreshing" : ""}`}
            onClick={async () => {
              setNotice("");
              if (await refresh()) setNotice("Datos actualizados.");
            }}
            aria-label="Actualizar datos"
            aria-busy={loading}
            title={loading ? "Actualizando datos…" : "Actualizar datos"}
            disabled={loading}
          >
            <Icon name="refresh" size={19} />
          </button>
          <button
            className="button primary new-movement"
            onClick={() => { setMovementPreset(undefined); setEditing("new"); }}
            disabled={!state.accounts.length}
          >
            <Icon name="plus" size={19} />
            <span>Nuevo movimiento</span>
          </button>
          {!local && (
            <button className="text-button" onClick={() => void logout()}>
              Salir
            </button>
          )}
          <span className="avatar">M</span>
        </div>
        <button
          className="mobile-account-toggle"
          aria-expanded={accountsOpen}
          aria-controls="accounts-panel"
          onClick={() => setAccountsOpen((v) => !v)}
        >
          <Icon name="wallet" size={17} />
          <span>
            {(page === "movimientos" ? movementAccount : selectedAccount)
              ? state.accounts.find(
                  (a) =>
                    a.id ===
                    (page === "movimientos"
                      ? movementAccount
                      : selectedAccount),
                )?.name
              : "Mis cuentas y tarjetas"}
          </span>
          <Icon name="chevron" size={15} />
        </button>
      </header>
      <div className="app-workspace">
        <div id="accounts-panel" className="accounts-panel">
          <AccountRail
            state={state}
            balances={summary?.balances}
            selected={
              page === "movimientos" ? movementAccount : selectedAccount
            }
            onSelect={selectAccount}
            allowAll={page !== "movimientos"}
          />
        </div>
        <main
          className={`route-content ${page === "resumen" ? "route-dashboard" : page === "revisar" ? "route-review" : ""}`}
        >
          {page !== "resumen" && page !== "movimientos" && (
            <div className="page-heading">
              <div>
                <h1>
                  {page === "revisar"
                    ? "Revisar pistas"
                    : page === "reportes"
                      ? "Entiende adónde se fue tu dinero."
                    : page === "design-system"
                      ? "Design system"
                      : title}
                </h1>
                {page !== "revisar" && <p>
                  {page === "movimientos"
                    ? "Cada movimiento, con su historia y sin duplicados."

                      : page === "reportes"
                        ? "Explora tus gastos por período, categoría y comercio."
                      : page === "design-system"
                        ? "Las reglas y componentes que mantienen Money Stalker consistente."
                        : "Cuentas bancarias, tarjetas y tu margen de tranquilidad."}
                </p>}
              </div>
              <EvidenceTrail variant={page === "revisar" ? "evidence" : page === "reportes" ? "funds" : "holdings"} />
            </div>
          )}
          {error && (
            <div role="alert" className="notice danger">
              {error}
              <button className="text-button" onClick={() => setError("")}>
                Cerrar
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="action-notice">
              {notice}
              <button className="text-button" onClick={() => setNotice("")}>
                Cerrar
              </button>
            </div>
          )}
          {page === "resumen" &&
            (summary ? (
              <Dashboard
                state={state}
                summary={summary}
                selectedAccount={selectedAccount}
                open={setEditing}
                refreshedAt={refreshedAt}
                stale={stale}
                refreshing={loading}
              />
            ) : (
              <SurfaceLoading failed={stale} />
            ))}
          {page === "movimientos" && (
            <Movements
              state={state}
              balances={summary?.balances}
              selectedAccount={movementAccount}
              open={setEditing}
              openImport={() => setImporting(true)}
              onError={setError}
            />
          )}
          {page === "revisar" &&
            (summary ? (
              <ReviewDesk
                state={state}
                act={act}
                edit={setEditing}
                stale={stale}
              />
            ) : (
              <SurfaceLoading failed={stale} />
            ))}
          {page === "reportes" && (
            <Reports state={state} accountId={selectedAccount} onAccountChange={setSelectedAccount} />
          )}
          {page === "cuentas" && (
            <Settings state={state} summary={summary} refresh={refresh} receiveCash={(accountId) => { setMovementPreset({ accountId, kind: "income" }); setEditing("new"); }} />
          )}
          {page === "design-system" && <DesignSystem />}
          <footer className="footer">
            <span>Money Stalker · COP · Colombia</span>
          </footer>
        </main>
      </div>
      {editing && (
        <TransactionDialog
          value={editing}
          state={state}
          preferredAccountId={
            movementPreset?.accountId ?? (page === "movimientos" ? movementAccount : selectedAccount)
          }
          preferredKind={movementPreset?.kind}
          close={() => { setEditing(undefined); setMovementPreset(undefined); }}
          saved={async (message) => {
            const refreshed = await refresh();
            setEditing(undefined);
            setNotice(
              refreshed
                ? (message ?? "Movimiento guardado. Ya está en tu rastro.")
                : "El movimiento quedó guardado, pero no pudimos actualizar la vista. Usa Actualizar datos para verlo.",
            );
          }}
        />
      )}
      {importing && movementAccount && (
        <ImportDialog
          state={state}
          accountId={movementAccount}
          refresh={refresh}
          close={() => setImporting(false)}
        />
      )}
    </div>
  );
}

function TransactionTable({
  transactions,
  state,
  selectedAccount,
  emptyMessage,
  emptyDescription,
  emptyActions,
  open,
}: {
  transactions: Transaction[];
  state: State;
  selectedAccount: string;
  emptyMessage: string;
  emptyDescription: string;
  emptyActions?: ReactNode;
  open: (t: Transaction) => void;
}) {
  return (
    <div className="table-scroll movement-table">
      <table aria-label="Movimientos del producto seleccionado">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Movimiento</th>
            <th>Categoría</th>
            <th>Estado</th>
            <th className="number">Valor</th>
          </tr>
        </thead>
        <tbody>
          {transactions.length ? (
            transactions.map((t) => {
              const incoming = isIncoming(t, selectedAccount);
              const selectedProduct = state.accounts.find(
                (account) => account.id === selectedAccount,
              );
              const historical = Boolean(
                selectedProduct && t.date < selectedProduct.openingDate,
              );
              const otherAccount =
                t.kind === "transfer"
                  ? state.accounts.find(
                      (a) =>
                        a.id ===
                        (t.accountId === selectedAccount
                          ? t.counterAccountId
                          : t.accountId),
                    )
                  : undefined;
              return (
                <tr key={t.id}>
                  <td className="register-date">
                    <time dateTime={t.date}>{displayDate(t.date)}</time>
                  </td>
                  <td className="register-movement">
                    <button
                      className="transaction-name"
                      onClick={() => open(t)}
                    >
                      {t.merchant ||
                        {
                          expense: "Gasto",
                          income: "Ingreso",
                          transfer: "Transferencia",
                          refund: "Devolución",
                        }[t.kind]}
                    </button>
                    <span className="register-details">
                      {t.note && <small>{t.note}</small>}
                      {(t.place ||
                        state.observations.some(
                          (observation) =>
                            observation.transactionId === t.id &&
                            observation.location,
                        )) && (
                        <span className="transaction-location-label">
                          <Icon name="location" size={13} />
                          {t.place?.name ?? "Ubicación guardada"}
                        </span>
                      )}
                      <FlowIndicator
                        record={t}
                        selectedAccount={selectedAccount}
                        state={state}
                      />
                      <span className="register-mobile-meta">
                        <time dateTime={t.date}>{displayDate(t.date)}</time>
                        <span aria-hidden="true">·</span>
                        <span>
                          {t.kind === "transfer"
                            ? (otherAccount?.name ?? "Transferencia")
                            : categoryLabel(state, t.categoryId)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {historical
                            ? "Histórico"
                            : t.status === "posted"
                              ? "Registrado"
                              : "Por confirmar"}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="register-category">
                    {t.kind === "transfer" ? (
                      (otherAccount?.name ?? "Transferencia")
                    ) : (
                      <span className="register-category-label">
                        <CategoryIcon categoryId={t.categoryId} size={14} />
                        {categoryLabel(state, t.categoryId)}
                      </span>
                    )}
                  </td>
                  <td
                    className="register-status"
                    title={
                      historical
                        ? "Anterior al saldo inicial; no cambia el saldo actual"
                        : undefined
                    }
                  >
                    <Badge
                      tone={
                        historical
                          ? ""
                          : t.status === "posted"
                            ? "green"
                            : "amber"
                      }
                    >
                      {historical
                        ? "Histórico"
                        : t.status === "posted"
                          ? "Registrado"
                          : "Por confirmar"}
                    </Badge>
                  </td>
                  <td
                    className={`number amount register-value ${incoming ? "positive" : "negative"}`}
                  >
                    {incoming ? "+" : "−"}
                    {formatCOP(t.amountMinor)}
                  </td>
                </tr>
              );
            })
          ) : (
            <tr className="register-empty-row">
              <td colSpan={5}>
                <div>
                  <Eyes className="register-empty-eyes" />
                  <strong>{emptyMessage}</strong>
                  <span>{emptyDescription}</span>
                  {emptyActions}
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
function Movements({
  state,
  balances,
  selectedAccount,
  open,
  openImport,
  onError,
}: {
  state: State;
  balances?: Record<string, string>;
  selectedAccount?: string;
  open: (t: Transaction | "new") => void;
  openImport: () => void;
  onError: (e: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [subcategoryFilter, setSubcategoryFilter] = useState("");
  const filtersRef = useRef<HTMLDetailsElement>(null);
  const closeFilters = () => {
    if (filtersRef.current) {
      filtersRef.current.open = false;
      filtersRef.current.querySelector("summary")?.focus();
    }
  };
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (
        filtersRef.current?.open &&
        !filtersRef.current.contains(event.target as Node)
      )
        filtersRef.current.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  const [directionFilter, setDirectionFilter] = useState("");
  const account = state.accounts.find((a) => a.id === selectedAccount);
  const accountTransactions = useMemo(
    () =>
      state.transactions
        .filter(
          (t) =>
            !t.voided &&
            (t.accountId === selectedAccount ||
              t.counterAccountId === selectedAccount),
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
    [selectedAccount, state.transactions],
  );
  const transactions = useMemo(
    () =>
      accountTransactions.filter((t) => {
        const matchesSearch = `${t.merchant ?? ""} ${t.note ?? ""} ${t.date}`
          .toLowerCase()
          .includes(search.toLowerCase());
        const matchesCategory = categoryMatches(
          state,
          t.categoryId,
          subcategoryFilter || categoryFilter,
        );
        const matchesDirection =
          !directionFilter ||
          (directionFilter === "incoming"
            ? isIncoming(t, selectedAccount!)
            : !isIncoming(t, selectedAccount!));
        return matchesSearch && matchesCategory && matchesDirection;
      }),
    [
      accountTransactions,
      categoryFilter,
      subcategoryFilter,
      directionFilter,
      search,
      selectedAccount,
      state.categories,
    ],
  );
  if (!account)
    return (
      <section className="panel movement-register no-products">
        <Empty title="Agrega tu primer producto">
          Crea una cuenta bancaria, tarjeta de crédito o efectivo para abrir su
          registro de movimientos.
        </Empty>
        <a className="button primary" href="#/cuentas">
          Agregar producto <Icon name="arrow" size={16} />
        </a>
      </section>
    );
  return (
    <section className="panel movement-register">
      <p className="sr-only" aria-live="polite">
        Mostrando movimientos de {account.name}
      </p>
      <header className="register-product-header">
        <div
          className={`register-product-icon account-artwork ${account.kind}`}
        >
          <AccountArtwork account={account} size={23} />
        </div>
        <div className="register-product-name">
          <span>
            {account.kind === "credit"
              ? "Tarjeta de crédito"
              : accountKindLabels[account.kind]}
          </span>
          <h1>{account.name}</h1>
          {account.institution && <small>{account.institution}</small>}
        </div>
        <div className="register-balance">
          <span>
            {account.kind === "credit" ? "Deuda actual" : "Saldo actual"}
          </span>
          <strong>
            {balances ? formatCOP(balances[account.id] ?? "0") : "—"}
          </strong>
          <small>
            {accountTransactions.length}{" "}
            {accountTransactions.length === 1 ? "movimiento" : "movimientos"}
          </small>
        </div>
      </header>
      <div className="register-toolbar">
        <Field label="Buscar en este producto">
          <input
            type="search"
            placeholder="Comercio, nota o fecha…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Field>
        <details
          className="register-more"
          ref={filtersRef}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeFilters();
          }}
        >
          <summary>
            <Icon name="search" size={16} /> Filtros y acciones
          </summary>
          <div className="register-more-panel">
            <div className="filter-panel-heading">
              <strong>Filtros y acciones</strong>
              <button
                type="button"
                className="button quiet"
                onClick={closeFilters}
                aria-label="Cerrar filtros"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <Field label="Categoría">
              <select
                aria-label="Categoría"
                value={categoryFilter}
                onChange={(event) => {
                  setCategoryFilter(event.target.value);
                  setSubcategoryFilter("");
                }}
              >
                <option value="">Todas</option>
                {state.categories
                  .filter((category) => !category.parentId)
                  .map((category) => (
                    <option value={category.id} key={category.id}>
                      {category.name}
                    </option>
                  ))}
              </select>
            </Field>
            {categoryFilter &&
              state.categories.some(
                (category) => category.parentId === categoryFilter,
              ) && (
                <Field label="Subcategoría (opcional)">
                  <select
                    aria-label="Subcategoría (opcional)"
                    value={subcategoryFilter}
                    onChange={(event) =>
                      setSubcategoryFilter(event.target.value)
                    }
                  >
                    <option value="">Todas las subcategorías</option>
                    {state.categories
                      .filter(
                        (category) => category.parentId === categoryFilter,
                      )
                      .map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
            <Field label="Dirección">
              <select
                value={directionFilter}
                onChange={(event) => setDirectionFilter(event.target.value)}
              >
                <option value="">Entradas y salidas</option>
                <option value="incoming">Entradas</option>
                <option value="outgoing">Salidas</option>
              </select>
            </Field>
            <div className="register-more-actions">
              <button className="button secondary" onClick={openImport}>
                <Icon name="upload" size={16} /> Importar archivo
              </button>
              <button
                className="button secondary"
                disabled={!accountTransactions.length}
                onClick={() =>
                  void download("csv", account.id).catch((e) =>
                    onError(e.message),
                  )
                }
              >
                <Icon name="download" size={16} /> Exportar CSV
              </button>
              <button
                className="button secondary"
                disabled={!accountTransactions.length}
                onClick={() =>
                  void download("xlsx", account.id).catch((e) =>
                    onError(e.message),
                  )
                }
              >
                <Icon name="download" size={16} /> Exportar Excel
              </button>
            </div>
          </div>
        </details>
      </div>
      <TransactionTable
        transactions={transactions}
        state={state}
        selectedAccount={account.id}
        emptyMessage={
          search || categoryFilter || directionFilter
            ? "No hay resultados para esta búsqueda"
            : "Este producto todavía no tiene movimientos"
        }
        emptyDescription={
          search || categoryFilter || directionFilter
            ? "Prueba con otro comercio, nota o fecha."
            : "Agrega el primero manualmente o importa un extracto de este producto."
        }
        emptyActions={
          search || categoryFilter || directionFilter ? undefined : (
            <div className="register-empty-actions">
              <button className="button primary" onClick={() => open("new")}>
                <Icon name="plus" size={16} />
                Agregar movimiento
              </button>
              <button className="button secondary" onClick={openImport}>
                <Icon name="upload" size={16} />
                Importar archivo
              </button>
            </div>
          )
        }
        open={open}
      />
    </section>
  );
}
function TransactionDialog({
  value,
  state,
  preferredAccountId,
  preferredKind,
  close,
  saved,
}: {
  value: Transaction | Observation | "new";
  state: State;
  preferredAccountId?: string;
  preferredKind?: "income";
  close: () => void;
  saved: (message?: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const isObservation = value !== "new" && "source" in value;
  const initial = value === "new" ? undefined : value;
  const transaction =
    value !== "new" && !isObservation ? (value as Transaction) : undefined;
  const initialCategory =
    state.categories.find((item) => item.id === transaction?.categoryId) ??
    state.categories.find((item) => item.id === "uncategorized")!;
  const initialInvestment = initial?.kind === "transfer" && state.accounts.some(account => account.id === initial.counterAccountId && account.kind === "investment");
  const [kind, setKind] = useState<Transaction["kind"] | "investment">(initialInvestment ? "investment" : initial?.kind ?? preferredKind ?? "expense");
  const [merchant, setMerchant] = useState(initial?.merchant ?? "");
  const [sourceAccountId, setSourceAccountId] = useState(initial?.accountId ?? preferredAccountId ?? "");
  const [investmentChoice, setInvestmentChoice] = useState<string | undefined>(initialInvestment ? initial?.counterAccountId : undefined);
  const [investmentName, setInvestmentName] = useState<string>();
  const newInvestmentId = useRef(freshId());
  const investmentProducts = state.accounts.filter(account => account.kind === "investment" && account.id !== sourceAccountId);
  const normalizedMerchant = merchant.normalize("NFKC").trim().toLocaleLowerCase("es-CO").replace(/\s+/g, " ");
  const rememberedInvestment = state.aliases.find(rule => rule.merchant === normalizedMerchant)?.investmentAccountId;
  const matchingInvestments = investmentProducts.filter(account => account.name.normalize("NFKC").trim().toLocaleLowerCase("es-CO").replace(/\s+/g, " ") === normalizedMerchant);
  const investmentDestination = investmentChoice ?? (investmentProducts.some(account => account.id === rememberedInvestment) ? rememberedInvestment : matchingInvestments.length === 1 ? matchingInvestments[0].id : "__new_investment__");
  const creatingInvestment = kind === "investment" && investmentDestination === "__new_investment__";
  const [categoryId, setCategoryId] = useState(initialCategory.parentId ?? initialCategory.id);
  const [subcategoryId, setSubcategoryId] = useState(initialCategory.parentId ? initialCategory.id : "");
  const [deleting, setDeleting] = useState(false);
  const [pendingDuplicate, setPendingDuplicate] = useState<{
    data: Record<string, unknown>;
    matches: Transaction[];
  }>();
  const [chosenPlace, setPlace] = useState<TransactionPlace | undefined>(transaction?.place);
  const [placeTouched, setPlaceTouched] = useState(false);
  const [rememberPlaceChoice, setRememberPlaceChoice] = useState(false);
  const [applyPlaceChoice, setApplyPlaceChoice] = useState(false);
  const rememberedPlace = state.aliases.find(rule => rule.merchant === normalizedMerchant)?.place;
  const place = chosenPlace ?? (placeTouched ? undefined : rememberedPlace);
  const locationEvidence =
    isObservation && (value as Observation).location
      ? [value as Observation]
      : transaction
        ? state.observations.filter(
            (observation) =>
              observation.transactionId === transaction.id &&
              Boolean(observation.location),
          )
        : [];
  const [locationOpen, setLocationOpen] = useState(
    Boolean(locationEvidence.length || place),
  );
  const operationId = useRef(freshId());
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="transaction-dialog-title"
      onCancel={close}
    >
      <div className="section-heading">
        <h2 id="transaction-dialog-title">
          {isObservation
            ? "Editar antes de guardar"
            : transaction
              ? "Editar movimiento"
              : "Nuevo movimiento"}
        </h2>
        <button className="icon-button" onClick={close} aria-label="Cerrar">
          <Icon name="close" />
        </button>
      </div>
      {isObservation && <p className="small-note">Ajusta los datos de la captura. El movimiento se guardará cuando pulses Registrar movimiento.</p>}
      {pendingDuplicate && (
        <section
          className="duplicate-confirmation"
          role="alertdialog"
          aria-label="Confirmar movimiento repetido"
        >
          <div>
            <strong>Este movimiento parece estar registrado</strong>
            <p>
              Encontramos {pendingDuplicate.matches.length} coincidencia
              {pendingDuplicate.matches.length === 1 ? "" : "s"} con la misma
              cuenta, fecha, valor y tipo.
            </p>
            {pendingDuplicate.matches.slice(0, 3).map((match) => (
              <small key={match.id}>
                {match.merchant || "Movimiento"} · {displayDate(match.date)} ·{" "}
                {formatCOP(match.amountMinor)}
              </small>
            ))}
          </div>
          <div className="button-row">
            <button
              type="button"
              className="button quiet"
              onClick={() => setPendingDuplicate(undefined)}
            >
              Volver a editar
            </button>
            <button
              type="button"
              className="button primary"
              onClick={async () => {
                await post("/transactions", {
                  ...pendingDuplicate.data,
                  duplicateConfirmed: true,
                });
                await saved(
                  "Movimiento repetido guardado por tu confirmación.",
                );
              }}
            >
              Guardar de todos modos
            </button>
          </div>
        </section>
      )}
      <AppForm
        submit={transaction ? "Guardar cambios" : "Registrar movimiento"}
        onSubmit={async (f) => {
          const data = {
            id: transaction?.id ?? operationId.current,
            kind: kind === "investment" ? "transfer" : kind,
            date: str(f, "date"),
            accountId: str(f, "accountId"),
            counterAccountId: kind === "investment" ? (creatingInvestment ? newInvestmentId.current : investmentDestination) :
              kind === "transfer" ? str(f, "counterAccountId") : null,
            ...(creatingInvestment ? { investmentProduct: { id: newInvestmentId.current, name: (investmentName ?? merchant).trim() } } : {}),
            rememberMerchant: f.get("rememberMerchant") === "on",
            rememberMerchantPlace: Boolean(place && merchant.trim() && rememberPlaceChoice),
            skipMerchantPlace: placeTouched && !place,
            amountMinor: amount(f, "amount"),
            merchant,
            categoryId: subcategoryId || categoryId || "uncategorized",
            note: str(f, "note"),
            billId: str(f, "billId") || null,
            place: place ?? null,
          };
          if (isObservation)
            await post("/reviews", {
              observationId: (value as Observation).id,
              action: "separate",
              details: Object.fromEntries(
                Object.entries(data).filter(([, v]) => v !== null),
              ),
            });
          else if (transaction) {
            const applyToSimilar = f.get("applyToSimilar") === "on";
            const applyPlaceToSimilar = Boolean(place && merchant.trim() && applyPlaceChoice);
            const result = await api<{ saved: true; updated: number }>(
              `/transactions/${transaction.id}`,
              {
                method: "PATCH",
                body: JSON.stringify({
                  changes: data,
                  applyToSimilar,
                  applyPlaceToSimilar,
                  rememberMerchantPlace: Boolean(place && merchant.trim() && rememberPlaceChoice),
                  rememberMerchant: f.get("rememberMerchant") === "on",
                  expectedRevision: transaction.revision,
                }),
              },
            );
            await saved(
              applyPlaceToSimilar
                ? `${applyToSimilar ? "Categoría, nota y ubicación guardadas" : "Ubicación guardada"} en ${result.updated} ${result.updated === 1 ? "movimiento" : "movimientos"} del mismo comercio.`
                : applyToSimilar
                ? `Categoría y nota guardadas en ${result.updated} ${result.updated === 1 ? "movimiento" : "movimientos"} del mismo comercio.`
                : undefined,
            );
            return;
          } else {
            const cleaned = Object.fromEntries(
              Object.entries(data).filter(([, v]) => v !== null),
            );
            const matches = duplicateTransactions(
              state,
              cleaned as Parameters<typeof duplicateTransactions>[1],
            );
            if (matches.length) {
              setPendingDuplicate({ data: cleaned, matches });
              return false;
            }
            await post("/transactions", cleaned);
          }
          await saved();
        }}
      >
        <div className="form-grid">
          <Field label="Tipo">
            <select
              name="kind"
              value={kind === "investment" ? "expense" : kind}
              onChange={(e) => {
                const next = e.target.value as typeof kind;
                setKind(next);
                const scope = next === "income" ? "income" : "expense";
                const selected = state.categories.find((item) => item.id === (subcategoryId || categoryId));
                if (next !== "transfer" && selected?.scope !== "both" && selected?.scope !== scope) {
                  setCategoryId("uncategorized");
                  setSubcategoryId("");
                }
              }}
            >
              <option value="expense">Gasto</option>
              <option value="income">Ingreso</option>
              <option value="transfer">Transferencia / pago de tarjeta</option>
              <option value="refund">Devolución</option>
            </select>
          </Field>
          <Field label="Fecha">
            <input
              name="date"
              type="date"
              required
              defaultValue={initial?.date ?? bogotaDate()}
              max={bogotaDate()}
            />
          </Field>
          <Field label="Cuenta de origen">
            <select
              name="accountId"
              required
              value={sourceAccountId}
              onChange={(event) => setSourceAccountId(event.target.value)}
            >
              <option value="">Selecciona una cuenta</option>
              {state.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Valor (COP)">
            <input
              name="amount"
              inputMode="decimal"
              placeholder="50.000"
              required
              defaultValue={
                initial?.amountMinor ? decimalCOP(initial.amountMinor) : ""
              }
            />
          </Field>
          {kind === "transfer" && (
            <Field label="Cuenta destino">
              <select
                name="counterAccountId"
                required
                defaultValue={initial?.counterAccountId}
              >
                <option value="">Selecciona destino</option>
                {state.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Comercio o descripción">
            <input
              name="merchant"
              maxLength={200}
              value={merchant}
              onChange={(event) => setMerchant(event.target.value)}
            />
          </Field>
          {kind !== "transfer" && (
            <>
              <Field label={kind === "income" ? "Categoría de ingreso" : "Categoría de gasto"}>
                <select name="categoryId" value={kind === "investment" ? "__investment__" : categoryId} onChange={(event) => {
                  if (event.target.value === "__investment__") { setKind("investment"); setCategoryId(state.categories.find(category => !category.parentId && /^(inversión|inversion|inversiones)$/i.test(category.name.trim()) && category.scope !== "income")?.id ?? "uncategorized"); }
                  else { if (kind === "investment") setKind("expense"); setCategoryId(event.target.value); }
                  setSubcategoryId("");
                }}>
                  {(kind === "expense" || kind === "investment") && <option value="__investment__">Inversión</option>}
                  {state.categories
                    .filter((category) => !category.parentId && (kind === "income" || !/^(inversión|inversion|inversiones)$/i.test(category.name.trim())) && (category.scope === "both" || category.scope === (kind === "income" ? "income" : "expense")))
                    .map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </Field>
              {kind !== "investment" && state.categories.some((category) => category.parentId === categoryId) && (
                <Field label="Subcategoría">
                  <select value={subcategoryId} onChange={(event) => setSubcategoryId(event.target.value)}>
                    <option value="">Sin subcategoría</option>
                    {state.categories.filter((category) => category.parentId === categoryId).map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          )}
          {kind === "investment" && <>
            <Field label="Producto de inversión"><select value={investmentDestination} onChange={(event) => setInvestmentChoice(event.target.value)} required>
              {investmentProducts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
              <option value="__new_investment__">Crear nuevo producto de inversión…</option>
            </select></Field>
            {creatingInvestment && <Field label="Nombre del nuevo producto de inversión"><input value={investmentName ?? merchant} onChange={(event) => setInvestmentName(event.target.value)} required maxLength={200} placeholder="Usa el nombre del comercio o escribe otro" /><small>Se creará al guardar este movimiento, con saldo inicial cero. El aporte se transferirá desde la cuenta de origen que elijas.</small></Field>}
          </>}
          {kind === "expense" && (
            <Field label="Factura asociada">
              <select name="billId" defaultValue={transaction?.billId ?? ""}>
                <option value="">Ninguna</option>
                {state.bills
                  .filter(
                    (b) =>
                      !b.paidTransactionId ||
                      b.paidTransactionId === transaction?.id,
                  )
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} · {formatCOP(b.amountMinor)}
                    </option>
                  ))}
              </select>
            </Field>
          )}
        </div>
        <details
          className="transaction-location-picker"
          open={locationOpen}
          onToggle={(event) => setLocationOpen(event.currentTarget.open)}
        >
          <summary>
            <span>
              <strong>Ubicación y negocio</strong>
              {(!place || !locationOpen) && <small>
                {place
                  ? place.name
                  : locationEvidence.length
                    ? "Ubicación capturada por el atajo"
                    : "Opcional"}
              </small>}
            </span>
            <Icon name="location" size={18} />
          </summary>
          {locationOpen && <>
            <TransactionMap
              merchant={merchant}
              captured={locationEvidence.map(
                (observation) => observation.location!,
              )}
              place={place}
              onPlaceChange={(next) => {
                setPlaceTouched(true);
                setPlace(next);
              }}
            >
            {rememberedPlace && !placeTouched && !chosenPlace && <p className="small-note remembered-place-note">Ubicación recordada para este comercio. Puedes cambiarla solo para este movimiento.</p>}
            {place && merchant.trim() && <div className="merchant-place-options">
              <label className="checkbox"><input type="checkbox" name="rememberMerchantPlace" checked={rememberPlaceChoice} onChange={event => setRememberPlaceChoice(event.target.checked)} /> Recordar esta ubicación para próximos movimientos de este comercio</label>
              {transaction && <label className="checkbox"><input type="checkbox" name="applyPlaceToSimilar" checked={applyPlaceChoice} onChange={event => setApplyPlaceChoice(event.target.checked)} /> Aplicar esta ubicación a todos los movimientos de este comercio</label>}
              <p className="small-note">Úsala para todo el comercio solo si el nombre identifica la misma sede. La ubicación original de cada atajo se conserva.</p>
            </div>}
            </TransactionMap>
          </>}
        </details>
        <Field label="Nota">
          <textarea
            name="note"
            maxLength={1000}
            defaultValue={transaction?.note}
          />
        </Field>
        {merchant.trim() && <label className="checkbox"><input type="checkbox" name="rememberMerchant" /> {kind === "investment" ? "Recordar este comercio, su categoría y producto de inversión para próximas importaciones" : "Recordar la categoría y nota de este comercio para próximas importaciones"}</label>}
        {transaction && merchant.trim() && (
          <label className="checkbox">
            <input type="checkbox" name="applyToSimilar" /> Aplicar esta
            categoría y nota a todos los movimientos de este comercio
          </label>
        )}
        {kind === "investment" && <p className="small-note">Este aporte es una transferencia: reduce el origen y el disponible, aumenta la inversión y no cuenta como gasto. La regla recordada se mostrará en la vista previa de los próximos CSV/XLSX.</p>}
        {kind === "transfer" && (
          <p className="small-note">
            El pago de una tarjeta mueve dinero: no crea un gasto nuevo.
          </p>
        )}
      </AppForm>
      {transaction && (
        <section className="transaction-delete">
          {!deleting ? (
            <button type="button" className="text-button danger-text" onClick={() => setDeleting(true)}>Eliminar movimiento</button>
          ) : (
            <div role="alertdialog" aria-label="Confirmar eliminación del movimiento">
              <div><strong>¿Eliminar este movimiento?</strong><p>Dejará de afectar saldos y reportes. La acción quedará en el historial.</p></div>
              <div className="button-row">
                <button type="button" className="button quiet" onClick={() => setDeleting(false)}>Cancelar</button>
                <button type="button" className="button danger" onClick={async () => {
                  await api(`/transactions/${transaction.id}`, { method: "DELETE", body: JSON.stringify({ expectedRevision: transaction.revision }) });
                  await saved("Movimiento eliminado.");
                }}>Sí, eliminar</button>
              </div>
            </div>
          )}
        </section>
      )}
    </dialog>
  );
}

function ImportDialog({
  state,
  accountId,
  refresh,
  close,
}: {
  state: State;
  accountId: string;
  refresh: () => Promise<boolean>;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [batch, setBatch] = useState<Batch>(),
    [list, setList] = useState<Batch[]>([]),
    [profiles, setProfiles] = useState<ImportProfile[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [fileName, setFileName] = useState(""),
    [includedDuplicates, setIncludedDuplicates] = useState<Set<number>>(
      new Set(),
    );
  const account = state.accounts.find((a) => a.id === accountId);
  const load = useCallback(
    async () => setList(await api<Batch[]>("/imports")),
    [],
  );
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    void api<ImportProfile[]>("/import-profiles")
      .then(setProfiles)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    setIncludedDuplicates(new Set());
  }, [batch?.id]);
  useEffect(() => {
    if (batch?.status === "committing") {
      const timer = setInterval(() => {
        void api<Batch>(`/imports/${batch.id}`)
          .then((b) => {
            setBatch(b);
            if (b.status === "done") {
              void refresh();
              void load();
            }
          })
          .catch((e) => setError(e.message));
      }, 1500);
      return () => clearInterval(timer);
    }
  }, [batch?.id, batch?.status, load, refresh]);
  async function upload(f: FormData) {
    const file = f.get("file") as File;
    if (!file?.size || file.size > 5 * 1024 * 1024)
      throw new Error("Selecciona un CSV/XLSX de hasta 5 MB");
    const created = await post<{
      batch: Batch;
      upload: { url: string; fields: Record<string, string>; local?: boolean };
    }>("/imports", {
      filename: file.name,
      size: file.size,
      accountId: str(f, "accountId"),
      profile: str(f, "profile") || "auto",
    });
    let response: Response;
    if (created.upload.local)
      response = await fetch(
        `${created.upload.url}?key=${encodeURIComponent(created.upload.fields.key)}`,
        { method: "PUT", body: file },
      );
    else {
      const payload = new FormData();
      Object.entries(created.upload.fields).forEach(([k, v]) =>
        payload.append(k, v),
      );
      payload.append("file", file);
      response = await fetch(created.upload.url, {
        method: "POST",
        body: payload,
      });
    }
    if (!response.ok)
      throw new Error("No se pudo subir el archivo. Intenta otra vez.");
    const preview = await post<Batch>(
      `/imports/${created.batch.id}/preview`,
      {},
    );
    setBatch({
      ...(await api<Batch>(`/imports/${preview.id}`)),
      duplicate: preview.duplicate,
    });
    setIncludedDuplicates(new Set());
    await load();
  }
  const accountImports = list.filter(
    (item) => !item.accountId || item.accountId === accountId,
  );
  return (
    <dialog
      ref={dialog}
      className="modal import-dialog"
      aria-labelledby="import-dialog-title"
      onCancel={close}
      onClose={close}
    >
      <div className="section-heading import-dialog-heading">
        <div>
          <h2 id="import-dialog-title">Importar movimientos</h2>
          <p>
            El archivo se agregará a <strong>{account?.name}</strong> después de
            que revises la vista previa.
          </p>
        </div>
        <button className="icon-button" onClick={close} aria-label="Cerrar">
          <Icon name="close" />
        </button>
      </div>
      <AppForm submit="Subir y previsualizar" onSubmit={upload}>
        <input type="hidden" name="accountId" value={accountId} />
        <Field label="Archivo CSV o Excel">
          <span className="file-picker">
            <input
              name="file"
              type="file"
              required
              accept=".csv,.xlsx"
              onChange={(event) =>
                setFileName(event.currentTarget.files?.[0]?.name ?? "")
              }
            />
            <span className="file-picker-action">
              <Icon name="upload" size={16} /> Elegir archivo
            </span>
            <small aria-live="polite">
              {fileName || "Ningún archivo seleccionado"}
            </small>
          </span>
        </Field>
        <Field label="Formato">
          <select name="profile" defaultValue="auto">
            <option value="auto">Detectar automáticamente</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
        </Field>
        <p className="small-note">
          Hasta 5 MB y 5.000 filas. Nada se agrega sin tu confirmación. Los
          movimientos anteriores al saldo inicial quedarán en el historial sin
          cambiar el saldo actual.
        </p>
      </AppForm>
      <details className="import-help">
        <summary>Formatos compatibles</summary>
        <div>
          <p>
            <strong>Bancolombia:</strong> extracto trimestral XLSX de cuenta de
            ahorros o extracto Visa detallado XLSX. En Visa, las compras
            positivas aumentan la deuda y los abonos negativos la reducen.
          </p>
          <p>
            <strong>Intercambio:</strong> encabezados{" "}
            <code>Fecha;Descripcion;Valor;Moneda;Tipo</code>
          </p>
          <p>
            Fecha ISO, valores como <code>25.000,00</code>, moneda{" "}
            <code>COP</code>. En cuentas, positivo es entrada y negativo es
            salida. En tarjetas de crédito, positivo es compra y negativo es
            devolución. Puedes indicar gasto, ingreso, transferencia o
            devolución en <code>Tipo</code> para reemplazar esa inferencia.
          </p>
          <p className="small-note">
            Los pagos de tarjeta y las transferencias a Nequi se conservan como
            transferencias cuando podemos identificar una cuenta propia como
            destino. Sin esa cuenta, se registran como gastos. No se evalúan
            fórmulas.
          </p>
        </div>
      </details>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {batch && (
        <section className="import-preview">
          <div className="section-heading">
            <div>
              <h2>Vista previa · {batch.filename}</h2>
              <p>
                {batch.accepted ?? 0} listas · {batch.duplicates ?? 0} posibles
                duplicados · {batch.rejected ?? 0} rechazadas ·{" "}
                {batch.skipped ?? 0} filas de encabezado/vacías
              </p>
              {batch.profile && (
                <p className="small-note">
                  {profiles.find((profile) => profile.id === batch.profile)
                    ?.label ?? batch.profile}
                </p>
              )}
            </div>
            <Badge tone={batch.status === "done" ? "green" : "amber"}>
              {batch.status === "done"
                ? "Completado"
                : batch.status === "committing"
                  ? `Procesando ${batch.next}/${batch.accepted}`
                  : "Sin confirmar"}
            </Badge>
          </div>
          {batch.duplicate && (
            <div className="notice">
              Este archivo ya estaba registrado. No se agregó de nuevo.
            </div>
          )}
          {(batch.duplicates ?? 0) > 0 && batch.status === "preview" && (
            <div className="notice import-duplicate-note">
              <strong>Revisa las coincidencias antes de terminar.</strong>
              <span>
                Solo comparamos con movimientos guardados antes de subir este
                archivo. Filas iguales dentro del mismo CSV o Excel se
                conservarán por separado.
              </span>
            </div>
          )}
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>Comercio</th>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th className="number">Valor</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {batch.rows?.map((row) => {
                  const historical = Boolean(
                    account &&
                      row.observation?.date &&
                      row.observation.date < account.openingDate,
                  );
                  const incoming = Boolean(
                    row.observation && isIncoming(row.observation, accountId),
                  );
                  return (
                    <tr key={row.row}>
                      <td>{row.row}</td>
                      <td>{row.observation?.merchant ?? "—"}
                        {row.observation?.counterAccountId && state.accounts.find(account => account.id === row.observation?.counterAccountId)?.kind === "investment" && <small className="import-rule-detail">Inversión: {state.accounts.find(account => account.id === row.observation?.counterAccountId)?.name}</small>}
                        {row.observation?.categoryId && row.observation.categoryId !== "uncategorized" && <small className="import-rule-detail">{categoryLabel(state, row.observation.categoryId)}</small>}
                      </td>
                      <td>{row.observation?.date ?? "—"}</td>
                      <td>
                        {row.observation ? (
                          <FlowIndicator
                            record={row.observation}
                            selectedAccount={accountId}
                            state={state}
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className={`number amount ${row.observation ? (incoming ? "positive" : "negative") : ""}`}
                      >
                        {row.observation?.amountMinor
                          ? `${incoming ? "+" : "−"}${formatCOP(row.observation.amountMinor)}`
                          : "—"}
                      </td>
                      <td>
                        {row.status === "duplicate" ? (
                          <label className="import-duplicate-choice">
                            <input
                              type="checkbox"
                              checked={includedDuplicates.has(row.row)}
                              onChange={(event) =>
                                setIncludedDuplicates((current) => {
                                  const next = new Set(current);
                                  if (event.target.checked) next.add(row.row);
                                  else next.delete(row.row);
                                  return next;
                                })
                              }
                            />
                            <span>
                              <strong>Posible duplicado</strong>
                              <small>
                                {row.duplicateCandidates?.length ?? 0}{" "}
                                coincidencia
                                {row.duplicateCandidates?.length === 1
                                  ? ""
                                  : "s"}{" "}
                                previa
                                {row.duplicateCandidates?.length === 1
                                  ? ""
                                  : "s"}
                                . Márcalo para importarlo también.
                              </small>
                            </span>
                          </label>
                        ) : (
                          (row.error ??
                          (historical
                            ? "Histórico · no cambia el saldo"
                            : "Lista para importar"))
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="button-row">
            {(batch.offset ?? 0) > 0 && (
              <button
                className="button secondary"
                onClick={() =>
                  void api<Batch>(
                    `/imports/${batch.id}?offset=${Math.max(0, (batch.offset ?? 0) - 100)}`,
                  ).then(setBatch)
                }
              >
                Anteriores
              </button>
            )}
            {batch.more && (
              <button
                className="button secondary"
                onClick={() =>
                  void api<Batch>(
                    `/imports/${batch.id}?offset=${(batch.offset ?? 0) + 100}`,
                  ).then(setBatch)
                }
              >
                Siguientes filas
              </button>
            )}
            {batch.status === "preview" && (
              <button
                className="button primary"
                disabled={
                  busy ||
                  Number(batch.accepted ?? 0) + includedDuplicates.size === 0
                }
                onClick={async () => {
                  setBusy(true);
                  try {
                    setBatch(
                      await post<Batch>(`/imports/${batch.id}/commit`, {
                        includeDuplicateRows: [...includedDuplicates],
                      }),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Confirmar{" "}
                {Number(batch.accepted ?? 0) + includedDuplicates.size}{" "}
                movimientos
              </button>
            )}
          </div>
        </section>
      )}
      <details className="import-help import-previous">
        <summary>Archivos anteriores de {account?.name}</summary>
        {accountImports.map((b) => (
          <button
            className="import-history"
            key={b.id}
            onClick={() =>
              void api<Batch>(`/imports/${b.id}`)
                .then(setBatch)
                .catch((e) => setError(e.message))
            }
          >
            <span>{b.filename}</span>
            <Badge>
              {b.status === "done"
                ? "Completado"
                : b.status === "preview"
                  ? "Por confirmar"
                  : b.status === "committing"
                    ? "Procesando"
                    : "Pendiente"}
            </Badge>
          </button>
        ))}
        {!accountImports.length && (
          <p className="muted">Todavía no has subido archivos.</p>
        )}
      </details>
    </dialog>
  );
}

function InvestmentValues({ account, state, balance, save }: { account: State["accounts"][number]; state: State; balance: string; save: (path: string, data: unknown) => Promise<void> }) {
  const operationId = useRef(freshId());
  const [undoError, setUndoError] = useState("");
  const [undoing, setUndoing] = useState(false);
  const history = (state.valuations ?? []).filter(value => value.accountId === account.id).sort((a, b) => b.sequence - a.sequence);
  const latest = history.find(value => !value.voided);
  return <div className="investment-values">
    <p className="small-note">Valor declarado manualmente. No consultamos cotizaciones ni calculamos rentabilidad automática. Los aportes y retiros se registran como transferencias; los cambios de valor no son ingresos ni gastos.</p>
    <DisclosureEditor label="Actualizar valor de inversión">
      <AppForm submit="Guardar valor actual" onSubmit={async (form) => {
        await save("/investment-values", { id: operationId.current, accountId: account.id, date: str(form, "date"), valueMinor: amount(form, "value"), note: str(form, "note") });
        operationId.current = freshId();
      }}>
        <Field label="Valor actual de la inversión (COP)"><input name="value" required inputMode="decimal" defaultValue={decimalCOP(balance)} /></Field>
        <Field label="Fecha de valoración"><input name="date" type="date" required defaultValue={bogotaDate()} min={latest?.date ?? account.openingDate} max={bogotaDate()} /></Field>
        <Field label="Nota de valoración (opcional)"><input name="note" maxLength={1000} placeholder="Saldo consultado en el extracto…" /></Field>
      </AppForm>
    </DisclosureEditor>
    {undoError && <p role="alert" className="error">{undoError}</p>}
    <details className="investment-history"><summary>Historial de valores declarados · {history.length}</summary>
      {history.length ? <ul>{history.map(value => <li key={value.id}><div><strong>{displayDate(value.date)} · {formatCOP(value.valueMinor)}</strong><p>Valor anterior: {formatCOP(value.beforeMinor)} · Ajuste declarado: {formatCOP(value.adjustmentMinor)}</p>{value.note && <p>{value.note}</p>}<small>{value.voided ? "Valoración anulada" : "Declarada por ti"}</small></div>{latest?.id === value.id && <button className="text-button" disabled={undoing} onClick={async () => { setUndoing(true); setUndoError(""); try { await save("/undo", { auditId: `valuation:${value.id}` }); } catch (error) { setUndoError((error as Error).message); } finally { setUndoing(false); } }}>{undoing ? "Deshaciendo…" : "Deshacer valoración"}</button>}</li>)}</ul> : <p className="small-note">La primera valoración quedará aquí. Cada cambio conserva su fecha y nota.</p>}
    </details>
  </div>;
}

function AccountEditor({
  account,
  state,
  save,
  saveInstrument,
}: {
  account: State["accounts"][number];
  state: State;
  save: (data: unknown) => Promise<void>;
  saveInstrument: (data: unknown) => Promise<void>;
}) {
  const [saved, setSaved] = useState(false),
    [kind, setKind] = useState(account.kind);
  const newDebitId = useRef(freshId());
  const hasMovements = state.transactions.some(
    (t) => t.accountId === account.id || t.counterAccountId === account.id,
  ) || (state.valuations ?? []).some(value => value.accountId === account.id);
  return (
    <DisclosureEditor label="Editar producto" className="account-organization">
      <AppForm
        submit="Guardar cambios"
        onSubmit={async (f) => {
          const artwork = f.get("artwork") as File;
          const uploadedArtwork = await prepareAccountArtwork(artwork);
          const imageDataUrl =
            uploadedArtwork ??
            (f.get("removeArtwork") === "on"
              ? undefined
              : account.imageDataUrl);
          await save({
            id: account.id,
            name: str(f, "name"),
            kind,
            captureAliases: str(f, "captureAliases").split(",").map(value => value.trim()).filter(Boolean),
            openingMinor: hasMovements
              ? account.openingMinor
              : amount(f, "opening"),
            openingDate: hasMovements ? account.openingDate : str(f, "date"),
            eligible:
              kind === "credit" ? account.eligible : f.get("eligible") === "on",
            ...(str(f, "institution").trim()
              ? { institution: str(f, "institution").trim() }
              : {}),
            ...(str(f, "institutionUrl").trim()
              ? { institutionUrl: str(f, "institutionUrl").trim() }
              : {}),
            ...(imageDataUrl ? { imageDataUrl } : {}),
            ...(kind === "credit"
              ? {
                  closingDay: Number(f.get("closing")),
                  dueDay: Number(f.get("due")),
                  ...(str(f, "parent")
                    ? { parentAccountId: str(f, "parent") }
                    : {}),
                }
              : {}),
          });
          setSaved(true);
        }}
      >
        <Field label="Nombre de la cuenta">
          <input
            name="name"
            required
            defaultValue={account.name}
            maxLength={200}
          />
        </Field>
        <Field label="Banco o entidad">
          <input
            name="institution"
            defaultValue={account.institution ?? ""}
            maxLength={200}
          />
        </Field>
        {kind === "bank" && (
          <Field label="Sitio web del banco (opcional)">
            <input
              name="institutionUrl"
              type="url"
              inputMode="url"
              placeholder="https://www.bancolombia.com"
              defaultValue={account.institutionUrl ?? ""}
              maxLength={500}
            />
            <small>
              Usaremos su favicon directamente; si no carga, verás el icono de
              banco.
            </small>
          </Field>
        )}
        <Field label="Imagen del producto (opcional)">
          <input
            name="artwork"
            type="file"
            accept="image/jpeg,image/png,image/webp"
          />
          <small>
            JPG, PNG o WebP. La reducimos antes de guardarla de forma privada.
          </small>
        </Field>
        {account.imageDataUrl && (
          <label className="checkbox">
            <input name="removeArtwork" type="checkbox" /> Usar de nuevo el
            icono predeterminado
          </label>
        )}
        <Field label="Tipo de cuenta">
          <select
            value={kind}
            disabled={hasMovements}
            onChange={(e) => setKind(e.target.value as typeof account.kind)}
          >
            <option value="bank">Cuenta bancaria</option>
            <option value="credit">Tarjeta de crédito</option>
            <option value="cash">Efectivo</option>
            <option value="pocket">Bolsillo</option>
            <option value="investment">Inversión</option>
          </select>
        </Field>
        {kind !== "cash" && <Field label={kind === "pocket" || kind === "investment" ? "Alias de destino en SMS (opcional)" : "Alias del producto en SMS (opcional)"}><input name="captureAliases" defaultValue={(account.captureAliases ?? []).join(", ")} placeholder="Últimos cuatro dígitos o nombre del destino" /><small>{kind === "pocket" || kind === "investment" ? "Separa los alias con comas. Un SMS compatible con origen y destino inequívocos podrá reconocer este destino propio." : "Usa el nombre o los últimos cuatro dígitos que aparecen en el SMS, separados por comas."} Nunca uses números completos.</small></Field>}
        <div className="form-grid">
          <Field
            label={
              kind === "credit" ? "Deuda inicial (COP)" : "Saldo inicial (COP)"
            }
          >
            <input
              name="opening"
              required
              disabled={hasMovements}
              inputMode="decimal"
              defaultValue={decimalCOP(account.openingMinor)}
            />
          </Field>
          <Field label="Fecha del saldo inicial">
            <input
              name="date"
              required
              disabled={hasMovements}
              type="date"
              max={bogotaDate()}
              defaultValue={account.openingDate}
            />
          </Field>
          {kind === "credit" && (
            <>
              <Field label="Día de corte">
                <input
                  name="closing"
                  type="number"
                  min="1"
                  max="31"
                  required
                  defaultValue={account.closingDay}
                />
              </Field>
              <Field label="Día de pago">
                <input
                  name="due"
                  type="number"
                  min="1"
                  max="31"
                  required
                  defaultValue={account.dueDay}
                />
              </Field>
            </>
          )}
        </div>
        {(kind === "bank" || kind === "cash") && (
          <label className="checkbox">
            <input
              name="eligible"
              type="checkbox"
              defaultChecked={account.eligible}
            />{" "}
            Incluir este saldo en el disponible
          </label>
        )}
        {kind === "credit" && (
          <Field label="Vincular con cuenta bancaria">
            <select name="parent" defaultValue={account.parentAccountId ?? ""}>
              <option value="">Tarjeta independiente</option>
              {state.accounts
                .filter((a) => a.kind === "bank")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.institution ? `${a.institution} · ` : ""}
                    {a.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {hasMovements && (
          <p className="small-note">
            El tipo y el saldo inicial quedan protegidos después del primer
            movimiento. Usa un movimiento de corrección si necesitas ajustar el
            saldo.
          </p>
        )}
        {saved && <p role="status">Cambios guardados.</p>}
      </AppForm>
      <section className="product-aliases">
        <div>
          <h3>Tarjetas y alias de este producto</h3>
          <p className="small-note">
            Estos nombres y últimos cuatro dígitos permiten reconocer SMS y
            pagos de Wallet. Nunca guardes el número completo.
          </p>
        </div>
        {state.instruments
          .filter((instrument) => instrument.accountId === account.id)
          .map((instrument) => (
            <div className="product-instrument" key={instrument.id}>
              <span className="stat-icon">
                <Icon name="card" />
              </span>
              <div>
                <strong>{instrument.name}</strong>
                <small>
                  {instrument.aliases.length
                    ? instrument.aliases.join(", ")
                    : "Sin alias configurado"}
                </small>
              </div>
              <InstrumentEditor
                instrument={instrument}
                state={state}
                save={saveInstrument}
              />
            </div>
          ))}
        {!state.instruments.some(
          (instrument) => instrument.accountId === account.id,
        ) && (
          <p className="small-note">
            Puedes agregar una tarjeta después en Capturas automáticas. Los alias del producto se editan arriba.
          </p>
        )}
        {account.kind === "bank" && <DisclosureEditor label="Agregar tarjeta débito">
          <AppForm submit="Guardar tarjeta débito" onSubmit={async f => {
            await saveInstrument({ id: newDebitId.current, accountId: account.id,
              name: str(f, "name").trim() || `Débito · ${account.name}`,
              aliases: str(f, "aliases").split(",").map(value => value.trim()).filter(Boolean) });
            newDebitId.current = freshId();
          }}>
            <Field label="Nombre de la tarjeta débito (opcional)"><input name="name" maxLength={200} placeholder={`Débito · ${account.name}`} /></Field>
            <Field label="Alias de la tarjeta débito en SMS"><input name="aliases" aria-label="Alias de la tarjeta débito en SMS" required placeholder="Últimos cuatro dígitos" /><small>Comparte el saldo de esta cuenta. Nunca escribas el número completo.</small></Field>
          </AppForm>
        </DisclosureEditor>}
      </section>
    </DisclosureEditor>
  );
}

function InstrumentEditor({
  instrument,
  state,
  save,
}: {
  instrument: State["instruments"][number];
  state: State;
  save: (data: unknown) => Promise<void>;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <DisclosureEditor label="Editar tarjeta" className="instrument-editor">
      <AppForm
        submit="Guardar cambios"
        onSubmit={async (f) => {
          await save({
            id: instrument.id,
            name: str(f, "name"),
            accountId: str(f, "accountId"),
            aliases: str(f, "aliases")
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean),
          });
          setSaved(true);
        }}
      >
        <Field label="Nombre de tarjeta">
          <input
            name="name"
            required
            defaultValue={instrument.name}
            maxLength={200}
          />
        </Field>
        <Field label="Cuenta asociada">
          <select name="accountId" required defaultValue={instrument.accountId}>
            {state.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ·{" "}
                {a.kind === "credit"
                  ? "crédito"
                  : a.kind === "bank"
                    ? "débito"
                    : "efectivo"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Alias separados por comas">
          <input
            name="aliases"
            defaultValue={instrument.aliases.join(", ")}
            placeholder="1122, wallet-debito"
          />
        </Field>
        {saved && <p role="status">Tarjeta actualizada.</p>}
      </AppForm>
    </DisclosureEditor>
  );
}

function SettingsSection({
  title,
  description,
  icon,
  children,
  open = false,
}: {
  title: string;
  description: string;
  icon: "plus" | "card" | "calendar" | "shield";
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="settings-section" open={open ? true : undefined}>
      <summary>
        <span className="settings-section-icon">
          <Icon name={icon} size={19} />
        </span>
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
        <Icon name="chevron" size={15} />
      </summary>
      <div className="settings-section-body">{children}</div>
    </details>
  );
}

function Settings({
  state,
  summary,
  refresh,
  receiveCash,
}: {
  state: State;
  summary?: Summary;
  refresh: () => Promise<boolean>;
  receiveCash: (accountId: string) => void;
}) {
  const [accountKind, setAccountKind] = useState("bank"),
    [token, setToken] = useState("");
  const [addDebitCard, setAddDebitCard] = useState(false);
  const productSetupIds = useRef({ account: freshId(), instrument: freshId() });
  const [productSaved, setProductSaved] = useState(false);
  const [newCategoryScope, setNewCategoryScope] = useState<"expense" | "income">("expense");
  const [devices, setDevices] = useState<
    { id: string; name: string; revoked: boolean }[]
  >([]);
  const [health, setHealth] = useState<{
    pending: { id: string; error?: string; createdAt: string }[];
  }>();
  const [deviceError, setDeviceError] = useState("");
  const [captureChecking, setCaptureChecking] = useState(false);
  const [captureFeedback, setCaptureFeedback] = useState("");
  const latestCapture = state.observations.filter((item) => item.source === "sms" || item.source === "wallet").sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  const loadDevices = useCallback(
    async () => setDevices(await api<typeof devices>("/devices")),
    [],
  );
  useEffect(() => {
    void loadDevices().catch((e) => setDeviceError(e.message));
    void api<typeof health>("/health")
      .then(setHealth)
      .catch((e) => setDeviceError(e.message));
  }, [loadDevices]);
  const save = async (path: string, data: unknown) => {
    await post(path, data);
    await refresh();
  };
  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <h2>Tus cuentas</h2>
          <Badge>{state.accounts.length}</Badge>
        </div>
        {state.accounts.map((a) => (
          <div className="account-row" key={a.id}>
            <span className={`stat-icon account-artwork ${a.kind}`}>
              <AccountArtwork account={a} />
            </span>
            <div>
              <strong>{a.name}</strong>
              <small>
                {a.kind === "credit"
                  ? "Tarjeta de crédito · deuda"
                  : accountKindLabels[a.kind]}
                {a.institution ? ` · ${a.institution}` : ""}
                {a.parentAccountId
                  ? ` · Vinculada a ${state.accounts.find((b) => b.id === a.parentAccountId)?.name ?? "cuenta bancaria"}`
                  : ""}
              </small>
              {a.kind !== "cash" && <small className="product-sms-status">{[...(a.captureAliases ?? []), ...state.instruments.filter(instrument => instrument.accountId === a.id).flatMap(instrument => instrument.aliases)].length ? "Identificación SMS configurada" : "SMS sin configurar · puedes hacerlo en Editar producto"}</small>}
            </div>
            <strong>
              {formatCOP(summary?.balances[a.id] ?? a.openingMinor)}
            </strong>
            {a.kind === "cash" && <button className="button secondary" onClick={() => receiveCash(a.id)}>Recibir efectivo</button>}
            <AccountEditor
              key={`${a.id}:${a.name}:${a.kind}:${a.openingMinor}:${a.openingDate}:${a.institution ?? ""}:${a.institutionUrl ?? ""}:${a.imageDataUrl?.length ?? 0}:${a.parentAccountId ?? ""}:${a.closingDay ?? ""}:${a.dueDay ?? ""}:${a.eligible}:${(a.captureAliases ?? []).join(",")}`}
              account={a}
              state={state}
              save={(data) => save("/accounts", data)}
              saveInstrument={(data) => save("/instruments", data)}
            />
            {a.kind === "investment" && <InvestmentValues account={a} state={state} balance={summary?.balances[a.id] ?? a.openingMinor} save={save} />}
            {a.kind === "pocket" && <p className="product-balance-note">Disponible en este bolsillo. No se incluye en el disponible general. Usa una transferencia para agregar o liberar dinero.</p>}
          </div>
        ))}
        {!state.accounts.length && (
          <p className="muted">
            Agrega una cuenta bancaria, efectivo o una tarjeta de crédito
            independiente.
          </p>
        )}
      </section>
      <section className="panel settings-hub">
        <div className="section-heading">
          <div>
            <h2>Administrar</h2>
            <p className="muted">
              Abre solo la sección que necesitas. Tus productos guardados
              permanecen visibles arriba.
            </p>
          </div>
        </div>
        <SettingsSection
          title="Agregar producto"
          description="Cuenta, tarjeta, efectivo, bolsillo o inversión"
          icon="plus"
          open={!state.accounts.length}
        >
          <p className="small-note">Empieza por el saldo y cómo reconocer este producto en los SMS. Después conecta tu iPhone una sola vez para todas tus cuentas.</p>
          {productSaved && <p role="status" className="product-setup-success">Producto guardado. Puedes conectar tu iPhone en Capturas automáticas o agregar otro producto.</p>}
          <AppForm onSubmit={async (f) => {
            const artwork = await prepareAccountArtwork(f.get("artwork") as File);
            const aliases = (key: string) => str(f, key).split(",").map(value => value.trim()).filter(Boolean);
            await save("/accounts", {
              id: productSetupIds.current.account,
              name: str(f, "name"), kind: accountKind,
              captureAliases: aliases("captureAliases"),
              openingMinor: amount(f, "opening"), openingDate: str(f, "date"),
              eligible: f.get("eligible") === "on",
              ...(str(f, "institution").trim() ? { institution: str(f, "institution").trim() } : {}),
              ...(str(f, "institutionUrl").trim() ? { institutionUrl: str(f, "institutionUrl").trim() } : {}),
              ...(artwork ? { imageDataUrl: artwork } : {}),
              ...(accountKind === "bank" && addDebitCard ? { initialInstrument: {
                id: productSetupIds.current.instrument,
                name: str(f, "debitName").trim() || `Débito · ${str(f, "name").trim()}`,
                aliases: aliases("debitAliases"),
              } } : {}),
              ...(accountKind === "credit" ? {
                closingDay: Number(f.get("closing")), dueDay: Number(f.get("due")),
                ...(str(f, "parentAccountId") ? { parentAccountId: str(f, "parentAccountId") } : {}),
              } : {}),
            });
            productSetupIds.current = { account: freshId(), instrument: freshId() };
            setAddDebitCard(false); setProductSaved(true);
          }}>
            <Field label="Tipo de cuenta"><select value={accountKind} onChange={event => { setAccountKind(event.target.value); setAddDebitCard(false); setProductSaved(false); }}>
              <option value="bank">Cuenta bancaria</option><option value="credit">Tarjeta de crédito</option><option value="cash">Efectivo</option><option value="pocket">Bolsillo</option><option value="investment">Inversión</option>
            </select></Field>
            <Field label="Nombre de la cuenta"><input name="name" required placeholder="Ahorros, Visa crédito, Viaje…" maxLength={200} /></Field>
            <div className="form-grid">
              <Field label={accountKind === "credit" ? "Deuda inicial (COP)" : "Saldo inicial (COP)"}><input name="opening" required inputMode="decimal" placeholder="0" /></Field>
              <Field label="Fecha del saldo inicial"><input name="date" required type="date" defaultValue={bogotaDate()} max={bogotaDate()} /></Field>
            </div>
            <p className="small-note">Usa el saldo de esa fecha. Los movimientos anteriores se conservarán en el historial sin cambiarlo.</p>
            {accountKind !== "cash" && <section className="product-capture-setup">
              <h3>Cómo aparece en tus SMS</h3>
              <Field label={accountKind === "pocket" || accountKind === "investment" ? "Alias de destino en SMS (opcional)" : "Alias del producto en SMS (opcional)"}>
                <input name="captureAliases" placeholder={accountKind === "pocket" || accountKind === "investment" ? "Nombre del destino o últimos cuatro dígitos" : "Últimos cuatro dígitos que muestra el SMS"} />
                <small>Guarda solo el nombre o los últimos cuatro dígitos, separados por comas. Nunca el número completo. Puedes completarlo después en Editar producto.</small>
              </Field>
              {accountKind === "bank" && <>
                <label className="checkbox"><input type="checkbox" checked={addDebitCard} onChange={event => setAddDebitCard(event.target.checked)} /> Agregar tarjeta débito ahora</label>
                {addDebitCard ? <div className="form-grid">
                  <Field label="Nombre de la tarjeta débito (opcional)"><input name="debitName" maxLength={200} placeholder="Débito · usa el nombre de la cuenta" /></Field>
                  <Field label="Alias de la tarjeta débito en SMS"><input name="debitAliases" aria-label="Alias de la tarjeta débito en SMS" required placeholder="Últimos cuatro dígitos" /><small>Usa los que aparecen junto a T.Deb en el mensaje. Las compras descontarán el saldo de esta cuenta.</small></Field>
                </div> : <p className="small-note">Puedes añadir la tarjeta después. La tarjeta débito comparte el saldo de la cuenta.</p>}
              </>}
              {accountKind === "credit" && <p className="small-note">Usa los últimos cuatro dígitos que aparecen junto a T.Cred. Las compras aumentarán la deuda de esta tarjeta.</p>}
              {(accountKind === "pocket" || accountKind === "investment") && <p className="small-note">Un SMS compatible con origen y destino inequívocos podrá reconocer este producto como propio.</p>}
            </section>}
            {accountKind === "credit" && <div className="form-grid">
              <Field label="Día de corte"><input name="closing" type="number" min="1" max="31" required /></Field>
              <Field label="Día de pago"><input name="due" type="number" min="1" max="31" required /></Field>
            </div>}
            <details className="product-optional-settings"><summary>Más opciones · banco, imagen y organización</summary><div>
              <Field label="Banco o entidad (opcional)"><input name="institution" placeholder="Bancolombia, Nu…" maxLength={200} /></Field>
              {accountKind === "bank" && <Field label="Sitio web del banco (opcional)"><input name="institutionUrl" type="url" inputMode="url" placeholder="https://www.bancolombia.com" maxLength={500} /><small>Intentaremos mostrar su favicon.</small></Field>}
              <Field label="Imagen del producto (opcional)"><input name="artwork" type="file" accept="image/jpeg,image/png,image/webp" /></Field>
              {accountKind === "credit" && <Field label="Cuenta bancaria vinculada (opcional)"><select name="parentAccountId" defaultValue=""><option value="">Tarjeta independiente</option>{state.accounts.filter(account => account.kind === "bank").map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select><small>Organiza la tarjeta sin mezclar su deuda con el saldo de la cuenta.</small></Field>}
              {(accountKind === "bank" || accountKind === "cash") && <label className="checkbox"><input name="eligible" type="checkbox" defaultChecked /> Incluir este saldo en el disponible</label>}
            </div></details>
            {(accountKind === "pocket" || accountKind === "investment") && <p className="small-note">Este saldo ya debe estar separado de tus otras cuentas. Para agregar dinero después, registra una transferencia; no es un gasto ni se incluye en el disponible general.</p>}
          </AppForm>
        </SettingsSection>
        <SettingsSection
          title="Margen y categorías"
          description="Reserva protegida, día de ingreso y clasificación"
          icon="shield"
        >
          <h3>Tu margen de tranquilidad</h3>
          <p className="small-note">Los retiros de cajero completos y sin posibles duplicados pasan automáticamente de la cuenta bancaria a Efectivo. Los casos dudosos quedan en Revisar. Recibir efectivo por otro concepto es un ingreso.</p>
          <AppForm
            onSubmit={(f) =>
              save("/settings", {
                ...(str(f, "cashAccountId") ? { cashAccountId: str(f, "cashAccountId") } : {}),
                payday: Number(f.get("payday")),
                reserveMinor: amount(f, "reserve"),
              })
            }
            key={`${state.settings.payday}-${state.settings.reserveMinor}-${state.settings.cashAccountId ?? ""}`}
          >
            <Field label="Día de ingreso mensual">
              <input
                name="payday"
                type="number"
                min="1"
                max="31"
                required
                defaultValue={state.settings.payday}
              />
            </Field>
            <Field label="Reserva protegida (COP)">
              <input
                name="reserve"
                required
                defaultValue={decimalCOP(state.settings.reserveMinor)}
                inputMode="decimal"
              />
            </Field>
            <p className="small-note">
              El salario esperado no se suma al dinero de hoy. La reserva queda
              fuera del disponible.
            </p>
            {state.accounts.some(account => account.kind === "cash") && <Field label="Efectivo destino de retiros"><select name="cashAccountId" defaultValue={state.settings.cashAccountId ?? state.accounts.find(account => account.kind === "cash")?.id}>{state.accounts.filter(account => account.kind === "cash").map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select><small>Si tienes varias cuentas de efectivo, elige aquí dónde guardar los retiros.</small></Field>}
          </AppForm>
          <hr />
          <h3>Nueva categoría</h3>
          <AppForm
            onSubmit={(f) =>
              save("/categories", {
                id: freshId(),
                name: str(f, "name"),
                scope: newCategoryScope,
                ...(str(f, "parentId") ? { parentId: str(f, "parentId") } : {}),
              })
            }
          >
            <Field label="Tipo de movimiento">
              <select value={newCategoryScope} onChange={(event) => setNewCategoryScope(event.target.value as "expense" | "income")}>
                <option value="expense">Gasto o devolución</option>
                <option value="income">Ingreso</option>
              </select>
            </Field>
            <Field label="Categoría principal (opcional)">
              <select name="parentId" defaultValue="" key={newCategoryScope}>
                <option value="">Crear categoría principal</option>
                {state.categories
                  .filter((category) => !category.parentId && category.id !== "uncategorized" && category.scope === newCategoryScope)
                  .map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <small>Selecciona una categoría principal para crear una subcategoría.</small>
            </Field>
            <Field label="Nombre de categoría">
              <input name="name" required maxLength={200} />
            </Field>
          </AppForm>
        </SettingsSection>
        <SettingsSection
          title="Configurar capturas automáticas"
          description="Conecta el iPhone una vez para tus productos"
          icon="card"
        >
          <p className="small-note">Los alias se configuran al agregar o editar cada producto. Aquí conectas el iPhone para enviar los SMS de todas tus cuentas. Configurar un alias todavía no conecta la automatización.</p>
          <details className="capture-step">
          <summary>1. Prueba tu iPhone <small>Comprueba el texto antes de conectar</small></summary><div>
          <p className="small-note shortcut-guide-intro">
            Apple permite activar automatizaciones con Mensajes y Wallet, pero
            no documenta que siempre entreguen el texto, el valor o el comercio.
            Haz estas pruebas antes de conectar datos reales.
          </p>
          <div
            className="shortcut-guide"
            aria-label="Guía de Atajos para iPhone"
          >
            <details open>
              <summary>
                <span>Prueba el SMS</span>
                <small>Primero · 3 minutos</small>
              </summary>
              <div className="shortcut-guide-body">
                <ol>
                  <li>
                    En <strong>Atajos → Automatización → + → Mensaje</strong>,
                    usa temporalmente un remitente de confianza y el filtro
                    <code>MS-TEST</code>.
                  </li>
                  <li>
                    Elige <strong>Ejecutar inmediatamente</strong> y crea una
                    automatización en blanco.
                  </li>
                  <li>
                    Agrega <strong>Texto</strong>. Toca su campo, elige
                    <strong>Seleccionar variable</strong> y busca
                    <strong>Entrada del atajo</strong>.
                  </li>
                  <li>
                    Agrega <strong>Mostrar alerta</strong> y envía
                    <code>MS-TEST 123</code> desde el remitente elegido.
                  </li>
                </ol>
                <p className="shortcut-result">
                  <strong>Continúa solo si ves el mensaje completo.</strong> Si
                  la variable no aparece o llega vacía, el disparador no puede
                  alimentar el lector automático en ese iPhone.
                </p>
              </div>
            </details>
            <details>
              <summary>
                <span>Prueba Wallet</span>
                <small>Antes de activarlo</small>
              </summary>
              <div className="shortcut-guide-body">
                <ol>
                  <li>
                    Crea <strong>Automatización → Transacción</strong> y elige
                    una tarjeta.
                  </li>
                  <li>
                    Agrega <strong>Texto</strong>, intenta insertar
                    <strong>Entrada del atajo</strong> y después agrega
                    <strong>Mostrar alerta</strong>.
                  </li>
                  <li>
                    Haz un pago normal y revisa si aparecen valor, comercio,
                    fecha, moneda y tarjeta.
                  </li>
                </ol>
                <p className="shortcut-result">
                  Si faltan esos datos, deja Wallet desactivado. Los SMS y los
                  extractos seguirán registrando y conciliando el movimiento.
                </p>
              </div>
            </details>
            <details>
              <summary>
                <span>Prueba la ubicación</span>
                <small>Opcional</small>
              </summary>
              <div className="shortcut-guide-body">
                <ol>
                  <li>
                    Agrega <strong>Obtener ubicación actual</strong> y luego una
                    acción <strong>Texto</strong>.
                  </li>
                  <li>
                    Inserta la variable azul de ubicación, tócala y revisa las
                    propiedades disponibles en tu iPhone.
                  </li>
                  <li>
                    Comprueba latitud y longitud. Extrae dirección completa, calle, ciudad, estado o departamento, código postal, región y país solo si están disponibles. La precisión es opcional; no todos los iPhone la exponen.
                  </li>
                </ol>
                <p className="shortcut-result">
                  La ubicación es una pista opcional. Nunca uses coordenadas
                  cero ni dejes que una falla de Localización borre el
                  movimiento.
                </p>
              </div>
            </details>
            <p className="shortcut-guide-sources">
              Validado con la documentación oficial de Apple sobre{" "}
              <a
                href="https://support.apple.com/guide/shortcuts/communication-triggers-apdd711f9dff/ios"
                target="_blank"
                rel="noreferrer"
              >
                Mensajes
              </a>
              ,{" "}
              <a
                href="https://support.apple.com/guide/shortcuts/apd65c67538a/ios"
                target="_blank"
                rel="noreferrer"
              >
                Transacciones
              </a>{" "}
              y{" "}
              <a
                href="https://support.apple.com/guide/shortcuts/apda36b9018b/ios"
                target="_blank"
                rel="noreferrer"
              >
                variables
              </a>
              .
            </p>
          </div>
          </div></details>
          <details className="capture-step" open={Boolean(token) || (Boolean(state.instruments.length) && !devices.some((device) => !device.revoked))}>
          <summary>2. Crea el acceso del iPhone <small>Un acceso privado para SMS y Wallet</small></summary><div>
          <p>
            Crea un acceso privado para este iPhone. El token se guarda solo en
            Atajos y permite enviar capturas; no da acceso a tu sesión ni a tus
            credenciales bancarias.
          </p>
          <AppForm
            submit="Crear acceso para mi iPhone"
            onSubmit={async (f) => {
              const d = await post<{ token: string }>("/devices", {
                name: str(f, "name"),
              });
              setToken(d.token);
              await loadDevices();
            }}
          >
            <Field label="Nombre del dispositivo">
              <input
                name="name"
                required
                placeholder="Mi iPhone"
                maxLength={100}
              />
            </Field>
          </AppForm>
          {token && <div className="notice"><div><strong>Copia este acceso ahora; no volverá a mostrarse.</strong><CopyCaptureValue label="Token" value={token} sensitive /><p>Guárdalo en tus Atajos. Usa este mismo acceso para SMS y Wallet.</p><button className="text-button" onClick={() => setToken("")}>Ya lo guardé</button></div></div>}
          {deviceError && <p className="error" role="alert">{deviceError}</p>}
          {devices.map((device) => <div className="audit-row" key={device.id}><strong>{device.name}</strong><button className="text-button" disabled={device.revoked} onClick={() => void api(`/devices/${device.id}`, { method: "DELETE" }).then(loadDevices).catch((error) => setDeviceError(error.message))}>{device.revoked ? "Revocado" : "Revocar acceso"}</button></div>)}
          </div></details>
          <details className="capture-step" open={devices.some((device) => !device.revoked)}>
          <summary>3. Conecta el Atajo <small>SMS primero; Wallet y ubicación opcionales</small></summary><div>
          <details className="shortcut-api-guide" open>
            <summary>Atajo real · SMS Bancolombia</summary>
            <div>
              <p className="shortcut-prerequisite">
                <strong>Requisito:</strong> la prueba anterior mostró el texto
                completo en <strong>Entrada del atajo</strong>.
              </p>
              <ol className="shortcut-production-steps">
                <li>
                  Crea <strong>Atajos → Automatización → + → Mensaje</strong>.
                  Remitente: <code>85540</code>. El mensaje contiene:
                  <code>Bancolombia:</code>. Elige
                  <strong>Ejecutar inmediatamente</strong>.
                </li>
                <li>
                  Agrega <strong>Formatear fecha</strong>. Como entrada elige la
                  variable <strong>Fecha actual</strong> y usa formato
                  <strong>ISO 8601</strong>. Renombra el resultado como
                  <code>ObservedAt</code>. Esa es la opción correcta aunque el
                  resultado termine en <code>-0500</code> o <code>-05:00</code>.
                </li>
                <li>
                  Agrega otro <strong>Formatear fecha</strong> con
                  <strong>Fecha actual</strong> y formato personalizado
                  <code>yyyyMMddHHmmssSSS</code>. Después agrega
                  <strong>Texto</strong> con <code>sms-</code> seguido de esa
                  fecha. Renombra el resultado como <code>EventId</code>. Conserva este valor y <code>ObservedAt</code> en cada reintento del mismo envío.
                </li>
                <li>
                  Agrega <strong>URL</strong> y pega:
                  <CopyCaptureValue label="URL de envío" value={`${apiURL}/capture-events`} />
                </li>
                <li>
                  Agrega <strong>Obtener contenido de URL</strong> y toca
                  <strong>Mostrar más</strong>. Método: <code>POST</code>.
                  Cuerpo de la solicitud: <code>JSON</code>.
                </li>
                <li>
                  En <strong>Cabeceras</strong>, agrega
                  <code>Authorization</code> con
                  <code>Bearer TU_TOKEN</code>. Sustituye
                  <code>TU_TOKEN</code> por el acceso creado arriba. Agrega
                  <code>Content-Type</code> con
                  <code>application/json</code>.
                  {token && <CopyCaptureValue label="Authorization" value={`Bearer ${token}`} sensitive />}
                </li>
                <li>
                  En el cuerpo JSON agrega exactamente:
                  <div className="shortcut-field-list">
                    <span>
                      <code>eventId</code>
                      <b>Texto · EventId</b>
                    </span>
                    <span>
                      <code>source</code>
                      <b>Texto · sms</b>
                    </span>
                    <span>
                      <code>observedAt</code>
                      <b>Texto · ObservedAt</b>
                    </span>
                    <span>
                      <code>message</code>
                      <b>Texto · Entrada del atajo</b>
                    </span>
                  </div>
                  Si <strong>Entrada del atajo</strong> es un objeto, tócala y
                  elige la propiedad que mostró el contenido en la prueba.
                </li>
                <li>
                  En la primera compra, agrega temporalmente
                  <strong>Mostrar alerta</strong> después de la solicitud. Una
                  respuesta con <code>durably_saved</code> confirma el envío;
                  después elimina la alerta.
                </li>
              </ol>
              <p className="shortcut-result">
                <strong>Una sola solicitud.</strong> Incluye latitude y longitude como números junto al SMS. Si no tienes ubicación, omite ambos campos y envía el movimiento igualmente.
              </p>
            </div>
          </details>
          <details className="shortcut-api-guide">
            <summary>Atajo real · pago con Wallet</summary>
            <div>
              <p className="shortcut-prerequisite">
                <strong>Requisito:</strong> la prueba de Wallet mostró valor,
                comercio, fecha y tarjeta. Apple no garantiza esos campos para
                todas las tarjetas.
              </p>
              <ol className="shortcut-production-steps">
                <li>
                  Crea <strong>Automatización → Transacción</strong>, selecciona
                  una sola tarjeta y elige
                  <strong>Ejecutar inmediatamente</strong>.
                </li>
                <li>
                  Crea <code>ObservedAt</code> y <code>EventId</code> igual que
                  en el atajo de SMS, usando el prefijo <code>wallet-</code>.
                </li>
                <li>
                  Multiplica el valor de Wallet por <code>100</code> y redondea
                  a cero decimales. Envíalo como texto en
                  <code>amountMinor</code>.
                </li>
                <li>
                  Usa el mismo endpoint, método, cabeceras y token. En el JSON
                  agrega:
                  <div className="shortcut-field-list">
                    <span>
                      <code>eventId</code>
                      <b>EventId</b>
                    </span>
                    <span>
                      <code>source</code>
                      <b>wallet</b>
                    </span>
                    <span>
                      <code>observedAt</code>
                      <b>ObservedAt</b>
                    </span>
                    <span>
                      <code>date</code>
                      <b>Fecha · yyyy-MM-dd</b>
                    </span>
                    <span>
                      <code>amountMinor</code>
                      <b>Valor × 100</b>
                    </span>
                    <span>
                      <code>currency</code>
                      <b>COP</b>
                    </span>
                    <span>
                      <code>merchant</code>
                      <b>Comercio de Wallet</b>
                    </span>
                    <span>
                      <code>instrumentHint</code>
                      <b>Alias de la tarjeta</b>
                    </span>
                    <span>
                      <code>kind</code>
                      <b>expense</b>
                    </span>
                  </div>
                </li>
              </ol>
              <p className="shortcut-result">
                Si la prueba no mostró valor o comercio, no existe un atajo
                automático completo para esa tarjeta. Déjalo desactivado: el SMS
                Bancolombia y el extracto seguirán cubriendo el pago.
              </p>
            </div>
          </details>
          </div></details>
          <details className="shortcut-api-guide location-shortcut-guide">
            <summary>Ubicación opcional · SMS y Wallet</summary>
            <div>
              <p>La opción más sencilla: envía <code>latitude</code> y <code>longitude</code> directamente en el JSON del evento, como números obtenidos de Ubicación actual. La dirección es opcional. Puedes añadir <code>locationObservedAt</code> con la hora de la muestra; si falta, se indica la hora del evento.</p><details><summary>Dirección detallada (opcional)</summary><p>También puedes enviar <code>location</code> como un diccionario dentro del mismo JSON de <code>/capture-events</code>, junto a <code>eventId</code>, <code>source</code>, <code>observedAt</code> y el SMS o los datos de Wallet. No hay una segunda solicitud.</p>
              <ol>
                <li>Genera y conserva el EventId del movimiento. Intenta obtener una sola muestra con <strong>Obtener ubicación actual</strong> antes del envío.</li>
                <li>Usa <strong>Obtener detalles de ubicaciones</strong> sobre esa misma variable para latitud, longitud y los componentes de dirección disponibles. Guarda la fecha de esa muestra como <code>LocationObservedAt</code>, en ISO 8601.</li>
                <li>Crea un diccionario <code>location</code> con <code>latitude</code> y <code>longitude</code> de tipo Número y <code>observedAt</code> de tipo Texto. Agrega solo los campos opcionales disponibles. No uses cero para reemplazar un dato faltante ni inventes precisión.</li>
                <li>Incluye el diccionario como valor de <code>location</code> en el JSON del evento y envía todo a la ruta habitual con POST y el mismo acceso del dispositivo. Al reintentar, reutiliza el EventId y el JSON completo, incluida la muestra original.</li>
                <li>Si no hay coordenadas válidas, omite <code>location</code>. Comprueba en tu iPhone que un permiso denegado o una demora no detenga el atajo antes del envío; si lo detiene, deja este bloque desactivado hasta resolverlo.</li>
              </ol>
              <p className="small-note">Para un enlace de Apple Maps usa <strong>Obtener URL de Mapas</strong>. La propiedad URL de una ubicación también puede ser otro enlace; la app lo conserva como enlace recibido.</p>
              <div className="shortcut-field-list">
                {[["latitude", "Número · Latitud"], ["longitude", "Número · Longitud"], ["observedAt", "Texto · LocationObservedAt"], ["accuracy", "Número · Precisión en metros, si existe"], ["fullAddress", "Texto · Dirección completa"], ["street", "Texto · Calle"], ["streetNumber", "Texto · Número"], ["city", "Texto · Ciudad"], ["state", "Texto · Estado / departamento"], ["postalCode", "Texto · Código postal"], ["region", "Texto · Región"], ["country", "Texto · País"], ["countryCode", "Texto · Código del país"], ["name", "Texto · Nombre recibido, sin confirmar comercio"], ["url", "Texto · URL de Mapas o enlace recibido"]].map(([field, label]) => <span key={field}><code>{field}</code><b>{label}</b></span>)}
              </div>
              <p className="small-note">Los enlaces a Apple Maps y Google Maps se generan con las coordenadas. La dirección del teléfono no identifica automáticamente al comercio, especialmente si el SMS llegó tarde.</p></details>
            </div>
          </details>
          <details className="capture-step">
          <summary>4. Verifica la primera evidencia <small>El acceso creado aún no confirma la conexión</small></summary><div>
          <p>Después del primer envío, actualiza y busca el comercio, valor y fecha en Revisar. Una evidencia recibida confirma ese envío; no garantiza que iOS ejecute todas las automatizaciones.</p>
          <button type="button" className="button secondary" onClick={async () => { setCaptureChecking(true); setCaptureFeedback(""); try { const refreshed = await refresh(); setCaptureFeedback(refreshed ? "Datos actualizados. Revisa la última evidencia recibida." : "No se pudo actualizar. Intenta de nuevo."); } finally { setCaptureChecking(false); } }} disabled={captureChecking}>{captureChecking ? "Comprobando…" : "Comprobar llegada"}</button>
          <p role="status">{captureFeedback}</p>
          {latestCapture ? <p className="capture-arrival"><strong>Última evidencia recibida · {latestCapture.source === "sms" ? "SMS" : "Wallet"}</strong><br />{latestCapture.merchant || "Comercio por completar"} · {latestCapture.amountMinor ? formatCOP(latestCapture.amountMinor) : "Valor por completar"}<br /><time dateTime={latestCapture.receivedAt}>{new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" }).format(new Date(latestCapture.receivedAt))}</time></p> : <p>Aún no hay evidencias de SMS o Wallet recibidas.</p>}
          <a className="text-link" href="#/revisar">Abrir pistas para revisar</a>
          <p className="small-note">
            Cuando el iPhone entrega el texto, Money Stalker reconoce SMS
            Bancolombia de compra con tarjeta, pago QR, pago desde cuenta y
            transferencia. Si faltan datos, la captura aparecerá en Revisión.
          </p>
          <p className="small-note">
            La ubicación viaja dentro de la misma solicitud que el evento. Conserva el EventId y el JSON completo al reintentar para evitar duplicados.
          </p>
          {health?.pending.length ? (
            <div className="notice">
              <div>
                <strong>
                  {health.pending.length} capturas o lotes pendientes
                </strong>
                {health.pending.map((j) => (
                  <p key={j.id}>
                    {j.error ?? "Esperando procesamiento"} ·{" "}
                    {new Date(j.createdAt).toLocaleString("es-CO")}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
          </div></details>
          <details className="capture-step">
          <summary>Agregar una tarjeta o alias después <small>Opcional · los alias iniciales se guardan al agregar el producto</small></summary>
          <div>
          <p className="small-note">
            Una tarjeta débito apunta a su cuenta bancaria; no crea un saldo
            nuevo. Agrega los últimos cuatro dígitos que aparecen en tus SMS,
            por ejemplo los últimos cuatro dígitos visibles en cada mensaje.
            Nunca guardes números completos.
          </p>
          <p className="small-note">
            Para una tarjeta de crédito, créala primero arriba como una cuenta
            de tipo <strong>Tarjeta de crédito</strong>. Después asocia aquí sus
            alias de SMS y Wallet. El tipo débito o crédito depende de la cuenta
            elegida.
          </p>
          <AppForm
            onSubmit={(f) =>
              save("/instruments", {
                id: freshId(),
                name: str(f, "name"),
                accountId: str(f, "accountId"),
                aliases: str(f, "aliases")
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
          >
            <Field label="Nombre de tarjeta">
              <input name="name" required placeholder="Débito · Wallet" />
            </Field>
            <Field label="Cuenta asociada">
              <select name="accountId" required>
                <option value="">Selecciona una cuenta</option>
                {state.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ·{" "}
                    {a.kind === "credit"
                      ? "crédito"
                      : a.kind === "bank"
                        ? "débito"
                        : "efectivo"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Alias separados por comas">
              <input name="aliases" placeholder="1122, wallet-debito" />
            </Field>
          </AppForm>
          {state.instruments.length > 0 && (
            <p className="small-note capture-product-note">
              Para cambiar una tarjeta o sus alias, abre <strong>Editar
              producto</strong> junto a la cuenta o tarjeta correspondiente en
              Tus cuentas.
            </p>
          )}
          </div></details>
        </SettingsSection>
        <SettingsSection
          title="Facturas y fechas"
          description="Compromisos que reducen tu dinero disponible"
          icon="calendar"
        >
          <AppForm
            onSubmit={(f) =>
              save("/bills", {
                id: freshId(),
                name: str(f, "name"),
                amountMinor: amount(f, "amount"),
                dueDate: str(f, "due"),
              })
            }
          >
            <Field label="Nombre de factura">
              <input name="name" required placeholder="Servicios de la casa" />
            </Field>
            <div className="form-grid">
              <Field label="Valor de factura (COP)">
                <input name="amount" required inputMode="decimal" />
              </Field>
              <Field label="Fecha de vencimiento">
                <input name="due" type="date" required />
              </Field>
            </div>
            <p className="small-note">
              Al registrar el gasto, asócialo a la factura para dejar de
              reservarla.
            </p>
          </AppForm>
          {state.bills.map((b) => (
            <div className="audit-row" key={b.id}>
              <div>
                <strong>{b.name}</strong>
                <small>
                  {b.dueDate} · {formatCOP(b.amountMinor)}
                </small>
              </div>
              <Badge tone={b.paidTransactionId ? "green" : "amber"}>
                {b.paidTransactionId ? "Pagada" : "Pendiente"}
              </Badge>
            </div>
          ))}
        </SettingsSection>
      </section>
    </>
  );
}
