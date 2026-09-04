import sql from 'mssql'
import { CONNECTION_BASE, type PdmCredentials } from './pdmDb'

// Propriedades de um componente do PDM (base VMI), pra tela Consulta PDM x
// Banco MSM — expandir uma linha mostra isto num painel dentro da própria
// tabela. Query montada a partir de duas que o usuário forneceu:
//  - a macro VBA "ATUALIZARSQL" (BOM via XRefs — relação pai/filho de uma
//    montagem no Vault) — reaproveitada aqui como um CTE recursivo, pra
//    trazer a estrutura INTEIRA (todos os níveis, não só o 1°), a partir de
//    um DocumentID raiz.
//  - a query de propriedades (VariableValue, pivotada por VariableID) —
//    reaproveitada verbatim, só trocando o escopo de "toda tabela Documents"
//    pra "só os documentos achados no CTE acima".
//
// Se o documento raiz for uma peça (ExtensionID = 5), o CTE recursivo não
// acha filho nenhum (só monta tem XRefs) — sobra só a própria peça, que é
// exatamente o comportamento pedido ("se for peça, só as propriedades dela").
// Se for montagem (ExtensionID = 4), traz a montagem + todas as peças e
// sub-montagens dela, recursivamente, deduplicadas por DocumentID (uma peça
// repetida em vários pontos da estrutura aparece uma vez só).
//
// Duas correções em cima do que o usuário forneceu (ver auditoria):
// 1. No JOIN de `b` (documento filho), Deleted/UserDocRefsModified também são
//    checados em `b`, não só em `a` — a versão original do usuário repetia as
//    condições de `a` no JOIN de `b`, deixando o filho sem essa validação (um
//    componente apagado/com refs modificadas ainda entrava na estrutura).
// 2. MAXREV filtra ConfigurationID = 2 antes do MAX(RevisionNo) — sem isso, a
//    revisão máxima podia vir de outra configuração que a config 2 nunca
//    atingiu, e o JOIN seguinte (que já exige ConfigurationID = 2) não achava
//    linha nenhuma, deixando a propriedade em branco por engano.

