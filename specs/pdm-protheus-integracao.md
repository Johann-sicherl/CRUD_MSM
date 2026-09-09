# Integração PDM / Protheus

## Conexões `mssql`

`pdmDb.ts`/`pdmProperties.ts` conectam via `mssql` (SQL Server) a dois
sistemas externos: o Vault/PDM (Autodesk) e o Protheus. `CONNECTION_BASE`
em `pdmDb.ts` define timeout/opções compartilhadas; cada chamada abre um
`sql.ConnectionPool` com credenciais (`PdmCredentials`) fornecidas pelo
usuário na tela (não fixas em variável de ambiente).

Funções principais:
- `fetchPdmAccessories(creds)` — lista de acessórios do PDM.
- `fetchPdmComponentProperties(creds, documentId)` — propriedades de um
  componente específico.

Convenção de credenciais: `PdmCredentials` é sempre fornecida pelo usuário na
tela e passada por requisição — nunca persistida no servidor (nem em
variável de ambiente, nem em sessão). Cada chamada abre e fecha seu próprio
`sql.ConnectionPool`. Mesmo padrão replicado de `protheusDb.ts` (a conexão
Protheus já existente antes desta integração).

A tela "Consulta PDM x Banco MSM" (credenciais + comparação PDM x Supabase)
é **admin-only** — nunca deve aparecer, nem solicitar credencial, para o
perfil Gerente Adm Comercial (ver `specs/permissoes-e-perfis.md`).

## Armadilhas conhecidas da query de BOM (já corrigidas)

Encontradas via auditoria manual do usuário e replicadas tanto no SQL
externo (VBA/planilha do usuário) quanto nas queries deste app:

- **Filtro de documento apagado/modificado ausente**: a query de itens filhos
  do BOM precisa filtrar `Deleted = 'False' AND UserDocRefsModified =
  'False'` (junto com `ObjectTypeID = '1' AND ExtensionID IN('4','5')`) —
  sem isso, itens excluídos ou com referência de usuário modificada
  aparecem indevidamente na estrutura. **Cuidado com o alias**: o bug real já
  encontrado foi validar essas colunas contra o alias do documento **pai**
  em vez do **filho** — o pai passava a validação e o filho inválido entrava
  na BOM mesmo assim. As condições precisam estar no alias do filho.
- **`ConfigurationID` não escopado em MAXREV/PROPFIL**: o join de
  propriedades de variável (`VariableValue`) precisa exigir
  `ConfigurationID = '2'` explicitamente **dentro da própria CTE `MAXREV`**
  — calcular `MAX(RevisionNo)` sem esse filtro deixa outra configuração
  "vencer" a revisão mais alta e a query seguinte (que já assume
  `ConfigurationID = '2'`) devolve propriedades em branco.

Essas duas condições estão comentadas inline em `pdmDb.ts` exatamente onde
aparecem (linhas próximas às queries SQL). Se uma query de BOM/propriedades
nova for adicionada, replicar as duas condições.

## Expansão de propriedades de montagem — hierarquia completa

Para uma montagem (assembly), a expansão de propriedades deve trazer a **BOM
recursiva completa** (todos os níveis, não só o 1º), deduplicada por
`DocumentID`. Pedido explícito do usuário: "a montagem deve ser trazida como
um todo, não somente o 1° nível."

Ao exportar/copiar dados dessa tela, o app pergunta (popup) se o
usuário quer incluir as propriedades+BOM do PDM ou só os dados já na tela —
não decide isso silenciosamente.

## `ALERTA_GERAL` — campo esquecido, decisão de não estender a RPC já publicada

O campo `ALERTA_GERAL` foi esquecido no mapeamento inicial de campos do PDM
(`PDM_FIELD_MAP`) e adicionado depois que o usuário notou a lacuna. **Decisão
deliberada**: a função `replace_protheus_code` (abaixo) já estava em
produção quando isso foi corrigido e **não foi estendida** para sincronizar
esse campo — mudar a assinatura de uma RPC `SECURITY DEFINER` já publicada é
tratado como risco desnecessário; se um novo campo precisar sincronizar via
substituição de revisão, isso exige decisão explícita nova, não extensão
silenciosa.

## Substituição de revisão (`msm_replace_protheus_code.sql`)

Tela "Consulta PDM x Banco MSM": quando um componente validado no PDM tem
código com revisão (ex.: `34.01.10040.01`) e já existe uma linha equivalente
sem revisão (ou com revisão anterior) no Supabase, a substituição é feita de
forma atômica pela RPC `replace_protheus_code`. Este fluxo passa por
`recordReplaceAudit` (ver `specs/auditoria.md`) — historicamente não passava,
foi corrigido nesta sessão.

**Decisão já tomada e não questionar**: a sincronização feita por esta
função é **só de código** (protheus_code/revisão) — não sincroniza
nome, cor, ou outros campos descritivos entre a linha antiga e a nova. Isso
foi um pedido explícito do dono do projeto; a função SQL já foi recriada
(`DROP FUNCTION` + `CREATE`) removendo os parâmetros extras que tentavam
sincronizar outros campos.

**Guard da função**: `replace_protheus_code` aborta com `RAISE EXCEPTION` se
o código antigo não existir em `accessories` — mesmo que ele exista em
outra tabela que o referencia (ex.: `relationship_equip_accessory`,
`non_combinable_comps`). Isso é intencional (accessories é a tabela "dona"
do código), mas significa que reverter/corrigir um código que só aparece em
tabelas relacionadas não passa por esta RPC.

**Popup de revisão antiga — bug já corrigido**: o popup que lista onde o
código antigo está cadastrado já filtrou incorretamente a própria tabela que
disparou o popup (Cadastro de Componentes) — corrigido para listar todas as
tabelas onde o código aparece, por precaução do usuário: "por precaução,
pode listar todas as janelas/tabelas neste pop-up de onde está com a revisão
antiga."

**Sem constraint de FK em `protheus_code`**: `msm_foreign_keys.sql` não
declara nenhuma FK real sobre `protheus_code`/`protheus_item_code`/
`remove_list_code` (só sobre IDs numéricos legados, como
`legacy_group_id`/`legacy_equipment_id`) — então renomear um código em
múltiplas tabelas via `UPDATE ... WHERE` não corre risco de violar
constraint, mas também significa que o Postgres não garante consistência
referencial nesses campos — é a própria RPC (e o app) que precisa manter
isso coerente.

## Alterações manuais via SQL Editor nunca geram auditoria

Rodar uma query direto no SQL Editor do Supabase (fora do app) **nunca**
grava uma linha em `audit_log` — só uma escrita feita através de uma rota do
app (que chama `record*Audit`, ver `specs/auditoria.md`) gera esse rastro.
Relevante sempre que uma correção pontual for feita direto no banco: ela
fica invisível para quem só olha a tela de Auditoria.
