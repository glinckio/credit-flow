import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Permission } from '@creditflow/shared';
import { UuidParamPipe } from '../../common/uuid-param.pipe.js';
import { ApplicationDto } from '../applications/applications.dto.js';
import { CurrentUser, RequirePermissions } from '../auth/access.decorators.js';
import type { AuthUser } from '../auth/auth-user.js';
import { SESSION_COOKIE } from '../auth/session.service.js';
import {
  CreateReviewDto,
  DecisionDto,
  IndicatorsDto,
  RecordDecisionDto,
  ReviewDto,
} from './analysis.dto.js';
import { AnalysisService } from './analysis.service.js';

@ApiTags('analysis')
@ApiCookieAuth(SESSION_COOKIE)
@Controller('applications/:id')
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Get('indicators')
  @RequirePermissions(Permission.APPLICATION_READ)
  @ApiOperation({ summary: 'Indicadores descritivos (não decisórios) dos valores declarados' })
  @ApiOkResponse({ type: IndicatorsDto })
  indicators(
    @CurrentUser() actor: AuthUser,
    @Param('id', new UuidParamPipe('Solicitação')) id: string,
  ) {
    return this.analysis.indicators(actor, id);
  }

  @Get('reviews')
  @RequirePermissions(Permission.APPLICATION_READ)
  @ApiOkResponse({
    type: [ReviewDto],
    description: 'Mais recente primeiro; `current` marca o vigente.',
  })
  listReviews(
    @CurrentUser() actor: AuthUser,
    @Param('id', new UuidParamPipe('Solicitação')) id: string,
  ) {
    return this.analysis.listReviews(actor, id);
  }

  @Post('reviews')
  @RequirePermissions(Permission.APPLICATION_REVIEW)
  @ApiOperation({ summary: 'Registra parecer (somente o analista responsável, durante a análise)' })
  @ApiCreatedResponse({ type: ReviewDto })
  createReview(
    @CurrentUser() actor: AuthUser,
    @Param('id', new UuidParamPipe('Solicitação')) id: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.analysis.createReview(actor, id, dto);
  }

  @Get('decision')
  @RequirePermissions(Permission.APPLICATION_READ)
  @ApiOkResponse({ type: DecisionDto })
  getDecision(
    @CurrentUser() actor: AuthUser,
    @Param('id', new UuidParamPipe('Solicitação')) id: string,
  ) {
    return this.analysis.getDecision(actor, id);
  }

  @Post('decision')
  @HttpCode(200)
  @RequirePermissions(Permission.APPLICATION_DECIDE)
  @ApiOperation({
    summary: 'Decisão humana final: UNDER_REVIEW → APPROVED | REJECTED',
    description:
      'Exige parecer vigente e justificativa; aprovar exige nenhuma pendência aberta. Nunca automática.',
  })
  @ApiOkResponse({ type: ApplicationDto })
  @ApiUnprocessableEntityResponse({ description: '`review-required` ou `open-issues`.' })
  decide(
    @CurrentUser() actor: AuthUser,
    @Param('id', new UuidParamPipe('Solicitação')) id: string,
    @Body() dto: RecordDecisionDto,
  ) {
    return this.analysis.decide(actor, id, dto);
  }
}
