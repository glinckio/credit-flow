import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Problems } from './http/app-exception.js';

export const MAX_PAGE_SIZE = 100;

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = 20;

  @ApiPropertyOptional({ description: 'campo:asc|desc, ex.: createdAt:desc' })
  @IsOptional()
  @Matches(/^[a-zA-Z]+:(asc|desc)$/, { message: 'sort deve ter o formato campo:asc|desc' })
  sort?: string;
}

export interface Page<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

export function toSkipTake(q: PaginationQueryDto): { skip: number; take: number } {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

/**
 * Parses `field:dir` against an allow-list so clients cannot order by
 * arbitrary (possibly sensitive or unindexed) columns.
 */
export function parseSort<F extends string>(
  sort: string | undefined,
  allowed: readonly F[],
  fallback: { field: F; direction: 'asc' | 'desc' },
): Record<F, 'asc' | 'desc'> {
  if (!sort) return { [fallback.field]: fallback.direction } as Record<F, 'asc' | 'desc'>;
  const [field, direction] = sort.split(':') as [string, 'asc' | 'desc'];
  if (!(allowed as readonly string[]).includes(field)) {
    throw Problems.businessRule(
      'invalid-sort',
      'Ordenação inválida',
      `Campos permitidos: ${allowed.join(', ')}`,
    );
  }
  return { [field]: direction } as Record<F, 'asc' | 'desc'>;
}

export function page<T>(data: T[], total: number, q: PaginationQueryDto): Page<T> {
  return { data, meta: { page: q.page, pageSize: q.pageSize, total } };
}
