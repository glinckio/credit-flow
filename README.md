# CreditFlow

Plataforma de gestão e análise **manual** de solicitações de crédito. Projeto de estudo: todos os dados são **sintéticos** e a decisão de crédito é sempre **humana**. Não há IA nesta fase (Parte A).

> Status: **Parte A concluída** (Etapas 1–13). Fluxo principal completo — cadastro, solicitação, documentos, análise, decisão humana, auditoria e dashboard — com testes unitários, de integração e ponta a ponta. Critérios de aceite verificados em [docs/acceptance-checklist.md](docs/acceptance-checklist.md). A Parte B (IA agêntica) só começa com autorização explícita.

## Stack

| Camada        | Tecnologia                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------- |
| API           | NestJS 12 (ESM), TypeScript 6, Prisma 7 + PostgreSQL 17, Swagger                                  |
| Web           | React 19, Vite 8, TypeScript 6, React Router 8, TanStack Query, React Hook Form + Zod, Tailwind 4 |
| Compartilhado | `packages/shared` (TypeScript puro: enums, permissões, máquina de estados, validadores)           |
| Testes        | Vitest (unitário e integração com Postgres real), Playwright (ponta a ponta)                      |
| Qualidade     | ESLint, Prettier, `tsc --noEmit`, GitHub Actions                                                  |

Documentação: [arquitetura](docs/architecture.md) · [modelo de domínio](docs/domain-model.md) · [segurança](docs/security.md) · [decisões (ADRs)](docs/decisions) · [plano da Parte A](docs/plano-parte-a.md).

## Pré-requisitos

- Node.js **24+**
- pnpm **11+** (`corepack enable` ou instalação manual)
- Docker Desktop (para o PostgreSQL)
- Para os testes ponta a ponta: Google Chrome instalado (ou outro navegador via `PW_CHANNEL`)

## Executar localmente

1. Copie o arquivo de ambiente e defina uma senha local para o Postgres em `POSTGRES_PASSWORD` (e a mesma senha em `DATABASE_URL` e `TEST_DATABASE_URL`). Opcionalmente defina `SEED_DEMO_PASSWORD` (mín. 12 caracteres) para a senha dos usuários demo:

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

   Sem `SEED_DEMO_PASSWORD`, o seed gera uma senha aleatória e a exibe uma única vez. Usuários demo: `admin@`, `analista@`, `analista2@`, `operador@` e `operador.decisor@creditflow.test`.

5. Rode API e web com hot reload:

   ```powershell
   pnpm dev
   ```

| Endereço                            | O quê                      |
| ----------------------------------- | -------------------------- |
| http://localhost:5173               | Frontend                   |
| http://localhost:3000/api/v1/health | Health check (API + banco) |
| http://localhost:3000/api/docs      | Swagger / OpenAPI          |

Se a porta 5173 estiver ocupada por outro projeto, rode o web em outra porta e informe a mesma origem à API (exigido pela proteção CSRF): `WEB_PORT=5174` para o Vite e `WEB_ORIGIN=http://localhost:5174` para a API.

## Usando a aplicação

- **Operador**: Clientes → Novo cliente → Nova solicitação → anexar identificação e comprovante de renda → Enviar para análise. Complementa pendências e devolve para análise.
- **Analista**: Solicitações → "Sem responsável (fila)" → Assumir análise → validar documentos → aba Análise: pendências e "Solicitar informações", parecer → Registrar decisão (justificativa e confirmação explícita obrigatórias).
- **Administrador**: Usuários (criar com senha temporária, papel, concessão de decisão, desativar, redefinir senha), Auditoria (antes/depois por campo), atribuição de analistas, cancelamento em análise e reabertura.
- Menus e botões seguem as permissões do papel; a API recusa o resto de qualquer forma.

## Comandos

| Comando                             | Descrição                                                               |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `pnpm dev`                          | API + web + shared em modo watch                                        |
| `pnpm lint`                         | ESLint em todo o monorepo                                               |
| `pnpm format` / `pnpm format:check` | Prettier                                                                |
| `pnpm typecheck`                    | `tsc --noEmit` em todos os pacotes                                      |
| `pnpm test`                         | Testes unitários (sem banco)                                            |
| `pnpm test:integration`             | Testes de integração da API contra `TEST_DATABASE_URL` (requer Docker)  |
| `pnpm test:e2e`                     | Testes ponta a ponta (Playwright) em ambiente isolado — ver abaixo      |
| `pnpm build`                        | Build de produção de todos os pacotes                                   |
| `pnpm db:migrate`                   | Aplica/cria migrations no banco de desenvolvimento                      |
| `pnpm db:seed`                      | Carrega dados sintéticos (exige banco vazio)                            |
| `pnpm db:reset`                     | **Apaga** o banco de desenvolvimento, reaplica migrations e roda o seed |

