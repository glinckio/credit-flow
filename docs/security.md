# Segurança — CreditFlow (Parte A)

Estado atual: Etapa 4 (autenticação, autorização, auditoria, infraestrutura HTTP, clientes). Atualizado a cada etapa.

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

## CSRF

Cookie `SameSite=Lax` **+** cabeçalho obrigatório `X-Requested-With` em métodos que alteram estado **+** rejeição de `Origin` diferente de `WEB_ORIGIN`. CORS desabilitado (front e API na mesma origem via proxy do Vite).

## HTTP

- `helmet` (inclui `X-Content-Type-Options: nosniff`, CSP padrão, `X-Frame-Options`), `x-powered-by` desligado.
- Validação global de DTOs: propriedades desconhecidas são **rejeitadas** (não ignoradas).
- Erros em RFC 9457 (`application/problem+json`) com `requestId`; erros inesperados nunca expõem stack, SQL ou mensagens internas.
- `X-Request-Id` aceito se bem-formado (8–64 `[A-Za-z0-9-]`), senão gerado; devolvido na resposta e gravado na auditoria.

## Logs

JSON estruturado (pino). Nunca registram corpo nem query string. Redação de `cookie`, `authorization`, `set-cookie`, senhas, hashes, tokens, `documentNumber`, `email`, `phone`. Health check não é logado. Verificado manualmente com o servidor real: nenhum e-mail, cookie, senha ou hash nos logs.

## Auditoria

- Gravada **na mesma transação** da alteração (`AuditService.record(tx, …)`).
- Ator, data/hora, ação, entidade, `before`/`after` com campos permitidos, `requestId`, IP, user-agent.
- Rede de segurança: chaves que pareçam segredo (`password`, `token`, `hash`, `secret`, `cookie`, `authorization`) são descartadas em qualquer profundidade.
- Tabela append-only (trigger no banco).

Eventos atuais: `auth.login_succeeded`, `auth.login_failed` (com motivo), `auth.logout`, `auth.password_changed`, `user.created`, `user.updated`, `user.deactivated`, `user.activated`, `user.password_reset`, `customer.created` (só tipo e status — os dados pessoais ficam no próprio registro), `customer.updated` (somente os campos alterados, com valor anterior e novo).

## Limites conhecidos

- Sem bloqueio de conta após N falhas (só rate limit), sem MFA.
- Rate limit em memória: vale por instância da API (suficiente para o MVP de instância única).
- CSP padrão do helmet também se aplica ao Swagger UI (verificado: renderiza).
