import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@creditflow/shared';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination.js';
import { PASSWORD_MIN_LENGTH } from '../../infra/security/password.js';
import { PASSWORD_MAX_LENGTH, normalizeEmail } from '../auth/auth.dto.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const toBool = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class UserDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: Object.values(Role) }) role!: Role;
  @ApiProperty() canDecide!: boolean;
  @ApiProperty() mustChangePassword!: boolean;
  @ApiProperty() active!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastLoginAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class UserPageDto {
  @ApiProperty({ type: [UserDto] }) data!: UserDto[];
  @ApiProperty({ example: { page: 1, pageSize: 20, total: 5 } })
  meta!: { page: number; pageSize: number; total: number };
}

export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Busca por nome ou e-mail' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: Object.values(Role) })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  active?: boolean;
}

export class CreateUserDto {
  @ApiProperty({ example: 'novo.analista@creditflow.test' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Informe um e-mail válido' })
  @MaxLength(254)
  email!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Informe o nome' })
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: Object.values(Role) })
  @IsEnum(Role, { message: 'Papel inválido' })
  role!: Role;

  @ApiPropertyOptional({ default: false, description: 'Somente para OPERATOR.' })
  @IsOptional()
  @IsBoolean()
  canDecide?: boolean;

  @ApiProperty({
    format: 'password',
    minLength: PASSWORD_MIN_LENGTH,
    description: 'Senha temporária; o usuário deve trocá-la no primeiro acesso.',
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `A senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  initialPassword!: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: Object.values(Role) })
  @IsOptional()
  @IsEnum(Role, { message: 'Papel inválido' })
  role?: Role;

  @ApiPropertyOptional({ description: 'Somente para OPERATOR.' })
  @IsOptional()
  @IsBoolean()
  canDecide?: boolean;
}

export class ResetPasswordDto {
  @ApiProperty({ format: 'password', minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `A senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  temporaryPassword!: string;
}
