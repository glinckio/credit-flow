import { ApiProperty } from '@nestjs/swagger';
import { DecisionOutcome, ReviewRecommendation } from '@creditflow/shared';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { trim } from '../../common/validators.js';
import { UserRefDto } from '../customers/customers.dto.js';

export const MIN_JUSTIFICATION = 20;

export class CreateReviewDto {
  @ApiProperty({ enum: Object.values(ReviewRecommendation) })
  @IsEnum(ReviewRecommendation, { message: 'Recomendação inválida' })
  recommendation!: ReviewRecommendation;

  @ApiProperty({ description: 'Observações da análise.' })
  @Transform(trim)
  @IsString()
  @MinLength(10, { message: 'Descreva a análise (mín. 10 caracteres)' })
  @MaxLength(5000)
  analysisNotes!: string;

  @ApiProperty({ minLength: MIN_JUSTIFICATION })
  @Transform(trim)
  @IsString()
  @MinLength(MIN_JUSTIFICATION, {
    message: `A justificativa deve ter ao menos ${MIN_JUSTIFICATION} caracteres`,
  })
  @MaxLength(5000)
  justification!: string;
}

export class RecordDecisionDto {
  @ApiProperty({ enum: Object.values(DecisionOutcome) })
  @IsEnum(DecisionOutcome, { message: 'Decisão inválida' })
  outcome!: DecisionOutcome;

  @ApiProperty({ minLength: MIN_JUSTIFICATION })
  @Transform(trim)
  @IsString()
  @MinLength(MIN_JUSTIFICATION, {
    message: `A justificativa deve ter ao menos ${MIN_JUSTIFICATION} caracteres`,
  })
  @MaxLength(5000)
  justification!: string;
}

export class ReviewDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) applicationId!: string;
  @ApiProperty({ type: UserRefDto }) author!: UserRefDto;
  @ApiProperty({ enum: Object.values(ReviewRecommendation) })
  recommendation!: ReviewRecommendation;
  @ApiProperty() analysisNotes!: string;
  @ApiProperty() justification!: string;
  @ApiProperty({ description: 'Parecer vigente (o mais recente).' }) current!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class DecisionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) applicationId!: string;
  @ApiProperty({ enum: Object.values(DecisionOutcome) }) outcome!: DecisionOutcome;
  @ApiProperty() justification!: string;
  @ApiProperty({ type: UserRefDto }) decidedBy!: UserRefDto;
  @ApiProperty({ type: String, format: 'date-time' }) decidedAt!: Date;
  @ApiProperty({ format: 'uuid', description: 'Parecer vigente no momento da decisão.' })
  reviewId!: string;
  @ApiProperty({ enum: Object.values(ReviewRecommendation) })
  reviewRecommendation!: ReviewRecommendation;
}

export class IndicatorDto {
  @ApiProperty() key!: string;
  @ApiProperty() label!: string;
  @ApiProperty() formula!: string;
  @ApiProperty({ type: String, nullable: true }) value!: string | null;
  @ApiProperty({ enum: ['BRL', 'ratio', 'months'] }) unit!: 'BRL' | 'ratio' | 'months';
}

export class IndicatorsDto {
  @ApiProperty({ type: [IndicatorDto] }) indicators!: IndicatorDto[];
  @ApiProperty() disclaimer!: string;
}
