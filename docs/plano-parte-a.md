# CreditFlow — Plano de implementação da Parte A (projeto-base)

**Status:** APROVADO em 25/11/2026 com os padrões propostos para todos os pontos em aberto (seção 6). **CONCLUÍDO em 26/11/2026** — Etapas 1–13 entregues; a etapa opcional 14 (anonimização) não foi executada. Verificação dos critérios em [acceptance-checklist.md](acceptance-checklist.md).
**Data:** 25/11/2026

> **Atualização (Etapa 1):** NestJS 12 é ESM-only; API passou a usar ESM + Vitest, TypeScript fixado em 6.0.x e Prisma 7.10.1 estável. Ver [ADR-0002](decisions/ADR-0002-esm-vitest-versoes.md). Substitui D24 (Jest) e resolve R1.

**Escopo:** somente Parte A do `CREDITFLOW-PROJECT-AND-AGENTIC-ROADMAP.md`. Sem agentes, LLMs, RAG, chatbot ou qualquer API de IA.

Convenções deste documento:

- **[Fato]** verificado no ambiente ou no roadmap.
- **[Decisão proposta]** escolha minha, sujeita à sua aprovação.
- **[Em aberto]** precisa de decisão sua (ver seção 6).

Ambiente verificado **[Fato]**: Windows 11, Node.js 24.14.0, npm 11.9.0, pnpm 11.8.0, Docker 29.5.3, Docker Compose v5.1.4, Git 2.53. Repositório contém apenas `LICENSE` e o roadmap.

---

## 1. Decisões técnicas e justificativas

