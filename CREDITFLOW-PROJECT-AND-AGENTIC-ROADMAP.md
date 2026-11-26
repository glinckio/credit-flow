# CreditFlow — Projeto-base e evolução para arquitetura agêntica

**Versão:** 1.0  
**Data:** 25/11/2026  
**Objetivo deste documento:** orientar duas etapas independentes no Claude Code: primeiro construir uma aplicação financeira funcional do zero; depois evoluí-la com uma arquitetura de IA agêntica integrada ao produto.

---

# 1. Visão geral e estratégia

Vamos criar uma aplicação fictícia chamada **CreditFlow**, usada por uma pequena operação financeira para gerenciar clientes, solicitações de crédito, documentos e análises feitas por analistas.

O projeto terá duas etapas bem separadas:

1. **Projeto-base:** aplicação financeira tradicional, funcional e sem agentes ou LLMs. Ela será o produto existente no qual poderemos trabalhar.
2. **Evolução agêntica:** adicionar uma camada de IA ao produto, com agentes e ferramentas que apoiam o processo de análise de crédito, sem substituir as regras determinísticas nem a responsabilidade do analista.

Essa separação é intencional. Primeiro teremos um sistema real, com frontend, backend, banco, autenticação, regras de negócio, testes e fluxo operacional. Depois vamos estudar como incorporar agentes a esse ambiente, respeitando suas tecnologias e limitações.

**Não construa as duas etapas ao mesmo tempo.** O Claude Code deve concluir o projeto-base e só depois iniciar a descoberta e o desenho da arquitetura agêntica.

# PARTE A — CONSTRUIR O PROJETO-BASE

## 2. Objetivo do produto-base

Construir um MVP de uma plataforma de gestão e análise operacional de solicitações de crédito.

A aplicação deve permitir que uma equipe:
- Cadastre e consulte clientes.
- Registre solicitações de crédito.
- Anexe e acompanhe documentos.
- Consulte informações financeiras declaradas pelo cliente.
- Faça uma análise manual e estruturada da solicitação.
- Registre uma decisão humana e sua justificativa.
- Acompanhe o histórico e o status de cada solicitação.

O produto-base não deve usar inteligência artificial. A análise inicial será feita por um usuário humano, apoiado por formulários, dados estruturados e regras determinísticas simples.

## 3. Usuários e permissões

Implementar autenticação e controle de acesso baseado em papéis (RBAC).

Papéis iniciais:

### Administrador
- Gerencia usuários e papéis.
- Consulta todos os clientes e solicitações.
- Acessa indicadores operacionais.
- Consulta trilhas de auditoria.

### Analista de crédito
- Consulta clientes e solicitações autorizadas.
- Analisa solicitações.
- Registra observações, pendências e pareceres.
- Recomenda aprovação, reprovação ou solicitação de informações adicionais, conforme as permissões definidas.
- Não gerencia usuários.

### Operador
- Cadastra clientes.
- Abre solicitações.
- Anexa documentos.
- Atualiza dados cadastrais permitidos.
- Não registra a decisão final de crédito, salvo se receber essa permissão explicitamente.

As permissões devem ser verificadas no backend, não apenas escondidas na interface.

Para o ambiente local, criar dados fictícios e usuários de demonstração. Não colocar senhas reais ou credenciais no repositório.

## 4. Módulos funcionais

### 4.1 Dashboard
Exibir indicadores operacionais básicos:
- Total de solicitações.
- Solicitações aguardando análise.
- Solicitações com pendências.
- Solicitações aprovadas.
- Solicitações reprovadas.
- Tempo médio entre abertura e conclusão, se houver dados suficientes.

Os indicadores devem ser calculados a partir dos dados reais do banco. Não usar números estáticos para simular métricas.

### 4.2 Clientes
Cadastro e consulta de clientes com:
- Nome completo ou razão social.
- CPF/CNPJ fictício nos dados de demonstração.
- E-mail e telefone.
- Data de nascimento ou data de constituição, quando aplicável.
- Endereço.
- Tipo de cliente: pessoa física ou jurídica.
- Data de criação e última atualização.
- Status cadastral.

