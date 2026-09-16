# Telas auxiliares (grupo "Sistema" / "Consulta Banco de Dados")

Todas as regras abaixo são JSON-file-backed (arquivo local, não tabela do
Supabase) — mais simples de propósito, porque são configurações operacionais
de um único usuário/máquina, não dados de negócio compartilhados.

## Calculadora de Autonomia de Nobreak — `upsAutonomyCalc.ts`

Tela `/calculadora-autonomia-nobreak` (grupo "Sistema", logo abaixo de
"Depurador Solic. Comercial"). Pedido explícito do usuário: portar pro app
uma calculadora de autonomia de nobreak (UPS) a partir de uma planilha de
dimensionamento (`Dimensionamento_UPS_VMI_Rev_12.xlsm`) feita por um
engenheiro da VMI, enviada como exemplo. A planilha inteira foi analisada
(abas `Cálculos`, `Temperatura`, `Baterias`, `UPS`, `Bat. Externa`,
`Escâneres`, `Parametros Carga Equipamento`) e portada por completo —
motor de cálculo + os 3 catálogos de referência + o BOM de potência por
equipamento —, decisão confirmada explicitamente com o usuário antes de
implementar (as alternativas descartadas: só o motor sem catálogo, ou sem
o preenchimento automático por modelo de equipamento).

### Motor de cálculo — fiel à planilha, validado numericamente

`src/lib/upsAutonomyCalc.ts` reimplementa a cadeia de fórmulas da aba
`Cálculos` sem simplificar a física do modelo original:

- **Potência ativa por segmento de carga** (`P = S·FP`) — a planilha
  suporta até 5 segmentos (colunas C:G), mas só 2 têm dado real em
  qualquer exemplo/uso real da planilha (Ativo/Stand By, vindos de
  "Parametros Carga Equipamento") — portado como exatamente 2 segmentos
  (`Ativo`/`Stand By`), não 5 genéricos, pra não construir UI pra um caso
  que não existe nos dados de origem.
- **Potência ativa máxima/média ponderada pelo tempo** de cada segmento —
  usada tanto pra dimensionar o UPS mínimo quanto pra estimar consumo
  médio da bateria.
- **Curva de derating por temperatura**: `y = a·ln(b·x + c) + d·x + e`,
  ajustada uma única vez a partir de um datasheet de fabricante
  (`Temperatura!F17:F21` na planilha original, fonte citada:
  upsbatterycenter.com) — os 5 coeficientes são fixos, não um input do
  usuário (`TEMPERATURE_CURVE` em `ups-autonomy-catalog.json`).
- **Curva de energia por bateria**: `E(P) = a·(e^(-P/b) + e^(-P/c) +
  e^(-P/d)) + e/P`, uma curva DIFERENTE por capacidade de bateria (Ah),
  ajustada a partir da tabela de descarga do fabricante daquele modelo
  específico — 8 grupos de capacidade (7.2, 9, 17, 34, 40, 45, 58, 65 Ah),
  cada um com seus próprios 5 coeficientes (`BATTERY_GROUPS`).
- **Distribuição de potência entre banco interno e externo**: a potência
  média consumida da bateria (`Pmb`) é repartida proporcionalmente à
  capacidade total ponderada (série × linhas × Ah) de cada banco — replica
  `Baterias!M26`/`M31` exatamente.
- **Autonomia final** = `(energia total / Pmb) × (1 − FS Autonomia) ×
  fator de derating(temperatura ambiente)`. Na planilha original esse
  resultado ainda é dividido por 24 só porque a célula usa formatação de
  hora do Excel (serial de fração de dia) — o port não precisa dessa
  divisão, calcula horas diretamente e formata com `formatHoursAsHM`.
- **Validado numericamente** contra o exemplo real gravado na planilha
  (Bodyscan DV, UPS "Prime Online 3000 FP 0,9 96V 9Ah", banco interno 8
  série × 1 linha × 9 Ah, sem banco externo, FP UPS 0,9, rendimento
  bateria 0,95, FS Potência 0,4, FS Autonomia 0,2, 15°C) — toda variável
  intermediária (Pmax, Pm, Pmb, potência mínima do UPS, potência por
  bateria, energia por bateria, energia total) bateu exatamente com o
  valor em cache da planilha, e o resultado final bateu com a autonomia
  gravada (1h 22min) — script de validação rodado fora do repo (scratch),
  não faz parte do código do app.

