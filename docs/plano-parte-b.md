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

## B4 — entregue

**Narrativa por modelo** sobre os achados já verificados, nunca sobre o documento. Regras completas na decisão 11 do [ADR-0011](decisions/ADR-0011-ia-apoio-ao-analista.md).

- **Contrato** ([`narrative.ts`](../packages/shared/src/ai/narrative.ts)): `buildNarrativeInput` (ids, assuntos, tipos e "Documento N"; nenhum valor, nome ou nome de arquivo), `validateNarrative` (rejeita a narrativa inteira em qualquer violação) e `NarrativeStatus` (`OK`, `REJECTED`, `FAILED`, `SKIPPED_BUDGET`, `NOT_NEEDED`, `DISABLED`).
- **Adaptador** [`AnthropicNarrativeWriter`](../apps/api/src/modules/ai-analysis/narrative/anthropic-narrative-writer.ts): mesmo cliente, modelo e esforço da extração; prompt versionado (`narrative-v1`). A chamada estruturada ficou num helper comum ([`anthropic-structured-call.ts`](../apps/api/src/modules/ai-analysis/provider/anthropic-structured-call.ts)), com o mesmo tratamento de recusa, saída cortada e timeout.
- **Worker:** depois do template, uma chamada por execução, sujeita ao mesmo limite de custo; tokens e custo somam na execução; a auditoria `ai_analysis.completed` registra `narrativeStatus` (sem texto). O status da execução não depende da narrativa.
- **API:** `GET /ai-analyses/:runId` devolve `narrative` (do snapshot da conclusão). Com `declaredDataChanged = true`, a narrativa está desatualizada e o template atual prevalece. Expurgada junto com o snapshot.
- **Sem migration:** a narrativa fica dentro de `report_snapshot`.

**Avaliação:** `pnpm --filter @creditflow/api eval:narrative` usa a extração gravada (gratuita) e só envia as narrativas ao modelo. Offline, um escritor determinístico precisa passar na validação em 30/30 casos (teste). Com `--provider anthropic` mostra a estimativa; roda só com `--confirm` e autorização.

**Primeira rodada real (2026-11-27, `claude-haiku-5-5`, custo US$ 0,019):** 15/30 narrativas aceitas. Rejeições: 19 por `contradicts-finding-kind` e 1 frase sem referência. Nenhuma narrativa aceita trouxe termo de decisão, número fora de marcador ou ponto de atenção omitido. As aceitas foram conferidas uma a uma contra os achados. Dois falsos alarmes do validador foram corrigidos e cobertos por teste: palavra de atenção negada ("não há divergências") passa a contar como afirmação positiva, e "correspondente" deixou de casar com "corresponde". O eval agora mostra as frases rejeitadas e o motivo de cada uma, para a próxima rodada confirmar o efeito. O texto rejeitado continua sem ser gravado em produção.

**Segunda rodada real (custo US$ 0,018):** 13/30 aceitas. Essa rodada usou, por erro meu, o build antigo do `@creditflow/shared`: o eval roda sobre o `dist`, e a correção ainda não tinha sido compilada. Como o eval agora guarda as frases do modelo, as rejeitadas foram revalidadas sem custo (`eval:narrative --replay <relatório.json>`). A leitura dessas frases levou a mais três ajustes:

- valores com origem embutida: o marcador vira "R$ 4.100,00 (declarado)" / "bruto R$ 5.000,00 (no documento)". Assim o valor declarado não aparece como se fosse do documento, mesmo se o modelo montar mal a frase;
- código interno no texto ("CONSISTENT") é rejeitado;
- a negação de palavras e expressões de atenção vale só quando nega a existência ("não há", "nenhum", "sem", "não foram identificados"), na mesma oração.

No replay das 17 rejeitadas, 15 passam. As 2 que continuam barradas são legítimas: uma cita ids no texto ("conforme o achado F1"), a outra usa um código interno. Prompt em `narrative-v2`. As 13 aceitas na rodada não puderam ser revalidadas, porque só o texto já renderizado foi guardado. A próxima rodada paga mede o conjunto completo com o validador atual.

**Terceira rodada real (custo US$ 0,0193, validador e prompt atuais): 29/30 aceitas.** As 29 foram lidas contra os achados: nenhum valor trocado de origem, nenhum ponto de atenção omitido, nenhum termo de decisão. Ressalvas de redação, sem erro de fato: em `income-contradictory` o achado ambíguo é chamado de "divergência" numa frase; em `income-matches-gross`, "confere com valores do Documento 1" (o marcador mostra bruto e líquido, então o analista vê qual confere). A única rejeição (`misread-value`) foi "Recomenda-se conferência manual": o termo "recomenda" é barrado mesmo nesse uso inofensivo. A regra foi mantida estrita de propósito: o custo é perder a narrativa desse caso, e o template continua exibido.

## B5 — entregue

**Painel na aba Análise** ([`AiAnalysisPanel.tsx`](../apps/web/src/features/ai-analysis/AiAnalysisPanel.tsx)), visível para quem tem `ai_analysis.read`:

- Status da execução (na fila / em andamento, com atualização automática / concluída / parcial / falhou) e aviso fixo de que o relatório não é parecer nem decisão.
- Avisos: documentos mudaram desde a análise (`stale`), documentos não analisados (`PARTIAL`), dados declarados mudaram depois da conclusão (a narrativa passa a ser marcada como desatualizada), conteúdo expurgado, falha (a análise manual segue).
- Narrativa (só quando aceita pela validação), identificada como redigida por IA; pontos de atenção primeiro, com evidência por achado (página, trecho e se o trecho foi conferido no documento); itens que conferem recolhidos; documentos com status e alertas; limitações.
- **Histórico:** seletor de execuções e, para a selecionada, as mudanças em relação à anterior ([`diffFindings`](../packages/shared/src/ai/feedback.ts): achados novos, que não constam mais, com tipo diferente ou com valor diferente). As duas execuções são comparadas com os mesmos dados declarados atuais, então só documentos, modelo e pipeline explicam a diferença.
- **Reprocessar** (analista responsável, solicitação em análise): se os documentos não mudaram, a API responde `analysis-up-to-date` e a tela pede confirmação antes de enviar `force`.
- **Avaliação por achado** (analista responsável): "Correto" / "Incorreto" e comentário opcional (até 500 caracteres).

**API e banco:** migration `ai_finding_feedback` (uma avaliação por execução, achado e analista; enviar de novo substitui). `PUT /ai-analyses/:runId/findings/:findingId/feedback` (`ai_analysis.request` + responsável; `409 analysis-purged` depois do expurgo). O detalhe da execução devolve `feedback`. Auditoria `ai_analysis.feedback` com veredito, assunto e tipo do achado, sem o comentário. O expurgo apaga as avaliações junto com as extrações.

**E2E com respostas gravadas:** `AI_PROVIDER=recorded` lê `<AI_RECORDINGS_DIR>/<sha256>.json` no momento da chamada (sem rede, sem chave, sem custo; recusado em produção) e usa a narrativa determinística. O teste [`ai-analysis.spec.ts`](../e2e/tests/ai-analysis.spec.ts) monta documentos com camada de texto pela mesma DSL do eval, grava a resposta fiel e percorre: envio → primeira execução automática → divergência de renda com evidência → avaliação → reprocessar com confirmação → nenhuma mudança nos achados → parecer e status intactos. O fluxo principal também roda com a IA ligada (documentos sem gravação ficam "não analisados") e continua passando.

**Testes:** componentes do painel (10), `diffFindings`, integração do feedback (permissões, substituição, validação, auditoria sem comentário, expurgo), configuração do provedor gravado.
