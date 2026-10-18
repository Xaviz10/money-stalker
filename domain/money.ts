import { DomainError } from './model';

export function parseCOP(input: string): string {
  let value = input.trim().replace(/^(COP|\$)\s*/i, '').replace(/\s/g, '');
  if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(value))
    throw new DomainError('Valor COP inválido. Usa 1.234,56 o 1234.');
  const negative = value.startsWith('-');
  value = value.replace(/^[+-]/, '').replaceAll('.', '');
  const [whole, decimal = ''] = value.split(',');
  const result = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, '0'));
  if (result > 99999999999999999n) throw new DomainError('Valor demasiado grande');
  return (negative ? -result : result).toString();
}
export function formatCOP(value: string): string {
  const amount = BigInt(value), abs = amount < 0n ? -amount : amount;
  const whole = new Intl.NumberFormat('es-CO').format(abs / 100n);
  return `${amount < 0n ? '−' : ''}$ ${whole}${abs % 100n ? ',' + (abs % 100n).toString().padStart(2, '0') : ''}`;
}
export const decimalCOP = (value: string) => {
  const n = BigInt(value), a = n < 0n ? -n : n;
  return `${n < 0n ? '-' : ''}${a / 100n},${(a % 100n).toString().padStart(2, '0')}`;
};
export function bogotaDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function nextPayday(today: string, day: number): string {
  const [y, m, d] = today.split('-').map(Number);
  const dateIn = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, new Date(Date.UTC(year, month, 0)).getUTCDate())).padStart(2, '0')}`;
  const current = dateIn(y, m);
  return current > today ? current : dateIn(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1);
}
