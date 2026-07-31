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
 * visited-set guards against cyclic BOM references.
 *
 * The description shown alongside the code comes from DESCRICAO_PRODUTO
 * (SB1010, product master) rather than DESC_ESTRUTURA — not every
 * structure has a populated DESC_ESTRUTURA, while the product master
 * description is filled in far more consistently.
 */
export async function fetchStructureCodes(protheusCode: string, creds: ProtheusCredentials): Promise<{ codes: string[]; description: string | null; foundInProtheus: boolean }> {
  const [{ adjacency, descriptions }, description] = await Promise.all([
    loadStructureCache(creds),
    getProductDescription(protheusCode, creds),
  ])

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
    description,
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

export interface ProtheusProductInfo {
  status: ProtheusProductStatus
  description: string | null
}

interface ProductInfoCache {
  infoByCode: Map<string, ProtheusProductInfo>
  fetchedAt: number
}

let productInfoCache: ProductInfoCache | null = null
let productInfoInFlight: Promise<ProductInfoCache> | null = null

async function loadProductInfoCache(creds: ProtheusCredentials): Promise<ProductInfoCache> {
  if (productInfoCache && Date.now() - productInfoCache.fetchedAt < CACHE_TTL_MS) return productInfoCache
  if (productInfoInFlight) return productInfoInFlight

  productInfoInFlight = (async () => {
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

      const infoByCode = new Map<string, ProtheusProductInfo>()
      for (const row of result.recordset as { COD_PRODUTO: unknown; STD_BLOQ: unknown; DESCRICAO_PRODUTO: unknown }[]) {
        const code = String(row.COD_PRODUTO ?? '').trim().toUpperCase()
        const status = String(row.STD_BLOQ ?? '').trim().toUpperCase()
        if (!code || (status !== 'ATIVO' && status !== 'BLOQUEADO')) continue
        const description = String(row.DESCRICAO_PRODUTO ?? '').trim()
        infoByCode.set(code, { status: status as ProtheusProductStatus, description: description || null })
      }

      productInfoCache = { infoByCode, fetchedAt: Date.now() }
      return productInfoCache
    } finally {
      await pool.close()
      productInfoInFlight = null
    }
  })()

  return productInfoInFlight
}

/**
 * ATIVO/BLOQUEADO status per product code (B1_COD), keyed by uppercased
 * trimmed code — used by the view-only Protheus flag column in Cadastro de
 * Equipamentos: green when ATIVO, strong red when BLOQUEADO, neutral when
 * the code isn't a registered product in Protheus at all.
 */
export async function listProductStatuses(creds: ProtheusCredentials): Promise<Map<string, ProtheusProductStatus>> {
  const { infoByCode } = await loadProductInfoCache(creds)
  const statusByCode = new Map<string, ProtheusProductStatus>()
  for (const [code, info] of infoByCode) statusByCode.set(code, info.status)
  return statusByCode
}

/**
 * DESCRICAO_PRODUTO (B1_DESC) for a single product code, from the same
 * SB1010/SBM010 cache above — this is what Busc. Itens Série Estrut. shows
 * under each analyzed equipment's code, since not every structure has a
 * DESC_ESTRUTURA and the product master description is more consistently
 * populated.
 */
export async function getProductDescription(code: string, creds: ProtheusCredentials): Promise<string | null> {
  const { infoByCode } = await loadProductInfoCache(creds)
  return infoByCode.get(code.trim().toUpperCase())?.description ?? null
}

/**
 * Display name for a batch of codes — used by the EQUIPAMENTOS group in
 * Produtos Dependentes (see DependentItemsModal.tsx), which lists
 * protheus_code values straight from standard_equipment_items with no name
 * column of its own. Tries B1_DESC (SB1010 product master, keyed by
 * B1_COD) first, then falls back to DESC_ESTRUTURA (ESTRUTURAS); 'N/A' when
 * the code is found in neither.
 */