### "Vf célula" da planilha original não foi portado — campo não usado na fórmula viva

A planilha tinha um campo "Vf célula" (tensão final de corte da bateria,
ex. 1,7 V) na seção de parâmetros do UPS — mas, conferido formula por
fórmula, esse valor **não é referenciado em nenhum lugar da cadeia de
cálculo viva** (`Cálculos!M15` e tudo que ele depende). Ele só aparecia
noutra parte da aba `Baterias`, usada apenas pra VALIDAR o ajuste da curva
de energia contra a tabela de descarga bruta do fabricante (calcular o
erro do fit) — não pra calcular a autonomia de verdade. Confirmado esse
comportamento antes de portar; o campo foi deliberadamente **omitido** da
calculadora (não é um parâmetro real do modelo, é vestígio de
documentação/validação da curva).

### Catálogos portados — dados extraídos programaticamente da planilha, não digitados à mão

- `src/data/ups-autonomy-catalog.json` — `ups` (46 modelos, todos os
  campos da tabela "UPS" da planilha: marca, modelo, tecnologia, VA, FP, W,
  tensão de bateria, capacidade do banco, expansão de bateria etc.),
  `batteryGroups` (os 8 grupos de capacidade com curva de energia),
  `temperatureCurve` (coeficientes fixos), `batteryExternal` (34 módulos
  de bateria externa pré-configurados: marca, produto, tensão, nº de
  baterias em série, nº de linhas, capacidade por bateria, energia total).
- `src/data/ups-autonomy-equipment.json` — `equipmentNames` (15 modelos de
  equipamento VMI: scanners de bagagem/carga, portal), `equipmentBom`
  (lista de ~44 componentes com potência unitária em VA e a quantidade de
  cada um por modelo de equipamento — replica a aba "Escâneres"),
  `equipmentLoadParams` (tempo/FP/FS potência de cada equipamento nos
  ciclos Ativo/Stand By — replica "Parametros Carga Equipamento").
- Extração feita com um script Python fora do repo (openpyxl, lendo a
  planilha original com `data_only=True` pra pegar os valores já
  calculados pelo Excel) — a planilha original **não** foi commitada no
  Git (é um arquivo proprietário de engenharia, enviado só como anexo da
  conversa), só os dados já extraídos e limpos.

### Potência do equipamento é recalculada a partir do BOM, não copiada literalmente da planilha

Achado durante a extração: `Cálculos!C9`/`D9` (Potência aparente
Ativo/Stand By pro exemplo "Bodyscan DV" gravado na planilha) são valores
**fixos digitados** (732/255 VA) — não uma fórmula ligada à aba
"Escâneres". Recalculando o BOM da própria aba "Escâneres" pra "Bodyscan
DV" (∑ potência unitária × quantidade de cada componente, coluna "W" da
matriz) dá um resultado bem diferente (~1003/280 VA) do valor gravado —
ou seja, o vínculo entre "selecionar o equipamento" e "preencher a
potência" na planilha original depende de uma macro VBA (não inspecionada
aqui) que não foi executada de novo depois da última edição do BOM, então
o exemplo ficou "dessincronizado" do BOM atual. Decisão pro port: em vez
de tentar reproduzir o comportamento exato (e possivelmente desatualizado)
da macro, `equipmentApparentPowerVA()` sempre recalcula a partir do BOM
atual (`equipmentBom`) — é o cálculo estruturalmente correto e
determinístico, mesmo que não bata com o número específico que ficou
gravado nesse exemplo em particular. Como em toda tela do app, o campo
continua editável depois do preenchimento automático.

### UPS com bateria de capacidade sem curva própria — aproximação pela mais próxima

Nem todo UPS do catálogo usa uma das 8 capacidades com curva ajustada — 3
modelos usam 5 ou 7 Ah (a curva mais próxima é a de 7,2 Ah). `nearestBatteryGroup()`
escolhe a curva de capacidade mais próxima nesses casos, e a tela mostra um
aviso explícito ("usando a curva de X Ah como aproximação") — nunca falha
silenciosamente nem trava o cálculo.

### Os 4 catálogos viraram editáveis pela própria tela (aba "Catálogos")

