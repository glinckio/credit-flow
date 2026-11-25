import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { HealthModule } from './modules/health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Single .env at the monorepo root (works from src/ and dist/); real env vars win.
      envFilePath: [resolve(import.meta.dirname, '../../../.env')],
      validate: validateEnv,
    }),
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
