import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DocumentType, ExtractedFieldKey as K, formatCpf } from '@creditflow/shared';
import { F, buildDocument, materialize } from '../../apps/api/evals/dataset/builder.js';
import { E2E_AI_RECORDINGS_DIR, REPO_ROOT } from './env.js';

/**
 * Synthetic documents with a text layer, built by the same DSL as the offline
 * evaluation, plus the faithful model answer recorded under their sha256. The
 * API runs with AI_PROVIDER=recorded and reads that answer: no network, no cost.
 */
export interface RecordedDocument {
  fileName: string;
  bytes: Buffer;
}

function record(fileName: string, doc: ReturnType<typeof buildDocument>): RecordedDocument {
  const { bytes, sha256 } = materialize(doc);
  const dir = resolve(REPO_ROOT, E2E_AI_RECORDINGS_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sha256}.json`), JSON.stringify(doc.recorded));
  return { fileName, bytes };
}

export function identificationPdf(p: { name: string; cpf: string; birth: string }) {
  return record(
    'rg-ia-e2e.pdf',
    buildDocument({
      caseId: 'e2e',
      id: 'identidade',
      declaredType: DocumentType.IDENTIFICATION,
      pages: [
        {
          lines: [
            'CARTEIRA DE IDENTIDADE (FICTICIA)',
            F(K.HOLDER_NAME, 'Nome', p.name),
            F(K.HOLDER_TAX_ID, 'CPF', formatCpf(p.cpf)),
            F(K.BIRTH_DATE, 'Data de nascimento', p.birth),
          ],
        },
      ],
    }),
  );
}

export function payslipPdf(p: { name: string; cpf: string; gross: string; net: string }) {
  return record(
    'holerite-ia-e2e.pdf',
    buildDocument({
      caseId: 'e2e',
      id: 'renda',
      declaredType: DocumentType.PROOF_OF_INCOME,
      pages: [
        {
          lines: [
            'HOLERITE - DEMONSTRATIVO DE PAGAMENTO',
            F(K.HOLDER_NAME, 'Funcionario', p.name),
            F(K.HOLDER_TAX_ID, 'CPF', formatCpf(p.cpf)),
            F(K.REFERENCE_MONTH, 'Competencia', '10/2026'),
            F(K.GROSS_MONTHLY_INCOME, 'Total de vencimentos (bruto)', p.gross),
            'Descontos: INSS e IRRF',
            F(K.NET_MONTHLY_INCOME, 'Liquido a receber', p.net),
          ],
        },
      ],
    }),
  );
}