Pedido explícito do usuário, rodada seguinte: "como que eu vou mudar
alguma coisa nas tabelas ou banco de dados que foi criado? Adicionar um
nobreak ou mudar a informação de algum equipamento?" — pergunta feita de
volta pra saber quais dos 4 catálogos precisavam de edição pela tela
(modelos de UPS, BOM de equipamento, módulos de bateria externa, grupos de
capacidade de bateria) — resposta: **todos os 4**. A curva de derating por
temperatura (`TEMPERATURE_CURVE`) continua fixa no código — não foi uma
das opções oferecidas, é dado "científico" que raramente muda.

**Arquitetura**: `upsAutonomyCalc.ts` deixou de importar os JSON
estaticamente — virou um módulo 100% puro, toda função recebe o catálogo
(`UpsModel[]`, `BatteryGroup[]`, `EquipmentBomComponent[]` etc.) como
parâmetro explícito, nunca lido de uma constante do módulo. Os dados
passaram a viver atrás de rotas próprias, mesmo padrão JSON-file-backed
de `structure-property-rules.ts` (`GET`/`PUT` substituem o arquivo
inteiro, `force-dynamic`/`force-no-store` nos dois, mesma lição do bug de
405 documentado acima nesta seção):
- `src/lib/upsAutonomyStore.ts` — `readUpsAutonomyCatalog`/
  `writeUpsAutonomyCatalog` (`ups-autonomy-catalog.json`: `ups`,
  `batteryGroups`, `batteryExternal`) e `readUpsAutonomyEquipment`/
  `writeUpsAutonomyEquipment` (`ups-autonomy-equipment.json`:
  `equipmentNames`, `equipmentBom`, `equipmentLoadParams`).
- `/api/ups-autonomy-catalog` e `/api/ups-autonomy-equipment` — as rotas.
- `calculadora-autonomia-nobreak/page.tsx` busca os dois endpoints no
  mount (`loadAll`) e guarda em estado — a aba "Calculadora" e a aba
  "Catálogos" leem/escrevem o MESMO estado, então salvar um catálogo
  reflete na hora no seletor da calculadora, sem precisar recarregar a
  página.

