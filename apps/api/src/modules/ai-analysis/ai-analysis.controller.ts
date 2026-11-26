import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Permission } from '@creditflow/shared';
import { UuidParamPipe } from '../../common/uuid-param.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/access.decorators.js';
import type { AuthUser } from '../auth/auth-user.js';
import { SESSION_COOKIE } from '../auth/session.service.js';
import {
  AiAnalysisRunDetailDto,
  AiAnalysisRunDto,
  RequestAiAnalysisDto,
} from './ai-analysis.dto.js';
import { AiAnalysisService } from './ai-analysis.service.js';

@ApiTags('ai-analysis')
@ApiCookieAuth(SESSION_COOKIE)
@Controller()
export class AiAnalysisController {
  constructor(private readonly service: AiAnalysisService) {}

  @Get('applications/:id/ai-analyses')
  @RequirePermissions(Permission.AI_ANALYSIS_READ)
  @ApiOperation({ summary: 'Análises de IA da solicitação (apoio ao analista; nunca decisão)' })
  @ApiOkResponse({ type: [AiAnalysisRunDto], description: 'Mais recente primeiro.' })
  list(@CurrentUser() actor: AuthUser, @Param('id', new UuidParamPipe('Solicitação')) id: string) {
    return this.service.list(actor, id);
  }

  @Post('applications/:id/ai-analyses')
  @HttpCode(202)
  @RequirePermissions(Permission.AI_ANALYSIS_REQUEST)
  @ApiOperation({
    summary: 'Reprocessar a análise de IA (analista responsável, durante a análise)',
    description:
      'A primeira análise é automática ao entrar em análise; as seguintes são sempre manuais.',
  })
  @ApiAcceptedResponse({ type: AiAnalysisRunDto })
  @ApiConflictResponse({
    description:
      '`analysis-in-progress`, `analysis-up-to-date` (envie `force: true`) ou `application-not-in-review`.',
  })
  @ApiServiceUnavailableResponse({ description: '`ai-disabled`.' })
  request(
    @CurrentUser() actor: AuthUser,
    @Param('id', new UuidParamPipe('Solicitação')) id: string,
    @Body() dto: RequestAiAnalysisDto,
  ) {
    return this.service.request(actor, id, dto);
  }

  @Get('ai-analyses/:runId')
  @RequirePermissions(Permission.AI_ANALYSIS_READ)
  @ApiOperation({ summary: 'Detalhe da análise: documentos, campos, evidências e alertas' })
  @ApiOkResponse({ type: AiAnalysisRunDetailDto })
  get(@CurrentUser() actor: AuthUser, @Param('runId', new UuidParamPipe('Análise')) runId: string) {
    return this.service.get(actor, runId);
  }
}