export async function getEquipmentItemNames(codes: string[], creds: ProtheusCredentials): Promise<Record<string, string>> {
  const [{ infoByCode }, { descriptions }] = await Promise.all([
    loadProductInfoCache(creds),
    loadStructureCache(creds),
  ])
  const names: Record<string, string> = {}
  for (const code of codes) {
    const trimmed = code.trim()
    const productDesc = infoByCode.get(trimmed.toUpperCase())?.description
    const structDesc = descriptions.get(trimmed)
    names[code] = productDesc || structDesc || 'N/A'
  }
  return names
}

// ─── Full BOM detail (Excel export) ─────────────────────────────────────
// Separate cache/query from everything above — feeds only the "Exportar
// Excel" button in Busc. Itens Série Estrut. and needs several columns
// (quantity, cost, unit, type, phantom flag) the existing ESTRUTURAS queries
// don't select. Kept fully isolated so it can't affect the BOM-resolution
// caches/logic already relied on by the rest of the page.

export interface BomLine {
  descEstrutura: string
  componente: string
  descComponente: string
  tipo: string
  unidade: string
  quant: number
  custoStd: number
  custoPond: number
  fantasma: string
}

interface BomDetailCache {
  byEstrutura: Map<string, BomLine[]>
  descByEstrutura: Map<string, string>
  fetchedAt: number
}

let bomDetailCache: BomDetailCache | null = null
let bomDetailInFlight: Promise<BomDetailCache> | null = null

// Values come from typed SQL Server numeric columns, not free-text Excel
// cells, so this only needs to cover the odd comma-decimal string — nothing
// like the VBA source macro's much heavier manual parsing is needed here.
function toNumberSafe(v: unknown): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0
  const n = parseFloat(String(v ?? '').trim().replace(',', '.'))
  return isNaN(n) ? 0 : n
}

async function loadBomDetailCache(creds: ProtheusCredentials): Promise<BomDetailCache> {
  if (bomDetailCache && Date.now() - bomDetailCache.fetchedAt < CACHE_TTL_MS) return bomDetailCache
  if (bomDetailInFlight) return bomDetailInFlight

  bomDetailInFlight = (async () => {
    const pool = new sql.ConnectionPool({
      ...CONNECTION_BASE,
      user: creds.user,
      password: creds.password,
      requestTimeout: BULK_LOAD_TIMEOUT_MS,
    })
    try {
      await pool.connect()
      const result = await pool.request().query(`
        SELECT ESTRUTURA, DESC_ESTRUTURA, COMPONENTE, DESC_COMPONENTE, B1_TIPO, UN, QUANT, CUSTO_STD, C_ULT_ENTRADA, FANTASMA
        FROM ESTRUTURAS
      `)

      const byEstrutura = new Map<string, BomLine[]>()
      const descByEstrutura = new Map<string, string>()
      for (const row of result.recordset as Record<string, unknown>[]) {
        const estrutura = String(row.ESTRUTURA ?? '').trim()
        const componente = String(row.COMPONENTE ?? '').trim()
        if (!estrutura || !componente) continue

        const descEstrutura = String(row.DESC_ESTRUTURA ?? '').trim()
        if (descEstrutura && !descByEstrutura.has(estrutura)) descByEstrutura.set(estrutura, descEstrutura)

        const line: BomLine = {
          descEstrutura,
          componente,
          descComponente: String(row.DESC_COMPONENTE ?? '').trim(),
          tipo: String(row.B1_TIPO ?? '').trim().toUpperCase(),
          unidade: String(row.UN ?? '').trim(),
          quant: toNumberSafe(row.QUANT),
          custoStd: toNumberSafe(row.CUSTO_STD),
          custoPond: toNumberSafe(row.C_ULT_ENTRADA),
          fantasma: String(row.FANTASMA ?? '').trim().toUpperCase(),
        }
        const list = byEstrutura.get(estrutura)
        if (list) list.push(line)
        else byEstrutura.set(estrutura, [line])
      }

      bomDetailCache = { byEstrutura, descByEstrutura, fetchedAt: Date.now() }
      return bomDetailCache
    } finally {
      await pool.close()
      bomDetailInFlight = null
    }
  })()

  return bomDetailInFlight
}