Validar formatos e unicidade de identificadores quando aplicável. Para demonstração, usar exclusivamente dados sintéticos.

### 4.3 Solicitações de crédito
Cada solicitação deve conter:
- Identificador único.
- Cliente relacionado.
- Tipo de crédito.
- Valor solicitado.
- Prazo solicitado em meses.
- Finalidade declarada.
- Renda ou faturamento declarado, conforme tipo de cliente.
- Despesas ou compromissos financeiros declarados, se aplicável.
- Data de abertura.
- Responsável atual.
- Status.
- Histórico de alterações.

Estados iniciais sugeridos:
- `DRAFT`
- `SUBMITTED`
- `UNDER_REVIEW`
- `PENDING_INFORMATION`
- `APPROVED`
- `REJECTED`
- `CANCELLED`

As transições devem ser validadas no backend. Por exemplo, uma solicitação cancelada não deve voltar para análise sem uma ação administrativa explícita e auditada.

### 4.4 Documentos
Permitir anexar documentos à solicitação:
- Documento de identificação.
- Comprovante de endereço.
- Comprovante de renda ou faturamento.
- Extrato ou documento financeiro.
- Outros documentos configuráveis.

Cada documento deve possuir:
- Tipo.
- Nome original.
- Referência de armazenamento.
- Tipo MIME.
- Tamanho.
- Data de envio.
- Usuário responsável pelo envio.
- Status de validação manual.
- Observações.

Requisitos de segurança:
- Validar extensão, MIME type e tamanho.
- Não confiar no nome ou no MIME type informado pelo navegador.
- Armazenar arquivos fora da pasta pública da aplicação.
- Não executar arquivos enviados.
- Restringir acesso por autorização no backend.
- Para desenvolvimento local, usar armazenamento local isolado ou serviço compatível com S3 via Docker, se isso for simples e justificado.
- Não incluir documentos reais ou dados pessoais no Git.

### 4.5 Análise de crédito manual
Criar uma tela de análise para o analista revisar:
- Dados do cliente.
- Dados da solicitação.
- Documentos anexados e status.
- Informações de renda/faturamento e compromissos declarados.
- Pendências identificadas manualmente.
- Observações do analista.
- Parecer e justificativa.

O sistema pode calcular indicadores descritivos simples, como relação entre valor solicitado e renda declarada, desde que a fórmula seja documentada e não seja apresentada como uma política de crédito universal.

A aplicação não deve inventar um score de crédito com aparência de precisão científica. Se houver um indicador ilustrativo, deixar claro que é apenas demonstrativo e não determina aprovação ou reprovação.

A decisão final deve ser humana, autorizada e acompanhada de justificativa.

### 4.6 Histórico e auditoria
Registrar eventos importantes:
- Criação e atualização de cliente.
- Abertura e alteração de solicitação.
- Envio e alteração de status de documento.
- Mudanças de status da solicitação.
- Atribuição de responsável.
- Registro ou alteração de parecer.
- Decisão final.

Cada evento deve registrar ator, data/hora, entidade, ação e dados relevantes antes/depois, evitando armazenar segredos ou cópias desnecessárias de documentos.

### 4.7 Administração
Permitir que administradores:
- Listem usuários.
- Criem e desativem usuários.
- Atribuam papéis.
- Consultem eventos de auditoria.

Não é necessário construir um sistema complexo de gestão de permissões customizadas no MVP. Os papéis iniciais são suficientes.

## 5. Fluxo principal do produto-base

1. Operador cadastra um cliente.
2. Operador abre uma solicitação de crédito.
3. Operador informa os dados declarados e anexa documentos.
4. Solicitação é enviada para análise.
5. Analista abre a solicitação e revisa os dados.
6. Se faltar informação, registra pendência e devolve para complementação.
7. Quando houver informação suficiente, analista registra parecer.
8. Usuário autorizado registra a decisão humana.
9. Sistema atualiza o status e grava os eventos de auditoria.
10. Dashboard reflete os dados atualizados.

