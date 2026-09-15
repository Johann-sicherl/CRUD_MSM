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

## Acessórios ignorados — `ignoredAccessories.ts`

A busca recursiva 26.xx/27.13 de Busc. Avanç. Acessórios Protheus está
correta e sempre traz **todos** os itens da estrutura — mas nem todo
componente que aparece ali é algo que o usuário vai usar de verdade,
mesmo sabendo disso com certeza. Pedido explícito do usuário: um jeito de
marcar um componente como "nunca vou usar" e ele parar de poluir a
listagem.

- `src/lib/ignoredAccessories.ts` / `src/data/ignored-accessories.json` —
  mesmo padrão JSON-file-backed de `structurePropertyRules.ts`/
  `equipmentClassificationRules.ts`: lista de `{ codigo, denominacao }`
  (só esses dois campos, nunca outro dado do item). `GET`/`PUT`
  (`/api/ignored-accessories`) substituem a lista inteira, mesma
  convenção de `/api/structure-property-rules` — dedup por código
  normalizado (`.trim().toUpperCase()`) feito na própria rota.
- **Adicionar** — só em Busc. Avanç. Acessórios Protheus: um checkbox
  "Ignorar" por linha (tabela da Lista de acessórios e nas duas linhas da
  Visão em cascata, nível 2 e nível 3) grava o item e ele **some da
  listagem a partir daí** — busca atual e buscas futuras, tanto em
  `flatItems` (Lista de acessórios) quanto em `cascadeHeaders` (Visão em
  cascata, filtrado antes de montar os nós de nível 2/3). Sempre
  desmarcado ao renderizar — uma vez marcado, a linha deixa de existir
  nesta tela, então não há "estado marcado" pra mostrar.
- **Ver/remover** — só em Parâm. Itens de Série e Acessórios (renomeada
  de "Param. Itens de Série" — pedido explícito do usuário, terceira
  coluna da tela, ao lado de Parâmetros de Estrutura e Classificação de
  Equipamentos): lista só-leitura + remoção (botão ✕). Remover daqui não
  apaga nada em Protheus/MSM, só tira o código da lista — ele volta a
  aparecer normalmente em Busc. Avanç. Acessórios Protheus na próxima
  busca. Sem formulário de adicionar nesta coluna, de propósito — a
  adição é sempre a partir da linha do componente na tela de busca, nunca
  digitando um código à mão aqui.
- **"Consulta completa" / "Só o que falta no meu banco"** — mesmo
  chaveamento de Busc. Itens Série Estrut. Protheus
  (`showOnlyMissingFromInternal`), pedido explícito do usuário. Filtra
  por `!item.registered` (não cadastrado nem em `accessories` nem em
  `standard_equipment_items`) — aplicado tanto em `filteredFlatItems`
  (Lista de acessórios) quanto em `cascadeHeaders` (Visão em cascata, que
  também esconde o cabeçalho 26.xx que ficar sem nenhum nível 2 depois do
  filtro). Reseta a cada nova busca, junto com Equipamento/Categoria/
  Filtro avançado.

**Bug real já corrigido: marcar vários acessórios em sequência rápida
perdia todos menos o último — condição de corrida no estado do React, não
falha da API.** Relatado pelo usuário: "cliquei em alguns, sumiram da
lista, mas quando olhei em Acessórios Ignorados eles não estavam lá".
Testado o round-trip da API isoladamente (`curl` direto em
`/api/ignored-accessories`) — GET/PUT funcionam perfeitamente, then a
causa era client-side: `markIgnored` montava a "próxima lista" a partir de
`ignoredList` (estado do React, só reflete o valor novo no próximo
render) — clicar em vários checkboxes antes de qualquer re-render
acontecer entre um clique e outro fazia cada chamada montar o array em
cima do MESMO snapshot antigo, e só a última chamada "vencia" de verdade
(as outras eram sobrescritas). Sintoma batia exato: item some da tela
(o filtro usa o estado mais recente, então some mesmo) mas nunca chega a
ir pro arquivo (só a última chamada grava, com uma lista que não inclui
os cliques anteriores). Corrigido com `ignoredListRef` (`useRef`, mantido
sincronizado no mesmo instante de cada clique, sem esperar o próximo
render) — cada chamada de `markIgnored`/`removeIgnored` agora acumula em
cima do valor real mais recente. Mesmo fix aplicado nos dois lados
(`busca-avancada-acessorios/page.tsx` e `parametros-estrutura/page.tsx`,
que tem o mesmo padrão em `removeIgnored`).

## Análise de Estruturas / Busca Avançada de Acessórios (grupo "Consulta Banco de Dados")

`/analisador-estruturas` e `/busca-avancada-acessorios` são telas de
consulta ao banco Protheus (via `mssql`, mesma base de `pdmDb.ts` — ver
`specs/pdm-protheus-integracao.md`) para localizar itens de série/estruturas
e acessórios diretamente na base oficial, fora do Supabase.

