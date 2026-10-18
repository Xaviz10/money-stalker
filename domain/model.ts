import { z } from 'zod';

export const id = z.string().min(1).max(200).regex(/^[\w:.-]+$/);
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
}, 'Fecha inválida');
export const minor = z.string().regex(/^(0|[1-9]\d{0,16})$/);
export const positive = minor.refine(v => BigInt(v) > 0n, 'El valor debe ser mayor que cero');
const text = z.string().trim().max(200);
export const accountSchema = z.object({
  id, name: text.min(1), kind: z.enum(['bank', 'cash', 'credit']), openingMinor: minor,
  openingDate: date, closingDay: z.number().int().min(1).max(31).optional(),
  dueDay: z.number().int().min(1).max(31).optional(), eligible: z.boolean().default(true),
  institution: text.optional(), parentAccountId: id.optional(),
});
export const instrumentSchema = z.object({ id, name: text.min(1), accountId: id, aliases: z.array(text.min(1)).max(10) });
export const categorySchema = z.object({ id, name: text.min(1) });
export const billSchema = z.object({ id, name: text.min(1), amountMinor: positive, dueDate: date, paidTransactionId: id.optional() });
export const settingsSchema = z.object({ payday: z.number().int().min(1).max(31), reserveMinor: minor });
export const transactionInput = z.object({
  id, accountId: id, counterAccountId: id.optional(), date, amountMinor: positive,
  kind: z.enum(['expense', 'income', 'transfer', 'refund']), merchant: text.default(''),
  categoryId: id.default('uncategorized'), note: z.string().max(1000).default(''), billId: id.optional(),
  status: z.enum(['provisional', 'posted']).default('posted'), reference: text.optional(),
});
export const captureSchema = z.object({
  eventId: id, source: z.enum(['sms', 'wallet']), observedAt: z.iso.datetime({ offset: true }),
  instrumentHint: text.optional(), accountId: id.optional(), amountMinor: positive.optional(),
  currency: z.literal('COP').default('COP'), date: date.optional(),
  merchant: text.default(''), kind: z.enum(['expense', 'income', 'transfer', 'refund']).default('expense'),
  counterAccountId: id.optional(), reference: text.optional(), message: z.string().max(3000).optional(),
  location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0), observedAt: z.iso.datetime({ offset: true }) }).optional(),
}).strict();
export type Account = z.infer<typeof accountSchema>;
export type Instrument = z.infer<typeof instrumentSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Bill = z.infer<typeof billSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type TransactionInput = z.infer<typeof transactionInput>;
export type Capture = z.infer<typeof captureSchema>;
export type Entry = { accountId: string; debitMinor: string; creditMinor: string };
export type Transaction = TransactionInput & { entries: Entry[]; observationIds: string[]; revision: number; voided?: boolean; requestSignature?: string };
export type Observation = {
  id: string; source: 'sms' | 'wallet' | 'statement'; observedAt: string; receivedAt: string;
  date?: string; accountId?: string; amountMinor?: string; currency: 'COP'; merchant: string;
  kind: TransactionInput['kind']; counterAccountId?: string; reference?: string;
  status: 'review' | 'linked' | 'ignored'; transactionId?: string; candidates: string[]; reason?: string;
  location?: Capture['location']; parserVersion: string;
};
export type Audit = { id: string; at: string; action: string; transactionId?: string;
  beforeTransaction?: Transaction; beforeObservation?: Observation; expectedRevision?: number; undone?: boolean };
export type State = {
  accounts: Account[]; instruments: Instrument[]; categories: Category[]; bills: Bill[];
  transactions: Transaction[]; observations: Observation[]; audit: Audit[];
  aliases: { id: string; merchant: string; categoryId: string }[]; settings: Settings;
};
export function emptyState(): State {
  return { accounts: [], instruments: [], categories: [
    { id: 'uncategorized', name: 'Sin categoría' }, { id: 'food', name: 'Alimentación' },
    { id: 'home', name: 'Hogar' }, { id: 'transport', name: 'Transporte' },
    { id: 'health', name: 'Salud' }, { id: 'leisure', name: 'Ocio' }, { id: 'other', name: 'Otros' },
  ], bills: [], transactions: [], observations: [], audit: [], aliases: [], settings: { payday: 1, reserveMinor: '0' } };
}
export class DomainError extends Error { constructor(message: string, public status = 400) { super(message); } }
export const requireValue = <T>(value: T | undefined, message: string): T => { if (value === undefined) throw new DomainError(message); return value; };
