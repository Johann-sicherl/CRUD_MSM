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

## Armadilhas conhecidas da query de BOM (já corrigidas)

Encontradas via auditoria manual do usuário e replicadas tanto no SQL
externo (VBA/planilha do usuário) quanto nas queries deste app:

- **Filtro de documento apagado/modificado ausente**: a query de itens filhos
  do BOM precisa filtrar `Deleted = 'False' AND UserDocRefsModified =
  'False'` (junto com `ObjectTypeID = '1' AND ExtensionID IN('4','5')`) —
  sem isso, itens excluídos ou com referência de usuário modificada
  aparecem indevidamente na estrutura.
- **`ConfigurationID` não escopado em MAXREV/PROPFIL**: o join de
  propriedades de variável (`VariableValue`) precisa exigir
  `ConfigurationID = '2'` explicitamente — a query de revisão máxima (MAXREV)
  por si só não garante isso, e o JOIN seguinte assume que já foi filtrado.

Essas duas condições estão comentadas inline em `pdmDb.ts` exatamente onde
aparecem (linhas próximas às queries SQL). Se uma query de BOM/propriedades
nova for adicionada, replicar as duas condições.

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
