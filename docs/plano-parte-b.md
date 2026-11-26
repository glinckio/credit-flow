# Plano — Parte B: IA de apoio ao analista

Decisões e justificativas: [ADR-0011](decisions/ADR-0011-ia-apoio-ao-analista.md). Este documento guarda o roteiro, os contratos e os critérios de aceite.

## Fluxo alvo

```
Solicitação entra em UNDER_REVIEW pela 1ª vez (ou analista clica "Reprocessar")
  └ Gate determinístico: permissão, status, responsável, flag, limites, idempotência
  └ Execução QUEUED → worker no processo da API (Postgres como fila)
      1. Carrega documentos pela porta DocumentStorage; confere sha256
      2. Por documento: 1 chamada ao modelo (classificação + extração), sem ferramentas
      3. Verificação de evidência + normalização + comparação com a solicitação (código)
      4. Relatório: template determinístico + narrativa (modelo, só com fatos verificados)
  └ SUCCEEDED | PARTIAL | FAILED, com custo, tokens, latência e auditoria
```

## Etapas

| Etapa  | Escopo                                                                                                                                                            | Critérios de aceite                                                                                                                                       |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B0** | ADR, contratos em `@creditflow/shared/ai`, dataset sintético com gabarito, porta do extrator + extrator gravado (fake), harness de avaliação offline              | Casos do §15 cobertos; gerador determinístico; harness roda sem rede e sem custo; nenhuma dependência nova; lint/typecheck/testes passam                  |
| **B1** | Tabelas e migrations, ciclo de vida da execução, worker, API, permissões, auditoria, disparo na 1ª entrada em análise, reprocessamento manual, expurgo de 90 dias | Testes de integração: RBAC, responsável, status, idempotência, concorrência, desatualização, retomada de execução órfã, falha não bloqueia o fluxo humano |
| **B2** | Comparação determinística (tolerância zero) e relatório por template                                                                                              | Testes unitários por regra; gabarito de achados do dataset atendido                                                                                       |
| **B3** | Biblioteca de texto de PDF, adaptador Anthropic (Haiku 5.5), suporte a imagens (PNG/JPEG, evidência `UNVERIFIABLE`), casos de imagem no dataset                   | Saída fora do schema rejeitada; injection sem efeito e com alerta; timeout/recusa → fallback seguro; **baseline medida** com autorização                  |
| **B4** | Narrativa por modelo, com números inseridos pelo backend e frases referenciando achados; fallback para template                                                   | Nenhuma frase sem referência ou com termo de decisão é exibida; avaliação com autorização                                                                 |
| **B5** | UI: painel na aba Análise, evidências, desatualização, reprocessar, histórico, diferenças entre execuções, feedback por achado                                    | Testes de componentes + E2E com extrator gravado; avisos visíveis; nenhum campo de parecer/decisão alterado                                               |
| **B6** | Observabilidade de custo/qualidade; regressão obrigatória ao trocar modelo, prompt ou schema                                                                      | Eval bloqueia a troca se as métricas piorarem                                                                                                             |

## Contratos (B0)

Em [`packages/shared/src/ai`](../packages/shared/src/ai):

- **Catálogo de campos por tipo de documento** (`document-fields.ts`): chave, tipo de valor e rótulos esperados (usados na verificação de evidência).
- **Resultado da extração** (`extraction.ts`): `detectedType`, `legibility` (`OK | PARTIAL | ILLEGIBLE`), `embeddedInstructionsDetected` e `fields[]` com `status` (`FOUND | NOT_FOUND | AMBIGUOUS | ILLEGIBLE`), `value`, `page`, `quote`. Versão `EXTRACTION_SCHEMA_VERSION`; JSON Schema para a saída estruturada; validador em código (a saída do modelo é sempre revalidada).
- **Normalização** (`normalize.ts`): moeda BRL → centavos exatos, datas `dd/mm/aaaa`, mês de referência, dígitos, CEP, texto (maiúsculas/acentos/espaços), abreviações de logradouro. Só formatação; nunca arredonda.
- **Verificação de evidência** (`evidence.ts`): `VERIFIED | UNVERIFIED | UNVERIFIABLE` com motivo.
- **Detector de instruções embutidas** (`injection.ts`): padrões de texto que se dirigem a um sistema/IA.

Na API, [`src/modules/ai-analysis/extraction`](../apps/api/src/modules/ai-analysis/extraction): porta `DocumentExtractor`, `RecordedExtractor` (respostas gravadas, indexadas por sha256) e `assessExtraction` (resultado do provedor + texto das páginas → avaliação do documento).

## Avaliação

Dataset em [`apps/api/evals`](../apps/api/evals): casos versionados com gabarito; os arquivos são gerados de forma determinística em `var/evals/` (não versionados).

