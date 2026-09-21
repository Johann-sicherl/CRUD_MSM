# Contexto de negócio — Inteligência do Produto

Este documento existe pra um propósito específico: explicar **o que cada
tabela/coluna do domínio significa e por que existe**, no contexto de
negócio (VMI Security / "Monte Sua Máquina") — a base pra entender por que
as 14 regras de `productIntelligence.ts` checam o que checam. Não é
validação de schema (`specs/dados-e-schema.md`) nem estatística de dado
real, é o raciocínio de negócio por trás.

**Histórico**: escrito originalmente como grounding pra uma "Camada B"
(janela de pergunta em texto livre sobre o motor de regras) — essa camada
foi implementada e depois **removida a pedido explícito do usuário**
(esforço de manter o parser heurístico não valia o retorno — ver
`specs/telas-auxiliares.md`, seção "Camada B ... tentada e removida"). O
conteúdo deste documento (seções 1–4, o raciocínio de negócio em si)
continua válido e útil independente disso — só as seções 5/6 (que falavam
especificamente da Camada B) foram atualizadas.

## 1. O domínio, em uma frase

Protheus é a fonte oficial de produto e estrutura (o que existe fisicamente
e como se monta); as 9 tabelas de engenharia do MSM são a camada de
**regras comerciais** por cima disso — o que pode ser vendido com o quê,
o que é incompatível, o que entra junto automaticamente. O MSM nunca
inventa produto — ele decide *combinação de venda* em cima do que o
Protheus já sabe que existe.

## 2. As duas fontes Protheus