| #   | Tema                        | Decisão proposta                                                                                                                                                                                                                                                                                                                                                  | Justificativa                                                                                                                        | Alternativas descartadas                                                                                                                                           |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Arquitetura                 | **Monólito modular**: uma API NestJS com módulos de domínio isolados + uma SPA React                                                                                                                                                                                                                                                                              | Requisito explícito; domínio pequeno; uma transação de banco cobre mudança + auditoria                                               | Microsserviços, filas, BFF separado (complexidade prematura)                                                                                                       |
| D2  | Monorepo                    | **pnpm workspaces** puro (`apps/api`, `apps/web`, `packages/shared`)                                                                                                                                                                                                                                                                                              | pnpm já instalado; workspaces bastam para 3 pacotes                                                                                  | Turborepo/Nx (cache/orquestração desnecessários neste tamanho)                                                                                                     |
| D3  | Backend                     | **NestJS + TypeScript**, REST em `/api/v1`, Swagger em `/api/docs`                                                                                                                                                                                                                                                                                                | Sugerido no roadmap; DI e módulos combinam com monólito modular; Swagger nativo                                                      | Express/Fastify puro (mais código de infraestrutura manual)                                                                                                        |
| D4  | Camadas                     | `controller → service → repository` por módulo. Repository = classe fina sobre Prisma, **sem** interface genérica                                                                                                                                                                                                                                                 | Atende "camadas claras" sem abstração vazia; facilita testes do service                                                              | Repositório genérico / DDD completo com agregados (excessivo)                                                                                                      |
| D5  | Validação backend           | **class-validator + class-transformer** nos DTOs, `ValidationPipe` global com `whitelist` e `forbidNonWhitelisted`                                                                                                                                                                                                                                                | Idiomático no Nest e integrado ao Swagger                                                                                            | nestjs-zod (dependência extra; integração com Swagger menos madura)                                                                                                |
| D6  | Validação frontend          | **React Hook Form + Zod**                                                                                                                                                                                                                                                                                                                                         | Sugerido no roadmap; backend continua sendo a autoridade                                                                             | —                                                                                                                                                                  |
| D7  | Código compartilhado        | `packages/shared` só com **enums, matriz de permissões, máquina de estados, validadores de CPF/CNPJ e cálculo de indicadores** (TS puro, sem dependências)                                                                                                                                                                                                        | Evita divergência das regras que front e back precisam conhecer; schemas de formulário ficam no front                                | Compartilhar DTOs/schemas completos (acopla front ao Nest)                                                                                                         |
| D8  | Banco/ORM                   | **PostgreSQL** em Docker + **Prisma** com migrations versionadas                                                                                                                                                                                                                                                                                                  | Sugerido; migrations reproduzíveis; tipagem forte                                                                                    | TypeORM (migrations e tipagem mais frágeis), Drizzle (válido, mas menos alinhado ao roadmap)                                                                       |
| D9  | Valores monetários          | `Decimal(14,2)` no banco, trafegado como **string** no JSON, formatado em BRL no front                                                                                                                                                                                                                                                                            | Evita erro de ponto flutuante                                                                                                        | `float`/centavos em `int` (int também seria aceitável; Decimal é mais legível)                                                                                     |
| D10 | Autenticação                | **Sessão opaca em cookie httpOnly** (`Secure` em prod, `SameSite=Lax`), token aleatório de 256 bits, armazenado no banco **apenas como hash SHA-256**, expiração deslizante (8h)                                                                                                                                                                                  | Revogação imediata ao desativar usuário ou fazer logout; nada de token acessível a JS; simples para SPA same-origin                  | JWT access+refresh (revogação mais complexa, sem ganho num monólito), JWT em localStorage (exposto a XSS)                                                          |
| D11 | CSRF                        | Cookie `SameSite=Lax` + verificação do header `Origin` + header obrigatório `X-Requested-With` em métodos mutáveis                                                                                                                                                                                                                                                | Defesa em camadas sem token CSRF dedicado                                                                                            | Token CSRF sincronizado (mais código; desnecessário com as camadas acima)                                                                                          |
| D12 | Hash de senha               | **Argon2id** via `@node-rs/argon2`                                                                                                                                                                                                                                                                                                                                | Algoritmo recomendado (OWASP); binários pré-compilados, sem node-gyp no Windows                                                      | bcrypt (aceitável, mais antigo), `argon2` (exige build nativo em alguns ambientes)                                                                                 |
| D13 | Autorização                 | **RBAC por permissões**: enum `Role` (ADMIN, ANALYST, OPERATOR) → conjunto de permissões definido em código (`packages/shared/permissions.ts`); guard `@RequirePermissions(...)` em todo endpoint; regras de objeto (estado, responsável) verificadas no service                                                                                                  | Permissões checadas no backend; matriz única e testável; concessão extra pontual (`canDecide`) sem sistema de permissões customizado | Tabela de permissões no banco (o roadmap diz que não é necessário no MVP), CASL (dependência para problema pequeno)                                                |
| D14 | Rate limit                  | `@nestjs/throttler` no login (ex.: 5 tentativas/min por IP+e-mail)                                                                                                                                                                                                                                                                                                | Mitiga força bruta                                                                                                                   | Bloqueio de conta (risco de DoS contra usuário; fica para depois)                                                                                                  |
| D15 | Armazenamento de documentos | **Filesystem local isolado** (`./var/storage`, fora de `public`, gitignored, fora do build) atrás de interface `DocumentStorage` (`put/get/delete`)                                                                                                                                                                                                               | Simples e suficiente; interface permite trocar por S3/MinIO depois sem mexer no domínio                                              | MinIO no Docker agora (mais um serviço sem necessidade comprovada no MVP)                                                                                          |
| D16 | Validação de arquivo        | Allowlist **PDF, PNG, JPEG**; limite **10 MB**; tipo detectado por **magic bytes** próprios (`%PDF-`, `89 50 4E 47`, `FF D8 FF`) e conferido com a extensão; nome original só como metadado; chave de armazenamento = UUID; SHA-256 registrado; download sempre via endpoint autorizado com `Content-Disposition: attachment` e `X-Content-Type-Options: nosniff` | Atende todos os requisitos de 4.4; checagem de 3 assinaturas não justifica dependência                                               | `file-type` (ESM-only, atrito com Nest CJS), confiar no MIME do navegador (proibido pelo roadmap)                                                                  |
| D17 | Auditoria                   | Tabela `AuditEvent` **append-only**, gravada **na mesma transação** da alteração, com ator, data/hora, entidade, ação, `before`/`after` restritos a campos permitidos (allowlist por entidade) e `requestId`                                                                                                                                                      | Consistência garantida (sem evento perdido nem evento órfão); evita armazenar segredos e conteúdo de documentos                      | Interceptor HTTP genérico (não sabe o "antes" e grava mesmo se a transação falhar), event sourcing (excessivo)                                                     |
| D18 | Histórico de status         | Tabela própria `ApplicationStatusHistory` além da auditoria                                                                                                                                                                                                                                                                                                       | Consulta de linha do tempo e métrica de tempo médio ficam simples e indexadas                                                        | Derivar tudo da auditoria (consultas em JSON, frágil)                                                                                                              |
| D19 | Concorrência                | Transições de estado com update condicional (`WHERE id = ? AND status = ?`); edição com coluna `version` (optimistic locking) → `409 Conflict`                                                                                                                                                                                                                    | Evita duas decisões simultâneas ou edição sobre dados desatualizados                                                                 | Locks pessimistas (desnecessários)                                                                                                                                 |
| D20 | Erros                       | Formato único **RFC 9457 (Problem Details)**: `type, title, status, detail, errors[], requestId` via exception filter global                                                                                                                                                                                                                                      | Padrão aberto e consistente                                                                                                          | Formato ad hoc                                                                                                                                                     |
| D21 | Logs                        | **nestjs-pino** (JSON estruturado), `requestId` por requisição, redaction de `password`, `cookie`, `authorization`, `document`(CPF/CNPJ), e-mail e telefone                                                                                                                                                                                                       | Logs estruturados sem dados pessoais desnecessários                                                                                  | `console.log` / logger padrão do Nest (não estruturado)                                                                                                            |
| D22 | Segurança HTTP              | `helmet`, CORS desabilitado (front e API same-origin via proxy do Vite em dev), body limit                                                                                                                                                                                                                                                                        | Superfície mínima                                                                                                                    | —                                                                                                                                                                  |
| D23 | Frontend                    | **React + Vite + TypeScript + React Router + TanStack Query + React Hook Form + Zod + Tailwind + shadcn/ui**                                                                                                                                                                                                                                                      | Stack sugerida; shadcn copia componentes para o repo (sem lock-in de biblioteca)                                                     | MUI/Ant (pesadas, estilo menos controlável)                                                                                                                        |
| D24 | Testes API                  | **Jest** (padrão do Nest) para unitários; **Jest + Supertest contra PostgreSQL real** (banco `creditflow_test` no mesmo container) para integração                                                                                                                                                                                                                | Testes de integração reais pegam erros de SQL, transação e constraint                                                                | Vitest no backend (precisa SWC para metadata de decorators; atrito), mocks de Prisma em integração (falsa segurança), Testcontainers (bom, mas Compose já resolve) |
| D25 | Testes web                  | **Vitest + Testing Library** para componentes/hooks críticos                                                                                                                                                                                                                                                                                                      | Nativo do Vite                                                                                                                       | Jest no front (configuração extra)                                                                                                                                 |
| D26 | E2E                         | **Playwright** cobrindo o fluxo principal completo (§5 do roadmap) com 3 papéis                                                                                                                                                                                                                                                                                   | Requisito de E2E do fluxo principal                                                                                                  | Cypress (mais lento, multi-aba/multi-usuário pior)                                                                                                                 |
| D27 | Qualidade                   | ESLint (flat config) + Prettier + `tsc --noEmit` por pacote; **CI GitHub Actions**: install → lint → typecheck → unit → integração (serviço Postgres) → build → E2E                                                                                                                                                                                               | Critério 11 do roadmap                                                                                                               | —                                                                                                                                                                  |
| D28 | Execução local              | Docker Compose sobe **somente o PostgreSQL**; API e web rodam no host com hot reload (`pnpm dev`)                                                                                                                                                                                                                                                                 | Ciclo de desenvolvimento rápido no Windows; menos problemas de volume/watch                                                          | Tudo em containers (watch lento em bind mount no Windows); pode ser adicionado depois como profile opcional                                                        |
| D29 | Seeds                       | Script de seed **100% sintético**: CPF/CNPJ gerados com dígitos verificadores válidos mas aleatórios, nomes/endereços fictícios (`@faker-js/faker` locale pt_BR, devDependency), PDFs mínimos gerados em memória. Senha dos usuários demo vem de `SEED_DEMO_PASSWORD`; se ausente, o seed gera uma aleatória e imprime no console uma única vez                   | Nenhuma credencial ou documento real no Git                                                                                          | Senhas fixas no repo (proibido pelo roadmap)                                                                                                                       |
| D30 | Idioma                      | Código, identificadores, enums e API em **inglês**; UI e documentação em **português (pt-BR)**                                                                                                                                                                                                                                                                    | Convenção comum; facilita futuras integrações                                                                                        | —                                                                                                                                                                  |
| D31 | Exclusão/retenção           | **Sem hard delete** pela aplicação. Cliente: status `INACTIVE`. Documento: remoção lógica (`deletedAt`) só enquanto a solicitação é editável. Anonimização de cliente (ADMIN) documentada e implementada na etapa final se aprovada (ver 6.7)                                                                                                                     | Preserva trilha de auditoria; prepara LGPD sem complicar o MVP                                                                       | Cascade delete (perde histórico)                                                                                                                                   |
| D32 | Versões                     | Instalar **versões estáveis atuais** de cada dependência, validadas no momento da instalação (Prisma 7 mudou geração do client — ver risco R1) e registradas no README                                                                                                                                                                                            | Roadmap pede validação de compatibilidade                                                                                            | Fixar versões de memória (pode estar desatualizado)                                                                                                                |

