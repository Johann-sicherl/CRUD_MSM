// Suporte à tela "Double-check de Queries" — cada uma destas tabelas tem
// uma cópia estrutural idêntica (mesmos tipos, PK/UNIQUE/CHECK, índices e
// foreign keys, _check -> _check) criada por msm_query_double_check.sql.
// Lista fechada e explícita (não "toda tabela com auditQueries") — pedido
// do usuário: só estas 9, na íntegra.
export const DOUBLE_CHECK_TABLES = [
  'accessories',
  'accessory_groups',
  'dependant_items',
  'equipments',
  'general_alerts',
  'non_combinable_comps',
  'relationship_equip_accessory',
  'roller_tables',
  'standard_equipment_items',
] as const

export type DoubleCheckTable = typeof DOUBLE_CHECK_TABLES[number]

const DOUBLE_CHECK_TABLE_SET = new Set<string>(DOUBLE_CHECK_TABLES)

export function isDoubleCheckTable(table: string): table is DoubleCheckTable {
  return DOUBLE_CHECK_TABLE_SET.has(table)
}

// Ordem de import por dependência de FK (ver msm_query_double_check.sql,
// passo 2) — pais (equipments/accessory_groups) sempre antes dos filhos que
// referenciam eles. DOUBLE_CHECK_TABLES acima é só a whitelist (ordem
// alfabética, não serve pra isso) — rodar o "Gravar em lote" na ordem de
// seleção do arquivo já causou erro real: standard_equipment_items/
// roller_tables/relationship_equip_accessory/non_combinable_comps rodaram
// antes de equipments (o usuário selecionou os arquivos fora de ordem) e
// todo INSERT deu "violates foreign key constraint ... is not present in
// table equipments_check", porque a linha pai ainda não existia na cópia
// _check no momento do INSERT do filho.
export const DOUBLE_CHECK_IMPORT_ORDER: DoubleCheckTable[] = [
  'accessory_groups',
  'equipments',
  'general_alerts',
  'accessories',
  'dependant_items',
  'non_combinable_comps',
  'relationship_equip_accessory',
  'roller_tables',
  'standard_equipment_items',
]

// As instruções vêm de src/lib/sqlAudit.ts (buildInsertSQL/buildUpdateSQL/
// buildDeleteSQL) — sempre no formato "INSERT INTO tabela (...", "UPDATE
// tabela SET ...", "DELETE FROM tabela WHERE ...", nunca digitadas à mão.
// Por isso é seguro pegar só o primeiro token de tabela (logo depois da
// palavra-chave, no início da instrução) e trocar por "<tabela>_check" — a
// mesma trava (tabela tem que estar na whitelist) é conferida de novo
// dentro da função Postgres (run_query_double_check), então um bug aqui
// nunca chega a tocar a tabela real.
const STATEMENT_TABLE_RE = /^\s*(INSERT INTO|UPDATE|DELETE FROM)\s+"?(\w+)"?/i

export interface RewrittenStatement {
  original: string
  rewritten: string | null // null = não reescrito (tabela não reconhecida/sem cópia _check)
  table: string | null
}

export function rewriteStatementForCheck(sql: string): RewrittenStatement {
  const match = sql.match(STATEMENT_TABLE_RE)
  const table = match?.[2] ?? null
  if (!table || !isDoubleCheckTable(table)) {
    return { original: sql, rewritten: null, table }
  }
  const rewritten = sql.replace(STATEMENT_TABLE_RE, (_full, keyword: string) => `${keyword} ${table}_check`)
  return { original: sql, rewritten, table }
}

// Um .txt exportado da Auditoria (ver auditoria/page.tsx, runTxtExport) é
// uma instrução SQL por linha, cada uma já terminando em ";" — mesmo texto
// que "Copiar"/"Copiar todas" produzem.
export function parseSqlStatementsFromText(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
}
