import { formatCnpj, formatCpf, onlyDigits } from '@creditflow/shared';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** "15000.50" (API decimal string) → "R$ 15.000,50". */
export function formatBRL(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return brl.format(Number(value));
}

/** Calendar date "1990-05-17" → "17/05/1990" (no timezone shift). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return dateFmt.format(new Date(value.length === 10 ? `${value}T00:00:00Z` : value));
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? dateTimeFmt.format(new Date(value)) : '—';
}

export function formatDocument(digits: string): string {
  return digits.length === 14 ? formatCnpj(digits) : formatCpf(digits);
}

// ───────────────────────────── input masks ─────────────────────────────

function applyPattern(digits: string, pattern: string): string {
  let out = '';
  let i = 0;
  for (const ch of pattern) {
    if (i >= digits.length) break;
    if (ch === '#') out += digits[i++];
    else out += ch;
  }
  return out;
}

export function maskCpf(value: string): string {
  return applyPattern(onlyDigits(value).slice(0, 11), '###.###.###-##');
}

export function maskCnpj(value: string): string {
  return applyPattern(onlyDigits(value).slice(0, 14), '##.###.###/####-##');
}

export function maskCep(value: string): string {
  return applyPattern(onlyDigits(value).slice(0, 8), '#####-###');
}

/** (11) 91234-5678 or (11) 3333-4444; keeps a leading +55 if typed. */
export function maskPhone(value: string): string {
  const raw = value.trim();
  let digits = onlyDigits(raw);
  const withCountry = raw.startsWith('+') || digits.length > 11;
  const prefix = withCountry && digits.startsWith('55') ? '+55 ' : '';
  if (prefix) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  const pattern = digits.length > 10 ? '(##) #####-####' : '(##) ####-####';
  return prefix + applyPattern(digits, pattern);
}

/**
 * Parses a BRL amount typed by a person ("15.000,50", "15000,5", "15000.50")
 * into the API's decimal string ("15000.50"). Returns null when not a number.
 */
export function parseMoneyInput(value: string): string | null {
  const v = value.replace(/[R$\s]/g, '');
  if (!v) return null;
  let normalized: string;
  if (v.includes(',')) {
    normalized = v.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(v)) {
    normalized = v.replace(/\./g, ''); // "15.000" is fifteen thousand in pt-BR
  } else {
    normalized = v;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [int, frac = ''] = normalized.split('.');
  return `${BigInt(int!).toString()}.${frac.padEnd(2, '0')}`;
}

/** API decimal string → value shown in a money input ("15000.50" → "15.000,50"). */
export function moneyToInput(value: string | null | undefined): string {
  if (!value) return '';
  return Number(value).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