### Testes ponta a ponta

`pnpm test:e2e` compila shared e API, cria e semeia um banco próprio (`creditflow_e2e`, derivado de `TEST_DATABASE_URL`), sobe a API na porta 3100 e o web na 5175 e percorre o fluxo principal com operador, analista e admin. Não toca no banco de desenvolvimento nem nas portas do `pnpm dev`. Usa o Chrome instalado; `PW_CHANNEL=msedge` usa o Edge. Detalhes em [ADR-0010](docs/decisions/ADR-0010-testes-e2e.md).

## API

Contrato completo no Swagger (`/api/docs`). Convenções:

- Prefixo `/api/v1`; autenticação por cookie de sessão definido em `POST /auth/login`.
- Requisições que alteram dados exigem o cabeçalho `X-Requested-With: XMLHttpRequest` (CSRF).
- Erros em `application/problem+json` (RFC 9457) com `type`, `title`, `status`, `errors[]` por campo e `requestId`.
- Listagens: `?page=1&pageSize=20&sort=campo:asc` (ou `:desc`) → `{ data, meta: { page, pageSize, total } }`.

| Área              | Rotas                                                                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Saúde             | `GET /health`                                                                                                                                                                                            |
| Autenticação      | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`                                                                                                                    |
| Usuários (admin)  | `GET/POST /users`, `GET/PATCH /users/:id`, `POST /users/:id/deactivate`, `/activate`, `/reset-password`                                                                                                  |
| Clientes          | `GET/POST /customers` (filtros `q`, `type`, `status`), `GET/PATCH /customers/:id` (PATCH exige `version`)                                                                                                |
| Solicitações      | `GET/POST /applications` (filtros: vários `status`, `assigneeId` = `me`, `none` ou id, `customerId`, `productType`, período, `q`), `GET/PATCH /applications/:id`, `GET /applications/:id/status-history` |
| Transições        | `POST /applications/:id/` + `submit`, `start-review`, `assign`, `release`, `request-information`, `resume`, `cancel`, `reopen` ([ADR-0006](docs/decisions/ADR-0006-maquina-de-estados.md))               |
| Pendências        | `GET/POST /applications/:id/issues`, `POST /issues/:id/resolve`                                                                                                                                          |
| Documentos        | `GET/POST /applications/:id/documents` (multipart), `GET /documents/:id/content`, `PATCH /documents/:id/validation`, `DELETE /documents/:id` ([ADR-0007](docs/decisions/ADR-0007-documentos.md))         |
| Análise           | `GET /applications/:id/indicators`, `GET/POST /applications/:id/reviews`, `GET/POST /applications/:id/decision` ([ADR-0008](docs/decisions/ADR-0008-analise-e-decisao.md))                               |
| Dashboard         | `GET /dashboard/metrics`                                                                                                                                                                                 |
| Auditoria (admin) | `GET /audit-events` (filtros `entityType`, `entityId`, `actorId`, `action` exata ou prefixo, `from`, `to`)                                                                                               |

## Estrutura

```
apps/api         API NestJS (módulos de domínio em src/modules)
apps/web         SPA React (telas em src/features)
packages/shared  enums, permissões, máquina de estados, validadores, indicadores
e2e/             testes ponta a ponta (Playwright)
docs/            plano, arquitetura, domínio, segurança, ADRs, checklist de aceite
infra/           scripts de infraestrutura local (init do Postgres)
```

## Segurança e dados

- Nunca versione `.env`, documentos reais ou dados pessoais. Somente dados sintéticos.
- O Postgres local escuta apenas em `127.0.0.1`; documentos ficam em `var/` (fora do Git e de qualquer pasta pública).
- pnpm bloqueia versões publicadas há menos de um dia (`minimumReleaseAge`) e scripts de instalação fora da allowlist em `pnpm-workspace.yaml`.
- Detalhes em [docs/security.md](docs/security.md).

## Licença

[MIT](LICENSE)
