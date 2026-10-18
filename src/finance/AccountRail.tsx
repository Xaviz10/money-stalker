import type { Account, State } from "../../domain/model";
import { groupAccounts, netWorthMinor } from "../../domain/account-groups";
import { formatCOP } from "../../domain/money";
import { Icon } from "../design-system/ui";

export function AccountRail({
  state,
  balances,
  selected,
  onSelect,
}: {
  state: State;
  balances?: Record<string, string>;
  selected?: string;
  onSelect: (id?: string) => void;
}) {
  const groups = groupAccounts(state);
  const row = (a: Account, nested = false) => (
    <button
      type="button"
      className={`rail-account ${selected === a.id ? "selected" : ""} ${nested ? "nested" : ""}`}
      aria-pressed={selected === a.id}
      key={a.id}
      onClick={() => onSelect(a.id)}
    >
      <span className={`rail-account-symbol ${a.kind}`}>
        <Icon
          name={
            a.kind === "credit" ? "card" : a.kind === "cash" ? "wallet" : "bank"
          }
          size={nested ? 17 : 21}
        />
      </span>
      <span className="rail-account-info">
        <strong>{a.name}</strong>
        <small>
          {a.kind === "credit"
            ? "Crédito · deuda"
            : a.kind === "cash"
              ? "Efectivo"
              : "Cuenta bancaria"}
        </small>
        <b>{balances ? formatCOP(balances[a.id] ?? "0") : "—"}</b>
      </span>
      <Icon name="chevron" size={14} />
    </button>
  );
  return (
    <aside className="accounts-rail" aria-label="Tus cuentas y tarjetas">
      <div className="rail-heading">
        <strong>Mis cuentas</strong>
        <a href="#/cuentas" className="rail-add">
          <Icon name="plus" size={15} />
          Agregar
        </a>
      </div>
      <button
        className={`rail-all ${!selected ? "selected" : ""}`}
        onClick={() => onSelect()}
        aria-pressed={!selected}
      >
        <Icon name="overview" size={17} />
        Todas las cuentas
      </button>
      <div className="rail-groups">
        {groups.institutions.map((g) => (
          <details className="institution-group" key={g.id} open>
            <summary>
              <span className="institution-monogram">
                {g.name.slice(0, 1).toLocaleUpperCase("es-CO")}
              </span>
              <strong>{g.name}</strong>
              <Icon name="chevron" size={14} />
            </summary>
            {g.accounts.map(({ account, debitCards, creditCards }) => (
              <div className="bank-family" key={account.id}>
                {row(account)}
                {debitCards.map((i) => (
                  <button
                    key={i.id}
                    className={`rail-instrument ${selected === account.id ? "instrument-selected" : ""}`}
                    onClick={() => onSelect(account.id)}
                  >
                    <Icon name="card" size={15} />
                    <span>
                      {i.name}
                      <small>Débito · usa el saldo de {account.name}</small>
                    </span>
                  </button>
                ))}
                {creditCards.map((c) => row(c, true))}
              </div>
            ))}
          </details>
        ))}
        {groups.standaloneCards.length > 0 && (
          <section className="standalone-cards">
            <h2>Tarjetas independientes</h2>
            {groups.standaloneCards.map((a) => row(a))}
          </section>
        )}
        {groups.cash.length > 0 && (
          <section className="cash-accounts">
            <h2>Efectivo</h2>
            {groups.cash.map((a) => row(a))}
          </section>
        )}
        {!state.accounts.length && (
          <div className="rail-empty">
            <Icon name="wallet" size={29} />
            <p>
              Tu primera cuenta
              <br />
              empieza el rastro.
            </p>
            <small>También puedes agregar solo una tarjeta de crédito.</small>
          </div>
        )}
      </div>
      <div className="rail-worth">
        <span>Patrimonio neto</span>
        <strong>
          {balances ? formatCOP(netWorthMinor(state.accounts, balances)) : "—"}
        </strong>
        <small>Activos menos deuda de tarjetas.</small>
        <a href="#/design-system">
          Design system <Icon name="arrow" size={14} />
        </a>
      </div>
    </aside>
  );
}
