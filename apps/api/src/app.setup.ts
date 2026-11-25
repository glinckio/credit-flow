import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { SESSION_COOKIE } from './modules/auth/session.service.js';

export const API_PREFIX = 'api/v1';

/**
 * Cross-cutting HTTP setup shared by main.ts and integration tests, so tests
 * exercise exactly the same pipeline as the running server. Guards, pipes and
 * filters are registered as APP_* providers in AppModule.
 */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  express.disable('x-powered-by');
  express.use(helmet());
  express.use(cookieParser());
  // CORS stays disabled: the web app reaches the API same-origin (Vite proxy in dev).
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
}

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('CreditFlow API')
    .setDescription(
      'Manual credit application management. Synthetic data only.\n\n' +
        'Authentication: httpOnly session cookie set by POST /auth/login. ' +
        'Mutating requests must send the header `X-Requested-With: XMLHttpRequest`. ' +
        'Errors follow RFC 9457 (application/problem+json).',
    )
    .setVersion('0.1.0')
    .addCookieAuth(SESSION_COOKIE)
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
}
