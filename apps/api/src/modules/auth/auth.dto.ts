import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../../infra/security/password.js';

export const PASSWORD_MAX_LENGTH = 128;

export const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class LoginDto {
  @ApiProperty({ example: 'operador@creditflow.test' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'Informe um e-mail válido' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(1, { message: 'Informe a senha' })
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(1, { message: 'Informe a senha atual' })
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @ApiProperty({ format: 'password', minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `A nova senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres`,
  })
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword!: string;
}