Esse fluxo deve funcionar ponta a ponta antes de qualquer implementação de agentes.

## 6. Stack técnica sugerida para o projeto-base

A stack abaixo é uma recomendação para construir um ambiente moderno e coerente com o objetivo de praticar engenharia de software e, posteriormente, integração com IA. O Claude Code deve validar compatibilidade e versões atuais antes de instalar dependências.

### Frontend
- React.
- TypeScript.
- Vite.
- React Router.
- TanStack Query para estado remoto, se adequado.
- React Hook Form e Zod para formulários e validação.
- Uma biblioteca visual consistente, por exemplo shadcn/ui com Tailwind CSS.

### Backend
- Node.js.
- NestJS.
- TypeScript.
- API REST documentada com OpenAPI/Swagger.
- Validação de DTOs.
- Camadas claras de controller, service e repository, sem abstrações desnecessárias.

### Banco de dados
- PostgreSQL.
- Prisma ORM, se compatível com as decisões do projeto.
- Migrations versionadas.

### Infraestrutura local
- Docker e Docker Compose.
- PostgreSQL em container.
- Serviço de armazenamento compatível com S3 somente se necessário para o fluxo de documentos.
- Arquivo `.env.example` sem valores secretos.

### Qualidade
- ESLint e Prettier.
- Testes unitários e de integração.
- Testes end-to-end para o fluxo principal.
- CI simples para lint, typecheck e testes.

### Organização sugerida
Monorepo com:
- `apps/web` — frontend.
- `apps/api` — backend.
- `packages/shared` — tipos e schemas compartilhados, somente se realmente útil.
- `docs` — requisitos, arquitetura e decisões.

Não introduzir microfrontends, microsserviços ou Kubernetes no MVP. O objetivo é ter um monólito modular bem organizado, que possa evoluir sem complexidade prematura.

## 7. Entidades iniciais do domínio

Modelo conceitual inicial; os nomes e relações finais devem ser refinados antes da implementação.

- `User`
- `Role` ou enum de papéis
- `Customer`
- `CreditApplication`
- `CreditDocument`
- `CreditReview`
- `ApplicationStatusHistory`
- `AuditEvent`

Relações principais:
- Um cliente pode ter várias solicitações.
- Uma solicitação pertence a um cliente.
- Uma solicitação pode ter vários documentos.
- Uma solicitação pode ter revisões e observações.
- Eventos de auditoria referenciam a entidade afetada e o ator responsável.

Evitar duplicar dados do cliente em várias tabelas sem uma razão de negócio documentada. Definir estratégia de exclusão, retenção e anonimização durante o desenho do modelo.

## 8. Requisitos não funcionais do projeto-base

- Autenticação segura e autorização no backend.
- Senhas armazenadas com hash apropriado; nunca em texto puro.
- Segredos somente em variáveis de ambiente ou gerenciador de segredos.
- Validação de entrada no frontend e no backend.
- Proteção contra acesso indevido a documentos e registros de outros usuários.
- Tratamento consistente de erros.
- Logs estruturados sem dados pessoais desnecessários.
- Paginação, filtros e ordenação nas listagens.
- Migrations reproduzíveis.
- Testes automatizados dos fluxos críticos.
- Dados seed exclusivamente sintéticos.
- README com instruções para executar localmente.

## 9. Critérios de aceite do projeto-base

O projeto-base só será considerado concluído quando:

