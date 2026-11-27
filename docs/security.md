# Segurança — CreditFlow (Parte A)

Estado atual: Parte A concluída (backend, frontend e testes ponta a ponta).

## Autenticação

| Aspecto          | Implementação                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Credencial       | e-mail + senha. Senha: mín. 12, máx. 128 caracteres                                                                                                                                        |
| Hash             | Argon2id (`@node-rs/argon2`), m=19 MiB, t=2, p=1 (baseline OWASP). Parâmetros ficam no próprio hash                                                                                        |
| Sessão           | token aleatório de 256 bits em cookie `cf_session` (`HttpOnly`, `SameSite=Lax`, `Path=/api`, `Secure` em produção). No banco só o SHA-256 do token                                         |
| Expiração        | deslizante, `SESSION_TTL_HOURS` (padrão 8h); renovação gravada no máximo 1×/min                                                                                                            |
| Revogação        | logout; desativação do usuário; reset de senha pelo admin; troca de senha (encerra as demais sessões)                                                                                      |
| Falhas de login  | resposta idêntica para e-mail inexistente, senha errada ou usuário inativo; hash "dummy" verificado quando o e-mail não existe (tempo de resposta semelhante); motivo real só na auditoria |
| Força bruta      | `LOGIN_RATE_LIMIT` tentativas/min por IP + e-mail (padrão 5) → 429                                                                                                                         |
| Senha temporária | usuários criados ou resetados pelo admin ficam com `mustChangePassword`; até trocarem só acessam `/auth/me`, `/auth/logout`, `/auth/change-password`                                       |

Recuperação de senha por e-mail não existe no MVP (decisão 6.5 do plano): o admin redefine uma senha temporária.

## Autorização (RBAC)

- Matriz papel → permissões em [`packages/shared/src/permissions.ts`](../packages/shared/src/permissions.ts), testada combinação a combinação.
- `application.decide`: ANALYST sempre; OPERATOR só com `canDecide`; ADMIN nunca (segregação de funções). `canDecide` só pode ser concedido a OPERATOR.
- `AccessGuard` global, **default deny**: toda rota precisa declarar `@Public()`, `@Authenticated()` ou `@RequirePermissions(...)`. Rota sem declaração responde 403, e um teste de integração varre todos os controllers e falha se alguma rota não declarar.
- Permissões são recalculadas a cada requisição a partir do usuário no banco: mudança de papel/concessão vale na hora.
- IDs malformados e inexistentes respondem 404 igual (não revelam existência).
- Além da permissão da rota, o service reaplica a máquina de estados (status + permissão) e regras de objeto: analista não vê rascunhos (404); ações de análise só pelo responsável (`403 not-assignee`); cancelar em análise e reabrir só admin.

## CSRF

Cookie `SameSite=Lax` **+** cabeçalho obrigatório `X-Requested-With` em métodos que alteram estado **+** rejeição de `Origin` diferente de `WEB_ORIGIN`. CORS desabilitado (front e API na mesma origem via proxy do Vite).

## HTTP

- `helmet` (inclui `X-Content-Type-Options: nosniff`, CSP padrão, `X-Frame-Options`), `x-powered-by` desligado.
- Validação global de DTOs: propriedades desconhecidas são **rejeitadas** (não ignoradas).
- Erros em RFC 9457 (`application/problem+json`) com `requestId`; erros inesperados nunca expõem stack, SQL ou mensagens internas.
- `X-Request-Id` aceito se bem-formado (8–64 `[A-Za-z0-9-]`), senão gerado; devolvido na resposta e gravado na auditoria.

## Documentos

Detalhes em [ADR-0007](decisions/ADR-0007-documentos.md):

- Allowlist PDF/PNG/JPEG por **assinatura do conteúdo**; extensão precisa corresponder; MIME do navegador ignorado; 10 MB.
- Armazenados fora de pasta pública, com chave UUID opaca, sem extensão, permissão 0600; nenhum dado do usuário compõe o caminho.
- Nunca executados nem servidos inline: download autorizado com `attachment`, `nosniff`, `no-store` e CSP `sandbox`; cada download é auditado.
- Sem antivírus no MVP (limite conhecido).

## Logs

JSON estruturado (pino). Nunca registram corpo nem query string. Redação de `cookie`, `authorization`, `set-cookie`, senhas, hashes, tokens, `documentNumber`, `email`, `phone`. Health check não é logado. Verificado manualmente com o servidor real: nenhum e-mail, cookie, senha ou hash nos logs.

## Auditoria

- Gravada **na mesma transação** da alteração (`AuditService.record(tx, …)`).
- Ator, data/hora, ação, entidade, `before`/`after` com campos permitidos, `requestId`, IP, user-agent.
- Rede de segurança: chaves que pareçam segredo (`password`, `token`, `hash`, `secret`, `cookie`, `authorization`) são descartadas em qualquer profundidade.
- Tabela append-only (trigger no banco).
- Consulta apenas por administradores (`audit.read`), paginada e filtrável; ids `BIGINT` expostos como string.

Eventos atuais: `auth.login_succeeded`, `auth.login_failed` (com motivo), `auth.logout`, `auth.password_changed`, `user.created`, `user.updated`, `user.deactivated`, `user.activated`, `user.password_reset`, `customer.created` (só tipo e status — os dados pessoais ficam no próprio registro), `customer.updated` (somente os campos alterados, com valor anterior e novo), `application.created`, `application.updated` (campos alterados), `application.status_changed` (com motivo e transição), `application.assigned`, `issue.created`, `issue.resolved`, `document.uploaded` (metadados e SHA-256, sem nome original), `document.downloaded`, `document.validated`, `document.removed`, `review.created`, `decision.recorded` (resultado, justificativa e parecer referenciado).

## Verificação

Além das suítes de integração, o teste ponta a ponta confirma no navegador real que um operador autenticado recebe 403 ao chamar diretamente rotas de administração e de decisão, e que uma requisição mutável sem o cabeçalho CSRF é recusada mesmo com sessão válida.

## Limites conhecidos

- Sem bloqueio de conta após N falhas (só rate limit), sem MFA.
- Rate limit em memória: vale por instância da API (suficiente para o MVP de instância única).
- CSP padrão do helmet também se aplica ao Swagger UI (verificado: renderiza).

## IA de apoio (Parte B)

Decisões em [ADR-0011](decisions/ADR-0011-ia-apoio-ao-analista.md); estado atual em [plano-parte-b.md](plano-parte-b.md).

- A IA não altera solicitação, documentos, pareceres nem decisões; nenhuma rota de IA escreve fora das tabelas `ai_*`.
- Leitura: `ai_analysis.read` (analista, admin, operador com `canDecide`) + mesma visibilidade da solicitação (rascunho oculto → 404). Reprocessar: `ai_analysis.request` + analista responsável.
- Conteúdo de documento é dado não confiável: chamada sem ferramentas, saída validada por código, valores só viram fato com evidência verificada; documento com texto dirigido a uma IA não gera fato.
- Logs e auditoria nunca contêm valores extraídos nem trechos de documento; o expurgo remove o conteúdo após `AI_RETENTION_DAYS`.
- Somente dados sintéticos no piloto. `AI_PROVIDER` só aceita `disabled` até a etapa B3.
- PDFs são lidos pelo PDF.js apenas para extrair texto (sem renderização, sem fontes, sem XFA); falha de leitura = documento sem camada de texto.
- `ANTHROPIC_API_KEY` só no `.env` (gitignored); a validação de ambiente nunca ecoa o valor; erros do provedor são registrados só com classe e status.
