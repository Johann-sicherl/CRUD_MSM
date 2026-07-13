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

/**
 * Recursively walks the ESTRUTURAS table starting from `protheusCode`:
 * for every COMPONENTE found under that ESTRUTURA, if the component is
 * itself the header of another structure, its components are pulled in
 * too — same result as the union of "2-Estruturas"/"FLAT-LIST" from the
 * manual Excel export, just fetched live. A visited-set guards against
 * cyclic BOM references.
 */
export async function fetchStructureCodes(protheusCode: string, creds: ProtheusCredentials): Promise<string[]> {
  const pool = new sql.ConnectionPool({
    ...CONNECTION_BASE,
    user: creds.user,
    password: creds.password,
  })

  try {
    await pool.connect()

    const visited = new Set<string>()
    const collected = new Set<string>()
    const queue: string[] = [protheusCode.trim()]

    while (queue.length > 0) {
      const current = (queue.shift() as string).trim()
      if (!current || visited.has(current)) continue
      visited.add(current)

      const result = await pool.request()
        .input('estrutura', sql.VarChar, current)
        .query('SELECT COMPONENTE FROM ESTRUTURAS WHERE ESTRUTURA = @estrutura')

      for (const row of result.recordset as { COMPONENTE: unknown }[]) {
        const componente = String(row.COMPONENTE ?? '').trim()
        if (!componente) continue
        collected.add(componente)
        if (!visited.has(componente)) queue.push(componente)
      }
    }

    return Array.from(collected)
  } finally {
    await pool.close()
  }
}
