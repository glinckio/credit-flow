# ADR-0005 — Sessões opacas, RBAC default-deny e infraestrutura HTTP

- **Status:** Aceito
- **Data:** 25/11/2026
- **Detalha:** decisões D10–D14 e D17–D22 do plano

## Decisão

1. **Sessão opaca em cookie httpOnly**, token de 256 bits, banco guarda apenas SHA-256. Revogação imediata (logout, desativação, reset/troca de senha). Preferida a JWT porque o monólito consulta o banco de qualquer forma e revogação de JWT exigiria lista de bloqueio.
2. **AccessGuard global com default deny**: cada rota declara `@Public`, `@Authenticated` ou `@RequirePermissions`. Teste de integração enumera todas as rotas via `DiscoveryService` e falha se faltar declaração.
3. **Permissões recalculadas por requisição** a partir do usuário no banco (sem cache em sessão), para que alterações de papel valham imediatamente.
4. **CSRF como guard** (não middleware Express): assim o erro passa pelo filtro global e sai em Problem Details. Ordem dos guards globais: CSRF → Access.
5. **Rate limit só no login**, via `ThrottlerGuard` customizado (chave IP + e-mail). Não há throttler global.
6. **Contexto de requisição via `AsyncLocalStorage`** (`requestId`, IP, user-agent) consumido pela auditoria e pelos logs, sem dependência extra (`nestjs-cls` descartado).
7. **Repository fino apenas onde há consultas**: `UsersRepository` encapsula Prisma; regras ficam no service.
8. **`Algorithm` do `@node-rs/argon2` é `const enum` ambiente**: incompatível com `isolatedModules`; usamos o valor literal (2 = Argon2id) e um teste confere o prefixo `$argon2id$` do hash.

## Alternativas descartadas

- JWT access + refresh: mais peças (rotação, blocklist) sem ganho num monólito com banco.
- Token CSRF sincronizado: redundante com SameSite + header customizado + checagem de Origin, sem CORS.
- CASL / permissões em tabela: o roadmap dispensa permissões customizadas no MVP.

## Consequências

- Uma consulta à tabela `sessions` (com join em `users`) por requisição autenticada; escrita no máximo 1×/min por sessão.
- Rate limit em memória por instância.
