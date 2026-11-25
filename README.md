# CreditFlow

Plataforma de gestão e análise **manual** de solicitações de crédito. Projeto de estudo: todos os dados são **sintéticos** e a decisão de crédito é sempre **humana**. Não há IA nesta fase (Parte A).

> Status: **Parte A, Etapa 1 (fundação do monorepo)**. Veja o plano em [docs/plano-parte-a.md](docs/plano-parte-a.md).

## Stack

| Camada        | Tecnologia                                                       |
| ------------- | ---------------------------------------------------------------- |
| API           | NestJS 12 (ESM), TypeScript 6, Prisma 7 + PostgreSQL 17, Swagger |
| Web           | React 19, Vite 8, TypeScript 6                                   |
| Compartilhado | `packages/shared` (TypeScript puro)                              |
| Testes        | Vitest (unit + integração com Postgres real)                     |
| Qualidade     | ESLint, Prettier, `tsc --noEmit`, GitHub Actions                 |

Decisões e justificativas: [docs/decisions](docs/decisions).

## Pré-requisitos

- Node.js **24+**
- pnpm **11+** (`corepack enable` ou instalação manual)
- Docker Desktop (para o PostgreSQL)

## Executar localmente

1. Copie o arquivo de ambiente e defina uma senha local para o Postgres em `POSTGRES_PASSWORD` (e a mesma senha em `DATABASE_URL` e `TEST_DATABASE_URL`):

   ```powershell
   Copy-Item .env.example .env
   ```

2. Suba o banco (cria também o banco `creditflow_test`):

   ```powershell
   docker compose up -d --wait
   ```

3. Instale as dependências (gera o client Prisma automaticamente):

   ```powershell
   pnpm install
   ```

4. Rode API e web com hot reload:

   ```powershell
   pnpm dev
   ```

| Endereço                            | O quê                      |
| ----------------------------------- | -------------------------- |
| http://localhost:5173               | Frontend                   |
| http://localhost:3000/api/v1/health | Health check (API + banco) |
| http://localhost:3000/api/docs      | Swagger / OpenAPI          |

## Comandos

| Comando                                          | Descrição                                                       |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `pnpm dev`                                       | API + web + shared em modo watch                                |
| `pnpm lint`                                      | ESLint em todo o monorepo                                       |
| `pnpm format` / `pnpm format:check`              | Prettier                                                        |
| `pnpm typecheck`                                 | `tsc --noEmit` em todos os pacotes                              |
| `pnpm test`                                      | Testes unitários (sem banco)                                    |
| `pnpm --filter @creditflow/api test:integration` | Testes de integração contra `TEST_DATABASE_URL` (requer Docker) |
| `pnpm build`                                     | Build de produção de todos os pacotes                           |

## Estrutura

```
apps/api         API NestJS (módulos de domínio em src/modules)
apps/web         SPA React
packages/shared  enums, permissões, máquina de estados, validadores
docs/            plano, arquitetura e ADRs
infra/           scripts de infraestrutura local (init do Postgres)
```

## Segurança e dados

- Nunca versione `.env`, documentos reais ou dados pessoais. Somente dados sintéticos.
- O Postgres local escuta apenas em `127.0.0.1`.
- pnpm bloqueia versões publicadas há menos de um dia (`minimumReleaseAge`) e scripts de instalação fora da allowlist em `pnpm-workspace.yaml`.

## Licença

[MIT](LICENSE)