| Caso (roadmap §15 + riscos)                               | Comportamento esperado                             |
| --------------------------------------------------------- | -------------------------------------------------- |
| Documento legível e completo                              | Campos verificados, iguais ao gabarito             |
| Documento incompleto                                      | Campo ausente → `NOT_FOUND`, nunca preenchido      |
| Documento ilegível / sem camada de texto                  | `UNREADABLE` ou campos `UNVERIFIABLE`              |
| Campos contraditórios                                     | `AMBIGUOUS`, nenhum valor aceito como fato         |
| Tipo não suportado                                        | `UNSUPPORTED`                                      |
| Dados que não correspondem à solicitação                  | Valores verificados; divergência apontada na B2    |
| Prompt injection                                          | Alerta; nenhum valor injetado aceito sem evidência |
| Resposta fora do schema                                   | `SCHEMA_INVALID`                                   |
| Timeout / indisponibilidade / recusa                      | `TIMEOUT` / `PROVIDER_ERROR` / `REFUSED`           |
| Extração inventada / valor lido errado                    | `UNVERIFIED`; nada aceito como fato                |
| Renda bruto × líquido, nome abreviado, endereço abreviado | Regras de comparação da B2                         |

Métricas: acerto por campo, validade da evidência, **afirmações sem suporte aceitas (deve ser 0)**, afirmações sem suporte bloqueadas, taxa de fallback seguro, alerta de injection, latência e custo. Precisão de divergências entra na B2; correções do analista, na B5. **Sem metas numéricas antes da baseline (B3).**

Comandos:

```bash
pnpm --filter @creditflow/api eval:dataset   # gera os arquivos sintéticos em var/evals/dataset
pnpm --filter @creditflow/api eval:ai        # roda a avaliação com o extrator gravado (offline)
```

Rodadas com o modelo real (B3+) só com autorização explícita a cada rodada, apresentando antes os resultados atuais.

## B1 — entregue

**Banco** (migration `ai_analysis`):

- `ai_analysis_runs`: uma execução por pedido; `status` `QUEUED → RUNNING → SUCCEEDED | PARTIAL | FAILED`; gatilho (`AUTO_FIRST_REVIEW` | `MANUAL`); impressão digital da entrada; modelo e versões; tokens, custo (B3) e latência; lease do worker; `purged_at`. Índice único parcial: **no máximo uma execução ativa por solicitação**. CHECKs: execução terminada tem `finished_at`; `FAILED` tem `error_code`.
- `ai_document_extractions`: resultado por documento (status, tipo detectado, camada de texto, alerta de injection com ids dos padrões, campos com evidência). **Write-once** (trigger proíbe `UPDATE`); `DELETE` só pelo expurgo.

**Fluxo:**

- **Disparo automático** só na **primeira** entrada da solicitação em `UNDER_REVIEW` (via notificação pós-commit do `ApplicationsService`: uma falha da IA nunca desfaz nem bloqueia a transição humana).
- **Reprocessar** (`POST /applications/:id/ai-analyses`, 202): analista responsável, solicitação em `UNDER_REVIEW`, nenhuma execução ativa (`409 analysis-in-progress`). Sem mudança nos documentos desde a última análise → `409 analysis-up-to-date`; com `{"force": true}` refaz.
- **Worker** no processo da API, Postgres como fila (`FOR UPDATE SKIP LOCKED`), um documento por vez. **Sem retentativa automática**: execução com lease vencido vira `FAILED/interrupted`. Falha de provedor por documento → `PARTIAL`; todos falharam → `FAILED/all-documents-failed`. Arquivo que não bate com o sha256 → `FAILED/document-integrity`.
- **Expurgo** (`AI_RETENTION_DAYS`, padrão 90): apaga as extrações; a execução mantém só metadados e a auditoria registra `ai_analysis.purged` sem valores. Roda mesmo com a IA desativada.
- **Desatualização** (`stale`): a impressão digital (sha256 dos documentos + modelo + versões) difere da atual. A versão da solicitação não entra (muda a cada transição); a comparação com os dados declarados (B2) é recalculada na leitura.

**API:** `GET /applications/:id/ai-analyses`, `POST /applications/:id/ai-analyses`, `GET /ai-analyses/:runId`. Permissões `ai_analysis.read` (analista, admin, operador com `canDecide`) e `ai_analysis.request` (analista; o serviço exige ser o responsável).

**Auditoria:** `ai_analysis.requested`, `.completed`, `.failed`, `.purged` — somente metadados (status, modelo, contagens, tokens), nunca valores extraídos.

**Configuração:** `AI_PROVIDER` (só `disabled` até a B3), `AI_MODEL` (lista fechada), `AI_WORKER_POLL_MS`, `AI_LEASE_MS`, `AI_RETENTION_DAYS`, `AI_MAX_DOCUMENTS_PER_RUN`. Com a IA desativada nada é enfileirado e o pedido manual responde `503 ai-disabled`.

**Limite conhecido até a B3:** sem biblioteca de PDF, o leitor padrão informa "sem camada de texto", então nenhum valor é aceito como fato em produção — comportamento conservador e intencional. Os testes usam um leitor dos PDFs sintéticos.