Dependências novas previstas (cada uma justificada na tabela): NestJS core/config/swagger/throttler, Prisma, class-validator/transformer, @node-rs/argon2, helmet, cookie-parser, nestjs-pino/pino-http, multer (já vem com `@nestjs/platform-express`), React/Vite/React Router/TanStack Query/RHF/Zod/Tailwind/shadcn (Radix), Jest/Supertest, Vitest/Testing Library, Playwright, @faker-js/faker (dev), ESLint/Prettier.

---

## 2. Estrutura de pastas proposta

```
credit-flow/
├─ apps/
│  ├─ api/
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma
│  │  │  ├─ migrations/
│  │  │  └─ seed/                     # seed sintético (users, customers, applications, docs)
│  │  ├─ src/
│  │  │  ├─ main.ts
│  │  │  ├─ app.module.ts
│  │  │  ├─ config/                   # validação de env (fail-fast)
│  │  │  ├─ common/                   # filtros de erro, paginação, request-id, decorators, guards base
│  │  │  ├─ infra/
│  │  │  │  ├─ prisma/                # PrismaService
│  │  │  │  └─ storage/               # DocumentStorage + LocalFsStorage
│  │  │  └─ modules/
│  │  │     ├─ auth/                  # login, logout, me, sessões, guards de sessão/permissão
│  │  │     ├─ users/                 # administração de usuários
│  │  │     ├─ customers/
│  │  │     ├─ applications/          # solicitações, máquina de estados, histórico, atribuição, pendências
│  │  │     ├─ documents/             # upload, download, validação manual
│  │  │     ├─ analysis/              # pareceres, indicadores descritivos, decisão final
│  │  │     ├─ dashboard/
│  │  │     ├─ audit/                 # AuditService (global) + consulta
│  │  │     └─ health/
│  │  └─ test/
│  │     ├─ integration/              # Supertest + Postgres real
│  │     └─ helpers/                  # factories, login helpers, reset de banco
│  └─ web/
│     ├─ src/
│     │  ├─ app/                      # router, providers, layout, guards de rota
│     │  ├─ components/ui/            # componentes shadcn
│     │  ├─ features/
│     │  │  ├─ auth/
│     │  │  ├─ dashboard/
│     │  │  ├─ customers/
│     │  │  ├─ applications/
│     │  │  ├─ analysis/
│     │  │  ├─ admin-users/
│     │  │  └─ audit/
│     │  └─ lib/                      # api client, formatação BRL/datas, máscaras CPF/CNPJ
│     └─ (vite/tailwind/tsconfig)
├─ packages/
│  └─ shared/
│     └─ src/
│        ├─ enums.ts                  # Role, ApplicationStatus, CustomerType, DocumentType...
│        ├─ permissions.ts            # matriz papel → permissões
│        ├─ application-state-machine.ts
│        ├─ indicators.ts             # fórmulas descritivas documentadas
│        └─ validators/cpf-cnpj.ts
├─ e2e/                               # Playwright (fluxo principal)
├─ docs/
│  ├─ plano-parte-a.md                # este documento
│  ├─ architecture.md
│  ├─ domain-model.md
│  ├─ api.md                          # visão geral; contrato completo no Swagger
│  ├─ security.md
│  └─ decisions/                      # ADRs (ADR-0001-monolito-modular.md, ...)
├─ var/                               # gitignored: storage local de documentos
├─ .github/workflows/ci.yml
├─ docker-compose.yml                 # postgres (+ banco de teste)
├─ .env.example                       # sem segredos
├─ .gitattributes / .gitignore / .editorconfig
├─ eslint.config.mjs / .prettierrc
├─ tsconfig.base.json
├─ pnpm-workspace.yaml / package.json
└─ README.md
```

Regra de fronteira entre módulos: um módulo só acessa outro pelo **service exportado** (ex.: `applications` usa `CustomersService.getById`), nunca pelo repository alheio. `audit` é global e recebe o `tx` da transação corrente.

---

