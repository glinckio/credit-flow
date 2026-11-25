import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Permission } from '@creditflow/shared';
import { RequirePermissions } from '../auth/access.decorators.js';
import { SESSION_COOKIE } from '../auth/session.service.js';
import { AuditEventPageDto, ListAuditEventsQueryDto } from './audit-query.dto.js';
import { AuditQueryService } from './audit-query.service.js';

@ApiTags('audit')
@ApiCookieAuth(SESSION_COOKIE)
@Controller('audit-events')
export class AuditController {
  constructor(private readonly auditQuery: AuditQueryService) {}

  @Get()
  @RequirePermissions(Permission.AUDIT_READ)
  @ApiOkResponse({ type: AuditEventPageDto })
  list(@Query() query: ListAuditEventsQueryDto) {
    return this.auditQuery.list(query);
  }
}
