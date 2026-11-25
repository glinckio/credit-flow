# CreditFlow

Plataforma de gestão e análise **manual** de solicitações de crédito. Projeto de estudo: todos os dados são **sintéticos** e a decisão de crédito é sempre **humana**. Não há IA nesta fase (Parte A).

> Status: **Parte A — Etapa 5 concluída** (fundação, modelo de dados e seed, autenticação, RBAC, auditoria, usuários, clientes e solicitações com máquina de estados e pendências). Veja o plano em [docs/plano-parte-a.md](docs/plano-parte-a.md).

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

4. Crie as tabelas e carregue os dados sintéticos de demonstração:

   ```powershell
   pnpm db:migrate
   ```

   ```powershell
   pnpm db:seed
   ```

   Defina `SEED_DEMO_PASSWORD` no `.env` (mín. 12 caracteres) ou o seed gera uma senha aleatória e a exibe uma única vez. Usuários demo: `admin@`, `analista@`, `analista2@`, `operador@` e `operador.decisor@creditflow.test`. Detalhes em [docs/domain-model.md](docs/domain-model.md).

5. Rode API e web com hot reload:

   ```powershell
   pnpm dev
   ```

| Endereço                            | O quê                      |
| ----------------------------------- | -------------------------- |
| http://localhost:5173               | Frontend                   |
| http://localhost:3000/api/v1/health | Health check (API + banco) |
| http://localhost:3000/api/docs      | Swagger / OpenAPI          |

## Comandos

| Comando                                          | Descrição                                                               |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| `pnpm dev`                                       | API + web + shared em modo watch                                        |
| `pnpm lint`                                      | ESLint em todo o monorepo                                               |
| `pnpm format` / `pnpm format:check`              | Prettier                                                                |
| `pnpm typecheck`                                 | `tsc --noEmit` em todos os pacotes                                      |
| `pnpm test`                                      | Testes unitários (sem banco)                                            |
| `pnpm --filter @creditflow/api test:integration` | Testes de integração contra `TEST_DATABASE_URL` (requer Docker)         |
| `pnpm db:migrate`                                | Aplica/cria migrations no banco de desenvolvimento                      |
| `pnpm db:seed`                                   | Carrega dados sintéticos (exige banco vazio)                            |
| `pnpm db:reset`                                  | **Apaga** o banco de desenvolvimento, reaplica migrations e roda o seed |
| `pnpm build`                                     | Build de produção de todos os pacotes                                   |

## API

Contrato completo no Swagger (`/api/docs`). Convenções:

- Prefixo `/api/v1`; autenticação por cookie de sessão definido em `POST /auth/login`.
- Requisições que alteram dados exigem o cabeçalho `X-Requested-With: XMLHttpRequest` (CSRF).
- Erros em `application/problem+json` (RFC 9457) com `type`, `title`, `status`, `errors[]` por campo e `requestId`.
- Listagens: `?page=1&pageSize=20&sort=campo:asc|desc` → `{ data, meta: { page, pageSize, total } }`.

| Disponível       | Rotas                                                                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Saúde            | `GET /health`                                                                                                                                                                                      |
| Autenticação     | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`                                                                                                              |
| Usuários (admin) | `GET/POST /users`, `GET/PATCH /users/:id`, `POST /users/:id/deactivate`, `/activate`, `/reset-password`                                                                                            |
| Clientes         | `GET/POST /customers` (filtros `q`, `type`, `status`), `GET/PATCH /customers/:id` (PATCH exige `version`)                                                                                          |
| Solicitações     | `GET/POST /applications` (filtros `status` múltiplo, `assigneeId=me                                                                                                                                | none | uuid`, `customerId`, `productType`, `createdFrom/To`, `q`código ou cliente),`GET/PATCH /applications/:id`, `GET /applications/:id/status-history` |
| Transições       | `POST /applications/:id/` `submit`, `start-review`, `assign`, `release`, `request-information`, `resume`, `cancel`, `reopen` — regras em [ADR-0006](docs/decisions/ADR-0006-maquina-de-estados.md) |
| Pendências       | `GET/POST /applications/:id/issues`, `POST /issues/:id/resolve`                                                                                                                                    |

Segurança em detalhe: [docs/security.md](docs/security.md).

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
