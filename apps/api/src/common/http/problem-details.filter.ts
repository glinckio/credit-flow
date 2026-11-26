import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';
import { currentRequestContext } from '../request-context.js';
import { AppException, type FieldError } from './app-exception.js';

/** RFC 9457 Problem Details body. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: FieldError[];
  requestId?: string;
  [extension: string]: unknown;
}

const DEFAULT_TITLES: Record<number, [string, string]> = {
  400: ['bad-request', 'Requisição inválida'],
  401: ['unauthenticated', 'Autenticação necessária'],
  403: ['forbidden', 'Acesso negado'],
  404: ['not-found', 'Recurso não encontrado'],
  405: ['method-not-allowed', 'Método não permitido'],
  409: ['conflict', 'Conflito'],
  413: ['payload-too-large', 'Conteúdo grande demais'],
  415: ['unsupported-media-type', 'Tipo de conteúdo não suportado'],
  422: ['business-rule', 'Regra de negócio violada'],
  429: ['too-many-requests', 'Muitas tentativas. Aguarde e tente novamente.'],
  500: ['internal-error', 'Erro interno'],
  503: ['service-unavailable', 'Serviço indisponível'],
};

function problem(status: number, code?: string, title?: string, detail?: string): ProblemDetails {
  const [defaultCode, defaultTitle] = DEFAULT_TITLES[status] ?? ['error', 'Erro'];
  return {
    type: `/problems/${code ?? defaultCode}`,
    title: title ?? defaultTitle,
    status,
    ...(detail ? { detail } : {}),
  };
}

/**
 * Single error format for the whole API. Never leaks stack traces, SQL or
 * internal messages for unexpected errors; those are logged with the request id.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();
    const body = this.toProblem(exception, req);
    body.requestId = currentRequestContext()?.requestId ?? String(req.id ?? '');
    res.status(body.status).type('application/problem+json').json(body);
  }

  private toProblem(exception: unknown, req: Request): ProblemDetails {
    if (exception instanceof AppException) {
      return {
        ...problem(exception.getStatus(), exception.code, exception.title, exception.detail),
        ...(exception.errors ? { errors: exception.errors } : {}),
        ...exception.extensions,
      };
    }
    if (exception instanceof ThrottlerException) {
      return problem(HttpStatus.TOO_MANY_REQUESTS);
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // Nest built-ins (404 route not found, 413 body too large...) keep a generic title.
      return problem(status);
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return problem(HttpStatus.CONFLICT, 'duplicate', 'Registro duplicado');
      }
      if (exception.code === 'P2025') {
        return problem(HttpStatus.NOT_FOUND);
      }
    }
    this.logger.error(
      { err: exception, method: req.method, url: req.originalUrl },
      'Unhandled exception',
    );
    return problem(HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
