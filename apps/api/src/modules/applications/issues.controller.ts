import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Permission } from '@creditflow/shared';
import { UuidParamPipe } from '../../common/uuid-param.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/access.decorators.js';
import type { AuthUser } from '../auth/auth-user.js';
import { SESSION_COOKIE } from '../auth/session.service.js';
import { IssueDto, ResolveIssueDto } from './applications.dto.js';
import { IssuesService } from './issues.service.js';

@ApiTags('applications')
@ApiCookieAuth(SESSION_COOKIE)
@Controller('issues')
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermissions(Permission.APPLICATION_REVIEW)
  @ApiOkResponse({ type: IssueDto })
  resolve(
    @CurrentUser() actor: AuthUser,
    @Param('id', new UuidParamPipe('Pendência')) id: string,
    @Body() dto: ResolveIssueDto,
  ) {
    return this.issues.resolve(actor, id, dto);
  }
}
