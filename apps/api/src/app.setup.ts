import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const API_PREFIX = 'api/v1';

/**
 * Cross-cutting HTTP setup shared by main.ts and integration tests, so tests
 * exercise exactly the same pipeline as the running server.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
}

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('CreditFlow API')
    .setDescription('Manual credit application management. Synthetic data only.')
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
}
