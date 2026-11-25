import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';
import { trim } from '../../common/validators.js';

export const AUDITED_ENTITY_TYPES = [
  'User',
  'Customer',
  'CreditApplication',
  'CreditDocument',
  'ApplicationIssue',
  'CreditReview',
  'CreditDecision',
] as const;

export class ListAuditEventsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AUDITED_ENTITY_TYPES })
  @IsOptional()
  @IsIn(AUDITED_ENTITY_TYPES)
  entityType?: string;

  @ApiPropertyOptional({ description: 'Id da entidade afetada' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  entityId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  actorId?: string;

  @ApiPropertyOptional({
    description: 'Ação exata (`decision.recorded`) ou prefixo terminado em ponto (`application.`)',
  })
  @IsOptional()
  @Matches(/^[a-z_]+(\.[a-z_]*)?$/, { message: 'Ação inválida' })
  action?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'A partir de (inclusive)' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Use data ISO 8601' })
  from?: string;

  @ApiPropertyOptional({ format: 'date-time', description: 'Até (exclusive)' })
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Use data ISO 8601' })
  to?: string;
}

export class AuditActorDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
}

export class AuditEventDto {
  @ApiProperty({ description: 'Sequencial (string, por ser BIGINT).' }) id!: string;
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt!: Date;
  @ApiProperty({ type: AuditActorDto, nullable: true }) actor!: AuditActorDto | null;
  @ApiProperty() action!: string;
  @ApiProperty() entityType!: string;
  @ApiProperty() entityId!: string;
  @ApiProperty({ type: Object, nullable: true }) before!: unknown;
  @ApiProperty({ type: Object, nullable: true }) after!: unknown;
  @ApiProperty({ type: Object, nullable: true }) metadata!: unknown;
}

export class AuditEventPageDto {
  @ApiProperty({ type: [AuditEventDto] }) data!: AuditEventDto[];
  @ApiProperty({ example: { page: 1, pageSize: 20, total: 286 } })
  meta!: { page: number; pageSize: number; total: number };
}