**Largura da página, sem `max-w` fixo** — pedido explícito do usuário
("aumente a largura das tabelas pra chegar mais próximo do canto da
página"), depois de a 1ª versão ter saído com `max-w-[110rem]` no
container raiz — violava a convenção já documentada em
`specs/ui-componentes.md` ("nenhuma tela de tabela deve ter max-w fixo no
container central"), esquecida ao criar esta tela nova. Removido — a
página (e as tabelas largas dela, `w-full` dentro de um container sem
cap) agora ocupa toda a largura disponível, igual ao resto do app.

**UI de cada catálogo** — tabelas largas com rolagem horizontal (mesmo
padrão de tela wide-table já usado em `duplo-check-queries`), linha por
registro, todos os campos como input, botão "+ Novo" no rodapé e "✕" por
linha — sem nenhuma trava de "código não editável depois de salvo" aqui
(diferente de Parâmetros de Estrutura): esses catálogos não têm o mesmo
risco de casar linha errada por identidade, e o usuário não pediu essa
trava aqui.
- **Modelos de UPS / Módulos de bateria externa** — uma linha por
  registro, todos os ~13–19 campos do catálogo original.
- **Grupos de capacidade de bateria** — só 8 linhas normalmente
  (capacidade + os 5 coeficientes da curva `a,b,c,d,e`) — mexer aqui exige
  ter uma tabela de descarga nova do fabricante pra reajustar a curva, não
  é edição do dia a dia.
- **Equipamentos e BOM de potência** — duas tabelas ligadas: "Equipamentos"
  (nome + os 5 parâmetros de carga Ativo/Stand By) e "Componentes" (nome +
  VA unitário + checkbox Stand By + uma coluna de quantidade por
  equipamento cadastrado — mesma matriz da aba "Escâneres" da planilha
  original). Adicionar um equipamento novo cria a linha de parâmetros de
  carga (zerada) e uma coluna nova na tabela de componentes
  automaticamente; remover um equipamento apaga a linha de parâmetros E a
  quantidade dele em todo componente (com confirmação, "não pode ser
  desfeito" — mesmo padrão de "Remover grupo" em Parâmetros de Estrutura).

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

## Parâmetros de Estrutura — ordem de grupo, filtro por grupo, código travado, Salvar por grupo

Quatro mudanças pedidas explicitamente pelo usuário, na mesma rodada, na
1ª coluna de `/parametros-estrutura`:

- **Ordem fixa de grupo** — `PROPERTY_FIELD_ORDER` (`parametros-estrutura/page.tsx`):
  `COLOR, LANGUAGE, MOTOPOLIA_TYPE, CONVEYOR_BELT_LOAD_CAPACITY_KG,
  PROCESSOR, MEMORY, GRAPHICS_CARD, STORAGE, TUBE_POWER_KV` — os mesmos
  campos de "Itens de Série" de `standard_equipment_items` (ver
  `specs/contexto-negocio-inteligencia-produto.md`). Antes a ordem era só
  alfabética (`localeCompare`); agora `sortGroupKeys` prioriza essa lista
  fixa (comparação case-insensitive, já que `property_field` é texto livre)
  e só cai pra alfabética como critério de desempate/fallback pra qualquer
  grupo fora da lista — nunca ordem de inserção arbitrária. Usada em todo
  lugar que recalcula `groupOrder` (`computeGroupOrder`, `addGroup`,
  `renameGroup`), não só na carga inicial.
- **Filtro dentro de cada grupo** (`groupFilters`, por chave de grupo) —
  pedido explícito: "dentro de cada grupo, quero poder filtrar o que eu
  preciso dentro daquele grupo, pra achar as opções". Diferente do filtro
  global no topo da página (que decide **quais grupos aparecem**) — este só
  restringe as linhas mostradas dentro de um grupo já aberto, por código ou
  output. Só aparece quando o grupo tem mais de 5 códigos (grupos pequenos
  não precisam de filtro pra serem navegáveis).
- **Código trava depois de salvo** — pedido explícito: "quando eu realizo
  um cadastro, não quero ter a capacidade de editar o código do cadastro,
  se estiver errado, tenho que apagar a linha e escrever a regra de novo".
  Cada linha carregada do servidor ganha um `_id` interno (nunca enviado
  pro backend); `newIds` (`Set<string>`) marca só as linhas **ainda não
  salvas** (adicionadas nesta sessão via "+ Código"/"+ Novo Grupo") — só
  essas têm o campo "Código Acessório Protheus" editável (`readOnly`
  quando fora de `newIds`, com `title` explicando o motivo). Depois de
  qualquer save bem-sucedido, `newIds` é zerado (tudo que acabou de ser
  gravado passa a estar travado). O campo Output continua sempre editável
  — só o código (a chave de identidade da linha) trava, mesma lógica de
  "nunca casar/reescrever pela identidade, só pela chave de negócio já
  fixada" já usada no resto do app.
- **Botão Salvar por grupo** — pedido explícito: "hoje tem apenas um único
  botão no final da página". Adicionado um botão "Salvar" no rodapé de
  cada grupo (ao lado de "+ Código"), pra não precisar rolar até o fim da
  página depois de editar um grupo no topo. **Não é save parcial** — a
  rota `PUT /api/structure-property-rules` sempre substitui a lista
  inteira (mesmo `handleSave` de antes) — o botão por grupo é só
  conveniência de posição, salva tudo igual ao botão do rodapé da página
  (mantido, ainda útil pra quando várias mudanças em grupos diferentes
  foram feitas antes de salvar).

## Parâmetros de Estrutura — layout em pilha vertical, não mais 3 colunas

Pedido explícito do usuário, depois de elogiar o layout novo da aba
"Catálogos" da Calculadora de Autonomia de Nobreak (cada seção um abaixo
da outra, título no topo, bem separado): "aplique este mesmo conceito de
organização um abaixo do outro pra janela de Param. Itens de Série e
Acessórios". As 3 colunas lado a lado (`grid xl:grid-cols-3`: Parâmetros
de Estrutura, Classificação de Equipamentos, Acessórios Ignorados)
viraram uma pilha vertical (`flex flex-col gap-10`) — cada seção continua
com seu próprio título/descrição/tabela/botões, só a disposição mudou; o
`xl:pl-12` que espaçava as colunas foi removido (não faz mais sentido em
pilha vertical, o `gap-10` do container já separa as seções).

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

**2ª rodada, mesmo bug reportado ainda acontecendo depois do fix acima** —
dois reforços adicionados, validados com teste automatizado direto contra
a rota real (`/api/ignored-accessories`, sem mock, disparando PUTs
concorrentes com corpos crescentes — 8 rodadas sem serialização, 8 com; o
teste **não reproduziu perda de dado nem sem a fila**, o que aponta pra
causa raiz mais provável ser a instância que o usuário estava testando
ainda rodando o código de antes do primeiro fix, não um bug novo):
1. **Fila de gravação** (`writeQueueRef`, `persistIgnoredList`) — cada PUT
   só é disparado depois do anterior *terminar* (nunca em paralelo), pra
   eliminar de vez qualquer dependência da ordem de chegada dos requests
   no servidor (que não é garantida só pela ordem de envio). Mesmo padrão
   nos dois arquivos.
2. **Guarda contra o GET inicial "tarde demais"** (`hasLocalWriteRef`,
   só em `busca-avancada-acessorios/page.tsx`) — se o usuário clicar
   "Ignorar" antes do primeiro `GET /api/ignored-accessories` (que
   hidrata o estado ao montar a página) terminar, a resposta desse GET
   (mais antiga que o clique) não pode mais sobrescrever o que já foi
   marcado localmente.

Se o problema persistir depois deste reforço, o próximo passo é confirmar
que o ambiente testado já está rodando os commits mais recentes (pull +
restart do `npm run dev`/`npm run serve`) antes de investigar mais —
a rota e a lógica de acumulação já foram validadas isoladamente e não
reproduzem perda de dado.

**3ª rodada — causa raiz real, achada com diagnóstico no ambiente do
usuário: rota estática em build de produção, PUT nunca chegava a rodar
(405), nada a ver com React nem com a fila de gravação.** As duas rodadas
acima corrigiram bugs reais (condição de corrida no client), mas nenhuma
delas era a causa do sintoma reportado nesta rodada — o usuário confirmou
com `git pull` + `npm run serve` limpo (sem processo `node.exe` travado) e
o `PUT` continuava devolvendo **405 Method Not Allowed**, com o corpo de
erro sendo a página padrão de erro do Next (`Allow: GET, HEAD` no header),
não um erro do handler da rota.

Diagnóstico: `/api/structure-property-rules`, `/api/equipment-classification-rules`
e `/api/ignored-accessories` são caminhos **fixos** (sem segmento `[param]`
dinâmico) que exportam `GET` junto de um método mutante (`PUT`/`POST`/
`DELETE`) — sem `export const dynamic = 'force-dynamic'`, um build de
produção (`next build`, dentro de `npm run serve`) pode classificar essas
rotas como **estáticas** (só o `GET` é pré-renderizado em build; qualquer
outro método cai no 405 padrão do Next, porque não existe handler dinâmico
pra rodar). `/api/product-intelligence/route.ts` já tinha essas duas linhas
desde que foi criada e nunca teve esse problema — foi o comparativo que
confirmou a causa. Rotas com segmento dinâmico no caminho
(`/api/[table]/route.ts`, `/api/[table]/[id]/route.ts`) não sofrem disso —
um caminho com `[param]` nunca é elegível pra pré-renderização estática
sem `generateStaticParams` (não usado aqui), então PUT/POST nelas sempre
funcionou; é por isso que editar registros no resto do app nunca deu esse
erro.

**Fix**: adicionado `export const dynamic = 'force-dynamic'` +
`export const fetchCache = 'force-no-store'` nas quatro rotas de caminho
fixo com GET+método mutante — as três já citadas mais `/api/field-options`
(mesmo padrão, `GET`/`POST`/`DELETE`, achada na mesma varredura). Validado
localmente: `npm run build` (confirma no output `ƒ` em vez de `○` ao lado
de cada rota — dinâmico, não estático) + `npm run start` + `curl` direto
nas quatro rotas, todas voltando `200` depois do fix (antes, 405 nas duas
que já existiam antes desta sessão e nunca tinham sido testadas em build
de produção). Auditoria rápida confirmou que as outras rotas mutantes do
projeto (`/api/[table]/...`, `/api/global-update/...` etc.) ou têm
segmento dinâmico no caminho, ou são só-POST sem GET — nenhuma delas se
encaixa no padrão de risco (GET + mutante + caminho fixo), então não
precisaram do mesmo fix.

**Diagnóstico de campo, não só de código**: como o Claude não tem acesso
ao ambiente Windows do usuário, a causa raiz só foi encontrada com um
roteiro de diagnóstico rodado pelo próprio usuário no PowerShell
(matar processos node travados, testar a API direto via
`Invoke-WebRequest`/`curl.exe` sem passar pelo navegador) — o corpo da
resposta 405 (HTML com `Allow: GET, HEAD` e chunks `pages/_error`, a
página de erro estática padrão do Next) foi a pista decisiva.

## Análise de Estruturas / Busca Avançada de Acessórios (grupo "Consulta Banco de Dados")

`/analisador-estruturas` e `/busca-avancada-acessorios` são telas de
consulta ao banco Protheus (via `mssql`, mesma base de `pdmDb.ts` — ver
`specs/pdm-protheus-integracao.md`) para localizar itens de série/estruturas
e acessórios diretamente na base oficial, fora do Supabase.

### Busc. Avanç. Acessórios Protheus — só categoria "ACESSÓRIO", sem Visão em cascata

Duas mudanças pedidas explicitamente pelo usuário, na mesma rodada:

- **`EXCLUDED_CATEGORIES`** (`busca-avancada-acessorios/page.tsx`) — a
  Lista de acessórios nunca mostra as categorias estruturais/
  intermediárias da árvore Protheus (`SUBPA`, `EQUIPAMENTO`,
  `GASTOS GERAIS`, `EMBALAGENS`, `ADESIVOS`, `SPARE PARTS`, `CABOS`), só o
  resíduo `ACESSÓRIO` (peça de verdade, categoria default de
  `classifyAccessoryRow` quando nenhum prefixo de código bate). Filtrado
  dentro do próprio `flatItems` (`if (EXCLUDED_CATEGORIES.has(categoria))
  continue`), antes de qualquer outro filtro — a busca recursiva 26.xx/
  27.13 continua trazendo tudo (está correta), só a exibição na Lista que
  ficou restrita.
- **"Visão em cascata (26.xx)" removida por completo** — pedido explícito
  ("pode deletar este chaveamento"). Removidos: `viewMode` (estado),
  `expandedHeaders`/`toggleHeaderExpanded`, as interfaces
  `CascadeNivel3Node`/`CascadeNivel2Node`/`CascadeHeader`, os cálculos
  `cascadeHeaders`/`cascadeByEquip`/`displayedCascadeGroups`, e todo o
  bloco de renderização da árvore 26.xx → nível 2 → nível 3. A tela agora
  só tem a Lista de acessórios (sem chaveamento de modo de visualização) —
  o filtro "Categoria" deixou de ser condicional a `viewMode === 'lista'`
  (sempre visível agora, já que só existe um modo), e `copyHeader`/
  `copyRows` ("Copiar lista") pararam de ramificar por modo.

`AccessoryHierarchyRow`/`AccessoryHierarchyGroup` (o resultado bruto da
busca em `rawGroups`, com nível 2 e nível 3) continuam existindo sem
mudança — ainda são necessários pra calcular `qtdTotal` de um item de
nível 3 (multiplicador do nível 2 pai) mesmo que linhas de nível 2 quase
sempre caiam em categoria excluída e nunca apareçam na lista.

**Hover no checkbox "Ignorar" evidencia a linha inteira** — pedido explícito
do usuário: "preciso ler o que eu estou ignorando, seja somente um leve
evidência de linha, nada estravagante". `hoveredIgnoreKey` (estado no
componente da página, chave `${codigo}-${i}`) é setado nos handlers
`onMouseEnter`/`onMouseLeave` do `<td>` que envolve o `IgnoreCheckbox` —
enquanto o mouse está sobre o checkbox daquela linha, o `<tr>` ganha
`bg-surface-container-high` (leve, mesmo tom neutro já usado em hover de
outras listas do app, não uma cor nova). Só a linha correspondente fica em
evidência, nunca a tabela inteira nem um destaque chamativo.

**Filtro "Categoria:" removido, mesma rodada** — consequência direta do
item acima: com `EXCLUDED_CATEGORIES` em vigor, toda linha exibida é
sempre `ACESSÓRIO` (a única categoria que sobrevive ao filtro), então o
seletor "Categoria:" nunca oferecia mais de uma opção real — pedido
explícito do usuário pra tirar. Removidos `categoryFilter`/
`setCategoryFilter` (estado), `categoriesPresent` (`useMemo`), o filtro
por categoria dentro de `displayedGroups`, os dois resets
(`runScan`/`clearResults`) e o bloco `<select>` correspondente. A coluna
"Categoria" continua aparecendo na própria tabela (não foi pedido tirar
essa, só o filtro) — hoje sempre mostra "ACESSÓRIO", mas fica como
confirmação visual por linha, não como filtro redundante.

### Inteligência do Produto (`/inteligencia-produto`) — módulo desativado da navegação

**Pedido explícito do usuário**: "Quero abandonar a ideia do módulo de
inteligência do produto. Está muito vago eu transferir meu conhecimento
para uma IA atualmente, pode deixar o script pronto dentro do código,
apenas deixe de exibir a janela." Depois de rodar a varredura completa
(ver o relatório real discutido nesta sessão, 606 achados) e revisar o
resultado, decisão de recuar da ideia — não pelo motor em si ter dado
errado, mas por avaliar que o esforço de "ensinar" as regras de negócio
pro sistema (a validação e o refinamento contínuo de cada uma das 20
regras) não compensa agora.

**Como foi desativado**: a entrada `{ key: 'inteligencia-produto', ... }`
foi removida de `MODULES` (`src/lib/modules.ts`) — isso tira o link da
Sidebar e a entrada do checklist "módulos visíveis" de Configuração de
Usuários automaticamente (os dois são derivados de `MODULES`), sem
precisar mexer em mais nada. **Nada foi apagado do código**: a rota
`/inteligencia-produto` (página), `/api/product-intelligence` e
`/api/product-intelligence/rules`, o motor de 20 regras
(`productIntelligence.ts`), `productIntelligenceContext.ts` e
`REGRAS_CATALOGO` continuam no repo intactos e continuam buildando/
funcionando normalmente (confirmado com `npm run build`) — só não há mais
como chegar na tela pela navegação normal do app. Se a ideia for retomada
no futuro, basta devolver a linha em `MODULES`.

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
- **Só produção na 1ª versão** — rodava só contra as 9 tabelas reais do
  Supabase + Protheus ao vivo. Depois virou escolha do usuário (ver seção
  "Fonte de dados: produção ou _check" abaixo) — não muda a razão de ser
  original do Double-check de Queries (simular SQL antes de rodar, não
  auditar consistência de cadastro), só reaproveita as cópias `_check` já
  existentes como uma segunda fonte de dados pra esta varredura.

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

#### Fonte de dados: produção ou `_check`

Pedido explícito do usuário: "quero poder escolher quais bases de dados
eu irei rodar a análise, se é em _check, ou se é em produção". Toggle
"Produção"/`_check` na tela (`useCheckTables`, estado local) — enviado no
corpo do POST pra `/api/product-intelligence` e repassado pra
`buildProductIntelligenceContext(creds, useCheckTables)`
(`productIntelligenceContext.ts`).

- **`TABELAS`** deixou de ser uma lista literal duplicada e passou a
  reusar `DOUBLE_CHECK_TABLES` (`queryDoubleCheck.ts`) diretamente — as
  duas listas já eram idênticas (as mesmas 9 tabelas de engenharia), e
  agora "quais tabelas têm cópia `_check`" é exatamente a pergunta que
  este toggle precisa responder, então faz sentido a fonte única já
  existente ser reaproveitada aqui em vez de mantida em paralelo.
- Cada fetch vira `supabaseAdmin.from(useCheckTables ? \`${t}_check\` :
  t).select('*')...` — o resto do motor (`productIntelligence.ts`, as 14
  regras) **não muda nada**: elas só indexam `ctx.tables.accessories`,
  `ctx.tables.equipments` etc. (chaves sempre com o nome canônico, nunca
  sufixadas), então de onde os dados vieram é irrelevante pro motor —
  isolado inteiramente em `productIntelligenceContext.ts`.
- **Protheus ao vivo é igual nos dois modos** — não existe cópia `_check`
  pro Protheus (isso é um conceito exclusivo das 9 tabelas do Supabase,
  ver `specs/double-check-queries.md`), então `protheusInfo`/
  `bomByVariantCode`/`accessoryHierarchyGroups` sempre vêm do Protheus de
  verdade, com a credencial informada, independente do toggle.
- A tela lembra qual fonte a **última análise concluída** de fato usou
  (`usedCheckTables`, separado do toggle `useCheckTables` que representa a
  escolha pra próxima execução) — o resumo narrativo (`buildNarrativeSummary`)
  e a mensagem de "carregando" refletem isso, pra nunca dar a entender que
  um resultado já na tela veio de uma fonte diferente da que gerou ele.
- **Pré-requisito não validado pelo app**: rodar contra `_check` só faz
  sentido depois de já ter gravado essas cópias via Double-check de
  Queries (passo 1) — a tela avisa isso num texto ao lado do toggle, mas
  não impede rodar contra tabelas `_check` vazias/desatualizadas (nesse
  caso a varredura roda normalmente, só que contra um retrato antigo ou
  sem nenhuma linha).

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

### "Copiar todas as regras" — catálogo legível das regras pra área de transferência

Pedido explícito do usuário: "quero um botão para copiar todas as regras
para área de transferência para aprimorarmos esta 'IA' que estamos
criando" — levar a lógica atual de cada regra pra fora do app (colar numa
conversa, revisar/discutir aprimoramento), sem precisar abrir o código-fonte.

