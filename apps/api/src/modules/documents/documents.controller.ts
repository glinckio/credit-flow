import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Permission } from '@creditflow/shared';
import type { Response } from 'express';
import { UuidParamPipe } from '../../common/uuid-param.pipe.js';
import { CurrentUser, RequirePermissions } from '../auth/access.decorators.js';
import type { AuthUser } from '../auth/auth-user.js';
import { SESSION_COOKIE } from '../auth/session.service.js';
import {
  DocumentDto,
  UploadDocumentBodyDoc,
  UploadDocumentDto,
  ValidateDocumentDto,
} from './documents.dto.js';
import { DocumentsService } from './documents.service.js';
import { MAX_DOCUMENT_BYTES, attachmentDisposition } from './file-type.js';

@ApiTags('documents')
@ApiCookieAuth(SESSION_COOKIE)
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('applications/:id/documents')
  @RequirePermissions(Permission.DOCUMENT_READ)
  @ApiOkResponse({ type: [DocumentDto] })
  list(
    @CurrentUser() actor: AuthUser,
    @Param('id', new UuidParamPipe('Solicitação')) applicationId: string,
  ) {
    return this.documents.list(actor, applicationId);
  }

  @Post('applications/:id/documents')
  @RequirePermissions(Permission.DOCUMENT_UPLOAD)
  @UseInterceptors(
    FileInterceptor('file', {
      // Memory storage: the file is validated before anything is written to disk.
      limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 5, parts: 6 },
      defParamCharset: 'utf8',
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadDocumentBodyDoc })
  @ApiCreatedResponse({ type: DocumentDto })
  upload(
    @CurrentUser() actor: AuthUser,
    @Param('id', new UuidParamPipe('Solicitação')) applicationId: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.documents.upload(actor, applicationId, dto, file);
  }

  @Get('documents/:id/content')
  @RequirePermissions(Permission.DOCUMENT_READ)
  @ApiProduces('application/pdf', 'image/png', 'image/jpeg')
  @ApiOkResponse({ description: 'Sempre como anexo (Content-Disposition: attachment).' })
  async download(
    @CurrentUser() actor: AuthUser,
    @Param('id', new UuidParamPipe('Documento')) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { doc, stream } = await this.documents.openForDownload(actor, id);
    res.set({
      'Content-Type': doc.mimeType,
      'Content-Length': String(doc.sizeBytes),
      'Content-Disposition': attachmentDisposition(doc.originalName),
      'Cache-Control': 'no-store',
      // Even if a browser decided to render it, nothing inside may run.
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    return new StreamableFile(stream);
  }

  @Patch('documents/:id/validation')
  @RequirePermissions(Permission.DOCUMENT_VALIDATE)
  @ApiOkResponse({ type: DocumentDto })
  validate(
    @CurrentUser() actor: AuthUser,
    @Param('id', new UuidParamPipe('Documento')) id: string,
    @Body() dto: ValidateDocumentDto,
  ) {
    return this.documents.validate(actor, id, dto);
  }

  @Delete('documents/:id')
  @HttpCode(204)
  @RequirePermissions(Permission.DOCUMENT_UPLOAD)
  @ApiNoContentResponse({ description: 'Remoção lógica (o arquivo é mantido).' })
  remove(@CurrentUser() actor: AuthUser, @Param('id', new UuidParamPipe('Documento')) id: string) {
    return this.documents.remove(actor, id);
  }
}
