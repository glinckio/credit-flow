import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AiAnalysisRunStatus,
  AiAnalysisTrigger,
  DocumentExtractionStatus,
  DocumentType,
  EvidenceStatus,
  ExtractedFieldKey,
  FieldStatus,
  type Finding,
  type NarrativeReport,
  type TemplateReport,
} from '@creditflow/shared';
import { IsBoolean, IsOptional } from 'class-validator';
import { UserRefDto } from '../customers/customers.dto.js';

export class RequestAiAnalysisDto {
  @ApiPropertyOptional({
    description:
      'Refaz mesmo sem mudança nos documentos desde a última análise (o resultado pode variar).',
  })
  @IsOptional()
  @IsBoolean({ message: 'force deve ser verdadeiro ou falso' })
  force?: boolean;
}

export class AiAnalysisRunDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) applicationId!: string;
  @ApiProperty({ enum: Object.values(AiAnalysisTrigger) }) trigger!: AiAnalysisTrigger;
  @ApiProperty({ enum: Object.values(AiAnalysisRunStatus) }) status!: AiAnalysisRunStatus;
  @ApiProperty({ type: UserRefDto, nullable: true }) requestedBy!: UserRefDto | null;
  @ApiProperty() model!: string;
  @ApiProperty() pipelineVersion!: string;
  @ApiProperty() extractionSchemaVersion!: string;
  @ApiProperty() promptVersion!: string;
  @ApiProperty({ type: String, nullable: true }) errorCode!: string | null;
  @ApiProperty() inputTokens!: number;
  @ApiProperty() outputTokens!: number;
  @ApiProperty({ type: String, nullable: true, description: 'US$, estimado (etapa B3).' })
  costUsd!: string | null;
  @ApiProperty({ type: Number, nullable: true }) latencyMs!: number | null;
  @ApiProperty({ type: String, format: 'date-time' }) queuedAt!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) startedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) finishedAt!: Date | null;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Conteúdo extraído removido pela política de retenção.',
  })
  purgedAt!: Date | null;
  @ApiProperty({ description: 'Os documentos mudaram desde esta análise.' }) stale!: boolean;
  @ApiProperty() documentCount!: number;
}

export class AiDocumentRefDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: Object.values(DocumentType) }) type!: DocumentType;
  @ApiProperty() originalName!: string;
}

export class AiFieldDto {
  @ApiProperty({ enum: Object.values(ExtractedFieldKey) }) key!: ExtractedFieldKey;
  @ApiProperty({ enum: Object.values(FieldStatus) }) modelStatus!: FieldStatus;
  @ApiProperty({ type: String, nullable: true, description: 'Como o modelo transcreveu.' })
  modelValue!: string | null;
  @ApiProperty({ type: Number, nullable: true }) page!: number | null;
  @ApiProperty({ type: String, nullable: true }) quote!: string | null;
  @ApiProperty({ enum: Object.values(EvidenceStatus), nullable: true })
  evidenceStatus!: EvidenceStatus | null;
  @ApiProperty({ type: String, nullable: true }) evidenceReason!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Valor aceito como fato (evidência verificada).',
  })
  acceptedValue!: string | null;
  @ApiProperty({ type: String, nullable: true }) rejectedBy!: string | null;
}

export class AiDocumentExtractionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: AiDocumentRefDto }) document!: AiDocumentRefDto;
  @ApiProperty() documentSha256!: string;
  @ApiProperty({ enum: Object.values(DocumentType) }) declaredType!: DocumentType;
  @ApiProperty({ enum: Object.values(DocumentExtractionStatus) })
  status!: DocumentExtractionStatus;
  @ApiProperty({ type: String, nullable: true }) detectedType!: string | null;
  @ApiProperty({ type: Boolean, nullable: true }) typeMatchesDeclared!: boolean | null;
  @ApiProperty() hasTextLayer!: boolean;
  @ApiProperty() injectionAlert!: boolean;
  @ApiProperty({ type: [String] }) injectionPatterns!: string[];
  @ApiProperty({ type: Boolean, nullable: true }) injectionModelFlag!: boolean | null;
  @ApiProperty({ type: [AiFieldDto] }) fields!: AiFieldDto[];
  @ApiProperty({ type: [String] }) schemaErrors!: string[];
}

export class AiAnalysisRunDetailDto extends AiAnalysisRunDto {
  @ApiProperty({
    type: [AiDocumentExtractionDto],
    description: 'Vazio depois do expurgo (purgedAt).',
  })
  documents!: AiDocumentExtractionDto[];

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description:
      'Achados determinísticos (comparação exata com os dados declarados ATUAIS). Vazio após o expurgo.',
  })
  findings!: Finding[];

  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: true,
    description:
      'Relatório por template (sempre gerado por código), com os dados declarados atuais.',
  })
  report!: TemplateReport | null;

  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: true,
    description: 'O mesmo relatório como estava ao concluir a análise.',
  })
  reportAtCompletion!: TemplateReport | null;

  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: true,
    description:
      'Narrativa redigida por modelo sobre os achados ao concluir (B4). Só tem frases quando status = OK; ' +
      'cada frase referencia os achados que a sustentam. Refere-se a reportAtCompletion: quando ' +
      'declaredDataChanged = true, está desatualizada. O template continua sendo a referência.',
  })
  narrative!: NarrativeReport | null;

  @ApiProperty({
    description: 'Os dados declarados mudaram desde a conclusão e alteraram algum achado.',
  })
  declaredDataChanged!: boolean;
}