- `REGRAS_CATALOGO` (`src/lib/productIntelligence.ts`, logo após `REGRAS`) —
  array estático `{ codigo, categoria, titulo, descricao }`, um por regra,
  na mesma ordem de registro de `REGRAS`. É pura documentação: o motor em si
  (`runProductIntelligence`) nunca lê isto, só `REGRAS`. Cada `descricao` foi
  escrita a partir da lógica real de cada regra (não é resumo genérico) —
  qualquer regra nova ou mudança de comportamento numa regra existente
  precisa atualizar a entrada correspondente aqui também, ou o catálogo
  copiado fica desalinhado do motor de verdade.
- `GET /api/product-intelligence/rules` — rota só-leitura, sem credencial
  nenhuma (não toca Protheus nem Supabase), devolve `{ regras:
  REGRAS_CATALOGO }`. Caminho fixo mas só `GET` — não corre o risco de 405
  em build de produção documentado mais abaixo nesta seção (esse bug era
  especificamente sobre caminho fixo com `GET` + método mutante juntos).
- Botão no cabeçalho de `/inteligencia-produto` (não depende de conexão
  Protheus — é só o catálogo estático) — busca a rota acima, formata
  `[CODIGO] categoria — título\ndescrição` por regra e copia via
  `navigator.clipboard.writeText`, mesmo padrão visual "✓ Copiado" (1.5s)
  já usado em `atualizador-global.tsx`/`depurador-solic-comercial/page.tsx`.

