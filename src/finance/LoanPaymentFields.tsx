import { useState } from "react";
import {
  loanPurposes,
  type State,
  type TransactionInput,
} from "../../domain/model";
import { decimalCOP } from "../../domain/money";
import { Field } from "../design-system/ui";
export function LoanPaymentFields({
  state,
  loanId,
  onLoanChange,
  initial,
}: {
  state: State;
  loanId: string;
  onLoanChange: (id: string) => void;
  initial?: TransactionInput["loanPayment"];
}) {
  const [distributed, setDistributed] = useState(!!initial?.allocation);
  const terms = state.loans.find((l) => l.id === loanId);
  return (
    <fieldset className="loan-payment-fields">
      <legend>Pago de crédito</legend>
      {initial?.documentId && (
        <>
          <p className="small-note">
            Este pago conserva su extracto asociado. Puedes contrastar su
            desglose en Documentos.
          </p>
          <label className="checkbox">
            <input type="checkbox" name="unlinkLoanDocument" /> Desvincular el
            extracto de este pago (queda en el historial)
          </label>
        </>
      )}
      <Field label="Crédito destino">
        <select
          value={loanId}
          onChange={(e) => onLoanChange(e.target.value)}
          required
        >
          {state.accounts
            .filter((a) => a.kind === "loan")
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          <option value="__new_loan__">Crear crédito hipotecario…</option>
        </select>
      </Field>
      {loanId === "__new_loan__" && (
        <Field label="Nombre del nuevo crédito">
          <input name="loanName" required maxLength={200} />
          <small>
            Se creará con el pago. Completa denominación y saldo confirmado en
            Créditos antes de distribuir capital.
          </small>
        </Field>
      )}
      <Field label="Tipo de pago al crédito">
        <select
          name="loanPurpose"
          defaultValue={
            initial?.purpose === "unconfirmed" ? "" : (initial?.purpose ?? "")
          }
          required
        >
          <option value="">Selecciona cómo se aplicó el pago</option>
          {Object.entries(loanPurposes)
            .filter(([key]) => key !== "unconfirmed")
            .map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Vencimiento que cancela (cuota ordinaria o adelanto)">
        <input name="loanDueDate" type="date" defaultValue={initial?.dueDate} />
        <small>
          Asócialo para descontar este pago del próximo compromiso. Un abono
          extraordinario no cancela automáticamente la cuota.
        </small>
      </Field>
      <label className="checkbox">
        <input
          type="checkbox"
          name="allocationConfirmed"
          checked={distributed}
          disabled={!terms}
          onChange={(e) => setDistributed(e.target.checked)}
        />{" "}
        Conozco el desglose confirmado por el banco
      </label>
      <p className="small-note">
        La salida de efectivo se registra una sola vez. Sin desglose, queda
        pendiente confirmar cuánto redujo el capital. Un adelanto de cuotas no
        equivale a un abono extraordinario.
      </p>
      {distributed && terms && (
        <div className="form-grid">
          {(
            [
              ["principalMinor", "Capital"],
              ["interestMinor", "Intereses"],
              ["lateInterestMinor", "Interés de mora"],
              ["insuranceMinor", "Seguros"],
              ["feesMinor", "Otros cargos"],
            ] as const
          ).map(([name, label]) => (
            <Field key={name} label={`${label} del pago (COP)`}>
              <input
                name={name}
                inputMode="decimal"
                required
                defaultValue={decimalCOP(initial?.allocation?.[name] ?? "0")}
              />
            </Field>
          ))}
          {terms.denomination === "UVR" && (
            <>
              <Field label="Capital aplicado (UVR)">
                <input
                  name="principalUnits"
                  inputMode="decimal"
                  defaultValue={initial?.allocation?.principalUnits}
                  required
                />
              </Field>
              <Field label="Valor UVR en fecha de aplicación (COP)">
                <input
                  name="paymentUvrValue"
                  inputMode="decimal"
                  defaultValue={initial?.allocation?.uvrValue}
                  required
                />
                <small>
                  Usa punto decimal, sin separadores de miles. La fecha es la
                  del movimiento.
                </small>
              </Field>
            </>
          )}
        </div>
      )}
    </fieldset>
  );
}
