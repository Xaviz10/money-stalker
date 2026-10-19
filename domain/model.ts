import { z } from 'zod';

export const id = z.string().min(1).max(200).regex(/^[\w:.-]+$/);
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v;
}, 'Fecha inválida');
export const minor = z.string().regex(/^(0|[1-9]\d{0,16})$/);
export const positive = minor.refine(v => BigInt(v) > 0n, 'El valor debe ser mayor que cero');
const text = z.string().trim().max(200);
const institutionUrl = z.url({ protocol: /^https$/ }).max(500).refine(value => {
  const parsed = new URL(value);
  return !parsed.username && !parsed.password;
}, 'Usa una URL HTTPS sin credenciales');
const accountImage = z.string().max(14000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/);
const coordinate = z.object({
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
});
export const transactionPlaceSchema = coordinate.extend({
  id: text.min(1), name: text.min(1), address: z.string().trim().max(500).default(''),
});
export const accountSchema = z.object({
  id, name: text.min(1), kind: z.enum(['bank', 'cash', 'credit']), openingMinor: minor,
  openingDate: date, closingDay: z.number().int().min(1).max(31).optional(),
  dueDay: z.number().int().min(1).max(31).optional(), eligible: z.boolean().default(true),
  institution: text.optional(), institutionUrl: institutionUrl.optional(), imageDataUrl: accountImage.optional(),
  parentAccountId: id.optional(),
});
export const instrumentSchema = z.object({ id, name: text.min(1), accountId: id, aliases: z.array(text.min(1)).max(10) });
export const categorySchema = z.object({ id, name: text.min(1) });
export const billSchema = z.object({ id, name: text.min(1), amountMinor: positive, dueDate: date, paidTransactionId: id.optional() });
export const settingsSchema = z.object({ payday: z.number().int().min(1).max(31), reserveMinor: minor });
export const transactionInput = z.object({
  id, accountId: id, counterAccountId: id.optional(), date, amountMinor: positive,
  kind: z.enum(['expense', 'income', 'transfer', 'refund']), merchant: text.default(''),
  categoryId: id.default('uncategorized'), note: z.string().max(1000).default(''), billId: id.optional(),
  status: z.enum(['provisional', 'posted']).default('posted'), reference: text.optional(), place: transactionPlaceSchema.optional(),
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
export type TransactionPlace = z.infer<typeof transactionPlaceSchema>;
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
  aliases: { id: string; merchant: string; categoryId: string; note?: string }[]; settings: Settings;
};
export const defaultCategories: Category[] = [
  { id: 'uncategorized', name: 'Sin categoría' },
  // Keep the existing ID so movements previously classified as food become Mercado.
  { id: 'food', name: 'Mercado' },
  { id: 'restaurants', name: 'Restaurantes' },
  { id: 'car', name: 'Carro' },
  { id: 'delivery', name: 'Domicilios' },
  { id: 'utilities', name: 'Servicios' },
  { id: 'home', name: 'Hogar' },
  { id: 'transport', name: 'Transporte' },
  { id: 'health', name: 'Salud' },
  { id: 'leisure', name: 'Ocio' },
  { id: 'salary', name: 'Salario' },
  { id: 'other', name: 'Otros' },
];
export function normalizeDefaultCategories(state: State) {
  for (const category of defaultCategories) {
    const existing = state.categories.find(c => c.id === category.id);
    if (existing) existing.name = category.name;
    else state.categories.push({ ...category });
  }
}
export function normalizeUnlinkedTransfer(state: State, observation: Observation) {
  const accountIds = new Set(state.accounts.map(account => account.id));
  if (observation.status === 'review' && observation.kind === 'transfer'
    && (!observation.counterAccountId || !accountIds.has(observation.counterAccountId))) {
    observation.kind = 'expense';
    delete observation.counterAccountId;
    observation.reason = 'No se encontró una cuenta propia destino; se tratará como gasto';
  }
}
export function normalizeUnlinkedTransfers(state: State) {
  for (const observation of state.observations) normalizeUnlinkedTransfer(state, observation);
}
export function emptyState(): State {
  return { accounts: [], instruments: [], categories: defaultCategories.map(category => ({ ...category })),
    bills: [], transactions: [], observations: [], audit: [], aliases: [], settings: { payday: 1, reserveMinor: '0' } };
}
export class DomainError extends Error { constructor(message: string, public status = 400) { super(message); } }
export const requireValue = <T>(value: T | undefined, message: string): T => { if (value === undefined) throw new DomainError(message); return value; };
