import sql from 'mssql'

// Connects to the Protheus ERP database (SQL Server) to read the ESTRUTURAS
// (BOM) table directly, instead of requiring a manually exported .xlsx.
// Credentials are supplied per-request and never stored — each call opens
// its own short-lived connection pool and closes it in `finally`, so there
// is no persistent connection sitting open, and a slow/unreachable server
// only affects this one request instead of blocking the whole app.

export interface ProtheusCredentials {
  user: string
  password: string
}

const CONNECTION_BASE = {
  server: '172.23.22.11',
  database: 'PROTHEUS12',
  port: 1433,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  connectionTimeout: 15000,
  requestTimeout: 20000,
}

// One ESTRUTURA→COMPONENTE query per BOM node meant hundreds of sequential
// round trips over the WAN link to the Protheus server — the whole analysis
// could take minutes and individual nodes were timing out at 20s. Instead,
// the whole ESTRUTURAS table is pulled ONCE (a single, longer-running query)
// into in-memory maps, cached for a while, and every structure resolution
// afterwards walks those maps in memory — zero further DB round trips per
// analysis. DESC_ESTRUTURA is pulled alongside ESTRUTURA/COMPONENTE in the
// same query so the structure's description is available with no extra cost.
interface StructureCache {
  adjacency: Map<string, string[]>
  descriptions: Map<string, string>
  fetchedAt: number
}

let cache: StructureCache | null = null
let inFlight: Promise<StructureCache> | null = null

const CACHE_TTL_MS = 30 * 60 * 1000 // BOM data changes rarely enough that a 30min-old cache is still safe to reuse.
const BULK_LOAD_TIMEOUT_MS = 120000 // the one full-table pull is allowed to run much longer than a normal query.

async function loadStructureCache(creds: ProtheusCredentials): Promise<StructureCache> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache
  if (inFlight) return inFlight

  inFlight = (async () => {
    const pool = new sql.ConnectionPool({
      ...CONNECTION_BASE,
      user: creds.user,
      password: creds.password,
      requestTimeout: BULK_LOAD_TIMEOUT_MS,
    })
    try {
      await pool.connect()
      const result = await pool.request()
        .query('SELECT ESTRUTURA, DESC_ESTRUTURA, COMPONENTE FROM ESTRUTURAS')

      const adjacency = new Map<string, string[]>()
      const descriptions = new Map<string, string>()
      for (const row of result.recordset as { ESTRUTURA: unknown; DESC_ESTRUTURA: unknown; COMPONENTE: unknown }[]) {
        const estrutura = String(row.ESTRUTURA ?? '').trim()
        const componente = String(row.COMPONENTE ?? '').trim()
        if (!estrutura) continue

        if (!descriptions.has(estrutura)) {
          const desc = String(row.DESC_ESTRUTURA ?? '').trim()
          if (desc) descriptions.set(estrutura, desc)
        }

        if (!componente) continue
        const children = adjacency.get(estrutura)
        if (children) children.push(componente)
        else adjacency.set(estrutura, [componente])
      }

      cache = { adjacency, descriptions, fetchedAt: Date.now() }
      return cache
    } finally {
      await pool.close()
      inFlight = null
    }
  })()

  return inFlight
}

/**
 * Resolves the full BOM for `protheusCode`: for every COMPONENTE under that
 * ESTRUTURA, if the component is itself the header of another structure,
 * its components are pulled in too — same result as the union of
 * "2-Estruturas"/"FLAT-LIST" from the manual Excel export. Runs entirely
 * against the in-memory adjacency map (see loadStructureCache above); a
 * visited-set guards against cyclic BOM references. Also returns the
 * structure's own DESC_ESTRUTURA, when known.
 */
export async function fetchStructureCodes(protheusCode: string, creds: ProtheusCredentials): Promise<{ codes: string[]; description: string | null; foundInProtheus: boolean }> {
  const { adjacency, descriptions } = await loadStructureCache(creds)

  const root = protheusCode.trim()
  const visited = new Set<string>()
  const collected = new Set<string>()
  const queue: string[] = [root]

  while (queue.length > 0) {
    const current = (queue.shift() as string).trim()
    if (!current || visited.has(current)) continue
    visited.add(current)

    for (const componente of adjacency.get(current) || []) {
      collected.add(componente)
      if (!visited.has(componente)) queue.push(componente)
    }
  }

  return {
    codes: Array.from(collected),
    description: descriptions.get(root) ?? null,
    foundInProtheus: adjacency.has(root) || descriptions.has(root),
  }
}

/**
 * Reverse lookup: every distinct ESTRUTURA header code registered in the
 * live Protheus database whose code starts with one of `prefixes` (e.g.
 * "27.04", "27.03") — regardless of whether that code exists in our
 * internal standard_equipment_items catalog. Reuses the same cached
 * adjacency map as fetchStructureCodes (its keys ARE the full set of
 * structure headers), so this costs no extra DB round trip once the
 * cache is warm.
 */
export async function listStructureHeaders(prefixes: string[], creds: ProtheusCredentials): Promise<string[]> {
  const { adjacency } = await loadStructureCache(creds)
  const normalizedPrefixes = prefixes.map(p => p.trim().toUpperCase()).filter(Boolean)
  if (normalizedPrefixes.length === 0) return []

  return Array.from(adjacency.keys())
    .filter(code => normalizedPrefixes.some(p => code.toUpperCase().startsWith(p)))
    .sort((a, b) => a.localeCompare(b))
}

