# ADR-0011 — IA de apoio ao analista: workflow determinístico com poucas chamadas de modelo

- **Status:** Aceito
- **Data:** 26/11/2026
- **Detalha:** Parte B do roadmap (§§ 11–16); plano em [plano-parte-b.md](../plano-parte-b.md)

## Contexto

Primeiro caso de uso de IA: ler os documentos da solicitação, extrair campos com evidência, comparar com os dados declarados e preparar um relatório de apoio. A IA **não decide** crédito, não altera dados oficiais e não substitui a validação manual de documentos.

Os passos do processo são conhecidos de antemão (extrair → verificar → comparar → relatar). A comparação é aritmética e igualdade; a única parte que exige um modelo é ler conteúdo não estruturado (PDF/imagem) e, opcionalmente, redigir uma narrativa a partir de fatos já verificados.

## Decisão

1. **Workflow determinístico, não multiagente.** Um módulo `ai-analysis` dentro da API (monólito, [ADR-0001](ADR-0001-monolito-modular.md)). Por documento, **uma** chamada de modelo (classificação + extração) **sem ferramentas** e com saída estruturada; depois, **uma** chamada para a narrativa, que recebe apenas fatos verificados (nunca o documento). Todo o resto é código.
2. **Provedor:** Messages API da Anthropic pelo SDK oficial `@anthropic-ai/sdk` (adicionado só na etapa B3, versão conferida no registry). Descartados: Claude Agent SDK (harness com ferramentas de filesystem/shell — privilégio incompatível com o §14) e Managed Agents (sandbox hospedado e histórico de sessão desnecessários).
3. **Modelo:** `claude-haiku-5-5` (decisão do produto, por custo). Lista fechada de modelos permitidos no código; o modelo e as versões de prompt/schema/pipeline são gravados em cada execução. Trocar de modelo exige rodar a avaliação.
4. **Evidência obrigatória e verificada por código.** Cada campo extraído traz `page` + `quote`. O backend confere, com o texto do PDF: (a) o trecho existe naquela página, (b) o valor está dentro do trecho, (c) o rótulo mais próximo antes do valor pertence ao campo (o líquido não passa como bruto), (d) o valor está no formato estrito do campo, (e) não existe, em todo o documento, outro valor diferente depois de um rótulo exclusivo do mesmo campo (documento contraditório ou valor injetado não vira fato). Falhou qualquer item → `UNVERIFIED`; o campo não vira fato. Sem camada de texto (imagem, PDF escaneado) → `UNVERIFIABLE`, conferência pelo analista. Não é usado o recurso de _citations_ da API: ele é incompatível com saída estruturada na mesma chamada.
5. **Comparação exata, sem tolerância.** Valores em centavos, datas e identificadores comparados por igualdade após normalizar **apenas a formatação** (moeda, separadores, maiúsculas, acentos, abreviações de logradouro). Renda declarada é comparada com bruto **e** líquido do comprovante: divergente só se não bater com nenhum. Nome abreviado é divergente.
6. **Prompt injection:** o conteúdo do documento é dado não confiável. A chamada de extração não tem ferramentas, a saída é limitada por schema, a comparação é feita por código, e um detector determinístico de padrões de instrução soma-se ao sinal `embeddedInstructionsDetected` do modelo para alertar o analista. Se o detector determinístico encontrar texto dirigido a uma IA, **nenhum valor daquele documento vira fato** (o documento é tratado como adulterado e fica para conferência humana); o sinal só do modelo gera alerta, sem descartar valores verificados.
7. **Disparo e custo:** automático na **primeira** entrada da solicitação em `UNDER_REVIEW`; depois, apenas manual (botão "Reprocessar" do analista responsável). Uma execução ativa por solicitação; mesma entrada (sha256 dos documentos + versão da solicitação + modelo + versões) reaproveita o resultado salvo. Sem retentativas no código da aplicação (o SDK faz no máximo 1 em erro transitório). Limites de páginas e de custo por execução.
8. **Reprodutibilidade:** o modelo não é determinístico (o Haiku 5.5 não aceita `temperature`). Testes de CI usam respostas gravadas (sem rede, sem custo); a qualidade do modelo real é medida no eval, que só roda com autorização explícita a cada rodada.
9. **Acesso:** leitura do relatório por analista, admin e operador com `canDecide`; disparo manual só pelo analista responsável.
10. **Retenção:** extrações e relatórios removidos após 90 dias por rotina de expurgo; a auditoria mantém só metadados (quem, quando, modelo, versões, custo), nunca valores extraídos.
11. **Dados:** somente sintéticos no piloto. Dados reais exigiriam provedor/contrato adequado ou camada de anonimização — fora de escopo.

## Consequências

- Custo e latência previsíveis (N documentos + 1 chamadas), fácil de testar e de auditar.
- Imagens e PDFs escaneados nunca terão evidência verificada por código.
- Tolerância zero gera mais divergências; a narrativa e o template devem deixar claro que divergência é um ponto de atenção, não uma conclusão.
- Agentes com ferramentas ficam para casos de uso futuros (ex.: assistente interno, §17.5), avaliados pelo checklist do §18.