## 3. Modelo de dados inicial

Todas as tabelas com `id UUID` (exceto `AuditEvent`, `BIGSERIAL` para ordenação), `createdAt`, `updatedAt` quando mutáveis.

### 3.1 Entidades

**User**

| Campo        | Tipo                                   | Observação                                     |
| ------------ | -------------------------------------- | ---------------------------------------------- |
| email        | text, unique (case-insensitive)        |                                                |
| name         | text                                   |                                                |
| passwordHash | text                                   | Argon2id                                       |
| role         | enum `Role` (ADMIN, ANALYST, OPERATOR) |                                                |
| canDecide    | boolean, default false                 | concessão explícita de decisão final (ver 6.1) |
| active       | boolean                                | desativar revoga sessões                       |
| lastLoginAt  | timestamptz?                           |                                                |

**Session**: `userId`, `tokenHash` (unique), `expiresAt`, `lastSeenAt`, `revokedAt?`, `userAgent?`. Token em claro nunca é persistido.

**Customer**

| Campo                                                                                                             | Tipo                                      | Observação                                                                              |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| type                                                                                                              | enum `CustomerType` (INDIVIDUAL, COMPANY) | PF/PJ                                                                                   |
| name                                                                                                              | text                                      | nome completo ou razão social                                                           |
| documentNumber                                                                                                    | varchar(14), unique                       | só dígitos; CPF (11) ou CNPJ (14) validado por dígito verificador e coerente com `type` |
| email, phone                                                                                                      | text                                      | formato validado                                                                        |
| birthOrFoundationDate                                                                                             | date?                                     | obrigatório? ver 6.9                                                                    |
| addressStreet, addressNumber, addressComplement?, addressDistrict, addressCity, addressState (UF), addressZipCode | colunas                                   | endereço embutido (1:1, sem tabela extra)                                               |
| status                                                                                                            | enum `CustomerStatus` (ACTIVE, INACTIVE)  |                                                                                         |
| createdById                                                                                                       | FK User                                   |                                                                                         |
| anonymizedAt                                                                                                      | timestamptz?                              | ver D31                                                                                 |
| version                                                                                                           | int                                       | optimistic locking                                                                      |

**CreditApplication**

| Campo                            | Tipo                     | Observação                                                                     |
| -------------------------------- | ------------------------ | ------------------------------------------------------------------------------ |
| code                             | text, unique             | legível, ex. `CF-2026-000123` (sequence)                                       |
| customerId                       | FK Customer              | dados do cliente **não** são copiados                                          |
| productType                      | enum `CreditProductType` | lista em 6.8                                                                   |
| requestedAmount                  | Decimal(14,2)            | > 0                                                                            |
| termMonths                       | int                      | 1–360                                                                          |
| purpose                          | text                     | finalidade declarada                                                           |
| declaredMonthlyIncome            | Decimal(14,2)            | renda (PF) ou faturamento médio mensal (PJ) — rótulo muda pelo tipo do cliente |
| declaredMonthlyCommitments       | Decimal(14,2)?           | despesas/compromissos declarados                                               |
| status                           | enum `ApplicationStatus` | 7 estados do roadmap                                                           |
| assigneeId                       | FK User?                 | responsável atual                                                              |
| createdById                      | FK User                  |                                                                                |
| submittedAt, decidedAt, closedAt | timestamptz?             | base para métricas                                                             |
| version                          | int                      |                                                                                |

Decisão de modelagem: os valores declarados ficam **na solicitação** (são declarados por solicitação e podem variar entre pedidos), não no cliente.

**CreditDocument**: `applicationId`, `type` (enum `DocumentType`: IDENTIFICATION, PROOF_OF_ADDRESS, PROOF_OF_INCOME, BANK_STATEMENT, OTHER), `otherDescription?`, `originalName`, `storageKey` (UUID, unique), `mimeType` (detectado), `sizeBytes`, `sha256`, `uploadedById`, `uploadedAt`, `validationStatus` (PENDING, ACCEPTED, REJECTED), `validationNotes?`, `validatedById?`, `validatedAt?`, `deletedAt?`.

**ApplicationIssue** (pendência — entidade nova, não listada no roadmap): `applicationId`, `description`, `status` (OPEN, RESOLVED), `createdById`, `resolvedById?`, `resolvedAt?`, `resolutionNote?`. Justificativa: pendências têm ciclo de vida próprio (abrir → resolver) e bloqueiam aprovação; texto livre num parecer não permite isso.

**CreditReview** (parecer — append-only): `applicationId`, `authorId`, `recommendation` (APPROVE, REJECT, REQUEST_INFORMATION), `analysisNotes` (observações), `justification`, `createdAt`. Alterar parecer = nova linha; o vigente é o mais recente. Histórico preservado sem `UPDATE`.

**CreditDecision** (1:1 com a solicitação): `applicationId` (unique), `outcome` (APPROVED, REJECTED), `justification` (mín. 20 caracteres), `decidedById`, `decidedAt`, `reviewId` (parecer vigente no momento da decisão).

**ApplicationStatusHistory**: `applicationId`, `fromStatus?`, `toStatus`, `actorId`, `reason?`, `createdAt`.

**AuditEvent** (append-only): `id BIGSERIAL`, `occurredAt`, `actorId?`, `action` (ex. `customer.created`, `application.status_changed`, `document.uploaded`, `decision.recorded`, `user.deactivated`, `auth.login_failed`), `entityType`, `entityId`, `before jsonb?`, `after jsonb?`, `metadata jsonb?` (`requestId`, IP). Nunca contém senha, hash, token, conteúdo de arquivo.

### 3.2 Relações

```
User 1─* Session
User 1─* Customer(createdBy) / CreditApplication(createdBy, assignee) / ...
Customer 1─* CreditApplication
CreditApplication 1─* CreditDocument
CreditApplication 1─* ApplicationIssue
CreditApplication 1─* CreditReview
CreditApplication 1─0..1 CreditDecision
CreditApplication 1─* ApplicationStatusHistory
AuditEvent *─0..1 User(actor); entityType+entityId referência polimórfica (sem FK)
```

