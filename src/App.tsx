import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  emptyState,
  type State,
  type Observation,
  type Transaction,
} from "../domain/model";
import { dashboard } from "../domain/ledger";
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
import { Dashboard, SurfaceLoading } from "./finance/Dashboard";
import { ReviewDesk } from "./finance/ReviewDesk";
import { AccountRail } from "./finance/AccountRail";
import { DesignSystem } from "./design-system/DesignSystem";
import {
  Icon,
  Eyes,
  Badge as SystemBadge,
  EmptyState,
  Field,
} from "./design-system/ui";

type Summary = ReturnType<typeof dashboard>;
type Batch = {
  id: string;
  filename: string;
  profile?: string;
  status: string;
  total?: number;
  accepted?: number;
  rejected?: number;
  skipped?: number;
  next: number;
  duplicate?: boolean;
  error?: string;
  rows?: {
    row: number;
    status: string;
    error?: string;
    observation?: Observation;
  }[];
  offset?: number;
  more?: boolean;
};
type ImportProfile = { id: string; label: string; verified: boolean };
const nav = [
  ["resumen", "Resumen", "overview"],
  ["movimientos", "Movimientos", "arrows"],
  ["revisar", "Revisar", "check"],
  ["importar", "Importar", "upload"],
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
      await onSubmit(new FormData(form));
      form.reset();
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
const capturedAt = (value: string) =>
  new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Bogota",
  }).format(new Date(value));

