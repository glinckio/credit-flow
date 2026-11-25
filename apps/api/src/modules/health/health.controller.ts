import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { APP_NAME } from '@creditflow/shared';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

export interface HealthResponse {
  status: 'ok';
  service: string;
  database: 'up';
  timestamp: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOkResponse({ description: 'API and database are reachable.' })
  @ApiServiceUnavailableResponse({ description: 'Database is not reachable.' })
  async check(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database is not reachable');
    }
    return {
      status: 'ok',
      service: APP_NAME,
      database: 'up',
      timestamp: new Date().toISOString(),
    };
  }
}
