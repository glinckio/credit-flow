import { resolve } from 'node:path';
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { CsrfGuard } from './common/http/csrf.guard.js';
import { ProblemDetailsFilter } from './common/http/problem-details.filter.js';
import { createValidationPipe } from './common/http/validation.js';
import { buildLoggerParams } from './common/logging.js';
import { RequestContextMiddleware } from './common/request-context.middleware.js';
import { type Env, validateEnv } from './config/env.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { StorageModule } from './infra/storage/storage.module.js';
import { AiAnalysisModule } from './modules/ai-analysis/ai-analysis.module.js';
import { AnalysisModule } from './modules/analysis/analysis.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AccessGuard } from './modules/auth/access.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ApplicationsModule } from './modules/applications/applications.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { LOGIN_THROTTLER } from './modules/auth/login-throttle.guard.js';
import { HealthModule } from './modules/health/health.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Single .env at the monorepo root (works from src/ and dist/); real env vars win.
      envFilePath: [resolve(import.meta.dirname, '../../../.env')],
      validate: validateEnv,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        buildLoggerParams({
          LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }),
          NODE_ENV: config.get('NODE_ENV', { infer: true }),
        }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      // Only the login route uses the throttler guard (LoginThrottleGuard).
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            name: LOGIN_THROTTLER,
            ttl: 60_000,
            limit: config.get('LOGIN_RATE_LIMIT', { infer: true }),
          },
        ],
      }),
    }),
    PrismaModule,
    StorageModule,
    AuditModule,
    AuthModule,
    UsersModule,
    CustomersModule,
    ApplicationsModule,
    DocumentsModule,
    AnalysisModule,
    AiAnalysisModule,
    DashboardModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
    // Order matters: CSRF check first, then authentication/authorization.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useExisting: AccessGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('{*splat}');
  }
}