Índices: `CreditApplication(status)`, `(customerId)`, `(assigneeId)`, `(createdAt)`; `Customer(name)` (busca); `AuditEvent(entityType, entityId)`, `(actorId)`, `(occurredAt)`.

### 3.3 Máquina de estados da solicitação

| De                                                  | Para                | Ação                  | Quem (permissão)                             | Regras                                                                          |
| --------------------------------------------------- | ------------------- | --------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| —                                                   | DRAFT               | criar                 | OPERATOR, ADMIN                              | cliente ACTIVE                                                                  |
| DRAFT                                               | SUBMITTED           | submit                | OPERATOR, ADMIN                              | campos obrigatórios; documentos obrigatórios (ver 6.3)                          |
| SUBMITTED                                           | UNDER_REVIEW        | start-review / assign | ANALYST (assume p/ si), ADMIN (atribui)      | define `assigneeId`                                                             |
| UNDER_REVIEW                                        | PENDING_INFORMATION | request-information   | ANALYST responsável                          | ≥ 1 pendência OPEN                                                              |
| PENDING_INFORMATION                                 | UNDER_REVIEW        | resume                | OPERATOR, ADMIN                              | mantém responsável; pendências podem continuar abertas para o analista resolver |
| UNDER_REVIEW                                        | APPROVED / REJECTED | decide                | `application.decide` (ver 6.1)               | parecer existente; justificativa; aprovação exige 0 pendências OPEN             |
| DRAFT, SUBMITTED, UNDER_REVIEW, PENDING_INFORMATION | CANCELLED           | cancel                | OPERATOR (só DRAFT/SUBMITTED/PENDING), ADMIN | motivo obrigatório                                                              |
| CANCELLED                                           | SUBMITTED           | reopen                | **somente ADMIN**                            | motivo obrigatório; auditado (regra explícita do roadmap)                       |
| UNDER_REVIEW                                        | SUBMITTED           | release               | ANALYST responsável, ADMIN                   | devolve à fila sem responsável                                                  |

APPROVED e REJECTED são terminais. A tabela vive em `packages/shared` e é testada exaustivamente (todas as combinações de/para).

### 3.4 Indicadores descritivos (não decisórios)

Calculados no backend, exibidos com aviso fixo "Indicador demonstrativo. Não representa política de crédito e não determina aprovação ou reprovação":

- **Parcela simples estimada** = `requestedAmount / termMonths` (sem juros — explicitado).
- **Comprometimento da renda com a parcela** = parcela simples / `declaredMonthlyIncome`.
- **Comprometimento total declarado** = (`declaredMonthlyCommitments` + parcela simples) / `declaredMonthlyIncome`.
- **Valor solicitado em meses de renda** = `requestedAmount / declaredMonthlyIncome`.

Sem score, sem faixas de "bom/ruim", sem cores de semáforo.

---

## 4. Fluxos de usuário

**F1 — Login.** Usuário informa e-mail/senha → `POST /auth/login` → cookie de sessão → redireciona para dashboard. Falhas genéricas ("credenciais inválidas"), auditadas e limitadas por rate limit. Usuário desativado não entra.

**F2 — Cadastro de cliente (Operador).** Clientes → Novo → escolhe PF/PJ → formulário com máscara e validação de CPF/CNPJ → salvar. Duplicidade de documento → erro 409 com link para o cliente existente.

**F3 — Abertura de solicitação (Operador).** Na ficha do cliente → Nova solicitação → produto, valor, prazo, finalidade, renda/faturamento, compromissos → salva como DRAFT → aba Documentos: anexa arquivos por tipo → "Enviar para análise" (valida obrigatórios) → SUBMITTED.

**F4 — Fila e análise (Analista).** Solicitações → filtro "Aguardando análise" → abre → "Assumir análise" (UNDER_REVIEW, responsável = analista) → tela de análise com abas: Cliente | Solicitação e valores declarados | Documentos (visualizar/baixar, marcar ACCEPTED/REJECTED com observação) | Indicadores descritivos | Pendências | Pareceres | Histórico.

**F5 — Pendência e complementação.** Analista registra pendência(s) → "Solicitar informações" → PENDING_INFORMATION. Operador vê a lista de pendências, anexa/corrige dados → "Devolver para análise" → UNDER_REVIEW. Analista resolve as pendências atendidas.

**F6 — Parecer.** Analista registra parecer (recomendação + observações + justificativa). Pode registrar novo parecer; anteriores ficam visíveis.

**F7 — Decisão humana.** Usuário com `application.decide` clica "Registrar decisão" → escolhe Aprovar/Reprovar → justificativa obrigatória → confirmação explícita → status final, `CreditDecision`, histórico e auditoria gravados na mesma transação.

**F8 — Cancelamento e reabertura.** Operador/Admin cancela com motivo. Somente Admin reabre (CANCELLED → SUBMITTED) com motivo.

**F9 — Dashboard.** Todos os papéis veem os indicadores operacionais calculados do banco (ver 6.2 para escopo por papel).

**F10 — Administração (Admin).** Usuários: listar, criar (senha inicial definida pelo admin), alterar papel/`canDecide`, desativar/reativar. Auditoria: filtros por entidade, ator, ação e período; visualização de antes/depois.

---

## 5. Contratos/API principais

Base `/api/v1`. JSON. Autenticação por cookie de sessão. Listagens: `?page=1&pageSize=20&sort=createdAt:desc` + filtros; resposta `{ "data": [...], "meta": { "page", "pageSize", "total" } }`. Erros: Problem Details (D20). Códigos: 400 validação, 401 não autenticado, 403 sem permissão, 404 inexistente **ou sem acesso** (não vazar existência), 409 conflito (duplicidade, transição inválida, versão), 413 arquivo grande, 415 tipo não suportado, 422 regra de negócio, 429 rate limit.

