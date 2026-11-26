# ADR-0009 — Base do frontend

- **Status:** Aceito
- **Data:** 25/11/2026
- **Detalha:** D6, D23 e D25 do plano

## Decisão

1. **Stack**: React 19 + Vite 8 + TypeScript 6, React Router 8 (modo data: `createBrowserRouter`), TanStack Query 5 (estado remoto), React Hook Form + Zod 4 (formulários), Tailwind CSS 4 (plugin Vite, tokens em `@theme`), ícones `lucide-react`, notificações `sonner`.
2. **Componentes no estilo shadcn/ui escritos no repositório** (`src/components/ui`: Button, Input/Textarea, FormField, Card, Alert, Badge, Spinner) com `class-variance-authority` + `tailwind-merge`. Mesma filosofia do shadcn (código copiado, sem biblioteca de UI), sem executar a CLI que baixa arquivos de registry externo. Primitivas Radix entram só quando um componente precisar (diálogo, select), nas próximas etapas.
3. **Sessão**: o frontend nunca vê o token (cookie httpOnly). A fonte de verdade do usuário é a query `GET /auth/me` (`['auth','me']`); `null` = anônimo. Login grava o usuário no cache após limpar todo o cache anterior; logout limpa tudo. Qualquer `401` em query/mutation zera o usuário e o guard leva ao login.
4. **Cliente HTTP** (`src/lib/api.ts`): `credentials: same-origin`, `X-Requested-With` em métodos mutáveis (CSRF), erros RFC 9457 como `ApiError` com `code`, `fieldErrors` e `requestId` (exibido como "código para suporte"). Falha de rede e respostas não-JSON viram mensagens amigáveis. Erros 4xx não têm retry.
5. **Guards** (apenas UX — a API é a autoridade): `RequireAuth` (sessão; senha temporária força `/trocar-senha`; preserva destino em `?redirect=`, validado contra open redirect) e `RequirePermission` (403 amigável). Menu montado a partir das permissões efetivas de `/auth/me`.
6. **Rotas em português** (`/login`, `/trocar-senha`, `/clientes`, `/solicitacoes`, `/admin/usuarios`, `/admin/auditoria`); telas futuras ficam como placeholders identificando a etapa.
7. **Testes**: Vitest + Testing Library + user-event sobre a **tabela de rotas real** num `createMemoryRouter`, com `fetch` simulado por teste.

## Etapa 10 — telas de clientes e solicitações

- Estado de listas (filtros, ordenação, página) na URL (`useListParams`): links compartilháveis, sobrevivem a reload/voltar.
- Máscaras de CPF/CNPJ, CEP e telefone; valores em BRL digitados em pt-BR ("15.000,50") e enviados como decimal ("15000.50").
- Schemas Zod do frontend reutilizam os validadores de `@creditflow/shared` (CPF/CNPJ, idade, UF, CEP); regras cruzadas usam `when` do Zod 4 para aparecer assim que os campos envolvidos são preenchidos.
- Botões de transição vêm de `availableActions` da API; motivo obrigatório em cancelar/reabrir; erros da API (ex.: documentos obrigatórios ausentes) aparecem no próprio diálogo.
- Upload com pré-checagem de extensão e tamanho no navegador (a API valida o conteúdo real). Download por link autorizado, sempre como anexo.
- Diálogo acessível com Radix (`radix-ui`); demais controles nativos estilizados.

## Etapa 11 — análise e decisão

- Detalhe da solicitação em abas (Radix Tabs; aba na URL `?aba=analise`): Dados e documentos | Análise | Histórico.
- Aba Análise: indicadores descritivos com fórmula e aviso (sem cores/faixas/score), pendências (criar, resolver), pareceres (append-only, "Vigente"), painel de decisão.
- Decisão: diálogo exige resultado, justificativa (mín. 20) e marcação explícita "decisão humana, tomada por mim"; alerta quando não há parecer, quando há pendências abertas e quando a decisão diverge do parecer; erros `review-required`/`open-issues` da API exibidos no diálogo.
- Ações de análise aparecem só para o analista responsável durante a análise (`useAnalysisAccess`); validação de documentos como coluna extra (aceitar/rejeitar com motivo). Admin atribui/reatribui analista ativo.
- Verificado no navegador: F4–F7 completo (assumir, validar, pendência, solicitar informações, operador complementa e devolve, resolver, parecer, tentativa de decidir sem parecer recusada, aprovação).

## Etapa 12 — dashboard, usuários e auditoria

- Dashboard: números como _stat tiles_ (não gráficos), cada um levando à lista filtrada; distribuição por status como barras horizontais de série única (um só tom, sem cores de status, valor e % sempre escritos). Tempos médios em dias/horas com a base usada; "dados insuficientes" quando não há decididas. Conferido contra SQL direto: todos os números idênticos.
- Usuários: senha temporária gerada no navegador (`crypto.getRandomValues`), concessão "pode decidir" só para operador, papel próprio e auto-desativação bloqueados na UI (a API também recusa).
- Auditoria: tabela paginada com expansão por linha (antes/depois por campo, metadados como `requestId` e IP), link para o registro auditado; atalho "Auditoria" no detalhe da solicitação para admins.
- Bug de acessibilidade encontrado pelo teste: o rótulo do campo de senha apontava para o contêiner; corrigido para apontar para o `<input>`.

## Pendências registradas

- ~~Bundle único de ~561 kB~~ **Resolvido na Etapa 10**: todas as telas (inclusive login e troca de senha) são carregadas sob demanda (`lazy` do React Router). Chunk inicial: 297 kB (92 kB gzip); zod e react-hook-form só baixam com os formulários.
- Tema escuro fora do MVP.
