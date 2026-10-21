import { z } from "zod";
import { date, id, minor } from "./model";
export const decimal = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,16})(\.\d{1,8})?$/,
    "Usa un decimal positivo con punto y hasta ocho decimales",
  );
const rate = decimal.refine(
  (v) => Number(v) <= 100,
  "La tasa no puede superar 100%",
);
export const loanTermsSchema = z
  .object({
    id,
    revision: z.number().int().min(0).default(0),
    denomination: z.enum(["COP", "UVR"]),
    principal: decimal.optional(),
    balanceDate: date.optional(),
    ratePercent: rate.optional(),
    rateConvention: z
      .enum(["effectiveAnnual", "effectiveMonthly"])
      .default("effectiveAnnual"),
    method: z.enum(["constant", "unsupported"]).default("constant"),
    dayCount: z.enum(["monthly", "other"]).default("monthly"),
    remainingMonths: z.number().int().min(1).max(600).optional(),
    nextPaymentDate: date.optional(),
    uvrValue: decimal.refine((v) => Number(v) > 0).optional(),
    uvrDate: date.optional(),
    insuranceMinor: minor.optional(),
    feesMinor: minor.optional(),
    subsidy: z
      .object({
        ratePercent: rate,
        startDate: date.optional(),
        endDate: date.optional(),
        convention: z
          .enum(["effectiveAnnual", "effectiveMonthly"])
          .default("effectiveAnnual"),
      })
      .optional(),
    nextDueMinor: minor.optional(),
    notes: z.string().max(1000).default(""),
  })
  .refine((v) => !v.principal || !!v.balanceDate, {
    message: "Indica la fecha del saldo",
    path: ["balanceDate"],
  })
  .refine(
    (v) =>
      !v.subsidy?.endDate ||
      !v.subsidy.startDate ||
      v.subsidy.endDate >= v.subsidy.startDate,
    {
      message: "El fin del subsidio debe ser posterior a su inicio",
      path: ["subsidy"],
    },
  );
export type LoanTerms = z.infer<typeof loanTermsSchema>;
export const loanSnapshotSchema = z.object({
  id,
  loanId: id,
  date,
  principal: decimal,
  reason: z.string().trim().min(1).max(1000),
  documentId: id.optional(),
  uvrValue: decimal.refine((v) => Number(v) > 0).optional(),
  uvrDate: date.optional(),
  remainingMonths: z.number().int().min(0).max(600).optional(),
  nextPaymentDate: date.optional(),
  nextDueMinor: minor.optional(),
});
export type LoanSnapshot = z.infer<typeof loanSnapshotSchema> & {
  at: string;
  sequence: number;
  beforePrincipal: string;
  difference: string;
  voided?: boolean;
  requestSignature: string;
};
export type LoanDocumentRow = {
  id: string;
  row: number;
  section: "history" | "projection" | "subsidy";
  date?: string;
  description: string;
  principal?: string;
  openingPrincipal?: string;
  uvrValue?: string;
  subsidyUnits?: string;
  closingPrincipal?: string;
  interest?: string;
  totalMinor?: string;
  allocation?: {
    principalMinor: string;
    interestMinor: string;
    lateInterestMinor: string;
    insuranceMinor: string;
    feesMinor: string;
  };
  roundingDifferenceMinor?: string;
  signature: string;
};
export type LoanDocument = {
  id: string;
  loanId: string;
  hash: string;
  filename: string;
  originalKey: string;
  normalizedKey: string;
  profile: "mortgage-monthly" | "mortgage-annual";
  status: "preview" | "confirmed";
  importedAt: string;
  confirmedAt?: string;
  period?: string;
  terms: Partial<LoanTerms> & { subsidyRateHint?: string };
  rows: LoanDocumentRow[];
  warnings: string[];
  comparisonIds: string[];
  overlapIds: string[];
  requestSignature?: string;
};
export const loanScenarioSchema = z.object({
  id,
  expectedRevision: z.number().int().min(0).optional(),
  expectedSignature: z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .optional(),
  loanId: id,
  name: z.string().trim().min(1).max(100),
  asOf: date,
  extraMinor: minor.default("0"),
  extraDate: date,
  recurringMinor: minor.default("0"),
  recurringStart: date.optional(),
  recurringEnd: date.optional(),
  monthlyBudgetMinor: minor.optional(),
  keepBudget: z.boolean().default(false),
  inflationPercent: z
    .string()
    .regex(/^-?\d{1,2}(\.\d{1,6})?$/)
    .refine((v) => Number(v) > -100 && Number(v) <= 50)
    .default("3"),
});
export type LoanScenarioInput = z.infer<typeof loanScenarioSchema>;
export type LoanScenario = LoanScenarioInput & {
  signature: string;
  at: string;
  revision: number;
};
export type UvrQuote = {
  date: string;
  value: string;
  fetchedAt: string;
  source: string;
};
