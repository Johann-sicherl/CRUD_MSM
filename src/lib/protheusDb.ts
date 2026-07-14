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
// into an in-memory adjacency map, cached for a while, and every structure
// resolution afterwards walks that map in memory — zero further DB round
// trips per analysis.
interface AdjacencyCache {
  adjacency: Map<string, string[]>
  fetchedAt: number
}

let cache: AdjacencyCache | null = null
let inFlight: Promise<Map<string, string[]>> | null = null

const CACHE_TTL_MS = 30 * 60 * 1000 // BOM data changes rarely enough that a 30min-old cache is still safe to reuse.
const BULK_LOAD_TIMEOUT_MS = 120000 // the one full-table pull is allowed to run much longer than a normal query.

async function loadAdjacency(creds: ProtheusCredentials): Promise<Map<string, string[]>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.adjacency
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
        .query('SELECT ESTRUTURA, COMPONENTE FROM ESTRUTURAS')

      const adjacency = new Map<string, string[]>()
      for (const row of result.recordset as { ESTRUTURA: unknown; COMPONENTE: unknown }[]) {
        const estrutura = String(row.ESTRUTURA ?? '').trim()
        const componente = String(row.COMPONENTE ?? '').trim()
        if (!estrutura || !componente) continue
        const children = adjacency.get(estrutura)
        if (children) children.push(componente)
        else adjacency.set(estrutura, [componente])
      }

      cache = { adjacency, fetchedAt: Date.now() }
      return adjacency
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
 * against the in-memory adjacency map (see loadAdjacency above); a
 * visited-set guards against cyclic BOM references.
 */
export async function fetchStructureCodes(protheusCode: string, creds: ProtheusCredentials): Promise<string[]> {
  const adjacency = await loadAdjacency(creds)

  const visited = new Set<string>()
  const collected = new Set<string>()
  const queue: string[] = [protheusCode.trim()]

  while (queue.length > 0) {
    const current = (queue.shift() as string).trim()
    if (!current || visited.has(current)) continue
    visited.add(current)

    for (const componente of adjacency.get(current) || []) {
      collected.add(componente)
      if (!visited.has(componente)) queue.push(componente)
    }
  }

  return Array.from(collected)
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
  const adjacency = await loadAdjacency(creds)
  const normalizedPrefixes = prefixes.map(p => p.trim().toUpperCase()).filter(Boolean)
  if (normalizedPrefixes.length === 0) return []

  return Array.from(adjacency.keys())
    .filter(code => normalizedPrefixes.some(p => code.toUpperCase().startsWith(p)))
    .sort((a, b) => a.localeCompare(b))
}
