# ADR-0001 — Monólito modular em monorepo pnpm

- **Status:** Aceito
- **Data:** 25/11/2026

## Contexto

O CreditFlow (Parte A) é um MVP de gestão e análise manual de crédito para uma operação pequena. O roadmap pede explicitamente um monólito modular, sem microsserviços, microfrontends ou Kubernetes.

## Decisão

- Uma API NestJS (`apps/api`) organizada em módulos de domínio (`auth`, `users`, `customers`, `applications`, `documents`, `analysis`, `dashboard`, `audit`, `health`).
- Uma SPA React (`apps/web`).
- `packages/shared` apenas com código TypeScript puro que front e back precisam concordar (enums, matriz de permissões, máquina de estados, validadores, fórmulas de indicadores).
- Monorepo com **pnpm workspaces**, sem Turborepo/Nx.
- Regra de fronteira: um módulo só usa outro via service exportado, nunca o repository alheio.

## Consequências

- Uma transação de banco cobre alteração de negócio + auditoria (consistência simples).
- Deploy único; escala vertical suficiente para o MVP.
- Se um módulo precisar ser extraído no futuro (ex.: integração de IA na Parte B), a fronteira por service facilita a extração.
