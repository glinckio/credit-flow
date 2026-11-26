import { ApiProperty } from '@nestjs/swagger';

export class StatusCountsDto {
  @ApiProperty() DRAFT!: number;
  @ApiProperty() SUBMITTED!: number;
  @ApiProperty() UNDER_REVIEW!: number;
  @ApiProperty() PENDING_INFORMATION!: number;
  @ApiProperty() APPROVED!: number;
  @ApiProperty() REJECTED!: number;
  @ApiProperty() CANCELLED!: number;
}

export class DurationMetricDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Média em horas (1 casa decimal); null quando não há dados suficientes.',
  })
  averageHours!: number | null;

  @ApiProperty({ description: 'Quantidade de solicitações consideradas.' }) sampleSize!: number;

  @ApiProperty({ description: 'Como a métrica é calculada.' }) definition!: string;
}

export class DashboardMetricsDto {
  @ApiProperty({
    description: 'Solicitações visíveis ao usuário (analistas não contam rascunhos).',
  })
  total!: number;

  @ApiProperty({ type: StatusCountsDto }) byStatus!: StatusCountsDto;

  @ApiProperty({ description: 'Aguardando análise (SUBMITTED, na fila).' }) awaitingReview!: number;
  @ApiProperty({ description: 'Em análise (UNDER_REVIEW).' }) underReview!: number;
  @ApiProperty({ description: 'Devolvidas por pendência (PENDING_INFORMATION).' })
  pendingInformation!: number;
  @ApiProperty({ description: 'Solicitações não concluídas com ao menos uma pendência aberta.' })
  withOpenIssues!: number;
  @ApiProperty() approved!: number;
  @ApiProperty() rejected!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Em análise ou com pendência atribuídas ao usuário (null se não analisa).',
  })
  assignedToMe!: number | null;

  @ApiProperty({ type: DurationMetricDto }) openToDecision!: DurationMetricDto;
  @ApiProperty({ type: DurationMetricDto }) submissionToDecision!: DurationMetricDto;

  @ApiProperty({ type: String, format: 'date-time' }) generatedAt!: Date;
}