1. Um desenvolvedor conseguir subir a aplicação localmente seguindo o README.
2. Um usuário conseguir autenticar-se.
3. As permissões de administrador, analista e operador forem aplicadas no backend.
4. Um operador conseguir cadastrar cliente e solicitação.
5. Documentos sintéticos puderem ser anexados e consultados com autorização.
6. Um analista conseguir revisar uma solicitação, registrar pendências e emitir parecer.
7. Um usuário autorizado conseguir registrar uma decisão humana com justificativa.
8. O histórico e a auditoria registrarem as ações relevantes.
9. O dashboard apresentar dados reais do banco.
10. O fluxo principal tiver testes automatizados.
11. Lint, typecheck, testes e build passarem.
12. Não houver dependência de LLM, agente ou API de IA para o funcionamento do produto-base.

## 10. O que não construir na primeira etapa

- Agentes autônomos.
- Orquestrador de agentes.
- RAG ou banco vetorial.
- Chatbot.
- Integração com Claude ou outro modelo.
- Aprovação ou reprovação automática.
- Integração bancária real.
- Consulta a bureaus de crédito reais.
- Deploy em infraestrutura complexa.
- Arquitetura de microsserviços.

Esses itens ficam para fases futuras e só serão incluídos se houver necessidade comprovada.

---

# PARTE B — EVOLUIR O PRODUTO PARA UMA ARQUITETURA AGÊNTICA

**Esta parte só deve ser iniciada quando a Parte A estiver funcional, testada e documentada.**

## 11. Objetivo da evolução agêntica

Adicionar ao CreditFlow uma capacidade de análise assistida por IA, integrada ao fluxo já existente.

A IA deverá ajudar o analista a:
- Entender os documentos recebidos.
- Extrair informações relevantes.
- Identificar dados ausentes ou inconsistentes.
- Comparar informações extraídas com os dados da solicitação.
- Organizar evidências.
- Produzir um relatório estruturado e explicável.
- Sugerir perguntas ou próximos passos para o analista.

A IA não deve tomar a decisão final de crédito. Aprovação e reprovação permanecem decisões humanas, realizadas no fluxo autorizado do sistema.

## 12. Estratégia de arquitetura

Não começar criando vários agentes. Primeiro mapear o fluxo existente, identificar as tarefas em que um LLM agrega valor e comparar agentes com alternativas determinísticas.

Arquitetura conceitual candidata:

1. **AI Integration API:** recebe pedidos de análise autorizados pelo backend principal.
2. **Workflow Orchestrator:** controla estados, etapas, timeout, retry, idempotência e handoffs.
3. **Document Understanding:** classifica documentos e extrai campos com referência à origem.
4. **Validation Service:** executa validações determinísticas e compara dados.
5. **Analysis Agent:** organiza somente fatos validados em um relatório para o analista.
6. **Audit and Evaluation:** registra versões, resultados, evidências, custos, latência e qualidade.
7. **Human Review:** apresenta os resultados no CreditFlow e mantém a decisão com o analista.

Esses componentes não precisam ser serviços separados. A implantação inicial pode ser um módulo dentro do backend ou um serviço dedicado, conforme a descoberta técnica justificar.

## 13. Possíveis agentes e responsabilidades

Agentes são possibilidades, não uma lista obrigatória.

### Document Classification / Intake
- Identificar o tipo de documento.
- Verificar se o formato é suportado.
- Encaminhar para a etapa correta.
- Não decidir crédito.

### Information Extraction
- Extrair campos previamente definidos.
- Retornar JSON validável por schema.
- Informar fonte, página/trecho e incerteza.
- Não preencher campos ausentes por suposição.

### Discrepancy Analysis
- Comparar fatos extraídos com dados da solicitação.
- Diferenciar divergência confirmada, ausência e ambiguidade.
- Apontar as evidências usadas.
- Não alterar os dados oficiais automaticamente.

### Analyst Report
- Produzir resumo estruturado com fatos, pendências, inconsistências e limitações.
- Referenciar evidências.
- Não inventar justificativas nem emitir decisão final.

### Future agents
Somente após avaliação e necessidade real, considerar agentes especializados para outros fluxos da plataforma.

## 14. Controles obrigatórios para IA

