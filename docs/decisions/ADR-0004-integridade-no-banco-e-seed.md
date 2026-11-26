# ADR-0004 — Regras de integridade no banco e seed determinístico

- **Status:** Aceito
- **Data:** 25/11/2026

## Contexto

Prisma não modela CHECK constraints nem triggers. Regras críticas (formato de identificadores, valores positivos, tabelas imutáveis) não devem depender só do código da aplicação. O seed precisa ser reproduzível e não pode conter credenciais nem dados reais.

## Decisão

1. **CHECK constraints e triggers append-only** escritos à mão na migration inicial (seção "Hand-written additions"), cobertos por teste de integração (`test/integration/schema.int-spec.ts`).
2. **Código da solicitação derivado** (`CF-AAAA-000123` = ano de criação + `number` sequencial), em vez de coluna armazenada. Evita duas fontes da verdade. (Ajuste em relação ao plano, que previa coluna `code`.)
3. **Enums duplicados** em Prisma e `@creditflow/shared` (o front não pode importar o client Prisma); um teste compara `pg_enum` com os enums do shared.
4. **Seed determinístico**: `faker.seed` fixo + data de referência fixa. Verificado executando o seed duas vezes e comparando hash dos dados de negócio (idênticos).
5. **Senha demo** via `SEED_DEMO_PASSWORD` (mín. 12) ou gerada aleatoriamente e exibida uma vez.
6. **Hash de senha** Argon2id (`@node-rs/argon2`, m=19 MiB, t=2, p=1 — baseline OWASP) em `src/infra/security/password.ts`, compartilhado por seed e autenticação.
7. **Banco de teste**: `prisma migrate deploy` (não destrutivo) roda no `globalSetup` da suíte de integração; cada teste limpa dados com `TRUNCATE` via helper que se recusa a operar fora de `TEST_DATABASE_URL`.

## Observação operacional

O Prisma 7 bloqueia `prisma migrate reset` quando executado por agente de IA sem consentimento explícito do usuário. `pnpm db:reset` deve ser executado pelo desenvolvedor (ou pelo agente após autorização explícita).

## Consequências

- Violações de regra viram erro de banco mesmo se um bug passar pela API.
- Mudanças nessas regras exigem nova migration SQL manual + atualização de `docs/domain-model.md`.