### `CADASTRO_PROTHEUS` — o mestre de produto (um por código)
Responde "este código existe, e em que estado". Cada linha é um item
cadastrado no ERP, com seu status (`STD_BLOQ`: `ATIVO`/`BLOQUEADO`),
categoria (`TIPO`: `MP` matéria-prima, `PI` produto intermediário, `SV`
serviço, etc.), descrição, e revisão (`COD_SEM_REV` agrupa todas as
revisões do mesmo item físico — é o que permite perguntar "existe uma
revisão mais nova deste código?").

### `ESTRUTURAS_PROTHEUS` — a árvore de montagem (BOM)
Responde "o que compõe o quê" — uma linha por vínculo pai→filho. `ESTRUTURA`
é o item de cima, `COMPONENTE` o item de baixo, `QUANT` quantas unidades do
filho por unidade do pai. `FANTASMA='S'` marca um nível que é só
agrupamento (não uma peça física de verdade — não conta duas vezes no
custo). `REV_INI`/`REV_FIM` dizem em que revisão do pai esse vínculo
específico passou a valer e até quando (`ZZZ` = ainda vale, sem fim
definido).

**Importante sobre a hierarquia 26.xx → 27.13 → nível 3**: um código `26.xx`
representa um **pedido/pacote completo** (não um equipamento único) — seus
filhos diretos (nível 2) são categorias como SubPA (`27.13`), Embalagens,
Gastos Gerais; os filhos DESSAS (nível 3, sob o ramo `27.13`) são os itens
de verdade que saem juntos naquele pedido — equipamento(s) + acessórios.
É por isso que co-ocorrência de dois códigos dentro dessa árvore é sinal
forte de "sempre são vendidos juntos" (base da regra R080).

### A moeda comum entre os dois mundos
`protheus_code` (nas tabelas de engenharia) é sempre o mesmo valor que
`COD_PRODUTO`/`ESTRUTURA`/`COMPONENTE` do lado Protheus, comparado sempre
`.trim().toUpperCase()`. É o único elo — não existe id interno comum entre
os dois sistemas.

## 3. As 9 tabelas de engenharia — papel de cada uma

### `equipments` — o modelo de máquina que existe pra ser vendido
Tudo mais no sistema (BOM, opcionais, incompatibilidades, dependências) só
existe porque está pendurado num equipamento daqui.
- `legacy_id` — o elo que todo o resto do sistema usa pra dizer "isto
  pertence a este equipamento".
- `name` — como a engenharia chama o equipamento; `commercial_name` — como
  o comercial/cliente chama.
- Os 9 campos financeiros (`ipi_tax_rate` … `parts_provision_rate`) — a
  fórmula de precificação do equipamento inteiro, campo a campo (imposto,
  margem, comissão em 3 níveis, custo de certificação, mão de obra,
  garantia, provisão de peças) — nunca o valor real fica no banco visível
  (ver seção 6 e `specs/custeio-financeiro.md`).
- `target_cost_pending` — não é dado do produto, é estado de fluxo:
  "a engenharia comercial ainda precisa revisar o custeio disso".

### `accessory_groups` — a categoria funcional de um componente
Responde "que TIPO de peça é essa" antes de "qual peça exatamente" — é o
que permite aplicar regra por categoria (ex.: "todo item do grupo
Monitores precisa de tamanho") em vez de regra por componente individual.

### `general_alerts` — um aviso reusável
Catálogo único de avisos, referenciado por ID em vez de texto repetido —
garante que o mesmo aviso apareça igual em qualquer lugar do sistema.

### `standard_equipment_items` — a ficha técnica de uma variante vendável
Um `equipments` é o conceito; esta tabela é a variante concreta amarrada a
um código Protheus real — o mesmo modelo pode existir com processador,
memória, idioma diferentes, cada combinação um código distinto.
- `protheus_code` — o que de fato entra numa proposta/pedido.
- `processor`, `memory`, `storage`, `graphics_card`, `tube_power_kv`,
  `certificate`, `conveyor_belt_type`, `conveyor_belt_load_capacity_kg`,
  `motopolia_type`, `language`, `color` — a especificação técnica que
  diferencia uma variante da outra ("Itens de Série") — e é exatamente
  isso que a estrutura Protheus real deveria confirmar, código a código
  (via `Parâmetros de Estrutura` — ver R090).
- `status` — se essa variante específica ainda pode ser vendida hoje.

### `accessories` — tudo que pode ser adicionado a um equipamento
O catálogo de peças/opcionais possíveis, sem estar amarrado a nenhum
equipamento ainda — responde "o que existe pra vender", não "o que vai
nesse equipamento aqui" (isso é `relationship_equip_accessory`).
- `color`/`predominant_material`/`dimensional_mm` — só fazem sentido pra
  peças de montagem física (mesas, extensões) — atributo condicional ao
  tipo de peça, não universal.
- `monitor_size` — só existe porque monitor é vendido por polegada.
- `quantity_monitor_totem` — modela uma limitação física de montagem
  (quantos monitores cabem naquele totem).

### `relationship_equip_accessory` — o cardápio de opcionais de CADA equipamento
Onde "o que existe" (accessories) vira "o que pode ser vendido com ESTE
equipamento específico" — o cardápio que aparece ao montar uma proposta.
- `operation_time` — só existe pra opcional cujo dimensionamento depende de
  tempo de operação (ex.: bateria/no-break — quanto tempo de autonomia).
- `maximum_quantity` — limite físico/funcional de quantas unidades fazem
  sentido nesse equipamento (`10000` na prática = "sem limite", não uma
  quantidade real).
- `status` — pode estar descontinuado só PARA ESTE equipamento, mesmo que
  o componente em si continue ativo em `accessories`.

### `non_combinable_comps` — o que não pode ir junto
Restrição física/funcional real: dois opcionais que não cabem juntos ou são
mutuamente exclusivos por design. Sem isso, a configuração deixaria montar
uma máquina impossível de fabricar. A mesma dupla pode ser incompatível num
equipamento e compatível em outro (depende do espaço físico disponível
naquele modelo específico).

### `dependant_items` — o que entra sozinho quando você escolhe outra coisa
Consequência automática: escolher um item obriga a levar outro junto (o
cliente/vendedor nem escolhe — o sistema adiciona sozinho). `protheus_code`
é o gatilho (pode ser o próprio equipamento ou um acessório escolhido),
`protheus_item_code` o que entra automaticamente, `quantity`/
`proportional_factor` escalam a quantidade do dependente.

### `roller_tables` — a composição física de uma mesa de roletes
Uma mesa de roletes é montada em posições (`type`: `start`/`middle`/`end`,
ou `unique` quando não precisa dividir) — modela literalmente a montagem
peça por peça; uma mesa só está completa se tiver as 4 posições certas (ou
ser `unique`).

## 4. Como os dois mundos se conectam — resumo prático

| Pergunta de negócio | Onde procurar |
|---|---|
| Este código ainda pode ser vendido? | `CADASTRO_PROTHEUS.STD_BLOQ` |
| Este código tem revisão mais nova? | `CADASTRO_PROTHEUS.COD_SEM_REV` (agrupa família) |
| O que compõe fisicamente este item? | `ESTRUTURAS_PROTHEUS` (recursivo, via `fetchStructureCodes`) |
| Este equipamento oferece este acessório? | `relationship_equip_accessory` |
| Estes dois itens podem ir juntos? | ausência de linha em `non_combinable_comps` |
| Escolher X obriga a levar Y? | `dependant_items` |
| A especificação técnica bate com a estrutura real? | comparar `standard_equipment_items` × `ESTRUTURAS_PROTHEUS` via `Parâmetros de Estrutura` (R090) |
| Dois itens sempre saem juntos, mas não é regra formal? | co-ocorrência na hierarquia `26.xx`/`27.13` (R080) |

## 5. O motor de regras

14 regras determinísticas/estatísticas implementadas
(`src/lib/productIntelligence.ts`), agrupadas por categoria: integridade
(R001, R002, R003, R070), estado (R010, R011, R012), duplicidade (R020,
R021), dependência (R030, R031, R081), incompatibilidade (R040, R041),
completude (R050, R051, R052), analogia (R060, R080), itens-de-série
(R090). Detalhe de cada uma em `specs/telas-auxiliares.md`. Rodam via a
tela "Análise completa" de `/inteligencia-produto` — uma varredura única
contra as 9 tabelas + cadastro/estrutura Protheus ao vivo, sem interface de
pergunta nenhuma (essa parte foi removida, ver histórico no topo do
documento).

## 6. Custo real nunca aparece num achado

Os 11 campos financeiros (`FORCE_TO_ONE_FIELDS`) nunca saem do sentinela
(`0`/`1`) em nenhum achado gerado pelo motor de regras — o valor real mora
só em `local-data/`, fora do Git. Nenhuma regra lê nem expõe esse valor.