### Inteligência do Produto (`/inteligencia-produto`)

Motor de regras que confronta as 9 tabelas de engenharia (`accessories`,
`accessory_groups`, `dependant_items`, `equipments`, `general_alerts`,
`non_combinable_comps`, `relationship_equip_accessory`, `roller_tables`,
`standard_equipment_items`) contra o cadastro e a estrutura ao vivo do
Protheus, buscando inconsistências que a validação normal de escrita do app
não cobre — porque nunca olha o Protheus (`validateExistsIn` só valida
contra outras tabelas do próprio Supabase), ou porque o dado entrou via
Atualizador Global (substituição total, apaga+recria sem validar campo
nenhum).

**Origem**: porte de um script Python (`validador_engenharia.py`) fornecido
pelo usuário, com pedido explícito de validar as regras contra o schema
real antes de portar. Três correções feitas nessa validação (ver
`src/lib/productIntelligence.ts`, comentário no topo do arquivo):
1. **R020 (duplicata de oferta)** — o script original tratava
   `(equipamento, código, operation_time)` como chave de negócio de
   `relationship_equip_accessory`. Errado: a chave real
   (`getAuditKeyFields`/`sqlAudit.ts`, os campos `noBulkEdit`) é só
   `(legacy_equipment_id, protheus_code)` — `operation_time` não faz parte
   dela. Corrigido antes de portar; do jeito original, duas linhas pro
   mesmo equipamento+código com `operation_time` diferente passariam
   batido, mesmo sendo uma violação real da chave.
2. **R002/parte de R003 (FK de equipamento/grupo)** — já são garantidas por
   `FOREIGN KEY` de verdade no Postgres (`msm_foreign_keys.sql`) — uma
   linha órfã não consegue existir na tabela ao vivo hoje, então essas
   regras nunca vão achar nada rodando contra o Supabase de produção.
   Mantidas mesmo assim (defesa em profundidade / reuso futuro contra uma
   fonte sem essa constraint), com a ressalva documentada no código. Só a
   metade de R003 que checa `legacy_second_group_id` de
   `non_combinable_comps` é de fato nova (essa coluna não tem FK nenhuma).
3. **R070 (alerta órfão) é regra nova**, não existia no script original —
   `legacy_general_alert_id` não tem FK nenhuma pra `general_alerts`
   (conferido em `msm_foreign_keys.sql`) e o Atualizador Global não valida
   esse campo.

**Decisões de escopo**, tomadas explicitamente antes de implementar:
- **Sem LLM real** — a "Camada 3" (parecer em linguagem natural) do script
  original é só um resumo narrativo montado pelo próprio motor de regras
  (`buildNarrativeSummary`, `inteligencia-produto/page.tsx`), nunca uma
  chamada de API a um LLM de verdade. Sem chave nova, sem custo por
  execução.
- **Camada 1 (determinística) + Camada 2 (analogia, R060) juntas** desde a
  primeira versão — não ficou faseado.
- **Só produção** — roda contra as 9 tabelas reais do Supabase + Protheus ao
  vivo, não contra as tabelas `_check` do Double-check de Queries (que
  resolvem um problema diferente: simular SQL antes de rodar, não auditar
  consistência de cadastro).

**Reuso de infraestrutura existente** — nenhuma query nova contra o
Protheus foi escrita: `listProductInfo` (`protheusDb.ts`, extensão de
`listProductStatuses` pra também expor `codSemRev`/`revisao`, que a query
de `loadProductInfoCache` já buscava mas não expunha) e `fetchStructureCodes`
(reuso direto, já cacheado) cobrem tudo que o motor precisa. O script
Python original chutava nomes de coluna errados pra tabela de estrutura
(`SG1010`/`G1_COD`/`G1_COMP`) — o ambiente real usa uma view/tabela
materializada `ESTRUTURAS` com colunas completamente diferentes, já
resolvida e cacheada em `protheusDb.ts`.

