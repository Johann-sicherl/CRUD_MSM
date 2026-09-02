import sql from 'mssql'

// Conecta ao banco do PDM (Autodesk Vault/PDM — SQL Server, base VMI em
// srvvmis03) pra trazer os atributos de item cadastrados lá, na tela
// Consulta PDM x Supabase. Mesmo padrão de src/lib/protheusDb.ts: as
// credenciais chegam a cada requisição e nunca são persistidas — cada
// chamada abre e fecha sua própria conexão.

export interface PdmCredentials {
  user: string
  password: string
}

const CONNECTION_BASE = {
  server: 'srvvmis03',
  database: 'VMI',
  port: 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  connectionTimeout: 15000,
  requestTimeout: 60000,
}

// Query fornecida pelo usuário, verbatim (mesmas CTEs/JOINs) — só filtra
// AC_VALIDADO = 'S', ou seja, apenas itens já validados no PDM.
const QUERY = `
WITH PROPFIL AS(
SELECT VariableID, DocumentID, MAX(RevisionNo) AS REV_FIM
FROM VariableValue
GROUP BY DocumentID, VariableID),

FILES AS(
SELECT DocumentID, Filename
FROM Documents
WHERE UserDocRefsModified = 'False' AND Deleted = 'False' AND ObjectTypeID = '1' AND ExtensionID IN('4','5')
--3 = DRW , 4 = ASM, 5 = PRT
),

PROPFILES AS(
SELECT d.DocumentID, d.Filename, e.REV_FIM, e.VariableID
FROM FILES d
INNER JOIN PROPFIL e ON d.DocumentID = e.DocumentID
),

PROPFILESCOMPLETE AS(
SELECT f.DocumentID, f.Filename, f.REV_FIM, f.VariableID, g.ValueText, g.ConfigurationID
FROM PROPFILES f
INNER JOIN VariableValue g ON f.DocumentID = g.DocumentID AND f.VariableID = g.VariableID AND f.REV_FIM = g.RevisionNo AND ConfigurationID = '2'
),

AYM AS (SELECT
a.DocumentID,
a.Filename,
(CASE
WHEN (LEFT(l.ValueText,2)) = '33' OR (LEFT(l.ValueText,2)) = '34' THEN CONCAT((l.ValueText),'.',(m.ValueText))
ELSE
(l.ValueText)
END) AS CODIGO_PROTHEUS,
(LEFT((b.ValueText),2)) as ID_GRUPO,
(c.ValueText) as COR_PRODUTO,
(d.ValueText) as MATERIAL_PREDOMINANTE,
(e.ValueText) as DIMENSIONAL_MM,
(f.ValueText) as QTD_MON_TOTEM,
(g.ValueText) as TAMANHO_MONITOR,
(h.ValueText) as TEMPO_OPERACAO_MIN,
(i.ValueText) as OBS,
(j.ValueText) as ALERTA_GERAL,
(k.ValueText) as AC_VALIDADO,
(n.ValueText) as NOME_COMERCIAL

FROM Documents a

INNER JOIN FILES q ON q.DocumentID = a.DocumentID

LEFT JOIN PROPFILESCOMPLETE b ON a.DocumentID = b.DocumentID AND b.VariableID = 111
LEFT JOIN PROPFILESCOMPLETE c ON a.DocumentID = c.DocumentID AND c.VariableID = 112
LEFT JOIN PROPFILESCOMPLETE d ON a.DocumentID = d.DocumentID AND d.VariableID = 113
LEFT JOIN PROPFILESCOMPLETE e ON a.DocumentID = e.DocumentID AND e.VariableID = 114
LEFT JOIN PROPFILESCOMPLETE f ON a.DocumentID = f.DocumentID AND f.VariableID = 115
LEFT JOIN PROPFILESCOMPLETE g ON a.DocumentID = g.DocumentID AND g.VariableID = 116
LEFT JOIN PROPFILESCOMPLETE h ON a.DocumentID = h.DocumentID AND h.VariableID = 117
LEFT JOIN PROPFILESCOMPLETE i ON a.DocumentID = i.DocumentID AND i.VariableID = 118
LEFT JOIN PROPFILESCOMPLETE j ON a.DocumentID = j.DocumentID AND j.VariableID = 119
LEFT JOIN PROPFILESCOMPLETE k ON a.DocumentID = k.DocumentID AND k.VariableID = 120
LEFT JOIN PROPFILESCOMPLETE l ON a.DocumentID = l.DocumentID AND l.VariableID = 85
LEFT JOIN PROPFILESCOMPLETE m ON a.DocumentID = m.DocumentID AND m.VariableID = 76
LEFT JOIN PROPFILESCOMPLETE n ON a.DocumentID = n.DocumentID AND n.VariableID = 122)

SELECT

t.CODIGO_PROTHEUS,
t.ID_GRUPO,
t.COR_PRODUTO,
t.MATERIAL_PREDOMINANTE,
t.DIMENSIONAL_MM,
t.QTD_MON_TOTEM,
t.TAMANHO_MONITOR,
t.NOME_COMERCIAL,
t.OBS,
t.ALERTA_GERAL

FROM AYM t

WHERE AC_VALIDADO = 'S'
ORDER BY ID_GRUPO ASC
`

export interface PdmAccessoryRow {
  codigoProtheus: string
  idGrupo: string | null
  corProduto: string | null
  materialPredominante: string | null
  dimensionalMm: string | null
  qtdMonTotem: string | null
  tamanhoMonitor: string | null
  nomeComercial: string | null
  obs: string | null
  alertaGeral: string | null
}

function cell(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s === '' ? null : s
}

export async function fetchPdmAccessories(creds: PdmCredentials): Promise<PdmAccessoryRow[]> {
  const pool = new sql.ConnectionPool({ ...CONNECTION_BASE, user: creds.user, password: creds.password })
  try {
    await pool.connect()
    const result = await pool.request().query(QUERY)
    return (result.recordset as Record<string, unknown>[])
      .map(row => ({
        codigoProtheus: cell(row.CODIGO_PROTHEUS) ?? '',
        idGrupo: cell(row.ID_GRUPO),
        corProduto: cell(row.COR_PRODUTO),
        materialPredominante: cell(row.MATERIAL_PREDOMINANTE),
        dimensionalMm: cell(row.DIMENSIONAL_MM),
        qtdMonTotem: cell(row.QTD_MON_TOTEM),
        tamanhoMonitor: cell(row.TAMANHO_MONITOR),
        nomeComercial: cell(row.NOME_COMERCIAL),
        obs: cell(row.OBS),
        alertaGeral: cell(row.ALERTA_GERAL),
      }))
      .filter(row => row.codigoProtheus)
  } finally {
    await pool.close()
  }
}
