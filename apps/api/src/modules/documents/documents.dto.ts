import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentType, DocumentValidationStatus } from '@creditflow/shared';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { trim } from '../../common/validators.js';
import { UserRefDto } from '../customers/customers.dto.js';
import { ALLOWED_EXTENSIONS, MAX_DOCUMENT_BYTES } from './file-type.js';

/** Multipart fields sent together with the `file` part. */
export class UploadDocumentDto {
  @ApiProperty({ enum: Object.values(DocumentType) })
  @IsEnum(DocumentType, { message: 'Tipo de documento inválido' })
  type!: DocumentType;

  @ApiPropertyOptional({ description: 'Obrigatório quando type = OTHER.' })
  @ValidateIf(
    (o: UploadDocumentDto) => o.type === DocumentType.OTHER || o.otherDescription !== undefined,
  )
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Descreva o documento' })
  @MaxLength(120)
  otherDescription?: string;
}

/** Swagger-only schema of the multipart body. */
export class UploadDocumentBodyDoc extends UploadDocumentDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: `PDF, PNG ou JPEG (${ALLOWED_EXTENSIONS.join(', ')}), até ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB. O tipo é detectado pelo conteúdo.`,
  })
  file!: unknown;
}

export class ValidateDocumentDto {
  @ApiProperty({ enum: Object.values(DocumentValidationStatus) })
  @IsEnum(DocumentValidationStatus, { message: 'Status de validação inválido' })
  status!: DocumentValidationStatus;

  @ApiPropertyOptional({ description: 'Obrigatório ao rejeitar.' })
  @ValidateIf(
    (o: ValidateDocumentDto) =>
      o.status === DocumentValidationStatus.REJECTED || o.notes !== undefined,
  )
  @Transform(trim)
  @IsString()
  @MinLength(3, { message: 'Explique o motivo da rejeição' })
  @MaxLength(1000)
  notes?: string;
}

export class DocumentDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) applicationId!: string;
  @ApiProperty({ enum: Object.values(DocumentType) }) type!: DocumentType;
  @ApiProperty({ type: String, nullable: true }) otherDescription!: string | null;
  @ApiProperty({ description: 'Nome enviado pelo usuário (apenas exibição).' })
  originalName!: string;
  @ApiProperty({ description: 'Detectado pelo conteúdo.' }) mimeType!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty() sha256!: string;
  @ApiProperty({ type: UserRefDto }) uploadedBy!: UserRefDto;
  @ApiProperty({ type: String, format: 'date-time' }) uploadedAt!: Date;
  @ApiProperty({ enum: Object.values(DocumentValidationStatus) })
  validationStatus!: DocumentValidationStatus;
  @ApiProperty({ type: String, nullable: true }) validationNotes!: string | null;
  @ApiProperty({ type: UserRefDto, nullable: true }) validatedBy!: UserRefDto | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) validatedAt!: Date | null;
}