const QUERY = `
;WITH BOM_TREE AS (
    SELECT @rootId AS DocumentID, 0 AS LEVEL

    UNION ALL

    SELECT x.XRefDocument, t.LEVEL + 1
    FROM BOM_TREE t
    INNER JOIN Documents a
      ON t.DocumentID = a.DocumentID
     AND a.ObjectTypeID = 1
     AND a.ExtensionID = 4
     AND a.UserDocRefsModified = 'False'
     AND a.Deleted = 'False'
    INNER JOIN XRefs x
      ON x.DocumentID = a.DocumentID
     AND x.RevNr = a.LatestRevisionNo
    INNER JOIN Documents b
      ON x.XRefDocument = b.DocumentID
     AND b.ObjectTypeID = 1
     AND b.ExtensionID IN (4, 5)
     AND b.UserDocRefsModified = 'False'
     AND b.Deleted = 'False'
    WHERE x.RefTimeStamp <> ''
),
DOCS AS (
    SELECT DocumentID, MIN(LEVEL) AS LEVEL
    FROM BOM_TREE
    GROUP BY DocumentID
),
MAXREV AS (
    SELECT v.DocumentID, v.VariableID, MAX(v.RevisionNo) AS REV_FIM
    FROM VariableValue v
    INNER JOIN DOCS f ON f.DocumentID = v.DocumentID
    WHERE v.VariableID IN (66,76,85,87,88,90,91,93,94,95,96,100,101,102,108)
      AND v.ConfigurationID = 2
    GROUP BY v.DocumentID, v.VariableID
),
VAL AS (
    SELECT m.DocumentID, m.VariableID, vv.ValueText
    FROM MAXREV m
    INNER JOIN VariableValue vv
            ON vv.DocumentID     = m.DocumentID
           AND vv.VariableID     = m.VariableID
           AND vv.RevisionNo     = m.REV_FIM
           AND vv.ConfigurationID = 2
)
SELECT
    d.DocumentID,
    doc.Filename,
    doc.ExtensionID,
    d.LEVEL,
    MAX(CASE WHEN v.VariableID = 66  THEN v.ValueText END) AS MATERIAL,
    MAX(CASE WHEN v.VariableID = 76  THEN v.ValueText END) AS REVISAO,
    MAX(CASE WHEN v.VariableID = 85  THEN v.ValueText END) AS CODIGO,
    MAX(CASE WHEN v.VariableID = 87  THEN v.ValueText END) AS MAQUINA,
    MAX(CASE WHEN v.VariableID = 88  THEN v.ValueText END) AS GRUPO,
    MAX(CASE WHEN v.VariableID = 90  THEN v.ValueText END) AS DENOMINACAO,
    MAX(CASE WHEN v.VariableID = 91  THEN v.ValueText END) AS TRATAMENTO,
    MAX(CASE WHEN v.VariableID = 93  THEN v.ValueText END) AS PESO,
    MAX(CASE WHEN v.VariableID = 94  THEN v.ValueText END) AS PROJETADO_POR,
    MAX(CASE WHEN v.VariableID = 95  THEN v.ValueText END) AS DESENHADO_POR,
    MAX(CASE WHEN v.VariableID = 96  THEN v.ValueText END) AS APROVADO_POR,
    MAX(CASE WHEN v.VariableID = 100 THEN v.ValueText END) AS NIVEL,
    MAX(CASE WHEN v.VariableID = 101 THEN v.ValueText END) AS AREA_SUP,
    MAX(CASE WHEN v.VariableID = 102 THEN v.ValueText END) AS ESPESSURA,
    MAX(CASE WHEN v.VariableID = 108 THEN v.ValueText END) AS CUSTO_SW
FROM DOCS d
INNER JOIN Documents doc ON doc.DocumentID = d.DocumentID
LEFT JOIN VAL v ON v.DocumentID = d.DocumentID
GROUP BY d.DocumentID, doc.Filename, doc.ExtensionID, d.LEVEL
ORDER BY d.LEVEL ASC, doc.Filename ASC
OPTION (MAXRECURSION 200);
`

export interface PdmPropertyRow {
  documentId: number
  filename: string
  extensionId: number | null
  level: number
  material: string | null
  revisao: string | null
  codigo: string | null
  maquina: string | null
  grupo: string | null
  denominacao: string | null
  tratamento: string | null
  peso: string | null
  projetadoPor: string | null
  desenhadoPor: string | null
  aprovadoPor: string | null
  nivel: string | null
  areaSup: string | null
  espessura: string | null
  custoSw: string | null
}

function cell(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s === '' ? null : s
}

export async function fetchPdmComponentProperties(creds: PdmCredentials, documentId: number): Promise<PdmPropertyRow[]> {
  const pool = new sql.ConnectionPool({ ...CONNECTION_BASE, user: creds.user, password: creds.password })
  try {
    await pool.connect()
    const result = await pool.request()
      .input('rootId', sql.Int, documentId)
      .query(QUERY)
    return (result.recordset as Record<string, unknown>[]).map(row => ({
      documentId: Number(row.DocumentID),
      filename: String(row.Filename ?? ''),
      extensionId: row.ExtensionID === null || row.ExtensionID === undefined ? null : Number(row.ExtensionID),
      level: Number(row.LEVEL ?? 0),
      material: cell(row.MATERIAL),
      revisao: cell(row.REVISAO),
      codigo: cell(row.CODIGO),
      maquina: cell(row.MAQUINA),
      grupo: cell(row.GRUPO),
      denominacao: cell(row.DENOMINACAO),
      tratamento: cell(row.TRATAMENTO),
      peso: cell(row.PESO),
      projetadoPor: cell(row.PROJETADO_POR),
      desenhadoPor: cell(row.DESENHADO_POR),
      aprovadoPor: cell(row.APROVADO_POR),
      nivel: cell(row.NIVEL),
      areaSup: cell(row.AREA_SUP),
      espessura: cell(row.ESPESSURA),
      custoSw: cell(row.CUSTO_SW),
    }))
  } finally {
    await pool.close()
  }
}
