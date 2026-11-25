import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ApplicationAction,
  ApplicationStatus,
  CreditProductType,
  CustomerStatus,
  CustomerType,
  IssueStatus,
} from '@creditflow/shared';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';
import { IsMoney, trim } from '../../common/validators.js';
import { UserRefDto } from '../customers/customers.dto.js';

// ───────────────────────────── request ─────────────────────────────

export class CreateApplicationDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all', { message: 'Cliente inválido' })
  customerId!: string;

  @ApiProperty({ enum: Object.values(CreditProductType) })
  @IsEnum(CreditProductType, { message: 'Tipo de crédito inválido' })
  productType!: CreditProductType;

  @ApiProperty({ example: '15000.00', description: 'Decimal em string, BRL.' })
  @IsMoney({ positive: true })
  requestedAmount!: string;

  @ApiProperty({ minimum: 1, maximum: 360, example: 24 })
  @IsInt({ message: 'Prazo deve ser um número inteiro de meses' })
  @Min(1)
  @Max(360)
  termMonths!: number;

  @ApiProperty({ example: 'Reforma da residência' })
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Descreva a finalidade' })
  @MaxLength(500)
  purpose!: string;

  @ApiProperty({ example: '6500.00', description: 'Renda (PF) ou faturamento médio (PJ) mensal.' })
  @IsMoney()
  declaredMonthlyIncome!: string;

  @ApiPropertyOptional({ example: '1200.00', nullable: true })
  @IsOptional()
  @IsMoney()
  declaredMonthlyCommitments?: string | null;
}

/** Customer cannot be changed; create a new application instead. */
export class UpdateApplicationDto {
  @ApiProperty({ description: 'Versão lida (controle de concorrência otimista).' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ enum: Object.values(CreditProductType) })
  @IsOptional()
  @IsEnum(CreditProductType)
  productType?: CreditProductType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMoney({ positive: true })
  requestedAmount?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 360 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(360)
  termMonths?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  purpose?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMoney()
  declaredMonthlyIncome?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsMoney()
  declaredMonthlyCommitments?: string | null;
}

export class TransitionDto {
  @ApiPropertyOptional({ description: 'Motivo (obrigatório em cancelamento e reabertura).' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class AssignDto {
  @ApiProperty({ format: 'uuid', description: 'Analista ativo.' })
  @IsUUID('all', { message: 'Analista inválido' })
  assigneeId!: string;
}

export class CreateIssueDto {
  @ApiProperty({ example: 'Enviar extrato bancário dos últimos 3 meses.' })
  @Transform(trim)
  @IsString()
  @MinLength(5, { message: 'Descreva a pendência' })
  @MaxLength(1000)
  description!: string;
}

export class ResolveIssueDto {
  @ApiProperty({ example: 'Extrato recebido e conferido.' })
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Descreva a resolução' })
  @MaxLength(1000)
  resolutionNote!: string;
}

const csv = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : value;

export class ListApplicationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Um ou mais status separados por vírgula',
    example: 'SUBMITTED,UNDER_REVIEW',
  })
  @IsOptional()
  @Transform(csv)
  @IsEnum(ApplicationStatus, { each: true })
  status?: ApplicationStatus[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  customerId?: string;

  @ApiPropertyOptional({ description: 'UUID do responsável, `me` ou `none` (sem responsável)' })
  @IsOptional()
  @Matches(/^(me|none|[0-9a-fA-F-]{36})$/, { message: 'assigneeId inválido' })
  assigneeId?: string;

  @ApiPropertyOptional({ enum: Object.values(CreditProductType) })
  @IsOptional()
  @IsEnum(CreditProductType)
  productType?: CreditProductType;

  @ApiPropertyOptional({ format: 'date', description: 'Criadas a partir de (inclusive)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use AAAA-MM-DD' })
  createdFrom?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Criadas até (inclusive)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use AAAA-MM-DD' })
  createdTo?: string;

  @ApiPropertyOptional({ description: 'Código (CF-AAAA-000123 ou número) ou nome do cliente' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class ListIssuesQueryDto {
  @ApiPropertyOptional({ enum: Object.values(IssueStatus) })
  @IsOptional()
  @IsIn(Object.values(IssueStatus))
  status?: IssueStatus;
}

// ───────────────────────────── response ─────────────────────────────

export class CustomerSummaryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: Object.values(CustomerType) }) type!: CustomerType;
  @ApiProperty() documentNumber!: string;
  @ApiProperty({ enum: Object.values(CustomerStatus) }) status!: CustomerStatus;
}

export class ApplicationDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() number!: number;
  @ApiProperty({ example: 'CF-2026-000123' }) code!: string;
  @ApiProperty({ type: CustomerSummaryDto }) customer!: CustomerSummaryDto;
  @ApiProperty({ enum: Object.values(CreditProductType) }) productType!: CreditProductType;
  @ApiProperty({ example: '15000.00' }) requestedAmount!: string;
  @ApiProperty() termMonths!: number;
  @ApiProperty() purpose!: string;
  @ApiProperty({ example: '6500.00' }) declaredMonthlyIncome!: string;
  @ApiProperty({ type: String, nullable: true }) declaredMonthlyCommitments!: string | null;
  @ApiProperty({ enum: Object.values(ApplicationStatus) }) status!: ApplicationStatus;
  @ApiProperty({ type: UserRefDto, nullable: true }) assignee!: UserRefDto | null;
  @ApiProperty({ type: UserRefDto }) createdBy!: UserRefDto;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) submittedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) decidedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closedAt!: Date | null;
  @ApiProperty() version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
  @ApiProperty({ description: 'Documentos ativos (não removidos)' }) documentCount!: number;
  @ApiProperty() openIssueCount!: number;
  @ApiProperty({
    enum: Object.values(ApplicationAction),
    isArray: true,
    description: 'Ações que o usuário atual pode tentar (status + permissão).',
  })
  availableActions!: ApplicationAction[];
}

export class ApplicationPageDto {
  @ApiProperty({ type: [ApplicationDto] }) data!: ApplicationDto[];
  @ApiProperty({ example: { page: 1, pageSize: 20, total: 30 } })
  meta!: { page: number; pageSize: number; total: number };
}

export class StatusHistoryEntryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: Object.values(ApplicationStatus), nullable: true })
  fromStatus!: ApplicationStatus | null;
  @ApiProperty({ enum: Object.values(ApplicationStatus) }) toStatus!: ApplicationStatus;
  @ApiProperty({ type: UserRefDto }) actor!: UserRefDto;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class IssueDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) applicationId!: string;
  @ApiProperty() description!: string;
  @ApiProperty({ enum: Object.values(IssueStatus) }) status!: IssueStatus;
  @ApiProperty({ type: UserRefDto }) createdBy!: UserRefDto;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: UserRefDto, nullable: true }) resolvedBy!: UserRefDto | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) resolvedAt!: Date | null;
  @ApiProperty({ type: String, nullable: true }) resolutionNote!: string | null;
}
