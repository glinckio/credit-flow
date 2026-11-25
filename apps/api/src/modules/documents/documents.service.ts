import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApplicationStatus, DocumentValidationStatus, isEditable } from '@creditflow/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { AppException, Problems } from '../../common/http/app-exception.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { DocumentStorage } from '../../infra/storage/document-storage.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth-user.js';
import { ApplicationsService } from '../applications/applications.service.js';
import type { DocumentDto, UploadDocumentDto, ValidateDocumentDto } from './documents.dto.js';
import {
  ALLOWED_EXTENSIONS,
  MAX_DOCUMENT_BYTES,
  checkFile,
  sanitizeOriginalName,
} from './file-type.js';

/** Upper bound of active documents per application (abuse protection). */
export const MAX_DOCUMENTS_PER_APPLICATION = 30;

/** Manual validation happens while the analysis is in progress. */
const VALIDATION_STATUSES: readonly ApplicationStatus[] = [
  ApplicationStatus.UNDER_REVIEW,
  ApplicationStatus.PENDING_INFORMATION,
];

const userRef = { select: { id: true, name: true } } as const;
const documentInclude = { uploadedBy: userRef, validatedBy: userRef } as const;
type DocumentWithRefs = Prisma.CreditDocumentGetPayload<{ include: typeof documentInclude }>;

function toDocumentDto(d: DocumentWithRefs): DocumentDto {
  return {
    id: d.id,
    applicationId: d.applicationId,
    type: d.type,
    otherDescription: d.otherDescription,
    originalName: d.originalName,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    sha256: d.sha256,
    uploadedBy: d.uploadedBy,
    uploadedAt: d.uploadedAt,
    validationStatus: d.validationStatus,
    validationNotes: d.validationNotes,
    validatedBy: d.validatedBy,
    validatedAt: d.validatedAt,
  };
}

