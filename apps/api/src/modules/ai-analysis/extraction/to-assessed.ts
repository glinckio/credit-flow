import type { AssessedDocument, AssessedField, DocumentType } from '@creditflow/shared';
import type { DocumentAssessment, FieldAssessment } from './assess-extraction.js';

/** Stored/served shape of a field (also the input of the comparison). */
export function toAssessedField(f: FieldAssessment): AssessedField {
  return {
    key: f.key,
    modelStatus: f.modelStatus,
    modelValue: f.modelValue,
    page: f.page,
    quote: f.quote,
    evidenceStatus: f.evidence?.status ?? null,
    evidenceReason: f.evidence && 'reason' in f.evidence ? f.evidence.reason : null,
    acceptedValue: f.acceptedValue,
    rejectedBy: f.rejectedBy,
  };
}

export function toAssessedDocument(
  documentId: string,
  declaredType: DocumentType,
  a: DocumentAssessment,
): AssessedDocument {
  return {
    documentId,
    declaredType,
    status: a.status,
    detectedType: a.detectedType,
    typeMatchesDeclared: a.typeMatchesDeclared,
    hasTextLayer: a.hasTextLayer,
    injectionAlert: a.injection.alert,
    fields: a.fields.map(toAssessedField),
  };
}
