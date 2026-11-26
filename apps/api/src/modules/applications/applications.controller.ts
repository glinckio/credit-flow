import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Permission } from '@creditflow/shared';
import { UuidParamPipe } from '../../common/uuid-param.pipe.js';
import {
  CurrentUser,
  RequireAnyPermission,
  RequirePermissions,
} from '../auth/access.decorators.js';
import type { AuthUser } from '../auth/auth-user.js';
import { SESSION_COOKIE } from '../auth/session.service.js';
import {
  ApplicationDto,
  ApplicationPageDto,
  AssignDto,
  CreateApplicationDto,
  CreateIssueDto,
  IssueDto,
  ListApplicationsQueryDto,
  ListIssuesQueryDto,
  StatusHistoryEntryDto,
  TransitionDto,
  UpdateApplicationDto,
} from './applications.dto.js';
import { ApplicationsService } from './applications.service.js';
import { IssuesService } from './issues.service.js';

const ApplicationId = Param('id', new UuidParamPipe('Solicitação'));

/**
 * Route permissions are the coarse gate; the service re-checks the state
 * machine (status + permission) and contextual rules (assignee, issues, docs).
 */
@ApiTags('applications')
@ApiCookieAuth(SESSION_COOKIE)
@Controller('applications')
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly issues: IssuesService,
  ) {}

  @Get()
  @RequirePermissions(Permission.APPLICATION_READ)
  @ApiOkResponse({ type: ApplicationPageDto })
  list(@CurrentUser() actor: AuthUser, @Query() query: ListApplicationsQueryDto) {
    return this.applications.list(actor, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.APPLICATION_READ)
  @ApiOkResponse({ type: ApplicationDto })
  get(@CurrentUser() actor: AuthUser, @ApplicationId id: string) {
    return this.applications.get(actor, id);
  }

  @Post()
  @RequirePermissions(Permission.APPLICATION_WRITE)
  @ApiCreatedResponse({ type: ApplicationDto, description: 'Criada em DRAFT.' })
  @ApiUnprocessableEntityResponse({ description: 'Cliente inativo.' })
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateApplicationDto) {
    return this.applications.create(actor, dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.APPLICATION_WRITE)
  @ApiOkResponse({ type: ApplicationDto })
  @ApiConflictResponse({ description: 'Status não editável ou `version` desatualizada.' })
  update(
    @CurrentUser() actor: AuthUser,
    @ApplicationId id: string,
    @Body() dto: UpdateApplicationDto,
  ) {
    return this.applications.update(actor, id, dto);
  }

  @Get(':id/status-history')
  @RequirePermissions(Permission.APPLICATION_READ)
  @ApiOkResponse({ type: [StatusHistoryEntryDto] })
  statusHistory(@CurrentUser() actor: AuthUser, @ApplicationId id: string) {
    return this.applications.statusHistory(actor, id);
  }

  // ───────────── transitions ─────────────

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions(Permission.APPLICATION_WRITE)
  @ApiOperation({ summary: 'DRAFT → SUBMITTED (exige documentos obrigatórios)' })
  @ApiOkResponse({ type: ApplicationDto })
  submit(@CurrentUser() actor: AuthUser, @ApplicationId id: string) {
    return this.applications.submit(actor, id);
  }

  @Post(':id/start-review')
  @HttpCode(200)
  @RequirePermissions(Permission.APPLICATION_REVIEW)
  @ApiOperation({ summary: 'SUBMITTED → UNDER_REVIEW, responsável = usuário atual' })
  @ApiOkResponse({ type: ApplicationDto })
  startReview(@CurrentUser() actor: AuthUser, @ApplicationId id: string) {
    return this.applications.startReview(actor, id);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermissions(Permission.APPLICATION_ASSIGN)
  @ApiOperation({ summary: 'Atribui/reatribui a um analista ativo (admin)' })
  @ApiOkResponse({ type: ApplicationDto })
  assign(@CurrentUser() actor: AuthUser, @ApplicationId id: string, @Body() dto: AssignDto) {
    return this.applications.assign(actor, id, dto.assigneeId);
  }

  @Post(':id/release')
  @HttpCode(200)
  @RequireAnyPermission(Permission.APPLICATION_REVIEW, Permission.APPLICATION_ASSIGN)
  @ApiOperation({ summary: 'UNDER_REVIEW → SUBMITTED, sem responsável' })
  @ApiOkResponse({ type: ApplicationDto })
  release(@CurrentUser() actor: AuthUser, @ApplicationId id: string) {
    return this.applications.release(actor, id);
  }

  @Post(':id/request-information')
  @HttpCode(200)
  @RequirePermissions(Permission.APPLICATION_REVIEW)
  @ApiOperation({ summary: 'UNDER_REVIEW → PENDING_INFORMATION (exige pendência aberta)' })
  @ApiOkResponse({ type: ApplicationDto })
  requestInformation(
    @CurrentUser() actor: AuthUser,
    @ApplicationId id: string,
    @Body() dto: TransitionDto,
  ) {
    return this.applications.requestInformation(actor, id, dto.reason);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermissions(Permission.APPLICATION_WRITE)
  @ApiOperation({ summary: 'PENDING_INFORMATION → UNDER_REVIEW' })
  @ApiOkResponse({ type: ApplicationDto })
  resume(@CurrentUser() actor: AuthUser, @ApplicationId id: string, @Body() dto: TransitionDto) {
    return this.applications.resume(actor, id, dto.reason);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(Permission.APPLICATION_CANCEL)
  @ApiOperation({ summary: '→ CANCELLED (motivo obrigatório; em análise só admin)' })
  @ApiOkResponse({ type: ApplicationDto })
  cancel(@CurrentUser() actor: AuthUser, @ApplicationId id: string, @Body() dto: TransitionDto) {
    return this.applications.cancel(actor, id, dto.reason);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermissions(Permission.APPLICATION_REOPEN)
  @ApiOperation({ summary: 'CANCELLED → SUBMITTED (admin, motivo obrigatório)' })
  @ApiOkResponse({ type: ApplicationDto })
  reopen(@CurrentUser() actor: AuthUser, @ApplicationId id: string, @Body() dto: TransitionDto) {
    return this.applications.reopen(actor, id, dto.reason);
  }

  // ───────────── issues (pendências) ─────────────

  @Get(':id/issues')
  @RequirePermissions(Permission.APPLICATION_READ)
  @ApiOkResponse({ type: [IssueDto] })
  listIssues(
    @CurrentUser() actor: AuthUser,
    @ApplicationId id: string,
    @Query() query: ListIssuesQueryDto,
  ) {
    return this.issues.list(actor, id, query.status);
  }

  @Post(':id/issues')
  @RequirePermissions(Permission.APPLICATION_REVIEW)
  @ApiCreatedResponse({ type: IssueDto })
  createIssue(
    @CurrentUser() actor: AuthUser,
    @ApplicationId id: string,
    @Body() dto: CreateIssueDto,
  ) {
    return this.issues.create(actor, id, dto);
  }
}