**Permissão**: mesmo padrão de `analisador-estruturas`/
`busca-avancada-acessorios` — entrada normal em `MODULES` (grupo "Consulta
Banco de Dados"), controlada por `visibleModules` do perfil, sem checagem
de `profileId` na rota (`/api/product-intelligence`): a própria credencial
Protheus, fornecida por requisição e nunca persistida, já é o controle de
acesso pro lado externo — mesmo padrão de `protheus-estrutura/route.ts`.

#### R080/R081/R090 — regras a partir da estrutura Protheus ao vivo

Pedido explícito do usuário, adicionadas depois da primeira versão (não
existiam no script Python original) — diferente das 11 regras anteriores,
estas mineram/comparam contra a estrutura Protheus **ao vivo**, não só o
cadastro interno entre si:

- **R080 (analogia)** — co-ocorrência de itens dentro da hierarquia
  26.xx → 27.13 → nível 3 (mesma consulta de Busc. Avanç. Acessórios
  Protheus, `listAccessoryHierarchy`, prefixos padrão `['26']`/`['27.13']`)
  — quando dois códigos aparecem juntos em quase toda estrutura onde
  qualquer um dos dois aparece (`MIN_COOCCURRENCE_CONFIDENCE = 0.9`, nos
  dois sentidos, com piso de amostra `MIN_COOCCURRENCE_SUPPORT = 3` pra não
  disparar em cima de 1-2 ocorrências) e ainda não estão registrados como
  par em `dependant_items`, vira uma pergunta ("candidato real a item
  dependente, ou coincidência de pedidos?"). Estatística, não
  determinística — por isso severidade sempre `pergunta`, nunca acusação.
- **R081 (dependência)** — pra cada variante de equipamento
  (`standard_equipment_items.protheus_code`), compara os códigos de
  embalagem (`PACKAGING_PREFIXES = ['27.11']`, convenção já vista nesta
  base — `accessory_groups` legacy_id 22 = "EMBALAGEM") vistos na estrutura
  Protheus ao vivo (reusa `bomByVariantCode`, já calculado, zero query
  extra) contra o que está cadastrado em `dependant_items` pra aquele
  `legacy_equipment_id`. Diverge (falta ou sobra) → achado `alto`, com
  sugestão de cadastrar ou remover explícita.
- **R090 (itens-de-série)** — reaproveita o motor de comparação de Busc.
  Itens Série Estrut. Protheus (`computeStructurePropertyResults`, extraído
  pra `src/lib/structurePropertyMatch.ts` e reusado também por
  `/api/analisador-estruturas/route.ts`, que antes tinha essa lógica
  duplicada inline) em vez de reinventar uma comparação de texto livre da
  descrição Protheus — casar por código via Parâmetros de Estrutura é mais
  confiável que casar por palavra dentro de B1_DESC (escrita por humano,
  não estruturada). Só os status `mismatch`/`duplicate` viram achado — o
  status `missing` é omitido de propósito: numa varredura em lote do
  catálogo inteiro, "missing" é o normal pra qualquer propriedade que não
  se aplica àquele tipo de equipamento (ex.: propriedade de correia num
  equipamento sem correia), geraria ruído enorme; a ferramenta interativa
  (um equipamento por vez, com contexto) é onde "missing" faz sentido
  revisar caso a caso.

### Camada B (`/inteligencia-produto`, aba "Pergunte à IA") — tentada e removida

**Histórico**: depois da primeira versão da Inteligência do Produto (14
regras + varredura completa, acima), o usuário pediu uma segunda camada —
uma janela de pergunta em texto livre que decidisse sozinha quais regras
rodar. Implementada em algumas rodadas (parser heurístico de palavra-chave/
regex em português, depois um filtro estruturado com `<select>` de
equipamento/grupo/código + checkboxes de regra pra eliminar a ambiguidade
do texto livre), sempre com a mesma decisão de escopo do usuário: **nenhuma
conexão com LLM/IA externa, nunca** — a "IA" seria só tradução de pergunta
pro motor de regras determinístico já existente, nunca uma rede neural.

Ao longo do teste real dessa camada, o parser heurístico de texto livre
mostrou-se repetidamente frágil — três bugs reais encontrados e corrigidos
em sequência (extração errada de `legacy_id` a partir de "EQUIPAMENTO 6040
SV ID 12", achado de R080 sem campo de equipamento na própria chave,
vocabulário de palavra-chave estreito demais para variações de frase) — e
mesmo depois do filtro estruturado (que eliminava a ambiguidade), o
usuário concluiu que o esforço de manter/testar essa camada não valia o
retorno: **pedido explícito do usuário para desistir da ideia** ("achei que
entregando as minhas bases de dados você já iria construir uma rede
neural... está muito trabalhoso fazer essa IA"). Removida por completo —
`src/lib/productIntelligenceNlu.ts` e `/api/product-intelligence/ask`
foram deletados; `productIntelligenceContext.ts` (extração do retrato de
contexto, 9 tabelas + Protheus ao vivo) foi mantido porque a rota original
(`/api/product-intelligence`, a varredura completa) continua usando.

**O que sobrou e continua valendo**: o motor de 14 regras determinístico
(`productIntelligence.ts`) e a tela "Análise completa" (varredura única,
sem pergunta nenhuma) — essa parte sempre funcionou sem ambiguidade e não
foi questionada. `R080` manteve o campo `chave.equipamentosRelacionados`
(mapeamento código → equipamento via `relationship_equip_accessory`/
`standard_equipment_items`) — deixou de ser infraestrutura de filtro da
Camada B e virou só contexto útil mostrado no card do achado.

Se a ideia de pergunta livre for retomada no futuro, a decisão de "sem LLM
real" pode ser revisitada — mas isso exige pedido explícito novo do
usuário, não uma retomada silenciosa do que foi removido aqui.

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
