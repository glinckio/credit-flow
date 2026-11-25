# ADR-0008 — Parecer, indicadores descritivos e decisão humana

- **Status:** Aceito
- **Data:** 25/11/2026
- **Detalha:** seções 4.5 do roadmap e 3.4 do plano

## Decisão

1. **Indicadores apenas descritivos** em `@creditflow/shared/indicators.ts`, calculados com os valores **declarados**, em centavos inteiros (exatos para `NUMERIC(14,2)`):

   | Indicador                       | Fórmula                                                         |
   | ------------------------------- | --------------------------------------------------------------- |
   | Parcela simples estimada        | valor solicitado ÷ prazo (sem juros)                            |
   | Parcela ÷ renda                 | parcela simples ÷ renda/faturamento mensal declarado            |
   | Comprometimento total declarado | (compromissos declarados + parcela simples) ÷ renda/faturamento |
   | Valor em meses de renda         | valor solicitado ÷ renda/faturamento                            |

   Renda zero → `null` (sem divisão por zero). Cada indicador traz a fórmula em texto e a resposta inclui aviso fixo: não é política de crédito e não determina aprovação ou reprovação. **Sem score, faixas, cores ou recomendação automática.**

2. **Parecer append-only**: editar = registrar novo parecer; o mais recente é o vigente (`current`). Só o analista responsável registra, e só durante a análise.

3. **Decisão humana final** (`POST /applications/:id/decision`), pelo mesmo pipeline de transição da ADR-0006:
   - permissão `application.decide` (analista; operador só com `canDecide`; admin nunca);
   - status `UNDER_REVIEW`; parecer vigente obrigatório (a decisão o referencia);
   - aprovar exige zero pendências abertas; reprovar é permitido com pendências;
   - justificativa obrigatória (mín. 20 caracteres), gravada na decisão, no histórico de status e na auditoria;
   - a decisão pode divergir da recomendação do parecer — a justificativa registra o porquê;
   - uma única decisão por solicitação (update condicional + `UNIQUE`), testado com duas decisões simultâneas;
   - após decidir, a solicitação fica congelada (sem parecer, pendência, documento ou cancelamento).

4. **Quem decide não precisa ser o responsável pela análise** (decisão 6.1 do plano: operador com `canDecide` pode decidir). "Quatro olhos" (decisor ≠ autor do parecer) continua fora do MVP, mas é uma regra de uma linha no `precheck` se for exigida.

## Não adotado

- Exigir todos os documentos `ACCEPTED` para aprovar: não pedido no roadmap; fica como regra candidata.
- Indicador sintético ou score ilustrativo: vedado pelo roadmap ("aparência de precisão científica").
