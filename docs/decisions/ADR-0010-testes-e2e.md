# ADR-0010 — Testes ponta a ponta com Playwright

- **Status:** Aceito
- **Data:** 26/11/2026
- **Detalha:** D26 do plano; critério 10 do §9 do roadmap

## Decisão

1. **Pacote `e2e/`** no workspace, com `@playwright/test`. Um teste percorre o fluxo principal do roadmap (§5) com três pessoas em contextos de navegador separados (operador, analista, admin), interagindo por rótulos acessíveis como um usuário real. Um segundo teste prova que permissões e CSRF são impostos pela API (mesma sessão, chamadas diretas → 403).
2. **Ambiente isolado e reproduzível**: banco próprio `creditflow_e2e` (derivado de `TEST_DATABASE_URL`, criado se não existir), API na porta 3100, web na 5175, storage `var/storage-e2e`. Antes de subir a API, `support/start-api.ts` cria o banco, aplica migrations, esvazia as tabelas, apaga o storage de teste e roda o seed sintético com uma senha só de teste. Cada execução começa do mesmo estado; não toca no banco de desenvolvimento nem disputa o banco dos testes de integração; não colide com outros projetos na porta 5173.
3. **Navegador**: localmente usa o Chrome instalado (`channel: 'chrome'`, sem download de binários; `PW_CHANNEL=msedge` ou vazio para outras opções). No CI, `playwright install --with-deps chromium`.
4. **CI**: job `e2e` separado, com seu próprio Postgres de serviço; relatório e traces enviados como artefato em caso de falha.
5. **Arquivos enviados no teste** são PDFs sintéticos mínimos gerados em memória (`setInputFiles` com buffer).

## Consequências

- `pnpm test:e2e` compila shared e API antes de rodar (a API sobe a partir de `dist/`).
- O teste é serial (um worker): os passos dependem do mesmo banco semeado.
- Execução local verificada duas vezes seguidas: 2/2 testes, ~34 s, sem processos órfãos.
- O job de CI foi escrito mas ainda não executado no GitHub (o repositório não foi publicado).
