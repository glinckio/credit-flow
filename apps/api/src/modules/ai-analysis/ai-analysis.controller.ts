import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  type PipeTransform,
  Post,
  Put,
  Query,
} from '@nestjs/common';
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
  AiMetricsQueryDto,
  FindingFeedbackBodyDto,
  FindingFeedbackDto,
  RequestAiAnalysisDto,
} from './ai-analysis.dto.js';
import { Problems } from '../../common/http/app-exception.js';
import { AiAnalysisService } from './ai-analysis.service.js';
import { AiMetricsService } from './ai-metrics.service.js';

/** `<subject>:<uuid>`; anything else is a 404 (no such finding). */
class FindingIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^[a-zA-Z]{1,40}:[0-9a-f-]{36}$/.test(value)) throw Problems.notFound('Achado');
    return value;
  }
}

@ApiTags('ai-analysis')
@ApiCookieAuth(SESSION_COOKIE)
@Controller()
export class AiAnalysisController {
  constructor(
    private readonly service: AiAnalysisService,
    private readonly metricsService: AiMetricsService,
  ) {}

  @Get('ai-metrics')
  @RequirePermissions(Permission.AI_ANALYSIS_METRICS)
  @ApiOperation({
    summary: 'Custo e qualidade das análises de IA no período (admin)',
    description:
      'Somente contagens e valores agregados: nenhum dado extraído, trecho ou comentário. ' +
      'Documentos, achados e narrativa cobrem execuções ainda não expurgadas.',
  })
  @ApiOkResponse({ description: 'Ver o tipo AiMetrics em @creditflow/shared.' })
  metrics(@Query() q: AiMetricsQueryDto) {
    return this.metricsService.metrics(q.days);
  }

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

  @Put('ai-analyses/:runId/findings/:findingId/feedback')
  @RequirePermissions(Permission.AI_ANALYSIS_REQUEST)
  @ApiOperation({
    summary: 'Avaliar um achado (analista responsável): correto ou incorreto',
    description:
      'Mede a frequência de correções do analista. Não altera o achado, o parecer nem a decisão. ' +
      'Enviar de novo substitui a avaliação anterior do mesmo analista.',
  })
  @ApiOkResponse({ type: FindingFeedbackDto })
  @ApiConflictResponse({ description: '`analysis-purged`.' })
  feedback(
    @CurrentUser() actor: AuthUser,
    @Param('runId', new UuidParamPipe('Análise')) runId: string,
    @Param('findingId', new FindingIdPipe()) findingId: string,
    @Body() dto: FindingFeedbackBodyDto,
  ) {
    return this.service.giveFeedback(actor, runId, findingId, dto);
  }
}
