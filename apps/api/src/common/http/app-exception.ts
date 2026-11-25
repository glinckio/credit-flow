import { HttpException, HttpStatus } from '@nestjs/common';

export interface FieldError {
  field: string;
  messages: string[];
}

/**
 * Domain error rendered as RFC 9457 Problem Details. `code` becomes the
 * problem `type` (`/problems/<code>`), so clients can branch on it.
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: FieldError[],
  ) {
    super({ code, title, detail, errors }, status);
  }
}

export const Problems = {
  unauthenticated: () =>
    new AppException(HttpStatus.UNAUTHORIZED, 'unauthenticated', 'Autenticação necessária'),
  invalidCredentials: () =>
    new AppException(HttpStatus.UNAUTHORIZED, 'invalid-credentials', 'E-mail ou senha inválidos'),
  forbidden: (detail?: string) =>
    new AppException(HttpStatus.FORBIDDEN, 'forbidden', 'Acesso negado', detail),
  passwordChangeRequired: () =>
    new AppException(
      HttpStatus.FORBIDDEN,
      'password-change-required',
      'Troca de senha obrigatória',
      'Altere sua senha temporária antes de continuar.',
    ),
  csrf: () =>
    new AppException(
      HttpStatus.FORBIDDEN,
      'csrf-rejected',
      'Requisição rejeitada',
      'Requisições que alteram dados devem vir da aplicação web do CreditFlow.',
    ),
  notFound: (what = 'Recurso') =>
    new AppException(HttpStatus.NOT_FOUND, 'not-found', `${what} não encontrado`),
  conflict: (code: string, title: string, detail?: string) =>
    new AppException(HttpStatus.CONFLICT, code, title, detail),
  businessRule: (code: string, title: string, detail?: string) =>
    new AppException(HttpStatus.UNPROCESSABLE_ENTITY, code, title, detail),
};
