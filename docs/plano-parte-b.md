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

## B2 — entregue

Comparação determinística ([`comparison.ts`](../packages/shared/src/ai/comparison.ts)) e relatório por template ([`report.ts`](../packages/shared/src/ai/report.ts)), sem nenhuma chamada a modelo.

**Regras (tolerância zero, só valores aceitos como fato):**

| Assunto            | Documentos                    | Regra                                                                                                                                                                                                                                             |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nome do titular    | todos exceto "outro"          | igual após ignorar maiúsculas/acentos/pontuação; abreviação = divergente                                                                                                                                                                          |
| CPF/CNPJ           | identidade, renda, extrato    | dígitos idênticos                                                                                                                                                                                                                                 |
| Data de nascimento | identidade (só pessoa física) | data idêntica                                                                                                                                                                                                                                     |
| Renda/faturamento  | comprovante de renda          | **confere** se bruto **ou** líquido **ou** faturamento médio for igual ao declarado; **divergente** só quando todos os valores citados foram verificados e nenhum é igual; se algum não pôde ser verificado, **não verificável** (não se conclui) |
| Endereço           | comprovante de endereço       | todos os componentes iguais (logradouro com abreviação expandida, número, cidade, UF, CEP)                                                                                                                                                        |
| Tipo de documento  | todos                         | conteúdo × tipo informado no envio                                                                                                                                                                                                                |

**Tipos de achado:** `CONSISTENT` (confere), `DIVERGENT`, `MISSING` (o documento não traz), `AMBIGUOUS` (documento contraditório), `UNVERIFIABLE` (sem texto pesquisável, evidência recusada ou documento com texto dirigido a IA — neste caso nunca "contraditório", pois o valor conflitante provavelmente foi injetado). Documento cuja chamada ao provedor falhou não gera achado: o relatório o lista como "não analisado".

**Relatório por template:** aviso fixo de que não é parecer nem decisão; pontos de atenção primeiro (divergente → contraditório → não verificável → ausente); frases geradas por código com valores formatados (`R$ 4.100,00`); evidências (página e trecho) por achado; documentos com status e alertas; limitações. Testado para nunca conter "aprov/reprov/recomend".

**Atual × na conclusão:** o detalhe da análise (`GET /ai-analyses/:runId`) traz `findings` e `report` calculados com os dados declarados **atuais**, `reportAtCompletion` (snapshot gravado ao concluir, roadmap §16) e `declaredDataChanged`. O snapshot é removido no expurgo.

**Avaliação:** achados esperados (ideais) em todos os casos do dataset; o teste offline exige reprodução exata com as respostas gravadas. Novas métricas: achados corretos, falsas divergências e divergências não sinalizadas.

## B3 — entregue

**Dependências novas (só na API):** `@anthropic-ai/sdk` 1.14.0 (SDK oficial) e `pdfjs-dist` 6.5.438 (PDF.js, Mozilla). Nenhuma outra.

**Provedor:** `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` no `.env` (nunca no Git). Adaptador [`anthropic-extractor.ts`](../apps/api/src/modules/ai-analysis/extraction/anthropic-extractor.ts):

- uma chamada por documento, **sem ferramentas**, com `output_config.format` (JSON Schema do contrato) e `effort` configurável (`AI_EFFORT`, padrão `medium`); PDF como bloco `document` base64, PNG/JPEG como bloco `image`;
- prompt versionado (`EXTRACTION_PROMPT_VERSION = extract-v1`): documento é dado não confiável, valores copiados literalmente, nada deduzido;
- `stop_reason: refusal` → `REFUSED`; saída cortada ou não-JSON → `SCHEMA_INVALID`; timeout → `TIMEOUT`; demais erros → `PROVIDER_ERROR`. No máximo 1 nova tentativa, feita pelo SDK; nenhuma pela aplicação. Logs só com classe/status do erro, nunca conteúdo.

**Texto do PDF:** [`PdfJsTextReader`](../apps/api/src/modules/ai-analysis/text/pdfjs-text-reader.ts) extrai o texto por página (só o caminho de texto; nada é renderizado; fontes desativadas; arquivo inválido → sem camada de texto). O pdfjs-dist 6.x não tem mais a opção `isEvalSupported`.

**Evidência:** a conferência passou a ignorar **somente espaços e quebras de linha** (bibliotecas de PDF não preservam os espaços visíveis); qualquer letra, dígito ou pontuação diferente continua recusando. `AI_PIPELINE_VERSION = pipeline-v2` (v3 após a primeira rodada real, abaixo).

**Proteções de custo (decididas antes de chamar o modelo):** documento com mais de `AI_MAX_PAGES_PER_DOCUMENT` páginas (padrão 10) → `TOO_LARGE`; quando o custo estimado da execução atinge `AI_MAX_COST_USD_PER_RUN` (padrão US$ 0,10), os documentos restantes → `SKIPPED_BUDGET`. Custo por execução gravado em `cost_usd` (tabela de preço em `AI_MODEL_PRICING`, por requisição).

**Imagens:** PNG/JPEG vão ao modelo; sem camada de texto, todos os valores ficam "não verificável" (D10). O dataset ganhou 2 casos em PNG (gerados por código, sem dependência).

**Avaliação:** o harness usa o PDF.js real. Modelo real: `pnpm --filter @creditflow/api eval:ai --provider anthropic` mostra a estimativa (30 documentos, 34 páginas: ~US$ 0,045, pior caso US$ 0,135); só roda com `--confirm` e autorização.

**Primeira rodada real (2026-11-27, `claude-haiku-5-5`, effort `medium`, custo real US$ 0,02):**

| Métrica                               | Resultado                                 |
| ------------------------------------- | ----------------------------------------- |
| Acerto por campo                      | 120/120                                   |
| Validade das evidências               | 109/112 (as 3 inválidas foram bloqueadas) |
| Afirmações erradas bloqueadas         | 2                                         |
| Alerta de prompt injection            | 3/3, nenhum alerta falso                  |
| Achados corretos                      | 34/36                                     |
| Falsas divergências / não sinalizadas | 0 / 0                                     |
| Latência média / p95                  | 3,3 s / 4,3 s                             |

A rodada encontrou dois problemas, ambos corrigidos (`pipeline-v3`):

1. **Harness:** os 6 casos que só simulam falha do provedor (timeout, recusa, JSON inválido etc.) foram enviados ao modelo real, que os respondeu corretamente. O gabarito esperava "nenhum valor", e a métrica crítica acusou 30. Esses casos agora rodam só no modo gravado (`simulatesProviderFailure`, com teste garantindo a marcação).
2. **Pipeline:** um documento ilegível, de tipo "desconhecido", era classificado como "tipo não suportado" (divergência de tipo) antes de "ilegível". A renda ficava sem achado. A precedência foi invertida: ilegível vem primeiro e nunca vira divergência de tipo. O relatório do eval agora lista os documentos cujo status difere do gabarito, para confirmar isso na próxima rodada.