| Método   | Rota                                    | Permissão                   | Descrição                                                                       |
| -------- | --------------------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| POST     | `/auth/login`                           | pública                     | `{email, password}` → 204 + cookie                                              |
| POST     | `/auth/logout`                          | autenticado                 | revoga sessão                                                                   |
| GET      | `/auth/me`                              | autenticado                 | usuário + papel + permissões efetivas                                           |
| GET      | `/users`                                | `user.manage`               | lista paginada                                                                  |
| POST     | `/users`                                | `user.manage`               | `{email, name, role, canDecide, initialPassword}`                               |
| PATCH    | `/users/:id`                            | `user.manage`               | `{name?, role?, canDecide?}`                                                    |
| POST     | `/users/:id/deactivate` · `/activate`   | `user.manage`               | desativar revoga sessões; admin não desativa a si mesmo                         |
| GET      | `/customers`                            | `customer.read`             | filtros: `q` (nome/documento), `type`, `status`                                 |
| POST     | `/customers`                            | `customer.write`            | cria                                                                            |
| GET      | `/customers/:id`                        | `customer.read`             | detalhe                                                                         |
| PATCH    | `/customers/:id`                        | `customer.write`            | campos permitidos + `version`; `documentNumber` e `type` imutáveis após criação |
| GET      | `/applications`                         | `application.read`          | filtros: `status`, `customerId`, `assigneeId`, `productType`, período           |
| POST     | `/applications`                         | `application.write`         | cria DRAFT                                                                      |
| GET      | `/applications/:id`                     | `application.read`          | detalhe com cliente resumido, responsável, contagens                            |
| PATCH    | `/applications/:id`                     | `application.write`         | só em DRAFT/PENDING_INFORMATION; `version`                                      |
| POST     | `/applications/:id/submit`              | `application.write`         | DRAFT → SUBMITTED                                                               |
| POST     | `/applications/:id/start-review`        | `application.review`        | assume para si                                                                  |
| POST     | `/applications/:id/assign`              | `application.assign`        | `{assigneeId}` (admin)                                                          |
| POST     | `/applications/:id/release`             | `application.review`        | devolve à fila                                                                  |
| POST     | `/applications/:id/request-information` | `application.review`        | → PENDING_INFORMATION                                                           |
| POST     | `/applications/:id/resume`              | `application.write`         | → UNDER_REVIEW                                                                  |
| POST     | `/applications/:id/cancel`              | `application.cancel`        | `{reason}`                                                                      |
| POST     | `/applications/:id/reopen`              | `application.reopen`        | `{reason}` (admin)                                                              |
| GET      | `/applications/:id/status-history`      | `application.read`          | linha do tempo                                                                  |
| GET      | `/applications/:id/indicators`          | `application.read`          | indicadores descritivos + fórmulas + aviso                                      |
| GET/POST | `/applications/:id/issues`              | read / `application.review` | pendências                                                                      |
| POST     | `/issues/:id/resolve`                   | `application.review`        | `{resolutionNote}`                                                              |
| GET/POST | `/applications/:id/reviews`             | read / `application.review` | pareceres                                                                       |
| POST     | `/applications/:id/decision`            | `application.decide`        | `{outcome, justification}`                                                      |
| GET      | `/applications/:id/documents`           | `document.read`             | lista                                                                           |
| POST     | `/applications/:id/documents`           | `document.upload`           | multipart `{file, type, otherDescription?}`                                     |
| GET      | `/documents/:id/content`                | `document.read`             | stream, `attachment`, `nosniff`                                                 |
| PATCH    | `/documents/:id/validation`             | `document.validate`         | `{status, notes}`                                                               |
| DELETE   | `/documents/:id`                        | `document.upload`           | remoção lógica, só se solicitação editável                                      |
| GET      | `/dashboard/metrics`                    | `dashboard.read`            | contagens por status, tempo médio (ou `null` + motivo)                          |
| GET      | `/audit-events`                         | `audit.read`                | filtros: `entityType`, `entityId`, `actorId`, `action`, `from`, `to`            |
| GET      | `/health`                               | pública                     | liveness + conexão com banco                                                    |

### Matriz de permissões proposta

| Permissão                                                       |  ADMIN  | ANALYST |      OPERATOR      |
| --------------------------------------------------------------- | :-----: | :-----: | :----------------: |
| user.manage, audit.read, application.assign, application.reopen |    ✔    |         |                    |
| dashboard.read                                                  |    ✔    |    ✔    |         ✔          |
| customer.read                                                   |    ✔    |    ✔    |         ✔          |
| customer.write                                                  |    ✔    |         |         ✔          |
| application.read                                                |    ✔    |    ✔    |         ✔          |
| application.write (criar/editar/submit/resume)                  |    ✔    |         |         ✔          |
| application.cancel                                              |    ✔    |         |         ✔          |
| application.review (assumir, pendência, parecer)                |         |    ✔    |                    |
| application.decide                                              | ver 6.1 | ver 6.1 | só com `canDecide` |
| document.read                                                   |    ✔    |    ✔    |         ✔          |
| document.upload                                                 |    ✔    |         |         ✔          |
| document.validate                                               |         |    ✔    |                    |

---

## 6. Riscos e pontos ainda indefinidos

### Em aberto (preciso da sua decisão; proponho um padrão)

