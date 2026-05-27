import { Pool } from 'pg'

const globalForPg = globalThis as unknown as { _pgPool?: Pool }

if (!globalForPg._pgPool) {
  globalForPg._pgPool = new Pool({
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    database: process.env.DATABASE_NAME || 'msm',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || '',
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  })
}

export const pool = globalForPg._pgPool
