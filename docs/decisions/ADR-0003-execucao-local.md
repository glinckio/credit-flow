# ADR-0003 — Execução local: Postgres no Docker, aplicações no host

- **Status:** Aceito
- **Data:** 25/11/2026

## Contexto

O ambiente principal de desenvolvimento é Windows. Bind mounts com file watching em containers no Windows são lentos e instáveis.

## Decisão

- `docker-compose.yml` sobe **somente o PostgreSQL 17**, exposto apenas em `127.0.0.1:5433` (evita conflito com Postgres local na 5432).
- Um script de init cria o banco `creditflow_test`, usado exclusivamente pelos testes de integração.
- API (`:3000`) e web (`:5173`) rodam no host via `pnpm dev`. O Vite faz proxy de `/api` para a API, mantendo front e API na mesma origem (cookies first-party, CORS desligado).
- Um único `.env` na raiz; `.env.example` versionado sem segredos. A senha do Postgres é escolhida por cada desenvolvedor.

## Consequências

- Hot reload rápido nos dois apps.
- Containerizar API/web pode ser adicionado depois como profile opcional do Compose, sem mudar código.
