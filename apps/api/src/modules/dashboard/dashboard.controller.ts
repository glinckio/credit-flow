import { Controller, Get } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Permission } from '@creditflow/shared';
import { CurrentUser, RequirePermissions } from '../auth/access.decorators.js';
import type { AuthUser } from '../auth/auth-user.js';
import { SESSION_COOKIE } from '../auth/session.service.js';
import { DashboardMetricsDto } from './dashboard.dto.js';
import { DashboardService } from './dashboard.service.js';

@ApiTags('dashboard')
@ApiCookieAuth(SESSION_COOKIE)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('metrics')
  @RequirePermissions(Permission.DASHBOARD_READ)
  @ApiOkResponse({
    type: DashboardMetricsDto,
    description: 'Calculado do banco a cada requisição.',
  })
  metrics(@CurrentUser() actor: AuthUser) {
    return this.dashboard.metrics(actor);
  }
}