- Usar dados sintéticos durante desenvolvimento e demonstrações.
- Não enviar dados reais de clientes a provedores externos sem autorização formal e avaliação de privacidade/segurança.
- Proteger contra prompt injection em documentos e conteúdo enviado por usuários.
- Tratar conteúdo de documentos como dado não confiável, nunca como instrução para o agente.
- Restringir ferramentas por agente e aplicar menor privilégio.
- Não permitir acesso irrestrito ao banco ou filesystem.
- Validar toda saída com schemas.
- Fazer validação determinística no backend.
- Registrar modelo/provedor, versão, configuração, execução, ferramentas utilizadas e resultado, sem registrar segredos ou conteúdo sensível desnecessário.
- Ter timeout, limite de custo, limite de tokens, retry controlado e fallback.
- Encaminhar casos ambíguos, incompletos ou com falha para revisão humana.
- Versionar prompts, schemas e datasets de avaliação.
- Testar regressões sempre que mudar modelo, prompt, ferramenta ou fluxo.

## 15. Avaliação de qualidade

Antes de considerar a funcionalidade útil, criar um conjunto de casos sintéticos representando:
- Documento legível e completo.
- Documento incompleto.
- Documento ilegível.
- Campos contraditórios.
- Documento de tipo não suportado.
- Dados que não correspondem à solicitação.
- Tentativa de prompt injection dentro do documento.
- Resposta do modelo fora do schema.
- Timeout ou indisponibilidade do provedor.

Medir:
- Correção da extração.
- Validade das referências às evidências.
- Precisão na identificação de divergências.
- Taxa de afirmações sem suporte.
- Taxa de fallback seguro.
- Latência.
- Custo por análise.
- Frequência de correções feitas pelo analista.

Não estabelecer metas numéricas sem primeiro medir uma baseline.

## 16. Integração com o produto existente

- Reutilizar autenticação, autorização, clientes, solicitações e documentos do CreditFlow.
- Não duplicar o cadastro de clientes ou o sistema de solicitações.
- Definir contrato claro entre o backend principal e o módulo de IA.
- Manter o sistema de registro oficial e o fluxo de decisão no produto-base.
- Exibir relatório e status no contexto da solicitação.
- Permitir reprocessamento controlado quando os documentos ou dados mudarem.
- Preservar versões anteriores dos relatórios e seus vínculos com as entradas utilizadas.

---

# PARTE C — CRESCIMENTO DO PRODUTO E NOVOS FLUXOS

## 17. A aplicação não ficará limitada à análise de crédito

A análise de crédito é o primeiro caso de uso para aprender a projetar, integrar e avaliar agentes em um sistema real. A arquitetura deve permitir a evolução da plataforma, mas sem construir todos os módulos antecipadamente.

Possíveis expansões:

### 17.1 Onboarding e análise cadastral
- Conferência de documentos cadastrais.
- Identificação de campos ausentes.
- Comparação de dados entre documentos.
- Preparação de pendências para o operador.

### 17.2 Monitoramento de carteira
- Resumos de alterações relevantes em dados da carteira.
- Identificação de padrões que merecem investigação.
- Geração de alertas explicáveis para revisão humana.

### 17.3 Cobrança e relacionamento
- Organização do histórico de contato.
- Sugestão de próximos passos com base em políticas autorizadas.
- Preparação de mensagens para aprovação humana.
- Nunca enviar comunicações sensíveis ou negociar condições sem regras e autorização explícitas.

### 17.4 Análise documental
- Classificação e extração de documentos em outros fluxos.
- Verificação de completude.
- Comparação de versões.
- Encaminhamento de exceções.

### 17.5 Assistente interno de operações
- Responder perguntas sobre processos e registros aos quais o usuário já tem acesso.
- Consultar dados por ferramentas com autorização.
- Explicar o status de uma solicitação.
- Não contornar permissões nem revelar dados de outros clientes.

### 17.6 Detecção de anomalias e prevenção a fraude
- Sinalizar padrões atípicos para investigação.
- Explicar os sinais observados.
- Não acusar automaticamente uma pessoa nem bloquear operações sem processo de revisão apropriado.

