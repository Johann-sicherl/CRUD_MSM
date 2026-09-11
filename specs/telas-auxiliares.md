# Telas auxiliares (grupo "Sistema" / "Consulta Banco de Dados")

Todas as regras abaixo são JSON-file-backed (arquivo local, não tabela do
Supabase) — mais simples de propósito, porque são configurações operacionais
de um único usuário/máquina, não dados de negócio compartilhados.

## Classificação de equipamentos — `equipmentClassification.ts` / `equipmentClassificationRules.ts`

- `classifyEquipmentType(...)` aplica uma lista ordenada de regras
  (`EquipmentClassificationRule[]`) e usa semântica **"a última regra que
  bate, vence"** (last match wins) — não para na primeira regra que casa.
  Isso foi portado deliberadamente da VBA legada que o app substitui; uma
  reescrita para "primeira regra vence" mudaria resultados de classificação
  já validados pelo usuário.
- `readEquipmentClassificationRules`/`writeEquipmentClassificationRules`
  persistem as regras num arquivo JSON local, não no banco.

## `structurePropertyRules.ts`

Regras de inferência de propriedade de estrutura (`StructurePropertyRule[]`),
mesmo padrão JSON-file-backed (`readStructurePropertyRules`/
`writeStructurePropertyRules`).

## Depurador Solic. Comercial — `solicComercialParser.ts`

`parseSolicComercial(raw)` é um **parser heurístico de texto livre**, não um
parser de verdade (não há gramática formal nem schema do formato de origem)
— extrai `ParsedItem[]` e blocos de texto não reconhecido (`FreeTextBlock[]`)
a partir de heurísticas sobre o texto colado na tela. Isso é intencional e já
documentado como tal no próprio código: **não tratar falhas de parsing como
bug a corrigir caso a caso** — é esperado que texto fora do padrão usual caia
em `FreeTextBlock` para revisão manual, não que o parser reconheça 100% dos
formatos possíveis.

## Explorador de Relações (`/explorador-relacoes`)

"Janela de Pesquisa Avançada" — navega relações entre tabelas via foreign
keys (`msm_foreign_keys.sql`) a partir de um registro. Rotas
`relations/[code]` usam `.limit(25000)` explícito para não cair no cap
padrão de 1000 linhas do PostgREST.

## Clonagem Estrutural Avançada (`/clonagem-estrutural-avancada`)

Clona uma estrutura completa (equipamento + itens padrão + acessórios
associados) para um novo código, via rota `clone-architecture` — mesma
observação sobre `.limit(25000)`/`range()` para evitar o cap do PostgREST em
buscas grandes.

## Análise de Estruturas / Busca Avançada de Acessórios (grupo "Consulta Banco de Dados")

`/analisador-estruturas` e `/busca-avancada-acessorios` são telas de
consulta ao banco Protheus (via `mssql`, mesma base de `pdmDb.ts` — ver
`specs/pdm-protheus-integracao.md`) para localizar itens de série/estruturas
e acessórios diretamente na base oficial, fora do Supabase.

### Busc. Itens Série Estrut. Protheus — aviso de "varredura concluída"

Os três pontos de entrada em lote (`handlePickGroup` — grupo inteiro,
`handlePickAll` — "Analisar TODOS", Busca Reversa por prefixo) rodam
`runDbStructureAnalysis` **sequencialmente**, um round-trip ao Protheus por
código — pode levar bastante tempo numa lista grande, sem nenhum jeito de
saber, só olhando a tela, se a varredura já terminou. Pedido explícito do
usuário: "preciso de pelo menos um pop-up, ou aviso dizendo que a Varredura
foi concluída com sucesso... não tenho a visibilidade se está completo ou
não".

Implementado com `runBulkScan` (`analisador-estruturas/page.tsx`) — wrapper
comum aos três pontos de entrada, que roda o loop sequencial e mostra um
toast no final ("Varredura concluída: N equipamento(s) analisado(s), M com
erro"), mesmo padrão visual de toast já usado em `auditoria/page.tsx`
(`fixed bottom-6 right-6`, 5s). `runDbStructureAnalysis` foi alterado pra
devolver `'done' | 'error'` (nunca lança exceção — já capturava tudo
internamente) só pra `runBulkScan` conseguir contar sucesso/erro no aviso
final. Busca de um único código (`handlePickCode`) não tem toast — o pedido
foi especificamente sobre a varredura em lote, onde a demora e a falta de
feedback realmente incomodam.