const FILE_ERRORS = {
  empty: () => new AppException(HttpStatus.BAD_REQUEST, 'empty-file', 'Arquivo vazio'),
  'too-large': () =>
    new AppException(
      HttpStatus.PAYLOAD_TOO_LARGE,
      'payload-too-large',
      'Arquivo grande demais',
      `Tamanho máximo: ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB.`,
    ),
  'unsupported-type': () =>
    new AppException(
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      'unsupported-file-type',
      'Tipo de arquivo não suportado',
      'Envie PDF, PNG ou JPEG.',
      undefined,
      { allowedExtensions: ALLOWED_EXTENSIONS },
    ),
  'extension-mismatch': () =>
    new AppException(
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      'file-extension-mismatch',
      'A extensão do arquivo não corresponde ao conteúdo',
      'Verifique se o arquivo não foi renomeado.',
    ),
};

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: DocumentStorage,
    private readonly applications: ApplicationsService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthUser, applicationId: string): Promise<DocumentDto[]> {
    await this.applications.getVisibleOrThrow(actor, applicationId);
    const docs = await this.prisma.creditDocument.findMany({
      where: { applicationId, deletedAt: null },
      orderBy: { uploadedAt: 'asc' },
      include: documentInclude,
    });
    return docs.map(toDocumentDto);
  }

  async upload(
    actor: AuthUser,
    applicationId: string,
    dto: UploadDocumentDto,
    file: { buffer: Buffer; originalname: string } | undefined,
  ): Promise<DocumentDto> {
    if (!file) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'file-required',
        'Envie o arquivo no campo "file" (multipart/form-data)',
      );
    }
    // Cheap authorization/state checks before touching the storage.
    this.assertEditable(await this.applications.getVisibleOrThrow(actor, applicationId));

    const originalName = sanitizeOriginalName(file.originalname);
    const check = checkFile(file.buffer, originalName);
    if (!check.ok) throw FILE_ERRORS[check.reason]();
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    const storageKey = await this.storage.put(file.buffer);
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Re-check inside the transaction: the application may have moved on.
        this.assertEditable(await this.applications.getVisibleOrThrow(actor, applicationId, tx));
        const active = await tx.creditDocument.count({ where: { applicationId, deletedAt: null } });
        if (active >= MAX_DOCUMENTS_PER_APPLICATION) {
          throw Problems.businessRule(
            'too-many-documents',
            'Limite de documentos atingido',
            `Máximo de ${MAX_DOCUMENTS_PER_APPLICATION} documentos ativos por solicitação.`,
          );
        }
        const doc = await tx.creditDocument.create({
          data: {
            applicationId,
            type: dto.type,
            otherDescription: dto.type === 'OTHER' ? (dto.otherDescription ?? null) : null,
            originalName,
            storageKey,
            mimeType: check.mimeType,
            sizeBytes: file.buffer.length,
            sha256,
            uploadedById: actor.id,
          },
          include: documentInclude,
        });
        await this.audit.record(tx, {
          actorId: actor.id,
          action: 'document.uploaded',
          entityType: 'CreditDocument',
          entityId: doc.id,
          after: {
            applicationId,
            type: doc.type,
            mimeType: doc.mimeType,
            sizeBytes: doc.sizeBytes,
            sha256: doc.sha256,
          },
        });
        return toDocumentDto(doc);
      });
    } catch (err) {
      // Compensate: no orphan file without its metadata row.
      await this.storage
        .remove(storageKey)
        .catch((e: unknown) =>
          this.logger.error({ err: e, storageKey }, 'Failed to remove orphan document'),
        );
      throw err;
    }
  }

  /** Opens the file for an authorised download and records the access. */
  async openForDownload(
    actor: AuthUser,
    documentId: string,
  ): Promise<{ doc: DocumentDto; stream: Readable }> {
    const doc = await this.getActiveDocument(actor, documentId);
    let stream: Readable;
    try {
      stream = await this.storage.open(doc.storageKey);
    } catch (err) {
      this.logger.error({ err, documentId }, 'Document metadata exists but file is missing');
      throw Problems.notFound('Documento');
    }
    await this.audit.record(this.prisma, {
      actorId: actor.id,
      action: 'document.downloaded',
      entityType: 'CreditDocument',
      entityId: doc.id,
      after: { applicationId: doc.applicationId },
    });
    return { doc: toDocumentDto(doc), stream };
  }

  async validate(
    actor: AuthUser,
    documentId: string,
    dto: ValidateDocumentDto,
  ): Promise<DocumentDto> {
    const doc = await this.getActiveDocument(actor, documentId);

    return this.prisma.$transaction(async (tx) => {
      const app = await this.applications.getVisibleOrThrow(actor, doc.applicationId, tx);
      if (!VALIDATION_STATUSES.includes(app.status)) {
        throw Problems.conflict(
          'application-not-in-review',
          'Documentos só podem ser validados durante a análise',
          undefined,
          { currentStatus: app.status },
        );
      }
      this.applications.assertAssignee(actor, app);

      const pending = dto.status === DocumentValidationStatus.PENDING;
      const updated = await tx.creditDocument.update({
        where: { id: documentId },
        data: {
          validationStatus: dto.status,
          validationNotes: dto.notes ?? null,
          validatedById: pending ? null : actor.id,
          validatedAt: pending ? null : new Date(),
        },
        include: documentInclude,
      });
      await this.audit.record(tx, {
        actorId: actor.id,
        action: 'document.validated',
        entityType: 'CreditDocument',
        entityId: documentId,
        before: { validationStatus: doc.validationStatus, validationNotes: doc.validationNotes },
        after: {
          validationStatus: updated.validationStatus,
          validationNotes: updated.validationNotes,
        },
      });
      return toDocumentDto(updated);
    });
  }

  /**
   * Logical removal while the application is editable. The file is kept
   * (retention); physical removal belongs to the anonymization procedure.
   */
  async remove(actor: AuthUser, documentId: string): Promise<void> {
    const doc = await this.getActiveDocument(actor, documentId);
    await this.prisma.$transaction(async (tx) => {
      this.assertEditable(await this.applications.getVisibleOrThrow(actor, doc.applicationId, tx));
      const { count } = await tx.creditDocument.updateMany({
        where: { id: documentId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (count === 0) throw Problems.notFound('Documento');
      await this.audit.record(tx, {
        actorId: actor.id,
        action: 'document.removed',
        entityType: 'CreditDocument',
        entityId: documentId,
        before: { type: doc.type, originalName: doc.originalName },
      });
    });
  }

  /** Active document whose application the actor may see; 404 otherwise. */
  private async getActiveDocument(actor: AuthUser, id: string) {
    const doc = await this.prisma.creditDocument.findUnique({
      where: { id },
      include: documentInclude,
    });
    if (!doc || doc.deletedAt) throw Problems.notFound('Documento');
    await this.applications.getVisibleOrThrow(actor, doc.applicationId);
    return doc;
  }

  private assertEditable(app: { status: ApplicationStatus }): void {
    if (!isEditable(app.status)) {
      throw Problems.conflict(
        'application-not-editable',
        'Documentos só podem ser incluídos ou removidos em rascunho ou com pendência de informação',
        undefined,
        { currentStatus: app.status },
      );
    }
  }
}
