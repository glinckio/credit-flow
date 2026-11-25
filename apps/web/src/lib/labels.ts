import type {
  ApplicationAction,
  ApplicationStatus,
  CreditProductType,
  CustomerStatus,
  CustomerType,
  DocumentType,
  DocumentValidationStatus,
  IssueStatus,
  ReviewRecommendation,
  Role,
} from '@creditflow/shared';
import type { BadgeProps } from '@/components/ui/badge';

/** Portuguese labels for enum values shown in the UI. */
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrador',
  ANALYST: 'Analista de crédito',
  OPERATOR: 'Operador',
};

export const CUSTOMER_TYPE_LABELS: Record<CustomerType, string> = {
  INDIVIDUAL: 'Pessoa física',
  COMPANY: 'Pessoa jurídica',
};

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
};

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  DRAFT: 'Rascunho',
  SUBMITTED: 'Aguardando análise',
  UNDER_REVIEW: 'Em análise',
  PENDING_INFORMATION: 'Pendente de informação',
  APPROVED: 'Aprovada',
  REJECTED: 'Reprovada',
  CANCELLED: 'Cancelada',
};

export const APPLICATION_STATUS_BADGE: Record<ApplicationStatus, BadgeProps['variant']> = {
  DRAFT: 'secondary',
  SUBMITTED: 'default',
  UNDER_REVIEW: 'default',
  PENDING_INFORMATION: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  CANCELLED: 'secondary',
};

export const PRODUCT_LABELS: Record<CreditProductType, string> = {
  PERSONAL_LOAN: 'Empréstimo pessoal',
  PAYROLL_LOAN: 'Consignado',
  VEHICLE_FINANCING: 'Financiamento de veículo',
  WORKING_CAPITAL: 'Capital de giro',
  EQUIPMENT_FINANCING: 'Financiamento de equipamento',
  OTHER: 'Outro',
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  IDENTIFICATION: 'Documento de identificação',
  PROOF_OF_ADDRESS: 'Comprovante de endereço',
  PROOF_OF_INCOME: 'Comprovante de renda/faturamento',
  BANK_STATEMENT: 'Extrato/documento financeiro',
  OTHER: 'Outro',
};

export const VALIDATION_STATUS_LABELS: Record<DocumentValidationStatus, string> = {
  PENDING: 'Não validado',
  ACCEPTED: 'Aceito',
  REJECTED: 'Rejeitado',
};

export const VALIDATION_STATUS_BADGE: Record<DocumentValidationStatus, BadgeProps['variant']> = {
  PENDING: 'secondary',
  ACCEPTED: 'success',
  REJECTED: 'destructive',
};

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  OPEN: 'Aberta',
  RESOLVED: 'Resolvida',
};

export const RECOMMENDATION_LABELS: Record<ReviewRecommendation, string> = {
  APPROVE: 'Aprovar',
  REJECT: 'Reprovar',
  REQUEST_INFORMATION: 'Solicitar informações',
};

export const ACTION_LABELS: Record<ApplicationAction, string> = {
  submit: 'Enviar para análise',
  'start-review': 'Assumir análise',
  assign: 'Atribuir analista',
  release: 'Devolver à fila',
  'request-information': 'Solicitar informações',
  resume: 'Devolver para análise',
  cancel: 'Cancelar solicitação',
  reopen: 'Reabrir solicitação',
  approve: 'Aprovar',
  reject: 'Reprovar',
};
