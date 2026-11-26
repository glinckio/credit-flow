import { formatBRL } from '@/lib/format';
import type { Indicator } from './analysis-api';

export function formatIndicator(i: Indicator): string {
  if (i.value === null) return 'Não calculável (renda declarada igual a zero)';
  if (i.unit === 'BRL') return formatBRL(i.value);
  if (i.unit === 'ratio') {
    return `${(Number(i.value) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  }
  return `${Number(i.value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} meses`;
}