// ─── Product master (SB1010) status check ──────────────────────────────
// Separate from the ESTRUTURAS cache above — this is a different table,
// used by the view-only Protheus status flag in Cadastro de Equipamentos.
// This is the user's own reference query, verbatim (same SELECT list,
// same INNER/LEFT JOINs) — the only change is dropping the trailing
// `AND (...) = 'ATIVO'` filter, since keeping it would mean BLOQUEADO rows
// never come back and the red flag could never trigger. Only COD_PRODUTO
// and STD_BLOQ are read from each row; the rest of the columns are pulled
// (matching the reference query exactly) but unused here.

export type ProtheusProductStatus = 'ATIVO' | 'BLOQUEADO'

interface ProductStatusCache {
  statusByCode: Map<string, ProtheusProductStatus>
  fetchedAt: number
}

let productStatusCache: ProductStatusCache | null = null
let productStatusInFlight: Promise<ProductStatusCache> | null = null

async function loadProductStatusCache(creds: ProtheusCredentials): Promise<ProductStatusCache> {
  if (productStatusCache && Date.now() - productStatusCache.fetchedAt < CACHE_TTL_MS) return productStatusCache
  if (productStatusInFlight) return productStatusInFlight

  productStatusInFlight = (async () => {
    const pool = new sql.ConnectionPool({
      ...CONNECTION_BASE,
      user: creds.user,
      password: creds.password,
      requestTimeout: BULK_LOAD_TIMEOUT_MS,
    })
    try {
      await pool.connect()
      const result = await pool.request().query(`
        SELECT
            rtrim(a.B1_COD) AS COD_PRODUTO,
            left(rtrim(a.B1_COD),11) AS COD_SEM_REV,
            rtrim(a.B1_DESC) AS DESCRICAO_PRODUTO,
            rtrim(a.B1_TIPO) AS TIPO,
            rtrim(a.B1_UM) AS PRIMEIRA_UNIDADE,
            rtrim(a.B1_SEGUM) AS SEGUNDA_UNIDADE,
            rtrim(a.B1_CONV) AS FAT_CONV,
            CASE
                WHEN a.B1_MSBLQL = '2' THEN 'ATIVO'
                WHEN a.B1_MSBLQL = '1' THEN 'BLOQUEADO'
                WHEN a.B1_MSBLQL = ''  THEN 'ATIVO'
            END AS STD_BLOQ,
            rtrim(a.B1_LOCPAD) AS LOCAL_PADRAO,
            rtrim(a.B1_GRUPO) AS GRUPO_PRODUTO,
            rtrim(b.BM_DESC) AS DESC_GRUPO_MICRO,
            rtrim(b2.BM_DESC) AS GRUPO_PRINC,
            rtrim(a.B1_FABRIC) AS FABRICANTE,
            rtrim(a.B1_REVATU) AS REVISAO,
            rtrim(a.B1_CONTRAT) AS CONTRATO,
            rtrim(a.B1_MODELO) AS MODELO_PRODUTO,
            rtrim(a.B1_ZQEKBAM) AS KANBAN,
            rtrim(a.B1_POSIPI) AS NCM,
            rtrim(a.B1_PE) AS MRP_PRAZO_ENTREGA,
            rtrim(a.B1_DATREF) AS DATA_REFERENCIA,
            rtrim(a.B1_ZOHO) AS ZOHO,
            rtrim(a.B1_UREV) AS UREV,
            rtrim(a.B1_LOCZPA) AS MRP_LOCAL_PADRAO_DE_PRODUCAO,
            a.B1_ZDES,
            a.B1_FANTASM
        FROM SB1010 a
        INNER JOIN SBM010 b
            ON a.B1_GRUPO = b.BM_GRUPO
           AND b.D_E_L_E_T_ <> '*' AND b.BM_MSBLQL = '2'
        LEFT JOIN SBM010 b2
            ON b2.BM_GRUPO = LEFT(a.B1_GRUPO, 2)
           AND b2.D_E_L_E_T_ <> '*'
        WHERE a.D_E_L_E_T_ <> '*'
      `)

      const statusByCode = new Map<string, ProtheusProductStatus>()
      for (const row of result.recordset as { COD_PRODUTO: unknown; STD_BLOQ: unknown }[]) {
        const code = String(row.COD_PRODUTO ?? '').trim().toUpperCase()
        const status = String(row.STD_BLOQ ?? '').trim().toUpperCase()
        if (!code || (status !== 'ATIVO' && status !== 'BLOQUEADO')) continue
        statusByCode.set(code, status as ProtheusProductStatus)
      }

      productStatusCache = { statusByCode, fetchedAt: Date.now() }
      return productStatusCache
    } finally {
      await pool.close()
      productStatusInFlight = null
    }
  })()

  return productStatusInFlight
}

/**
 * ATIVO/BLOQUEADO status per product code (B1_COD), keyed by uppercased
 * trimmed code — used by the view-only Protheus flag column in Cadastro de
 * Equipamentos: green when ATIVO, strong red when BLOQUEADO, neutral when
 * the code isn't a registered product in Protheus at all.
 */
export async function listProductStatuses(creds: ProtheusCredentials): Promise<Map<string, ProtheusProductStatus>> {
  const { statusByCode } = await loadProductStatusCache(creds)
  return statusByCode
}