export interface ExplodedBomRow {
  estrutura: string
  descEstrutura: string
  nivel: number
  codigo: string
  denominacao: string
  qtd: number
  unidade: string
  tipo: string
  custoStd: number
  custoPond: number
  qtdTotal: number
  stdTotal: number
  pondTotal: number
  alerta: string
  codPaiDireto: string
}

/**
 * Faithful port of the legacy VBA DFS_Explode macro: walks the BOM tree from
 * `protheusCode` accumulating the quantity multiplier level by level (QTD
 * TOTAL = QTD × multiplicador acumulado do pai), flags lines with no cost
 * registered as "PRECIFICAR" (excluding phantom-structure and labor/PI-type
 * lines, same conditions as the source macro), and guards against cyclic
 * structures the same way the macro does: a node already in the current
 * root-to-here path is skipped, but the same node reached again via a
 * different branch is still explored normally (no cross-branch blocking).
 */
export async function explodeBomForExport(
  protheusCode: string,
  creds: ProtheusCredentials,
): Promise<{ rows: ExplodedBomRow[]; descEstrutura: string | null; found: boolean }> {
  const { byEstrutura, descByEstrutura } = await loadBomDetailCache(creds)
  const root = protheusCode.trim()
  const rootDesc = descByEstrutura.get(root) ?? null
  const rows: ExplodedBomRow[] = []

  const explode = (codPai: string, nivel: number, fator: number, path: Set<string>) => {
    const children = byEstrutura.get(codPai)
    if (!children || path.has(codPai)) return
    const nextPath = new Set(path)
    nextPath.add(codPai)

    for (const child of children) {
      const qtdTotal = child.quant * fator
      const stdTotal = qtdTotal * child.custoStd
      const pondTotal = qtdTotal * child.custoPond
      const alerta = (child.custoStd === 0 && child.custoPond === 0 && child.tipo !== 'PI' && child.tipo !== 'MO' && child.fantasma !== 'S')
        ? 'PRECIFICAR'
        : ''

      rows.push({
        estrutura: root,
        descEstrutura: rootDesc ?? '',
        nivel,
        codigo: child.componente,
        denominacao: child.descComponente,
        qtd: child.quant,
        unidade: child.unidade,
        tipo: child.tipo,
        custoStd: child.custoStd,
        custoPond: child.custoPond,
        qtdTotal,
        stdTotal,
        pondTotal,
        alerta,
        codPaiDireto: codPai,
      })

      explode(child.componente, nivel + 1, qtdTotal, nextPath)
    }
  }

  explode(root, 2, 1, new Set())
  return { rows, descEstrutura: rootDesc, found: byEstrutura.has(root) || descByEstrutura.has(root) }
}

// ─── BOM cost summary (Busc. Itens Série Estrut. card badges) ───────────
// Separate, narrower calculation from explodeBomForExport above: only counts
// cost from raw-material lines (B1_TIPO = 'MP') at ANY level, excluding
// phantom structures (FANTASMA = 'S') — this is deliberately not "every
// line, every level" (which double-counts: a sub-assembly's own CUSTO_STD
// already reflects its children's cost). Reuses the same BomDetailCache, no
// extra Protheus round trip beyond the one shared full-table load.

export interface BomCostSummary {
  custoStdTotal: number   // soma de QTD TOTAL × CUSTO_STD, só linhas MP não-fantasma
  custoPondTotal: number  // idem, usando C_ULT_ENTRADA
  hasMissingCost: boolean // alguma linha MP não-fantasma com custo (std ou última entrada) zerado
}