export function App() {
  const [state, setState] = useState<State>(emptyState),
    [summary, setSummary] = useState<Summary>();
  const [signedIn, setSignedIn] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [page, setPage] = useState(location.hash.slice(2) || "resumen");
  const [editing, setEditing] = useState<Transaction | Observation | "new">();
  const [loading, setLoading] = useState(false),
    [notice, setNotice] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<string>();
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date>();
  const [stale, setStale] = useState(false);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d] = await Promise.all([
        api<State>("/state"),
        api<Summary>("/dashboard"),
      ]);
      setState(s);
      setSummary(d);
      setRefreshedAt(new Date());
      setStale(false);
      setError("");
    } catch (e) {
      setStale(true);
      setError((e as Error).message);
    } finally {
      setLoading(false);
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
    const route = () => setPage(location.hash.slice(2) || "resumen");
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
        if (document.visibilityState === "visible") void refresh();
      }, 30000);
      return () => clearInterval(timer);
    }
  }, [signedIn, refresh]);
  const act = async (
    fn: () => Promise<unknown>,
    message = "Cambios guardados",
  ) => {
    setNotice("");
    try {
      await fn();
      setNotice(message);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
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
            className="icon-button"
            onClick={() => void refresh()}
            aria-label="Actualizar datos"
            disabled={loading}
          >
            <Icon name="refresh" size={19} />
          </button>
          <button
            className="button primary new-movement"
            onClick={() => setEditing("new")}
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
            {selectedAccount
              ? state.accounts.find((a) => a.id === selectedAccount)?.name
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
            selected={selectedAccount}
            onSelect={selectAccount}
          />
        </div>
        <main
          className={`route-content ${page === "resumen" ? "route-dashboard" : ""}`}
        >
          {page !== "resumen" && (
            <div className="page-heading">
              <div>
                <h1>
                  {page === "revisar"
                    ? "Conectemos las pistas."
                    : page === "design-system"
                      ? "Design system"
                      : title}
                </h1>
                <p>
                  {page === "movimientos"
                    ? "Cada movimiento, con su historia y sin duplicados."
                    : page === "revisar"
                      ? "Compara las evidencias. Tú tienes la última palabra."
                      : page === "importar"
                        ? "Del archivo original a tus movimientos."
                        : page === "design-system"
                          ? "Las reglas y componentes que mantienen Money Stalker consistente."
                          : "Cuentas bancarias, tarjetas y tu margen de tranquilidad."}
                </p>
              </div>
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
            <Movements state={state} open={setEditing} onError={setError} />
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
          {page === "importar" && <Imports state={state} refresh={refresh} />}
          {page === "cuentas" && (
            <Settings state={state} summary={summary} refresh={refresh} />
          )}
          {page === "design-system" && <DesignSystem />}
          <footer className="footer">
            <span>Money Stalker · COP · Colombia</span>
            <a href="#/design-system">
              Design system <Icon name="arrow" size={14} />
            </a>
          </footer>
        </main>
      </div>
      {editing && (
        <TransactionDialog
          value={editing}
          state={state}
          close={() => setEditing(undefined)}
          saved={async () => {
            setEditing(undefined);
            setNotice("Movimiento guardado. Ya está en tu rastro.");
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function TransactionTable({
  transactions,
  state,
  open,
}: {
  transactions: Transaction[];
  state: State;
  open: (t: Transaction) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Movimiento</th>
            <th>Cuenta</th>
            <th>Categoría</th>
            <th>Estado</th>
            <th className="number">Valor</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr key={t.id}>
              <td>
                <button className="transaction-name" onClick={() => open(t)}>
                  {t.merchant ||
                    {
                      expense: "Gasto",
                      income: "Ingreso",
                      transfer: "Transferencia",
                      refund: "Devolución",
                    }[t.kind]}
                </button>
                <small>
                  {t.date}
                  {t.kind === "transfer" ? " · Transferencia" : ""}
                </small>
              </td>
              <td>{state.accounts.find((a) => a.id === t.accountId)?.name}</td>
              <td>
                {state.categories.find((c) => c.id === t.categoryId)?.name}
              </td>
              <td>
                <Badge tone={t.status === "posted" ? "green" : "amber"}>
                  {t.status === "posted" ? "Registrado" : "Por confirmar"}
                </Badge>
              </td>
              <td
                className={`number amount ${t.kind === "income" || t.kind === "refund" ? "positive" : ""}`}
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
function Movements({
  state,
  open,
  onError,
}: {
  state: State;
  open: (t: Transaction) => void;
  onError: (e: string) => void;
}) {
  const [search, setSearch] = useState("");
  const transactions = state.transactions
    .filter(
      (t) =>
        !t.voided &&
        `${t.merchant} ${t.note} ${t.date}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section className="panel">
      <div className="section-heading toolbar">
        <input
          aria-label="Buscar movimientos"
          type="search"
          placeholder="Buscar comercio, nota o fecha…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="button-row">
          <button
            className="button secondary"
            onClick={() =>
              void download("csv").catch((e) => onError(e.message))
            }
          >
            <Icon name="download" />
            CSV
          </button>
          <button
            className="button secondary"
            onClick={() =>
              void download("xlsx").catch((e) => onError(e.message))
            }
          >
            Excel
          </button>
        </div>
      </div>
      {transactions.length ? (
        <TransactionTable
          transactions={transactions}
          state={state}
          open={open}
        />
      ) : (
        <Empty title="No hay movimientos">
          Los registros manuales, capturas y extractos aparecerán aquí.
        </Empty>
      )}
    </section>
  );
}
function TransactionDialog({
  value,
  state,
  close,
  saved,
}: {
  value: Transaction | Observation | "new";
  state: State;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const isObservation = value !== "new" && "source" in value;
  const initial = value === "new" ? undefined : value;
  const [kind, setKind] = useState(initial?.kind ?? "expense");
  const transaction =
    value !== "new" && !isObservation ? (value as Transaction) : undefined;
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
            ? "Completar evidencia"
            : transaction
              ? "Editar movimiento"
              : "Nuevo movimiento"}
        </h2>
        <button className="icon-button" onClick={close} aria-label="Cerrar">
          <Icon name="close" />
        </button>
      </div>
      {locationEvidence.length > 0 && (
        <div className="notice location-memory">
          <div>
            <strong>Ubicación guardada por el atajo</strong>
            {locationEvidence.map((observation) => (
              <div className="location-entry" key={observation.id}>
                <small>
                  {observation.source === "wallet" ? "Wallet" : "SMS"} ·{" "}
                  {observation.location!.latitude.toFixed(5)},{" "}
                  {observation.location!.longitude.toFixed(5)} · precisión{" "}
                  {Math.round(observation.location!.accuracy)} m ·{" "}
                  {capturedAt(observation.location!.observedAt)}
                </small>
                <a
                  href={`https://maps.apple.com/?ll=${observation.location!.latitude},${observation.location!.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir en Mapas
                </a>
              </div>
            ))}
            <small>
              Es una pista del momento de captura. Un SMS retrasado puede llegar
              después de salir del lugar.
            </small>
          </div>
        </div>
      )}
      <AppForm
        submit={transaction ? "Guardar cambios" : "Registrar movimiento"}
        onSubmit={async (f) => {
          const data = {
            id: transaction?.id ?? operationId.current,
            kind,
            date: str(f, "date"),
            accountId: str(f, "accountId"),
            counterAccountId:
              kind === "transfer" ? str(f, "counterAccountId") : null,
            amountMinor: amount(f, "amount"),
            merchant: str(f, "merchant"),
            categoryId: str(f, "categoryId") || "uncategorized",
            note: str(f, "note"),
            billId: str(f, "billId") || null,
          };
          if (isObservation)
            await post("/reviews", {
              observationId: (value as Observation).id,
              action: "separate",
              details: Object.fromEntries(
                Object.entries(data).filter(([, v]) => v !== null),
              ),
            });
          else if (transaction)
            await api(`/transactions/${transaction.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                changes: data,
                remember: f.get("remember") === "on",
                expectedRevision: transaction.revision,
              }),
            });
          else
            await post(
              "/transactions",
              Object.fromEntries(
                Object.entries(data).filter(([, v]) => v !== null),
              ),
            );
          await saved();
        }}
      >
        <div className="form-grid">
          <Field label="Tipo">
            <select
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
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
            <select name="accountId" required defaultValue={initial?.accountId}>
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
              defaultValue={initial?.merchant}
            />
          </Field>
          <Field label="Categoría">
            <select
              name="categoryId"
              defaultValue={transaction?.categoryId ?? "uncategorized"}
            >
              {state.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
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
        <Field label="Nota">
          <textarea
            name="note"
            maxLength={1000}
            defaultValue={transaction?.note}
          />
        </Field>
        {transaction && (
          <label className="checkbox">
            <input type="checkbox" name="remember" /> Recordar esta categoría
            para el mismo comercio
          </label>
        )}
        {kind === "transfer" && (
          <p className="small-note">
            El pago de una tarjeta mueve dinero: no crea un gasto nuevo.
          </p>
        )}
      </AppForm>
    </dialog>
  );
}

function Imports({
  state,
  refresh,
}: {
  state: State;
  refresh: () => Promise<void>;
}) {
  const [batch, setBatch] = useState<Batch>(),
    [list, setList] = useState<Batch[]>([]),
    [profiles, setProfiles] = useState<ImportProfile[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
    await load();
  }
  return (
    <>
      <div className="notice">
        <div>
          <strong>Formato Bancolombia verificado</strong>
          <br />
          Reconocemos el extracto trimestral XLSX de cuenta de ahorros y el
          formato de intercambio COP. Siempre verás una vista previa antes de
          agregar movimientos.
        </div>
      </div>
      <div className="two-columns">
        <section className="panel">
          <h2>Importar archivo</h2>
          <AppForm submit="Subir y previsualizar" onSubmit={upload}>
            <Field label="Cuenta del archivo">
              <select required name="accountId">
                <option value="">Selecciona una cuenta</option>
                {state.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Archivo CSV o Excel">
              <input name="file" type="file" required accept=".csv,.xlsx" />
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
              Hasta 5 MB y 5.000 filas. Revisa el resultado antes de confirmar.
            </p>
          </AppForm>
        </section>
        <section className="panel">
          <h2>Formatos compatibles</h2>
          <p>
            <strong>Bancolombia:</strong> extracto trimestral XLSX de cuenta de
            ahorros, con fechas por página y valores firmados.
          </p>
          <p>
            <strong>Intercambio:</strong> encabezados{" "}
            <code>Fecha;Descripcion;Valor;Moneda;Tipo</code>
          </p>
          <p>
            Fecha ISO, valores como <code>25.000,00</code>, moneda{" "}
            <code>COP</code>. Tipos: gasto, ingreso, transferencia, devolución.
          </p>
          <p className="small-note">
            Los pagos de tarjeta y las transferencias a Nequi se conservan como
            transferencias cuando podemos identificar la cuenta destino. Si
            falta, aparecerán en Revisión. No se evalúan fórmulas.
          </p>
        </section>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {batch && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Vista previa · {batch.filename}</h2>
              <p>
                {batch.accepted ?? 0} aceptadas · {batch.rejected ?? 0}{" "}
                rechazadas · {batch.skipped ?? 0} filas de encabezado/vacías
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
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>Comercio</th>
                  <th>Fecha</th>
                  <th>Valor</th>
                  <th>Resultado</th>
                </tr>
              </thead>
              <tbody>
                {batch.rows?.map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>{row.observation?.merchant ?? "—"}</td>
                    <td>{row.observation?.date ?? "—"}</td>
                    <td>
                      {row.observation?.amountMinor
                        ? formatCOP(row.observation.amountMinor)
                        : "—"}
                    </td>
                    <td>{row.error ?? "Lista para conciliar"}</td>
                  </tr>
                ))}
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
                disabled={busy || !batch.accepted}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setBatch(
                      await post<Batch>(`/imports/${batch.id}/commit`, {}),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Confirmar {batch.accepted} filas aceptadas
              </button>
            )}
          </div>
        </section>
      )}
      <section className="panel">
        <h2>Archivos anteriores</h2>
        {list.map((b) => (
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
        {!list.length && (
          <p className="muted">Todavía no has subido archivos.</p>
        )}
      </section>
    </>
  );
}

function AccountOrganization({
  account,
  state,
  save,
}: {
  account: State["accounts"][number];
  state: State;
  save: (data: unknown) => Promise<void>;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <details className="account-organization">
      <summary>
        Organizar cuenta <Icon name="chevron" size={14} />
      </summary>
      <AppForm
        submit="Guardar organización"
        onSubmit={async (f) => {
          const { institution: _, parentAccountId: __, ...rest } = account;
          await save({
            ...rest,
            ...(str(f, "institution").trim()
              ? { institution: str(f, "institution").trim() }
              : {}),
            ...(account.kind === "credit" && str(f, "parent")
              ? { parentAccountId: str(f, "parent") }
              : {}),
          });
          setSaved(true);
        }}
      >
        <Field label="Banco o entidad">
          <input
            name="institution"
            defaultValue={account.institution ?? ""}
            maxLength={200}
          />
        </Field>
        {account.kind === "credit" && (
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
        {saved && <p role="status">Organización guardada.</p>}
      </AppForm>
    </details>
  );
}

function Settings({
  state,
  summary,
  refresh,
}: {
  state: State;
  summary?: Summary;
  refresh: () => Promise<void>;
}) {
  const [accountKind, setAccountKind] = useState("bank"),
    [token, setToken] = useState("");
  const [devices, setDevices] = useState<
    { id: string; name: string; revoked: boolean }[]
  >([]);
  const [health, setHealth] = useState<{
    pending: { id: string; error?: string; createdAt: string }[];
  }>();
  const [deviceError, setDeviceError] = useState("");
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
            <span className="stat-icon income">
              <Icon name="wallet" />
            </span>
            <div>
              <strong>{a.name}</strong>
              <small>
                {a.kind === "credit"
                  ? "Tarjeta de crédito · deuda"
                  : a.kind === "cash"
                    ? "Efectivo"
                    : "Cuenta bancaria"}
                {a.institution ? ` · ${a.institution}` : ""}
                {a.parentAccountId
                  ? ` · Vinculada a ${state.accounts.find((b) => b.id === a.parentAccountId)?.name ?? "cuenta bancaria"}`
                  : ""}
              </small>
            </div>
            <strong>
              {formatCOP(summary?.balances[a.id] ?? a.openingMinor)}
            </strong>
            <AccountOrganization
              account={a}
              state={state}
              save={(data) => save("/accounts", data)}
            />
          </div>
        ))}
        {!state.accounts.length && (
          <p className="muted">
            Agrega una cuenta bancaria, efectivo o una tarjeta de crédito
            independiente.
          </p>
        )}
      </section>
      <div className="two-columns">
        <section className="panel">
          <h2>Agregar cuenta</h2>
          <AppForm
            onSubmit={(f) =>
              save("/accounts", {
                id: freshId(),
                name: str(f, "name"),
                kind: accountKind,
                openingMinor: amount(f, "opening"),
                openingDate: str(f, "date"),
                eligible: f.get("eligible") === "on",
                ...(str(f, "institution").trim()
                  ? { institution: str(f, "institution").trim() }
                  : {}),
                ...(accountKind === "credit"
                  ? {
                      closingDay: Number(f.get("closing")),
                      dueDay: Number(f.get("due")),
                      ...(str(f, "parentAccountId")
                        ? { parentAccountId: str(f, "parentAccountId") }
                        : {}),
                    }
                  : {}),
              })
            }
          >
            <Field label="Nombre de la cuenta">
              <input
                name="name"
                required
                placeholder="Ahorros, Visa crédito…"
                maxLength={200}
              />
            </Field>
            <Field label="Banco o entidad (opcional)">
              <input
                name="institution"
                placeholder="Bancolombia, Nu…"
                maxLength={200}
              />
            </Field>
            {accountKind === "credit" && (
              <Field label="Cuenta bancaria vinculada (opcional)">
                <select name="parentAccountId" defaultValue="">
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
            <div className="form-grid">
              <Field label="Tipo de cuenta">
                <select
                  value={accountKind}
                  onChange={(e) => setAccountKind(e.target.value)}
                >
                  <option value="bank">Cuenta bancaria</option>
                  <option value="credit">Tarjeta de crédito</option>
                  <option value="cash">Efectivo</option>
                </select>
              </Field>
              <Field
                label={
                  accountKind === "credit"
                    ? "Deuda inicial (COP)"
                    : "Saldo inicial (COP)"
                }
              >
                <input
                  name="opening"
                  required
                  inputMode="decimal"
                  placeholder="0"
                />
              </Field>
              <Field label="Fecha del saldo inicial">
                <input
                  name="date"
                  required
                  type="date"
                  defaultValue={bogotaDate()}
                  max={bogotaDate()}
                />
              </Field>
              {accountKind === "credit" && (
                <>
                  <Field label="Día de corte">
                    <input
                      name="closing"
                      type="number"
                      min="1"
                      max="31"
                      required
                    />
                  </Field>
                  <Field label="Día de pago">
                    <input name="due" type="number" min="1" max="31" required />
                  </Field>
                </>
              )}
            </div>
            {accountKind !== "credit" ? (
              <label className="checkbox">
                <input name="eligible" type="checkbox" defaultChecked /> Incluir
                este saldo en el disponible
              </label>
            ) : (
              <p className="small-note">
                La tarjeta conserva su propia deuda. Vincularla a una cuenta
                solo organiza la vista; puedes dejarla independiente.
              </p>
            )}
            <p className="small-note">
              El saldo inicial debe ser anterior a los movimientos que vas a
              importar.
            </p>
          </AppForm>
        </section>
        <section className="panel">
          <h2>Tu margen de tranquilidad</h2>
          <AppForm
            onSubmit={(f) =>
              save("/settings", {
                payday: Number(f.get("payday")),
                reserveMinor: amount(f, "reserve"),
              })
            }
            key={`${state.settings.payday}-${state.settings.reserveMinor}`}
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
          </AppForm>
          <hr />
          <h2>Nueva categoría</h2>
          <AppForm
            onSubmit={(f) =>
              save("/categories", { id: freshId(), name: str(f, "name") })
            }
          >
            <Field label="Nombre de categoría">
              <input name="name" required maxLength={200} />
            </Field>
          </AppForm>
        </section>
      </div>
      <div className="two-columns">
        <section className="panel">
          <h2>Tarjetas y alias de captura</h2>
          <p className="small-note">
            Una tarjeta débito apunta a su cuenta bancaria; no crea un saldo
            nuevo. Agrega los últimos cuatro dígitos que aparecen en tus SMS,
            por ejemplo los últimos cuatro dígitos visibles en cada mensaje.
            Nunca guardes números completos.
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
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Alias separados por comas">
              <input name="aliases" placeholder="1122, wallet-debito" />
            </Field>
          </AppForm>
          {state.instruments.map((i) => (
            <p key={i.id}>
              <strong>{i.name}</strong> ·{" "}
              {state.accounts.find((a) => a.id === i.accountId)?.kind ===
              "credit"
                ? "Crédito"
                : "Débito"}{" "}
              · {state.accounts.find((a) => a.id === i.accountId)?.name}
              {i.aliases.length ? ` · ${i.aliases.join(", ")}` : ""}
            </p>
          ))}
        </section>
        <section className="panel">
          <h2>Facturas y fechas</h2>
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
        </section>
      </div>
      <section className="panel">
        <h2>Capturas desde tu iPhone</h2>
        <p>
          Crea un token por dispositivo y úsalo en dos automatizaciones de
          Atajos: una recibe el texto del SMS Bancolombia y otra recibe los
          campos de la transacción de Wallet. Las capturas no usan screenshots.
          El token solo permite enviar evidencias.
        </p>
        <AppForm
          submit="Crear token de captura"
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
        {token && (
          <div className="notice">
            <div>
              <strong>Copia el token ahora; no volverá a mostrarse.</strong>
              <code className="token">{token}</code>
              <small>
                Endpoint: {apiURL}/capture-events · Cabecera Authorization:
                Bearer TOKEN
              </small>
              <br />
              <button className="text-button" onClick={() => setToken("")}>
                Ya lo guardé
              </button>
            </div>
          </div>
        )}
        {deviceError && (
          <p className="error" role="alert">
            {deviceError}
          </p>
        )}
        {devices.map((d) => (
          <div className="audit-row" key={d.id}>
            <strong>{d.name}</strong>
            <button
              className="text-button"
              disabled={d.revoked}
              onClick={() =>
                void api(`/devices/${d.id}`, { method: "DELETE" })
                  .then(loadDevices)
                  .catch((e) => setDeviceError(e.message))
              }
            >
              {d.revoked ? "Revocado" : "Revocar"}
            </button>
          </div>
        ))}
        <p className="small-note">
          Los SMS Bancolombia de compra con tarjeta, pago QR, pago desde cuenta
          y transferencia se leen automáticamente. Los campos o destinos que
          falten se envían a Revisión.
        </p>
        <p className="small-note">
          Ambos atajos deben intentar obtener la ubicación actual y enviar
          coordenadas, precisión y hora de captura. Si Localización está
          desactivada o tarda demasiado, el movimiento se envía de todas formas.
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
      </section>
    </>
  );
}
