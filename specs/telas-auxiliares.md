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

### Camada B (`/inteligencia-produto`, aba "Pergunte à IA") — IA interna, sem LLM real

Implementada com uma decisão explícita e definitiva do usuário, que
reverteu a hipótese original ("precisa de LLM real") levantada quando a
Camada B ainda era só descrita, não implementada: **nenhuma conexão com
nenhum serviço de IA externo, nunca** — nem Anthropic, nem OpenAI, nem
qualquer outro provedor, nenhuma chave de API nova. A "IA" é inteiramente
interna e determinística.

- `src/lib/productIntelligenceNlu.ts` — parser heurístico de pergunta em
  português, mesmo espírito de `solicComercialParser.ts` (sem gramática
  formal, sem tentar cobrir 100% das formas de perguntar):
  - `parseProductQuestion(texto)` — extrai código(s) Protheus
    (`\d{2}\.\d{2}\.\d{4,6}(\.\d{2})?`), `equipamento <n>`/`grupo <n>`
    (regex ancorada na palavra, pra não confundir número de equipamento com
    qualquer número solto no texto), e casa palavras-chave (sem acento,
    minúsculo) contra uma tabela `KEYWORD_RULES` que mapeia assunto → um ou
    mais dos códigos das 14 regras (ex.: "bloquead"/"bloqueio" → R010+R011,
    "duplic"/"repetid" → R020+R021, "sempre sai junto"/"co-ocorrencia" →
    R080). Pergunta sem nenhum código/equipamento/grupo/palavra-chave
    reconhecida vira `reconhecida: false` — resposta fixa pedindo pra
    reformular, nunca uma tentativa de resposta às cegas.
  - `filterAchadosByEntities(achados, parsed)` — filtra os achados já
    calculados pelos valores citados na pergunta, olhando em qualquer campo
    de `achado.chave` (cada regra nomeia a própria chave diferente:
    `codigo`, `codigoA`/`codigoB`, `equipamento`, `grupo`...).
  - `buildAskAnswer(parsed, achados, regrasRodadas)` — monta a frase de
    resposta citando exatamente as regras rodadas e o escopo entendido;
    nunca lista achado que o motor não gerou.
- `src/lib/productIntelligenceContext.ts` — `buildProductIntelligenceContext(creds)`,
  extraído de dentro de `/api/product-intelligence/route.ts` (que passou a
  só chamá-lo) especificamente pra ser reusado também pela rota nova abaixo,
  sem duplicar a montagem do contexto (9 tabelas + cadastro/estrutura
  Protheus ao vivo).
- `POST /api/product-intelligence/ask` — recebe `{ user, password, pergunta }`
  (mesma credencial Protheus por requisição de sempre, nunca persistida).
  Pergunta não reconhecida responde direto, sem round-trip nenhum ao
  Protheus. Reconhecida: monta o contexto, roda só as regras detectadas
  (ou as 14, se a pergunta citou um código/equipamento/grupo mas nenhum
  assunto específico), filtra por entidade citada, devolve
  `{ resposta, achados, parsed, regrasRodadas }`.
- UI: `inteligencia-produto/page.tsx` ganhou abas ("🧠 Análise completa" /
  "💬 Pergunte à IA") — a aba nova tem um `textarea` de pergunta livre, o
  card de resposta (texto + chips das regras rodadas) e a lista de achados
  reaproveitando o mesmo `AchadoCard` da análise completa.

**Regra de ouro, já documentada em
`specs/contexto-negocio-inteligencia-produto.md`**: a IA nunca inventa
achado — ela só traduz linguagem natural pra um recorte do motor de regras
determinístico (quais regras rodar, sobre qual código/equipamento/grupo) e
devolve exatamente o que ele calculou. Continua **só propondo, nunca
gravando** — a aba de pergunta é só leitura, igual à análise completa; toda
gravação real continua passando pelo fluxo normal do app.

**Bug real já corrigido: "zero achado" não pode significar "coerente" quando
o identificador nem foi checado.** Achado pelo próprio usuário rodando a
pergunta "VERIFIQUE TODA ÁRVORE DE RELACIONAMENTO DO EQUIPAMENTO 6040 SV ID
12, SE ESTÁ COERENTE..." — a extração de equipamento pegava o primeiro
número depois da palavra "equipamento" (`6040`, parte do nome comercial do
produto), não o `12` depois de "ID" (o `legacy_id` de verdade). O filtro
então recortava achados por `equipamento: "6040"`, não achava nada, e a
resposta dizia "não encontrei nenhum achado — nada pendente", dando falsa
sensação de "coerente" sem ter checado o equipamento certo. Dois fixes em
`productIntelligenceNlu.ts`:
1. `ID_RE` (`/\bid\s*.../`) tem prioridade sobre o número solto depois de
   "equipamento"/"grupo" quando a pergunta menciona esse assunto — "ID N"
   explícito é mais confiável que um número qualquer perto da palavra.