export async function calculateBomCost(protheusCode: string, creds: ProtheusCredentials): Promise<BomCostSummary> {
  const { byEstrutura } = await loadBomDetailCache(creds)
  const root = protheusCode.trim()

  let custoStdTotal = 0
  let custoPondTotal = 0
  let hasMissingCost = false

  const visit = (codPai: string, fator: number, path: Set<string>) => {
    const children = byEstrutura.get(codPai)
    if (!children || path.has(codPai)) return
    const nextPath = new Set(path)
    nextPath.add(codPai)

    for (const child of children) {
      const qtdTotal = child.quant * fator
      if (child.tipo === 'MP' && child.fantasma !== 'S') {
        custoStdTotal += qtdTotal * child.custoStd
        custoPondTotal += qtdTotal * child.custoPond
        if (child.custoStd === 0 || child.custoPond === 0) hasMissingCost = true
      }
      visit(child.componente, qtdTotal, nextPath)
    }
  }

  visit(root, 1, new Set())
  return { custoStdTotal, custoPondTotal, hasMissingCost }
}

// ─── Acessórios por equipamento (Busc. Avançada Acessórios) ─────────────
// Reuses the same BomDetailCache built for "Exportar Excel" above — no new
// Protheus query needed. The company's own hierarchy: a "26.xx" header is
// the top level (NIVEL 1, implicit — never itself reported); its direct
// children are NIVEL 2 (SubPA/Embalagens/Gastos Gerais); the children of
// THOSE are NIVEL 3 (the actual equipamento + its accessories, under the
// SubPA node, or the packaging's own raw materials, under the Embalagens
// node). Only these two levels are reported — nothing deeper, exactly as
// specified ("nível 1 é o próprio 26.xx.xxxxx... somente isso").
export interface AccessoryHierarchyRow {
  nivel: 2 | 3
  codigo: string
  denominacao: string
  qtd: number
  codPaiDireto: string
}

export interface AccessoryHierarchyGroup {
  estrutura: string
  descEstrutura: string
  rows: AccessoryHierarchyRow[]
}

export async function listAccessoryHierarchy(
  headerPrefixes: string[],
  nivel2Prefixes: string[],
  creds: ProtheusCredentials,
): Promise<AccessoryHierarchyGroup[]> {
  const { byEstrutura, descByEstrutura } = await loadBomDetailCache(creds)

  const normHeaderPrefixes = headerPrefixes.map(p => p.trim().toUpperCase()).filter(Boolean)
  const normNivel2Prefixes = nivel2Prefixes.map(p => p.trim().toUpperCase()).filter(Boolean)
  if (normHeaderPrefixes.length === 0) return []

  const headers = Array.from(byEstrutura.keys())
    .filter(code => normHeaderPrefixes.some(p => code.toUpperCase().startsWith(p)))
    .sort((a, b) => a.localeCompare(b))

  const groups: AccessoryHierarchyGroup[] = []
  for (const estrutura of headers) {
    const rows: AccessoryHierarchyRow[] = []
    const nivel2Lines = byEstrutura.get(estrutura) || []
    for (const nivel2 of nivel2Lines) {
      if (!nivel2.componente) continue
      rows.push({ nivel: 2, codigo: nivel2.componente, denominacao: nivel2.descComponente, qtd: nivel2.quant, codPaiDireto: estrutura })

      // Only descend into NIVEL 3 for a NIVEL 2 node whose own código matches
      // one of nivel2Prefixes (default "27.13", the SubPA branch) — other
      // NIVEL 2 nodes (Embalagens, Gastos Gerais, or any other structure
      // that happens to have its own sub-BOM in Protheus) are still listed,
      // but not expanded, so an unrelated sub-structure never leaks in as
      // unwanted NIVEL 3 rows.
      if (normNivel2Prefixes.length > 0 && !normNivel2Prefixes.some(p => nivel2.componente.toUpperCase().startsWith(p))) continue

      const nivel3Lines = byEstrutura.get(nivel2.componente) || []
      for (const nivel3 of nivel3Lines) {
        if (!nivel3.componente) continue
        rows.push({ nivel: 3, codigo: nivel3.componente, denominacao: nivel3.descComponente, qtd: nivel3.quant, codPaiDireto: nivel2.componente })
      }
    }
    if (rows.length === 0) continue
    groups.push({
      estrutura,
      descEstrutura: descByEstrutura.get(estrutura) ?? '',
      rows,
    })
  }

  return groups
}