**"Copiar relatório" dos achados — rodada seguinte, pedido explícito do
usuário**: "quero copiar o relatório também das ocorrências encontradas,
não somente as regras". Segundo botão, dentro do box de resumo (ao lado do
texto narrativo gerado por `buildNarrativeSummary`), só aparece depois de
já ter rodado uma análise (`achados.length > 0`). `buildAchadosReportText`
monta um texto agrupado por severidade (`[REGRA] tabela · chave`, mensagem,
evidência/sugestão/pergunta quando existirem), recalculando o resumo local
a partir da própria lista recebida — nunca do `resumo` da varredura
inteira, pra não misturar contagem total com uma lista filtrada.

**Copia o que está filtrado na tela, não a varredura inteira** — mesmo
padrão já estabelecido em Auditoria (`scopedRows`, ver `specs/auditoria.md`):
o botão recebe `filtrados` (já passado pelos filtros de severidade/tabela
ativos), não `achados` bruto, e o rótulo do botão mostra a contagem
correspondente (`Copiar relatório (N)`). Quando algum filtro está ativo, o
texto copiado inclui um aviso explícito ("este relatório não cobre todos os
achados da última varredura") — pra quem for colar isso numa conversa não
achar que está vendo o total.

**Achado incidental durante esta mudança**: o catálogo (agora documentado
acima) tem 20 regras reais no código (`R001, R002, R003, R070, R010, R011,
R012, R020, R021, R030, R031, R040, R041, R050, R051, R052, R060, R080,
R081, R090`) — o texto de `specs/contexto-negocio-inteligencia-produto.md`
("14 regras determinísticas/estatísticas") ficou desatualizado depois que
R080/R081/R090 foram adicionadas numa rodada posterior sem atualizar essa
contagem. Não corrigido nesta sessão (fora do escopo do pedido) — só
registrado aqui pra quem for mexer nesse spec depois.

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
