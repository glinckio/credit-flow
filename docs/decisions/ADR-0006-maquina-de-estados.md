# ADR-0006 — Máquina de estados da solicitação e concorrência

- **Status:** Aceito
- **Data:** 25/11/2026
- **Detalha:** seção 3.3 e D19 do plano

## Decisão

1. **Tabela de transições única em `@creditflow/shared`** (`application-state-machine.ts`): status de origem, status de destino, permissões aceitas (qualquer uma) e motivo obrigatório. Backend usa para impor; frontend usará para exibir ações (`availableActions` já vem em cada solicitação). Teste unitário cobre as 70 combinações status × ação contra uma tabela escrita à mão a partir do plano.
2. **Um único caminho de transição no backend** (`ApplicationsService.transition`): checa máquina → permissão → regras contextuais (responsável, pendências abertas, documentos obrigatórios) → `UPDATE ... WHERE id = ? AND status = ?` → histórico → auditoria, tudo em uma transação. Se o `UPDATE` condicional não afeta linha, outra requisição venceu: `409 concurrent-modification`. Teste de integração dispara duas "assumir análise" simultâneas e verifica que exatamente uma vence.
3. **Edição com `version`** (optimistic locking) e somente em `DRAFT`/`PENDING_INFORMATION`.
4. **Visibilidade**: quem não tem `application.write` (analista) não vê rascunhos; respondem 404 como inexistentes.
5. **Regras contextuais**:
   - Pendências, solicitação de informação e liberação: só o **analista responsável** (`403 not-assignee`). Admin pode liberar/reatribuir.
   - `request-information` exige ≥ 1 pendência aberta.
   - `submit` exige documentos ativos de identificação e de renda (`422 missing-required-documents` com a lista).
   - Cancelar em `UNDER_REVIEW` é exclusivo do admin; reabrir (`CANCELLED → SUBMITTED`) só admin, com motivo, limpa responsável e `closedAt`.
   - Reatribuição sem mudança de status grava auditoria `application.assigned`, não linha de histórico de status.
6. **Ajustes em relação ao plano**: `assign` também vale em `PENDING_INFORMATION` (troca de analista sem perder as pendências); `release` aceita `application.review` (responsável) **ou** `application.assign` (admin) — nova regra de acesso `@RequireAnyPermission`.

## Limitação conhecida

O Prisma 7.10.1 (`@prisma/adapter-pg`) executa algumas consultas de relações em paralelo dentro de transações interativas; o `pg` 8.23 emite `DeprecationWarning: Calling client.query() when the client is already executing a query`. Hoje o `pg` enfileira as consultas e o comportamento é correto; o aviso vira erro apenas no `pg` 9. Ação: não atualizar para `pg` 9 antes de o adapter do Prisma suportar.

## Consequências

- Nenhuma mudança de status fora do `transition` (revisão de código deve rejeitar `update` direto de `status`).
- As decisões finais (Etapa 7) reutilizam o mesmo pipeline com as ações `approve`/`reject`, já presentes na tabela.
