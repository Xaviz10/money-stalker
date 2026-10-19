import { useState } from "react";
import {
  Badge,
  Button,
  DisclosureEditor,
  EmptyState,
  Eyes,
  Field,
  Icon,
  Panel,
} from "./ui";
import { CategoryIcon } from "../finance/CategoryIcon";
const swatches = [
  ["Primary", "--color-primary"],
  ["Account rail", "--color-rail"],
  ["Ink", "--color-ink"],
  ["Canvas", "--color-canvas"],
  ["Available funds", "--color-citron"],
  ["Success", "--color-success"],
  ["Warning", "--color-warning"],
  ["Error", "--color-danger"],
];
export function DesignSystem() {
  const [notice, setNotice] = useState("");
  return (
    <div className="design-catalog">
      <Panel title="Accounts first">
        <div className="catalog-brand">
          <span className="brand-mark">
            <Eyes />
          </span>
          <strong>money stalker.</strong>
        </div>
        <p>
          Cuentas primero. Cifras claras. Un cómplice curioso para seguir cada
          peso.
        </p>
        <p>
          La misma base visual para el resumen, la revisión y las próximas
          pantallas.
        </p>
        <a className="text-link" href="#/resumen">
          Volver al resumen <Icon name="arrow" size={16} />
        </a>
      </Panel>
      <Panel title="Color">
        <div className="token-swatches">
          {swatches.map(([name, token]) => (
            <div key={token}>
              <span style={{ background: `var(${token})` }} />
              <strong>{name}</strong>
              <code>{token}</code>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Typography">
        <div className="type-specimen">
          <strong>Cada peso, localizado.</strong>
          <h2>Tus cuentas y tus tarjetas.</h2>
          <p>
            Inter variable, alojada en la aplicación. Jerarquía fija y números
            tabulares para comparar montos.
          </p>
          <b>
            $ 7.250.000 <span>COP · ejemplo</span>
          </b>
        </div>
      </Panel>
      <Panel title="Buttons and states">
        <div className="catalog-row">
          <Button onClick={() => setNotice("Acción de ejemplo confirmada.")}>
            <Icon name="plus" size={17} />
            Primary action
          </Button>
          <Button
            variant="secondary"
            onClick={() => setNotice("Acción secundaria de ejemplo.")}
          >
            Secondary
          </Button>
          <Button
            variant="quiet"
            onClick={() => setNotice("Acción discreta de ejemplo.")}
          >
            Quiet
          </Button>
          <Button disabled>Disabled</Button>
          <Button disabled>Guardando…</Button>
        </div>
        {notice && (
          <p className="action-notice" role="status">
            {notice}
          </p>
        )}
        <div className="catalog-row">
          <Badge tone="blue">Selected</Badge>
          <Badge tone="success">Registrado</Badge>
          <Badge tone="warning">Por confirmar</Badge>
          <Badge tone="danger">Requiere revisión</Badge>
        </div>
      </Panel>
      <Panel title="Inputs">
        <div className="form-grid">
          <label className="field">
            <span>Account name · example</span>
            <input placeholder="Ahorros" />
          </label>
          <label className="field">
            <span>Account type · example</span>
            <select defaultValue="bank">
              <option value="bank">Cuenta bancaria</option>
              <option value="credit">Tarjeta de crédito</option>
            </select>
          </label>
        </div>
      </Panel>
      <Panel title="Bank and card hierarchy">
        <div className="catalog-hierarchy">
          <strong>Bancolombia</strong>
          <div>
            <Icon name="bank" />
            Ahorros <Badge tone="blue">Saldo de efectivo</Badge>
          </div>
          <div className="hierarchy-child">
            <Icon name="card" />
            Visa débito <small>Usa el saldo de Ahorros</small>
          </div>
          <div className="hierarchy-child">
            <Icon name="card" />
            Mastercard crédito <small>Deuda separada</small>
          </div>
          <strong>Tarjetas independientes</strong>
          <div>
            <Icon name="card" />
            Nu crédito <small>No requiere cuenta bancaria</small>
          </div>
        </div>
        <p className="small-note">
          Estructura de ejemplo. El diseño agrupa; los saldos se calculan una
          sola vez.
        </p>
      </Panel>
      <Panel title="Product and category symbols">
        <div className="catalog-symbol-grid">
          {[
            ["food", "Mercado"],
            ["restaurants", "Restaurantes"],
            ["car", "Carro"],
            ["delivery", "Domicilios"],
            ["utilities", "Servicios"],
            ["home", "Hogar"],
            ["transport", "Transporte"],
            ["health", "Salud"],
            ["leisure", "Ocio"],
            ["other", "Otros"],
          ].map(([id, label]) => (
            <span key={id}>
              <CategoryIcon categoryId={id} size={18} />
              {label}
            </span>
          ))}
        </div>
        <p className="small-note">
          Las cuentas bancarias pueden usar el favicon de una URL HTTPS. Las
          tarjetas conservan el símbolo de tarjeta; una imagen privada subida
          por el usuario reemplaza ambos.
        </p>
      </Panel>
      <Panel title="Inline settings editor">
        <div className="account-row">
          <span className="stat-icon">
            <Icon name="card" />
          </span>
          <div>
            <strong>Visa crédito</strong>
            <small>Crédito · cuenta principal · •8645</small>
          </div>
          <DisclosureEditor
            label="Editar tarjeta"
            className="instrument-editor"
          >
            <div className="form">
              <Field label="Nombre de tarjeta">
                <input defaultValue="Visa crédito" />
              </Field>
              <Button
                type="button"
                onClick={() => setNotice("Ejemplo guardado.")}
              >
                Guardar cambios
              </Button>
            </div>
          </DisclosureEditor>
        </div>
      </Panel>
      <Panel title="Empty states">
        <EmptyState
          title="Tu primera pista está por llegar."
          action={
            <a className="button secondary" href="#/cuentas">
              Agregar cuenta <Icon name="arrow" size={16} />
            </a>
          }
        >
          Explica el siguiente paso, antes de añadir personalidad.
        </EmptyState>
      </Panel>
    </div>
  );
}