## 18. Como decidir se um novo agente deve existir

Para cada novo fluxo, responder:

1. Qual problema de negócio será resolvido?
2. Quem é o usuário beneficiado?
3. Como o processo funciona hoje?
4. Qual etapa exige raciocínio contextual ou uso de ferramentas?
5. Uma função determinística ou regra de negócio resolveria melhor?
6. Quais dados o agente precisa acessar?
7. Quais ferramentas ele realmente precisa?
8. O que ele pode fazer e o que está proibido de fazer?
9. Como um humano verifica o resultado?
10. Como medir qualidade, custo, latência e impacto?

Só criar um agente quando houver uma responsabilidade clara e uma vantagem verificável. A arquitetura pode ter vários agentes no futuro, mas não deve virar um conjunto de agentes sem necessidade.

## 19. Evolução por etapas

Sugestão de roadmap:

- **Etapa 1:** produto-base de crédito, sem IA.
- **Etapa 2:** análise documental assistida por IA.
- **Etapa 3:** extração e validação com evidências.
- **Etapa 4:** relatório assistido para analista.
- **Etapa 5:** onboarding cadastral assistido.
- **Etapa 6:** assistente interno com ferramentas e controle de acesso.
- **Etapa 7:** monitoramento, alertas e outros fluxos, conforme necessidade.

Cada etapa deve ter escopo, critérios de aceite, avaliação e revisão arquitetural próprios.

---

# PARTE D — INSTRUÇÕES PARA O CLAUDE CODE

## 20. Regras gerais de trabalho

O Claude Code deve atuar como parceiro de engenharia, não como autoridade que toma decisões sem revisão.

- Ler este documento integralmente.
- Respeitar as fases e não misturá-las.
- Trabalhar em tarefas pequenas e verificáveis.
- Inspecionar o código antes de propor alterações.
- Explicar alternativas e trade-offs.
- Não assumir que uma tecnologia ou biblioteca é obrigatória quando houver uma opção melhor justificada.
- Não adicionar dependências sem explicar a necessidade.
- Não introduzir microsserviços, filas, vector database ou agentes por moda.
- Não alterar arquitetura ou escopo silenciosamente.
- Não executar comandos destrutivos, migrations em ambientes compartilhados ou deploy sem aprovação.
- Nunca afirmar que testes passaram sem executá-los e verificar o resultado.
- Manter documentação e decisões técnicas atualizadas.
- Separar fatos verificados, hipóteses e questões em aberto.
- Pedir esclarecimento quando uma decisão de produto, segurança ou arquitetura não puder ser tomada com segurança.

## 21. Prompt para iniciar a construção do projeto-base

Copie este prompt ao abrir uma pasta vazia no Claude Code, junto com este documento:

> Leia integralmente o arquivo `CREDITFLOW-PROJECT-AND-AGENTIC-ROADMAP.md`.
>
> Vamos executar somente a **PARTE A — CONSTRUIR O PROJETO-BASE**. Não implemente agentes, LLMs, RAG ou qualquer integração de IA nesta fase.
>
> Primeiro, transforme os requisitos da Parte A em um plano de implementação detalhado. Proponha a arquitetura do monólito modular, estrutura do repositório, modelo de domínio, contratos da API, estratégia de autenticação/autorização, armazenamento de documentos, testes e execução local.
>
> Antes de codificar, apresente:
> 1. Decisões técnicas e justificativas.
> 2. Estrutura de pastas proposta.
> 3. Modelo de dados inicial.
> 4. Fluxos de usuário.
> 5. Contratos/API principais.
> 6. Riscos e pontos ainda indefinidos.
> 7. Plano dividido em etapas pequenas, com critérios de aceite.
>
> Não comece a implementar até eu revisar e aprovar esse plano.
>
> Depois da aprovação, implemente por etapas. Ao final de cada etapa, informe arquivos alterados, decisões tomadas, testes executados e resultados reais. Mantenha README, documentação e decisões técnicas atualizados.
>
> O resultado esperado é uma aplicação funcional de gestão e análise manual de crédito, com frontend, backend, banco de dados, autenticação, autorização, documentos, auditoria e testes. A análise e a decisão de crédito são humanas. Use somente dados sintéticos.
>
> Não avance para a Parte B até a Parte A estar concluída e eu autorizar explicitamente.

