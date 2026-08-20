import fs from 'fs'
import path from 'path'
import type { ExtractedCostRow } from './localCostExtract'
import { costBucketFor, SHARED_ITEM_COST_TABLES } from './csvBaseline'

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

// Chamado pela rota de import (Atualizador Global e Importador de Custos
// Locais) logo depois de uma substituição bem-sucedida. Para uma tabela com
// bucket próprio (equipments, ou qualquer tabela nova fora do grupo
// compartilhado) troca TODO o bucket pelo que acabou de vir do CSV — do
// mesmo jeito que global_table_replace apaga e recarrega a tabela real
// inteira (evita valor "fantasma" de um item que saiu do CSV). Já para
// accessories/standard_equipment_items/dependant_items — que dividem o
// bucket "items" (ver costBucketFor em csvBaseline.ts) — um replace total
// apagaria os códigos capturados pelas OUTRAS duas tabelas, então aqui é
// upsert: só grava/atualiza os códigos que vieram nesta importação,
// preservando o resto do bucket compartilhado.
export function replaceTableCosts(tableName: string, rows: Record<string, ExtractedCostRow>): void {
  const store = readCostStore()
  const now = new Date().toISOString()
  const bucket = costBucketFor(tableName)
  const table: RealCostTable = SHARED_ITEM_COST_TABLES.has(tableName) ? { ...(store[bucket] ?? {}) } : {}
  for (const [key, row] of Object.entries(rows)) {
    table[key] = { label: row.label, values: row.values, updatedAt: now }
  }
  store[bucket] = table
  writeCostStore(store)
}

// Edição manual de UM valor, feita pela tela de Custos Reais (Local) — nunca
// chama o Supabase. Preserva os demais campos já guardados dessa linha.
export function updateCostRow(tableName: string, key: string, values: Record<string, number | null>): RealCostRow {
  const store = readCostStore()
  const bucket = costBucketFor(tableName)
  if (!store[bucket]) store[bucket] = {}
  const existing = store[bucket][key]
  const row: RealCostRow = {
    label: existing?.label ?? key,
    values: { ...(existing?.values ?? {}), ...values },
    updatedAt: new Date().toISOString(),
  }
  store[bucket][key] = row
  writeCostStore(store)
  return row
}