2. `findUnknownEntities(ctx, parsed)` — checa se cada código/equipamento/
   grupo citado existe de verdade em algum lugar (não só na tabela "dona":
   toda coluna de referência nas 9 tabelas + o cadastro Protheus, porque um
   código pode estar em uso na engenharia sem existir no Protheus — isso é
   literalmente o que R001 detecta, não pode contar como "desconhecido").
   Quando algum identificador citado não existe em lugar nenhum,
   `buildAskAnswer` antepõe um aviso explícito (`⚠ Não encontrei ...`) e,
   se **nenhum** dos identificadores citados existir, troca a mensagem
   inteira por "não rodei a checagem de verdade... isso NÃO significa
   'coerente'" em vez de implicar que está tudo certo.
2ª correção na mesma rodada: `KEYWORD_RULES` de R001 eram frases fixas
demais (`'nao cadastrado no protheus'`) — não batiam em "não estão
cadastrados" (plural, ordem de palavras diferente). Ampliado pro stem
`'nao cadastrad'`/`'nao esta(o) cadastrad'`. Não chegou a quebrar nada
sozinho (sem palavra-chave nenhuma reconhecida, o fallback já roda as 14
regras, R001 incluído) mas a resposta ficava menos transparente sobre qual
regra endereçava a pergunta.

#### Filtro estruturado — elimina a ambiguidade de parsing na raiz

Depois do bug acima, pedido explícito do usuário ("implementa a opção 2"
— ver a conversa: perguntei se ele queria eu ampliar o vocabulário de
palavras-chave, jogo de gato e rato, ou adicionar controles estruturados
que eliminam a ambiguidade de vez; ele escolheu a segunda): a aba
"Pergunte à IA" ganhou seletores estruturados **ao lado** do texto livre,
não como substituto — o texto livre continua existindo como atalho, mas o
filtro estruturado, quando preenchido, tem prioridade total e **ignora** o
texto livre por completo (nunca mistura os dois na mesma requisição).

- UI (`inteligencia-produto/page.tsx`): `<select>` de Equipamento e de
  Grupo alimentados pela lista real do banco (`GET /api/equipments` e
  `GET /api/accessory_groups`, o mesmo endpoint genérico de listagem que
  toda tela de tabela já usa — `.range()`/`limit=25000` explícito, mesma
  convenção de sempre), campo de texto pro código Protheus (sem regex
  nenhuma — o valor vai direto, sem ambiguidade de "onde começa/termina o
  código"), e checkboxes das 20 ocorrências de regra (as 14 regras, com
  R002/R003/R081/R090 etc. listadas por código — nenhuma marcada = roda
  todas). `REGRAS_INFO` é uma lista **hardcoded** no componente cliente
  (rótulo curto por regra) — deliberado, pra não importar
  `productIntelligence.ts` (motor completo, com `computeStructurePropertyResults`
  etc.) pro bundle client-side só pra pegar uma lista de códigos.
- `POST /api/product-intelligence/ask` passou a aceitar `filtro: {
  equipamento?, grupo?, codigo?, regras?: string[] }` além de `pergunta`.
  Quando `filtro` tem qualquer campo preenchido, o servidor monta o
  `ParsedProductQuestion` **direto** a partir dele (`reconhecida: true`
  sempre, porque veio de seleção explícita — não há "não reconhecido"
  possível aqui) e **nunca** chama `parseProductQuestion` — o parser
  heurístico só roda quando não há filtro estruturado nenhum. `regras`
  do corpo é validado contra `REGRAS_DISPONIVEIS` (só aceita código de
  regra real, ignora qualquer string que não seja uma das 14).
- Efeito prático: perguntar de novo sobre "equipamento 6040 SV ID 12"
  escolhendo "12" no `<select>` de Equipamento elimina de raiz a classe de
  bug documentada acima — não existe mais "número errado extraído do
  texto", porque não há extração nenhuma nesse caminho.

Isso não fecha a porta a um LLM de verdade no futuro (a hipótese original
citada abaixo, em itálico, fica como histórico) — mas a decisão vigente,
pedida explicitamente pelo usuário, é que a Camada B **é** este motor
heurístico interno, não um LLM.

*Histórico (hipótese original, superada pela decisão acima): o usuário
descreveu o objetivo final como uma janela de prompt livre onde uma IA de
verdade interpretaria a pergunta e proporia o cenário completo de cadastro
(ex.: "cadastre este componente em Acessórios, associe esta embalagem a
este equipamento..."), o que exigiria uma chamada real a um LLM.*

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
