import fs from 'fs'
import path from 'path'
import type { ExtractedCostRow } from './localCostExtract'

// Guarda os valores financeiros REAIS (capturados do CSV antes de virarem 1
// no Supabase — ver localCostExtract.ts) num arquivo JSON LOCAL, na mesma
// máquina onde o app está rodando. Nunca é enviado ao Supabase, nunca é
// commitado no Git (local-data/ está no .gitignore) — é puramente local a
// cada instalação. Único módulo do app que usa 'fs'; só pode ser importado
// por código que roda no servidor (rotas de API), nunca por um componente
// client.

const STORE_DIR = path.join(process.cwd(), 'local-data')
const STORE_PATH = path.join(STORE_DIR, 'real-costs.json')

export interface RealCostRow {
  label: string
  values: Record<string, number | null>
  updatedAt: string
}
export type RealCostTable = Record<string, RealCostRow> // chave de negócio -> linha
export type RealCostStore = Record<string, RealCostTable> // nome da tabela -> RealCostTable

export function readCostStore(): RealCostStore {
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf-8')
    return JSON.parse(raw) as RealCostStore
  } catch {
    return {} // arquivo ainda não existe (primeira vez) — vazio é um estado válido
  }
}

function writeCostStore(store: RealCostStore): void {
  fs.mkdirSync(STORE_DIR, { recursive: true })
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8')
}

// Chamado pela rota de import (Atualizador Global) logo depois de uma
// substituição bem-sucedida — troca TODA a tabela de custos daquela tabela
// pelo que acabou de vir do CSV nesse import, do mesmo jeito que
// global_table_replace apaga e recarrega a tabela real inteira (evita
// deixar valor "fantasma" de um item que saiu do CSV numa reimportação).
// Edições manuais feitas entre um import e outro (ver updateCostRow) são
// substituídas também — o CSV é sempre a fonte da verdade num reimport.
export function replaceTableCosts(tableName: string, rows: Record<string, ExtractedCostRow>): void {
  const store = readCostStore()
  const now = new Date().toISOString()
  const table: RealCostTable = {}
  for (const [key, row] of Object.entries(rows)) {
    table[key] = { label: row.label, values: row.values, updatedAt: now }
  }
  store[tableName] = table
  writeCostStore(store)
}

// Edição manual de UM valor, feita pela tela de Custos Reais (Local) — nunca
// chama o Supabase. Preserva os demais campos já guardados dessa linha.
export function updateCostRow(tableName: string, key: string, values: Record<string, number | null>): RealCostRow {
  const store = readCostStore()
  if (!store[tableName]) store[tableName] = {}
  const existing = store[tableName][key]
  const row: RealCostRow = {
    label: existing?.label ?? key,
    values: { ...(existing?.values ?? {}), ...values },
    updatedAt: new Date().toISOString(),
  }
  store[tableName][key] = row
  writeCostStore(store)
  return row
}
