import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BRAZILIAN_STATES,
  CustomerStatus,
  CustomerType,
  isValidPhone,
  isValidZipCode,
  onlyDigits,
} from '@creditflow/shared';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  ValidationArguments,
  registerDecorator,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';
import { normalizeEmail } from '../auth/auth.dto.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const digits = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? onlyDigits(value) : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : trim({ value });

function Satisfies(check: (value: string) => boolean, message: string) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      target: target.constructor,
      propertyName,
      options: { message },
      validator: {
        validate: (value: unknown, _args: ValidationArguments) =>
          typeof value === 'string' && check(value),
      },
    });
}

// ───────────────────────────── request ─────────────────────────────

export class AddressDto {
  @ApiProperty({ example: 'Rua das Flores' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Informe o logradouro' })
  @MaxLength(200)
  street!: string;

  @ApiProperty({ example: '123' })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Informe o número' })
  @MaxLength(20)
  number!: string;

  @ApiPropertyOptional({ example: 'Apto 12' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(100)
  complement?: string;

  @ApiProperty({ example: 'Centro' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Informe o bairro' })
  @MaxLength(100)
  district!: string;

  @ApiProperty({ example: 'São Paulo' })
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Informe a cidade' })
  @MaxLength(100)
  city!: string;

  @ApiProperty({ enum: BRAZILIAN_STATES, example: 'SP' })
  @Transform(upper)
  @IsIn(BRAZILIAN_STATES, { message: 'UF inválida' })
  state!: string;

  @ApiProperty({ example: '01310100', description: 'CEP; pontuação é removida.' })
  @Transform(digits)
  @Satisfies(isValidZipCode, 'CEP deve ter 8 dígitos')
  zipCode!: string;
}

export class CreateCustomerDto {
  @ApiProperty({ enum: Object.values(CustomerType) })
  @IsEnum(CustomerType, { message: 'Tipo de cliente inválido' })
  type!: CustomerType;

  @ApiProperty({ description: 'Nome completo (PF) ou razão social (PJ)' })
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Informe o nome completo ou a razão social' })
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    description: 'CPF (PF) ou CNPJ (PJ), com ou sem pontuação. Validado por dígito verificador.',
    example: '123.456.789-09',
  })
  @Transform(digits)
  @Matches(/^(\d{11}|\d{14})$/, { message: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos)' })
  documentNumber!: string;

  @ApiProperty({ example: 'cliente@exemplo.test' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Informe um e-mail válido' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: '+55 11 90000-0001' })
  @Transform(trim)
  @IsString()
  @MaxLength(25)
  @Satisfies(isValidPhone, 'Telefone deve ter DDD e número (10 a 13 dígitos)')
  phone!: string;

  @ApiProperty({
    format: 'date',
    example: '1990-05-17',
    description: 'Nascimento (PF) ou constituição (PJ)',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use o formato AAAA-MM-DD' })
  birthOrFoundationDate!: string;

  @ApiProperty({ type: AddressDto })
  @ValidateNested()
  @Type(() => AddressDto)
  address!: AddressDto;
}

/**
 * `type` and `documentNumber` are immutable after creation and therefore not
 * accepted here (unknown properties are rejected with 400).
 */
export class UpdateCustomerDto {
  @ApiProperty({ description: 'Versão lida pelo cliente (controle de concorrência otimista).' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Informe um e-mail válido' })
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(25)
  @Satisfies(isValidPhone, 'Telefone deve ter DDD e número (10 a 13 dígitos)')
  phone?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use o formato AAAA-MM-DD' })
  birthOrFoundationDate?: string;

  @ApiPropertyOptional({ type: AddressDto, description: 'Substitui o endereço inteiro.' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @ApiPropertyOptional({ enum: Object.values(CustomerStatus) })
  @IsOptional()
  @IsEnum(CustomerStatus, { message: 'Status inválido' })
  status?: CustomerStatus;
}

export class ListCustomersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Nome (contém) ou CPF/CNPJ (começa com, só dígitos)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: Object.values(CustomerType) })
  @IsOptional()
  @IsEnum(CustomerType)
  type?: CustomerType;

  @ApiPropertyOptional({ enum: Object.values(CustomerStatus) })
  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;
}

// ───────────────────────────── response ─────────────────────────────

export class AddressResponseDto {
  @ApiProperty() street!: string;
  @ApiProperty() number!: string;
  @ApiProperty({ type: String, nullable: true }) complement!: string | null;
  @ApiProperty() district!: string;
  @ApiProperty() city!: string;
  @ApiProperty() state!: string;
  @ApiProperty() zipCode!: string;
}

export class UserRefDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class CustomerDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: Object.values(CustomerType) }) type!: CustomerType;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Somente dígitos' }) documentNumber!: string;
  @ApiProperty() email!: string;
  @ApiProperty() phone!: string;
  @ApiProperty({ format: 'date' }) birthOrFoundationDate!: string;
  @ApiProperty({ type: AddressResponseDto }) address!: AddressResponseDto;
  @ApiProperty({ enum: Object.values(CustomerStatus) }) status!: CustomerStatus;
  @ApiProperty() version!: number;
  @ApiProperty({ type: UserRefDto }) createdBy!: UserRefDto;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class CustomerPageDto {
  @ApiProperty({ type: [CustomerDto] }) data!: CustomerDto[];
  @ApiProperty({ example: { page: 1, pageSize: 20, total: 20 } })
  meta!: { page: number; pageSize: number; total: number };
}
