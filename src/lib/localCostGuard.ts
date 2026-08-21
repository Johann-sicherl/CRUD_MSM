import { FORCE_TO_ONE_FIELDS, getRealColumnFields, type TableSchema } from './schema'
import { isBlankCell, toCellValue } from './globalUpdateConvert'
import { costBucketFor, getCostItemKey } from './csvBaseline'
import { readCostStore, updateCostRow } from './localCostStore'

// Fecha, para os caminhos de escrita registro-a-registro (POST /api/[table]
// e PUT /api/[table]/[id] — usados por "+ Novo Registro", "Importar Excel",
// os modais de Não Combináveis/Dependentes e o formulário de edição), a
// mesma garantia que o Atualizador Global já tem via convertCsvRows: nenhum
// valor financeiro real (FORCE_TO_ONE_FIELDS) chega ao Supabase — vai
// sempre 1, e o valor real (se houver) é gravado só no arquivo local
// (ver localCostStore.ts). Melhor esforço: nunca deve derrubar a operação
// real por causa de um problema aqui (ex.: disco cheio).
//
// Exceção deliberada: ZERO não é segredo. Um cadastro novo (Engenharia do
// Produto) sem custo/percentual definido ainda é exatamente o estado que
// Controladoria/Fiscal/Precificação precisa conseguir filtrar no Supabase —
// então 0 vai pro banco como 0 mesmo, sem virar 1. Só um valor DIFERENTE de
// zero é tratado como segredo de verdade (forçado a 1, guardado só
// localmente). Todos os FORCE_TO_ONE_FIELDS têm default 0 e NOT NULL no
// schema, então "em branco" e "0 explícito" significam a mesma coisa aqui.

/** POST — linha nova: qualquer valor numérico ≠0 enviado pelo cliente num
 *  campo financeiro é "real" por definição (a linha não existia antes) — vira
 *  1 no Supabase e é capturado localmente. Um campo deixado em branco/0 vai
 *  como 0 mesmo. Muta `writeBody` in-place; `writeBody` já deve ter todos os
 *  campos-chave resolvidos (inclusive autoIncrement, se houver) antes de
 *  chamar esta função, pra chave de linha ficar correta. */
export function protectLocalCostsOnInsert(
  table: string,
  schema: TableSchema,
  writeBody: Record<string, unknown>,
  rawBody: Record<string, unknown>,
): void {
  const forceFields = getRealColumnFields(schema).filter(f => FORCE_TO_ONE_FIELDS.includes(f.name))
  if (forceFields.length === 0) return
  try {
    const key = getCostItemKey(table, schema, writeBody)
    const values: Record<string, number | null> = {}
    let hasAny = false
    for (const field of forceFields) {
      const raw = rawBody[field.name]
      const v = isBlankCell(raw) ? null : toCellValue(field, raw)
      if (typeof v === 'number' && v !== 0) {
        values[field.name] = v
        hasAny = true
        writeBody[field.name] = 1
      } else {
        writeBody[field.name] = 0
      }
    }
    if (hasAny && key) updateCostRow(table, key, values)
  } catch (e) {
    console.error(`[local-costs] falha ao proteger custos reais de "${table}" (insert)`, e)
  }
}

/** PUT — edição: só trata como "valor real novo" o campo cujo valor
 *  enviado difere do que já estava guardado como real no arquivo local —
 *  NUNCA compara contra o que está no Supabase (beforeRow), que pra estes
 *  campos é sempre 1 (valor real escondido) ou 0 (nenhum valor real ainda) e
 *  portanto quase sempre "diferente" do valor real, mesmo quando ninguém
 *  tocou nesse campo (ex.: RecordModal resubmete o valor pré-preenchido
 *  mesmo que o usuário só tenha mudado o nome).
 *
 *  Três casos por campo:
 *  - Em branco (isBlankCell): esta máquina pode não ter o valor real
 *    capturado localmente pra pré-preencher o formulário (ex.: perfil
 *    diferente do que capturou originalmente) — resubmeter em branco não é
 *    uma intenção de mexer no campo. Tira o campo do UPDATE inteiramente,
 *    preservando o que já está gravado no Supabase (seja 1 ou 0).
 *  - 0 explícito: não é segredo — é a "chave" que Controladoria/Fiscal/
 *    Precificação usa pra filtrar cadastros ainda sem custo real definido.
 *    Vai como 0 mesmo pro Supabase, sem forçar 1, e não é capturado
 *    localmente (não há nada de real pra proteger).
 *  - Qualquer outro número: valor real de verdade — protegido como sempre
 *    (força 1 no Supabase, captura local só se realmente mudou).
 *
 *  Devolve os nomes dos campos cujo valor real de fato mudou — o Supabase
 *  não reflete essa mudança quando os dois lados já eram um segredo (fica
 *  sempre 1), então quem chama usa essa lista pra registrar a edição na
 *  Auditoria de Queries mesmo assim (ver recordUpdateAudit/
 *  forceIncludeFields), senão essa troca de segredo por outro segredo não
 *  gera pendência nenhuma lá. */
export function protectLocalCostsOnUpdate(
  table: string,
  schema: TableSchema,
  writeBody: Record<string, unknown>,
  rawBody: Record<string, unknown>,
  beforeRow: Record<string, unknown> | null,
): string[] {
  const forceFields = getRealColumnFields(schema).filter(f => FORCE_TO_ONE_FIELDS.includes(f.name) && f.name in writeBody)
  if (forceFields.length === 0) return []
  try {
    const fullRow = { ...(beforeRow ?? {}), ...writeBody }
    const key = getCostItemKey(table, schema, fullRow)
    const existingRealValues = readCostStore()[costBucketFor(table)]?.[key]?.values ?? {}
    const values: Record<string, number | null> = {}
    let hasAny = false
    for (const field of forceFields) {
      const raw = rawBody[field.name]
      if (isBlankCell(raw)) {
        delete writeBody[field.name]
        continue
      }
      const newVal = toCellValue(field, raw)
      if (newVal === 0) {
        writeBody[field.name] = 0
        continue
      }
      const prevRealVal = existingRealValues[field.name] // undefined = nunca capturado antes
      if (typeof newVal === 'number' && prevRealVal !== newVal) {
        values[field.name] = newVal
        hasAny = true
      }
      writeBody[field.name] = 1
    }
    if (hasAny && key) updateCostRow(table, key, values)
    return Object.keys(values)
  } catch (e) {
    console.error(`[local-costs] falha ao proteger custos reais de "${table}" (update)`, e)
    return []
  }
}