## 22. Prompt para iniciar a evolução agêntica

Depois que o projeto-base estiver concluído, testado e documentado, use este segundo prompt no mesmo repositório:

> Leia integralmente `CREDITFLOW-PROJECT-AND-AGENTIC-ROADMAP.md`, especialmente as Partes B, C e D. Inspecione também a implementação real, os documentos, os contratos e os testes existentes.
>
> Agora vamos estudar e planejar a evolução do CreditFlow com IA agêntica. **Não implemente nada ainda.**
>
> Primeiro faça uma nova descoberta técnica e funcional:
> 1. Descreva a arquitetura atual com base no código real.
> 2. Mapeie o fluxo atual de solicitação, documentos, análise e decisão.
> 3. Identifique os pontos em que IA pode gerar valor.
> 4. Separe tarefas determinísticas de tarefas que podem justificar LLMs ou agentes.
> 5. Proponha a menor arquitetura segura que resolva o primeiro caso de uso.
> 6. Compare uma implementação com workflow determinístico e poucas chamadas de modelo com uma arquitetura multiagente. Explique os custos e benefícios.
> 7. Defina limites, ferramentas, permissões, schemas, estados, falhas, auditoria e avaliação.
> 8. Verifique as opções atuais do Anthropic Agent SDK e demais bibliotecas apenas se a documentação oficial e as versões forem necessárias para uma decisão técnica. Não presuma APIs ou funcionalidades.
> 9. Identifique alterações necessárias no frontend, backend, banco e infraestrutura.
> 10. Proponha um roadmap incremental com critérios de aceite.
>
> O primeiro caso de uso é análise documental e preparação de um relatório de apoio ao analista. O sistema não pode aprovar ou reprovar crédito autonomamente.
>
> Não reescreva o produto. Reutilize o domínio e os fluxos existentes. Não crie agentes apenas para aumentar a quantidade de agentes. Use dados sintéticos.
>
> Apresente a descoberta, as opções arquiteturais, os riscos, as decisões pendentes e o plano. Aguarde minha aprovação antes de modificar código ou instalar dependências.

## 23. Como trabalhar em conjunto com o Claude Code

Para cada etapa, peça que ele:
- Explique o problema que está resolvendo.
- Mostre quais arquivos e módulos serão afetados.
- Justifique a abordagem escolhida.
- Liste alternativas descartadas e por quê.
- Divida a implementação em tarefas pequenas.
- Implemente uma tarefa por vez.
- Execute testes e mostre os resultados.
- Atualize documentação quando a realidade do código mudar.

Não aceite uma arquitetura só porque o agente a sugeriu. O objetivo do exercício é aprender a avaliar as decisões: por que usar um agente, por que não usar, onde manter lógica determinística, como controlar ferramentas, como medir qualidade e como operar isso em produção.

---

# 24. Resultado final esperado do aprendizado

Ao final, você deverá ter construído e conseguir explicar:

1. Um produto financeiro funcional, com arquitetura de software convencional.
2. Uma integração de IA que resolve uma dor real dentro desse produto.
3. Um workflow agêntico com responsabilidades e permissões bem definidas.
4. Integração com APIs, banco, documentos e serviços existentes.
5. Estratégias de avaliação, observabilidade, segurança e controle de custos.
6. Um caminho de expansão para novos fluxos sem transformar tudo em uma arquitetura excessivamente complexa.

**A ideia central:** primeiro construímos um produto que funciona sem IA. Depois adicionamos inteligência onde ela realmente melhora o processo. A análise de crédito é nosso primeiro caso de uso, não o limite do produto nem da arquitetura.
