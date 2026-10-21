import { loanBalance } from '../../domain/loans';
import { bogotaDate } from '../../domain/money';
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { accountKindLabels, type Account, type State } from "../../domain/model";
import { groupAccounts } from "../../domain/account-groups";
import { formatCOP } from "../../domain/money";
import { Icon, Eyes, EvidenceTrail } from "../design-system/ui";
import { AccountArtwork } from "./AccountArtwork";

export function AccountRail({
  state,
  balances,
  availableMinor,
  availableIncomplete = false,
  stale = false,
  selected,
  onSelect,
  allowAll = true,
  collapsed = false,
  onToggleCollapsed,
}: {
  state: State;
  balances?: Record<string, string>;
  availableMinor?: string;
  availableIncomplete?: boolean;
  stale?: boolean;
  selected?: string;
  onSelect: (id?: string) => void;
  allowAll?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const groups = groupAccounts(state);
  const tooltipId = useId();
  const [tooltip, setTooltip] = useState<{ id: string; label: string; top: number }>();
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keepTooltip = () => clearTimeout(hideTimer.current);
  const hideTooltip = () => {
    keepTooltip();
    hideTimer.current = setTimeout(() => setTooltip(undefined), 120);
  };
  const showTooltip = (element: HTMLElement, account: Account) => {
    keepTooltip();
    if (!collapsed || window.innerWidth <= 850) return;
    const rect = element.getBoundingClientRect();
    setTooltip({ id: account.id, label: `${account.name} · ${accountKindLabels[account.kind]}`,
      top: Math.max(80, Math.min(rect.top + rect.height / 2, window.innerHeight - 80)) });
  };
  useEffect(() => {
    setTooltip(undefined);
    return () => clearTimeout(hideTimer.current);
  }, [collapsed]);
  useEffect(() => {
    const dismiss = () => setTooltip(undefined);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, []);
  const row = (a: Account, nested = false) => (
    <button
      type="button"
      className={`rail-account ${selected === a.id ? "selected" : ""} ${nested ? "nested" : ""}`}
      title={collapsed ? undefined : `${a.name} · ${accountKindLabels[a.kind]}`}
      aria-describedby={collapsed && tooltip?.id === a.id ? tooltipId : undefined}
      onFocus={(event) => showTooltip(event.currentTarget, a)}
      onBlur={hideTooltip}
      onMouseEnter={(event) => showTooltip(event.currentTarget, a)}
      onMouseLeave={(event) => { if (document.activeElement !== event.currentTarget) hideTooltip(); }}
      aria-label={`${a.name} · ${accountKindLabels[a.kind]}`}
      aria-pressed={selected === a.id}
      key={a.id}
      onClick={() => { setTooltip(undefined); onSelect(a.id); }}
    >
      <span className={`rail-account-symbol ${a.kind}`}>
        <AccountArtwork account={a} size={nested ? 17 : 21} />
      </span>
      <span className="rail-account-info">
        <strong>{a.name}</strong>
        <small>
          {a.kind === "credit"
            ? "Crédito · deuda"
            : accountKindLabels[a.kind]}
        </small>
        <b>{a.kind === "loan" && !loanBalance(state, a.id, bogotaDate()).known ? "Sin confirmar" : balances ? formatCOP(balances[a.id] ?? "0") : "—"}</b>
      </span>
      <Icon name="chevron" size={14} />
    </button>
  );
  return (
    <aside className="accounts-rail" aria-label="Tus cuentas y tarjetas"
      onKeyDown={(event) => { if (event.key === "Escape") { keepTooltip(); setTooltip(undefined); } }}>
      {collapsed && tooltip && createPortal(
        <div className="rail-product-tooltip" style={{ top: tooltip.top }}
          onMouseEnter={keepTooltip} onMouseLeave={hideTooltip}>
          <span role="tooltip" id={tooltipId}>{tooltip.label}</span>
        </div>, document.body)}
      <div className="rail-heading">
        <strong>Mis cuentas</strong>
        <button type="button" className="rail-collapse-toggle" onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expandir menú de cuentas" : "Contraer menú de cuentas"}
          title={collapsed ? "Expandir menú de cuentas" : "Contraer menú de cuentas"}
          aria-expanded={!collapsed}>
          <Icon name="chevron" size={18} />
        </button>
        <a href="#/cuentas" className="rail-add">
          <Icon name="plus" size={15} />
          Agregar
        </a>
      </div>
      {allowAll && (
        <button
          className={`rail-all ${!selected ? "selected" : ""}`}
          onClick={() => onSelect()}
          title="Todas las cuentas"
          aria-label="Todas las cuentas"
          aria-pressed={!selected}
        >
          <Icon name="overview" size={17} />
          <span>Todas las cuentas</span>
        </button>
      )}
      <div className="rail-groups">
        {groups.institutions.map((g) => (
          <details className="institution-group" key={`${g.id}-${collapsed}`} open>
            <summary>
              <span className="institution-monogram">
                <AccountArtwork account={g.accounts[0].account} size={15} />
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
        {groups.pockets.length > 0 && <section className="pocket-accounts"><h2>Bolsillos</h2>{groups.pockets.map(account => row(account))}</section>}
        {groups.investments.length > 0 && <section className="investment-accounts"><h2>Inversiones</h2>{groups.investments.map(account => row(account))}</section>}
        {groups.loans.length > 0 && <section className="loan-accounts"><h2>Créditos</h2>{groups.loans.map(account => row(account))}</section>}
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
      <div className="rail-companion" aria-hidden="true"><EvidenceTrail variant="holdings" /><Eyes /></div>
      <section className="rail-worth" aria-label="Disponible total de todas las cuentas">
        <span>Disponible total</span>
        <strong>
          {availableMinor === undefined ? "—" : formatCOP(availableMinor)}
        </strong>
        <small>{stale ? "Última consulta · datos sin actualizar." : availableIncomplete ? "Datos incompletos. Revisa tus pistas." : "Después de compromisos y reserva."}</small>
      </section>
    </aside>
  );
}
