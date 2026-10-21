// Local, read-only comparison. Never writes original values or files to the repository.
import { readFileSync } from "node:fs";
import { parseLoanDocument } from "../server/loan-imports";
import { emptyState } from "../domain/model";
import { configure } from "../domain/ledger";
import { saveLoanTerms, simulateLoan, loanDecimal as D } from "../domain/loans";
const args = process.argv.slice(2);
const option = (key: string) => args[args.indexOf(key) + 1];
if (
  !args.includes("--projection") ||
  !args.includes("--rate") ||
  !args.includes("--remaining") ||
  !args.includes("--balance-date")
)
  throw new Error(
    "Usage: npm run validate:loan -- --projection <private.xlsx> --rate <effective-annual-percent> --remaining <months> --balance-date <yyyy-mm-dd> [--subsidy-rate <effective-annual-percent> --subsidy-start <date> --subsidy-end <date>]",
  );
const now = new Date().toISOString();
const doc = parseLoanDocument(readFileSync(option("--projection")), {
  id: "local-validation",
  loanId: "loan",
  filename: "redacted.xlsx",
  originalKey: "local-only",
  normalizedKey: "local-only",
  importedAt: now,
  comparisonIds: [],
});
if (doc.terms.denomination !== "UVR")
  throw new Error(
    "This private comparison currently validates native UVR schedules; obtain independent lender COP schedules separately.",
  );
const reference = doc.rows.filter(
  (r) =>
    r.section === "projection" &&
    r.openingPrincipal &&
    r.uvrValue &&
    new D(r.principal ?? "0").gt(0),
);
if (reference.length < 2)
  throw new Error("At least two lender projection periods are required.");
const first = reference[0],
  s = emptyState();
configure(s, "accounts", {
  id: "loan",
  kind: "loan",
  name: "Private local validation",
  openingMinor: "0",
  openingDate: option("--balance-date"),
});
saveLoanTerms(
  s,
  {
    id: "loan",
    denomination: "UVR",
    principal: first.openingPrincipal,
    balanceDate: option("--balance-date"),
    ratePercent: option("--rate"),
    remainingMonths: Number(option("--remaining")),
    nextPaymentDate: first.date,
    insuranceMinor: "0",
    feesMinor: "0",
    uvrValue: first.uvrValue,
    uvrDate: option("--balance-date"),
    ...(args.includes("--subsidy-rate")
      ? {
          subsidy: {
            ratePercent: option("--subsidy-rate"),
            startDate: option("--subsidy-start"),
            endDate: option("--subsidy-end"),
            convention: "effectiveAnnual",
          },
        }
      : {}),
  },
  now,
);
const result = simulateLoan(s, {
  id: "comparison",
  loanId: "loan",
  name: "Local native-unit comparison",
  asOf: option("--balance-date"),
  extraMinor: "0",
  extraDate: first.date,
  recurringMinor: "0",
  inflationPercent: "0",
}).schedules[0];
const checks = reference.slice(0, 2).map((expected, index) => {
  const actual = result.rows[index],
    principalError = new D(actual.principal).minus(expected.principal!).abs(),
    balanceError = new D(actual.closingPrincipal)
      .minus(expected.closingPrincipal!)
      .abs();
  return {
    period: index + 1,
    principalErrorUVR: principalError.toFixed(4),
    closingBalanceErrorUVR: balanceError.toFixed(4),
    withinRoundedRateComparison:
      principalError.lte("0.05") && balanceError.lte("0.10"),
  };
});
console.log(
  JSON.stringify(
    {
      denomination: "UVR",
      periodsChecked: checks.length,
      checks,
      exactContractValidation: false,
      limitation:
        "Approximate monthly comparison using rounded published rates. This does not validate daily accrual, early-payment benefits, full subsidy eligibility, insurance repricing or official future COP values.",
    },
    null,
    2,
  ),
);
if (checks.some((c) => !c.withinRoundedRateComparison)) process.exitCode = 1;