1. **Quem registra a decisão final?** Padrão proposto: ANALYST tem `application.decide`; OPERATOR só com `canDecide=true`; ADMIN **não** decide (segregação: quem administra usuários não decide crédito). Exigir "quatro olhos" (quem decide ≠ autor do parecer)? Padrão proposto: **não** no MVP, mas registrado e fácil de ligar.
2. **Escopo de visibilidade ("solicitações autorizadas").** Padrão proposto (operação pequena): todos os papéis leem todos os clientes; ANALYST não vê solicitações em DRAFT de terceiros; ações de análise só pelo responsável atribuído. Alternativa: analista vê apenas as atribuídas a ele + fila.
3. **Documentos obrigatórios para submeter.** Padrão proposto: IDENTIFICATION + PROOF_OF_INCOME obrigatórios; demais opcionais.
4. **"Outros documentos configuráveis".** Padrão proposto: enum fixo + `OTHER` com descrição livre. Alternativa: tabela `DocumentType` gerenciada pelo admin (mais telas).
5. **Recuperação de senha.** Padrão proposto: sem e-mail no MVP; admin redefine senha temporária e usuário troca no próximo login (`mustChangePassword`). Política: mínimo 12 caracteres.
6. **Commits.** Commito ao fim de cada etapa (mensagem descritiva, branch `main` ou branch por etapa)? Padrão proposto: **uma branch `feat/parte-a`, um commit por etapa, sem push** até você pedir.
7. **Anonimização de cliente (LGPD).** Padrão proposto: estratégia documentada no MVP; endpoint de anonimização (ADMIN) entra como etapa opcional ao final.
8. **Tipos de crédito.** Padrão proposto: PERSONAL_LOAN, PAYROLL_LOAN, VEHICLE_FINANCING, WORKING_CAPITAL, EQUIPMENT_FINANCING, OTHER.
9. **Data de nascimento/constituição.** Padrão proposto: obrigatória; PF ≥ 18 anos.

### Riscos técnicos

| #   | Risco                                                                                                                                         | Mitigação                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Prisma 7 mudou a geração do client (gerador `prisma-client`, ESM, `prisma.config.ts`, driver adapters) e pode ter atrito com Nest em CommonJS | Validar na Etapa 2 com um spike curto; fallback documentado para Prisma 6 (estável com Nest)                                          |
| R2  | `packages/shared` consumido por Nest (CJS) e Vite (ESM)                                                                                       | Compilar shared com `tsc` em dois formatos (ou `tsup`, 1 devDependency) e validar na Etapa 1                                          |
| R3  | Windows: line endings, caminhos, binários nativos                                                                                             | `.gitattributes` (`eol=lf`), `@node-rs/argon2` (pré-compilado), scripts cross-platform (sem `rm -rf`/`export` em npm scripts)         |
| R4  | Testes de integração dependem do Docker em execução                                                                                           | Script `pnpm test:integration` checa a conexão e falha com mensagem clara; CI usa service container                                   |
| R5  | Upload: arquivos poliglotas (PDF válido contendo script)                                                                                      | Nunca servir inline nem executar; `attachment` + `nosniff` + CSP restritiva; documentado como limite conhecido (sem antivírus no MVP) |
| R6  | Auditoria crescer muito                                                                                                                       | Índices + paginação; retenção documentada, sem expurgo automático no MVP                                                              |
| R7  | Escopo do frontend é o maior bloco                                                                                                            | Etapas de UI separadas por feature; componentes shadcn prontos; sem design system próprio                                             |
| R8  | Métrica de tempo médio com poucos dados                                                                                                       | Retornar `null` + `"insufficientData"` quando < 1 solicitação concluída; seed inclui concluídas                                       |

---

## 7. Plano em etapas pequenas, com critérios de aceite

Cada etapa termina com: arquivos alterados, decisões tomadas, comandos de teste executados **e saída real**, docs atualizadas. Não avanço de etapa com teste falhando.

### Etapa 1 — Fundação do monorepo

