import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp, setupSwagger } from './app.setup.js';
import type { Env } from './config/env.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  setupSwagger(app);

  const port = app.get(ConfigService<Env, true>).get('API_PORT', { infer: true });
  await app.listen(port);
  Logger.log(`CreditFlow API listening on http://localhost:${port}/api/v1`, 'Bootstrap');
}

await bootstrap();
