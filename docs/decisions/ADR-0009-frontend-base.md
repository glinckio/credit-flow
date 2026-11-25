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

## Pendências registradas

- Bundle único de ~561 kB (aviso do Vite > 500 kB): introduzir lazy-loading por rota quando as telas reais entrarem (Etapa 10).
- Tema escuro fora do MVP.