Escopo: pnpm workspaces, `tsconfig.base`, ESLint + Prettier, `.gitignore/.gitattributes/.editorconfig`, `docker-compose.yml` (Postgres + banco de teste via script init), `.env.example`, Nest mínimo com `/api/v1/health` e Swagger, Vite+React mínimo com proxy `/api`, `packages/shared` consumido por ambos, CI (lint, typecheck, test, build), README inicial, ADR-0001..0003.
Aceite: `pnpm install` → `docker compose up -d` → `pnpm dev` sobe API e web; `/api/v1/health` retorna OK com banco; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` passam; front importa algo de `shared`.

### Etapa 2 — Esquema, migrations e seed

Escopo: `schema.prisma` completo (seção 3), primeira migration, seed sintético (3 usuários demo, ~20 clientes PF/PJ, ~30 solicitações distribuídas em todos os status com histórico coerente, PDFs sintéticos em `var/storage`), scripts `db:migrate`, `db:reset`, `db:seed`.
Aceite: `pnpm db:reset` recria do zero de forma determinística; nenhum dado/senha real no repo; spike Prisma 7 vs 6 decidido e registrado em ADR.

### Etapa 3 — Infra transversal, autenticação e RBAC

Escopo: config validada, Problem Details, request-id, pino com redaction, helmet, `AuditService` transacional, sessões, login/logout/me, guards de sessão e permissão, matriz de permissões em `shared`, throttler no login, módulo `users` (admin).
Aceite (testes de integração): login ok/erro; 401 sem cookie; 403 por papel em endpoint protegido; usuário desativado perde sessão na hora; senha nunca aparece em resposta/log/auditoria; eventos `auth.*` e `user.*` auditados.

### Etapa 4 — Clientes (API)

Escopo: CRUD sem delete, validação CPF/CNPJ coerente com tipo, unicidade, paginação/filtro/ordenação, optimistic locking, auditoria com before/after.
Aceite: unit dos validadores; integração: criação, duplicidade 409, edição com versão antiga 409, operador escreve / analista 403, auditoria gravada.

### Etapa 5 — Solicitações, máquina de estados, pendências (API)

Escopo: CRUD de solicitação, todas as transições da 3.3, `ApplicationStatusHistory`, atribuição, pendências, cancelamento/reabertura.
Aceite: unit cobrindo **todas** as combinações de/para da máquina; integração: fluxo DRAFT→SUBMITTED→UNDER_REVIEW→PENDING_INFORMATION→UNDER_REVIEW; transição inválida 409; reabertura só ADMIN com motivo; condição de corrida (duas transições simultâneas → uma falha).

### Etapa 6 — Documentos (API)

Escopo: `DocumentStorage` local, upload multipart com limites, magic bytes, SHA-256, download autorizado, validação manual, remoção lógica, auditoria.
Aceite: integração: PDF/PNG/JPEG válidos aceitos; `.exe` renomeado para `.pdf` → 415; extensão divergente do conteúdo → 415; > 10 MB → 413; papel sem permissão → 403; arquivo inexistente/sem acesso → 404; arquivo gravado fora de pasta servida; nome original malicioso (`../../x`) não afeta caminho.

### Etapa 7 — Análise e decisão (API)

Escopo: pareceres append-only, indicadores descritivos com fórmulas, decisão com regras (parecer existente, justificativa, sem pendências abertas para aprovar, permissão `decide`), transação única decisão+status+histórico+auditoria.
Aceite: unit dos indicadores (incl. renda zero → indicador indisponível, não divisão por zero); integração: operador sem `canDecide` 403, com `canDecide` ok; aprovação com pendência aberta 422; decisão dupla 409; auditoria de decisão com ator e justificativa.

### Etapa 8 — Dashboard e consulta de auditoria (API)

Escopo: métricas agregadas do banco; endpoint de auditoria com filtros.
Aceite: integração com dados controlados → contagens e tempo médio exatos; `insufficientData` quando aplicável; auditoria filtrável, somente ADMIN.

### Etapa 9 — Frontend: base, login e layout

Escopo: Tailwind + shadcn, layout com navegação por permissões, cliente HTTP (cookie, `X-Requested-With`, tratamento de Problem Details), TanStack Query, login/logout, rota protegida, página 403/404.
Aceite: login real contra API; menu muda por papel; sessão expirada redireciona para login; Vitest dos guards/cliente HTTP.

### Etapa 10 — Frontend: clientes e solicitações

Escopo: listas com paginação/filtros/ordenação, formulários RHF+Zod (máscaras CPF/CNPJ/BRL), detalhe do cliente, criação/edição/envio da solicitação, upload e lista de documentos.
Aceite: operador executa F2 e F3 no navegador; erros de validação do backend exibidos nos campos; Vitest dos schemas.

### Etapa 11 — Frontend: análise e decisão

Escopo: tela de análise em abas (F4–F8), indicadores com aviso, pendências, pareceres, validação de documentos, diálogo de decisão com confirmação, linha do tempo.
Aceite: analista executa F4–F7 no navegador; botões indisponíveis conforme estado/permissão (e backend continua bloqueando).

### Etapa 12 — Frontend: dashboard, usuários e auditoria

Escopo: dashboard com números do backend, administração de usuários, visualizador de auditoria com diff antes/depois.
Aceite: números conferem com consulta SQL direta ao banco seed; admin cria/desativa usuário e o efeito é imediato.

### Etapa 13 — E2E, CI completo e documentação final

Escopo: Playwright do fluxo principal (operador cadastra cliente → abre solicitação → anexa documentos → envia; analista assume → registra pendência; operador complementa; analista emite parecer → decide; dashboard reflete; auditoria contém os eventos), E2E no CI, README final, `architecture.md`, `domain-model.md`, `security.md`, ADRs, checklist dos 12 critérios do §9 do roadmap com evidência de cada um.
Aceite: todos os critérios do §9 verificados e documentados; `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm test:e2e` passam localmente e no CI; nenhuma dependência de IA.

### Etapa 14 (opcional, se aprovada) — Anonimização de cliente

Escopo: endpoint ADMIN que substitui PII por marcadores, remove arquivos do storage, mantém agregados e auditoria.

---

## 8. Execução (registro)

| Etapa                                     | Commit  | Desvios relevantes em relação ao plano                                                                                                    |
| ----------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Fundação                                | 2ccaab4 | NestJS 12 é ESM-only → Vitest no lugar de Jest; TS fixado em 6.0; Prisma 7 estável ([ADR-0002](decisions/ADR-0002-esm-vitest-versoes.md)) |
| 2 Esquema e seed                          | 4dda03f | Código da solicitação derivado (não armazenado); 5 usuários demo ([ADR-0004](decisions/ADR-0004-integridade-no-banco-e-seed.md))          |
| 3 Auth e RBAC                             | 548b8ee | CSRF como guard; rota `change-password` ([ADR-0005](decisions/ADR-0005-autenticacao-autorizacao.md))                                      |
| 4 Clientes                                | 28bc946 | Auditoria de edição só com campos alterados                                                                                               |
| 5 Solicitações                            | aa901a1 | `assign` também em pendência; `release` por responsável ou admin ([ADR-0006](decisions/ADR-0006-maquina-de-estados.md))                   |
| 6 Documentos                              | 75312a7 | Detecção por assinatura própria (sem `file-type`) ([ADR-0007](decisions/ADR-0007-documentos.md))                                          |
| 7 Análise e decisão                       | fe76772 | — ([ADR-0008](decisions/ADR-0008-analise-e-decisao.md))                                                                                   |
| 8 Dashboard e auditoria                   | 259514d | —                                                                                                                                         |
| 9 Front base                              | 39a635a | Componentes estilo shadcn escritos no repo (sem CLI) ([ADR-0009](decisions/ADR-0009-frontend-base.md))                                    |
| 10 Clientes e solicitações (front)        | abeed58 | Carregamento de telas sob demanda; `WEB_PORT` configurável                                                                                |
| 11 Análise e decisão (front)              | 8a49859 | Abas no detalhe da solicitação                                                                                                            |
| 12 Dashboard, usuários, auditoria (front) | 7b00a85 | —                                                                                                                                         |
| 13 E2E, CI, docs                          | (este)  | Banco próprio para E2E e navegador local sem download ([ADR-0010](decisions/ADR-0010-testes-e2e.md))                                      |
