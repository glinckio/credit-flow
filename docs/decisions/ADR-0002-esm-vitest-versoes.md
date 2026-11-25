# ADR-0002 — ESM em todo o monorepo, Vitest como único runner e versões fixadas

- **Status:** Aceito
- **Data:** 25/11/2026
- **Substitui parcialmente:** decisões D24 e D32 do plano (`docs/plano-parte-a.md`)

## Contexto

Ao validar as versões atuais no registry (Etapa 1), três fatos mudaram premissas do plano:

1. **NestJS 12 é publicado apenas como ESM** (`"type": "module"`). O template oficial `ts-esm` do `@nestjs/schematics` 12 usa **Vitest**, não Jest.
2. **TypeScript 7** é a versão `latest`, mas `typescript-eslint` 8.x exige `typescript <6.1` e `ts-jest` exige `<7`.
3. A dist-tag `latest` do pacote `prisma` aponta para **8.0.0-rc** (pré-release). A última estável é **7.10.1**, que gera client ESM (`prisma-client`) e usa driver adapter (`@prisma/adapter-pg`).

## Decisão

- API, web e shared são **ESM** (`"type": "module"`, `module: nodenext` na API/shared, `bundler` no web).
- **Vitest** para unitários e integração em todos os pacotes (substitui Jest do plano original). A injeção de dependência do Nest funciona no Vitest sem plugin SWC (metadata de decorators verificada nos testes da Etapa 1).
- **TypeScript ~6.0.x** até o ecossistema de lint suportar o 7.
- **Prisma 7.10.1 estável** (CLI, client e adapter fixados na mesma versão). O risco R1 do plano (atrito Prisma 7 × Nest CJS) deixa de existir, pois ambos são ESM.
- `packages/shared` é compilado com `tsc` para `dist/` (consumido pela API) e expõe a condição de export `source` → `src/index.ts`, usada pelo Vite para hot reload sem build.

## Política de supply-chain (pnpm 11)

- `minimumReleaseAge` do pnpm fica **no padrão** (versões publicadas há menos de ~1 dia não são instaladas). Nenhuma exceção foi adicionada; os ranges foram ajustados para o pnpm escolher versões já maduras (ex.: Nest 12.6.0 em vez de 12.6.2 publicada no mesmo dia).
- `allowBuilds`: scripts de instalação liberados somente para `prisma` e `@prisma/engines`; `@scarf/scarf` (telemetria) negado.

## Consequências

- Imports relativos na API usam extensão `.js` (exigência do ESM no Node).
- Um único test runner no monorepo simplifica CI e scripts.
- Rever esta ADR quando `typescript-eslint` suportar TS 7 ou o Prisma 8 sair do RC.
