import { supabaseAdmin } from './supabase'
import { listProductStatuses, listStructureHeaders, fetchStructureCodes, type ProtheusCredentials } from './protheusDb'
import { fetchPdmAccessories, type PdmCredentials } from './pdmDb'
import { comparePdmWithSupabase } from './pdmCompare'
import { readStructurePropertyRules } from './structurePropertyRules'
import { computeStructurePropertyResults } from './structurePropertyMatch'
import { tables } from './schema'
import { REVERSE_SEARCH_GROUPS, PDM_COMPARE_GROUPS } from './appDiagnosticsGroups'

// Diagnóstico da Aplicação — pedido explícito do usuário: um pop-up que
// roda sozinho na primeira abertura do app (ou depois de uma atualização,
// ver AppDiagnosticsGate.tsx) e varre a base procurando inconsistências que
// o usuário precisa saber de cara, sem precisar abrir tela por tela. Cada
// checagem vira uma "seção" (uma tabela) no pop-up — pensado pra crescer:
// hoje só tem a primeira, mais podem ser adicionadas em CHECKS abaixo, sem
// mexer no pop-up nem no gatilho.

// Uma linha da tabela Propriedade/Valor Esperado/Código(s) que Geraram/
// Valor no Banco já usada por Busc. Itens Série Estrut. Protheus — pedido
// explícito do usuário: "quando eu clico no equipamento ele me mostra os
// erro dele" (numa caixinha própria por equipamento, ver
// AppDiagnosticsPopup.tsx). Guardado estruturado (não só uma frase
// concatenada em `message`) pra UI poder renderizar a mesma mini-tabela da
// tela viva.
export interface DiagnosticIssueDetail {
  property: string
  expected: string | null
  via: string
  dbValue: string | null
}

export interface DiagnosticIssue {
  rowLabel: string
  message: string
  // Só usado por checagens que precisam separar os resultados em blocos
  // dentro do mesmo dropdown (ex. Busca Reversa — pedido explícito do
  // usuário: "faça a separação dos equipamentos por 'Blocos', assim, o
  // que está errado, que eu veja"). Ausente = sem agrupamento, lista única
  // (as duas checagens de status Protheus continuam assim). Ver
  // GROUP_ORDER/GROUP_TONE em AppDiagnosticsPopup.tsx para ordem e cor.
  group?: string
  // Quando presente, a UI renderiza cada equipamento como uma caixinha
  // própria (clicável, "mostra os erro dele" ao expandir) com esta tabela
  // em vez de só o texto de `message`. Ausente = a caixinha, se houver,
  // mostra só `message` ao expandir.
  details?: DiagnosticIssueDetail[]
}

export interface DiagnosticSection {
  key: string
  tableLabel: string
  // 'problems' (default) — seção vermelha esmaecida quando issues.length>0,
  // "sem erros" quando vazia (as duas checagens de status Protheus abaixo).
  // 'summary' — inventário informativo (ex.: Busca Reversa), nunca fica
  // vermelha só por ter itens; ver AppDiagnosticsPopup.tsx.
  mode?: 'problems' | 'summary'
  issues: DiagnosticIssue[]
}

// Credencial combinada — Protheus é sempre exigida pra abrir o pop-up (ver
// AppDiagnosticsGate.tsx), PDM é opcional: a checagem #4 (Consulta PDM x
// Banco MSM) só roda de verdade se o Admin já tiver conectado ao PDM nesta
// sessão (a conexão é oferecida automaticamente logo depois do Protheus,
// mas exige um passo à parte — ver pdmAuthContext.tsx); se ainda não
// conectou no exato momento em que o pop-up dispara, a seção reporta isso
// de forma transparente em vez de travar o diagnóstico inteiro ou fingir
// que rodou.
export interface DiagnosticsCredentials {
  protheus: ProtheusCredentials
  pdm: PdmCredentials | null
}

type Check = {
  key: string
  tableLabel: string
  mode?: 'problems' | 'summary'
  run: (creds: DiagnosticsCredentials) => Promise<DiagnosticIssue[]>
}

// Regra compartilhada, pedido explícito do usuário — primeiro pra Cadastro
// de Equipamentos (standard_equipment_items), depois replicada tal e qual
// pra Cadastro de Componentes (accessories): "analisando se tem algo
// bloqueado no Protheus... e com STATUS igual active, sempre que tiver
// bolinha vermelha tem que estar deactive." Mesma fonte de status (SB1010,
// ATIVO/BLOQUEADO) que já alimenta a "bolinha" de DataTable.tsx
// (getProtheusStatus) — reaproveitada aqui, sem query nova ao Protheus além
// da já existente em listProductStatuses. As duas tabelas têm exatamente a
// mesma forma (protheus_code + status com opções active/deactive), por
// isso uma função genérica em vez de duplicar a lógica por tabela.
function checkProtheusStatusVsActive(tableName: string, tableLabel: string) {
  return async (creds: DiagnosticsCredentials): Promise<DiagnosticIssue[]> => {
    const { data, error } = await supabaseAdmin
      .from(tableName)
      .select('protheus_code, status')
      .range(0, 24999)
    if (error) throw new Error(`Falha ao ler ${tableLabel}: ${error.message}`)

    const statusByCode = await listProductStatuses(creds.protheus)

    const issues: DiagnosticIssue[] = []
    for (const row of (data || [])) {
      const code = String(row.protheus_code ?? '').trim().toUpperCase()
      if (!code) continue
      const protheusStatus = statusByCode.get(code)
      if (protheusStatus === 'BLOQUEADO' && row.status === 'active') {
        issues.push({
          rowLabel: `Código Protheus: ${code}`,
          message: 'BLOQUEADO no Protheus, mas o Status aqui está "Ativo" — deveria estar "Inativo".',
        })
      }
    }
    return issues
  }
}

// Busca Reversa (Protheus) 27.04 / 27.03 — pedido explícito do usuário:
// "faça uma pesquisa que é realizada em Busc. Itens Série Estrut. Protheus,
// Busca Reversa (Protheus) 27.04, 27.03, e me dê um resumo de todas as
// estruturas encontradas." Mesma função (`listStructureHeaders`,
// `protheusDb.ts`) e os mesmos prefixos que já vêm pré-preenchidos por
// padrão nesse campo da tela (`analisador-estruturas/page.tsx`,
// `reversePrefixInput`) — nenhuma lógica de busca nova, só reaproveitada
// aqui pro pop-up. Diferente das duas checagens acima, esta não é
// "problema vs sem erros" — o usuário pediu um resumo de **todas** as
// estruturas encontradas, cadastradas ou não, por isso `mode: 'summary'`:
// toda estrutura encontrada vira uma linha (nunca fica vermelho esmaecido
// só por ter itens — ver AppDiagnosticsPopup.tsx).
//
// Rodada seguinte, pedido explícito do usuário: além de cadastrado/não
// cadastrado, também listar os "N erro(s)" de propriedade de cada
// estrutura — o mesmo flag e a mesma tabela (Propriedade/Valor Esperado/
// Código(s) que Geraram/Valor no Banco/Status) que já existem por código
// na tela viva. Reaproveita `fetchStructureCodes` (explosão da árvore de
// componentes) + `computeStructurePropertyResults` (`structurePropertyMatch.ts`,
// o mesmo motor de comparação usado por /api/analisador-estruturas e por
// R090 de Inteligência do Produto) — nenhuma lógica de comparação nova.
// Só roda a explosão de estrutura (o passo caro) pras estruturas que JÁ
// estão cadastradas — sem uma linha em Cadastro de Equipamentos não há
// "valor no banco" nenhum pra comparar, então o custo é evitado à toa.
// Decisão confirmada com o usuário: aceitar que esta seção demore mais que
// as outras duas (sem limite de quantidade de estruturas analisadas).
const REVERSE_SEARCH_PREFIXES = ['27.04', '27.03']

function structurePropertyFieldLabel(fieldName: string): string {
  return tables.standard_equipment_items.fields.find(f => f.name === fieldName)?.label ?? fieldName
}

async function checkReverseSearchStructures(creds: DiagnosticsCredentials): Promise<DiagnosticIssue[]> {
  const headers = await listStructureHeaders(REVERSE_SEARCH_PREFIXES, creds.protheus)
  if (headers.length === 0) return []

  const { data, error } = await supabaseAdmin
    .from('standard_equipment_items')
    .select('*')
    .range(0, 24999)
  if (error) throw new Error(`Falha ao ler Cadastro de Equipamentos: ${error.message}`)

  const rowByCode = new Map<string, Record<string, unknown>>()
  for (const row of (data || [])) {
    const code = String(row.protheus_code ?? '').trim().toUpperCase()
    if (code) rowByCode.set(code, row)
  }

  const rules = readStructurePropertyRules()

  const issues: DiagnosticIssue[] = []
  for (const rawCode of headers) {
    const code = rawCode.trim().toUpperCase()
    const equipmentRow = rowByCode.get(code)

    if (!equipmentRow) {
      issues.push({ rowLabel: code, message: 'NÃO cadastrado em Cadastro de Equipamentos.', group: REVERSE_SEARCH_GROUPS.notRegistered })
      continue
    }

    const { codes: componentCodes } = await fetchStructureCodes(code, creds.protheus)
    const mismatches = computeStructurePropertyResults(new Set(componentCodes), equipmentRow, rules)
      .filter(r => r.status === 'mismatch')

    if (mismatches.length === 0) {
      issues.push({ rowLabel: code, message: 'Sem erros de propriedade.', group: REVERSE_SEARCH_GROUPS.ok })
      continue
    }

    const details: DiagnosticIssueDetail[] = mismatches.map(m => ({
      property: structurePropertyFieldLabel(m.field),
      expected: m.computedValue,
      via: m.matched.map(x => `${x.code} → ${x.value}`).join(', '),
      dbValue: m.dbValue,
    }))
    issues.push({
      rowLabel: code,
      message: `${mismatches.length} erro(s) de propriedade.`,
      group: REVERSE_SEARCH_GROUPS.errors,
      details,
    })
  }
  return issues
}

// Consulta PDM x Banco MSM — pedido explícito do usuário: "traga a análise
// de Consulta PDM x Banco MSM... mesmo estilo, linha a linha, caixa a
// caixa, segundo código a código. Separe grupo também por dropdown" — as
// mesmas 4 categorias da tela viva (pdm-consulta-acessorios/page.tsx):
// OK, Divergentes, Só no PDM, Só no Banco MSM. Reaproveita
// `comparePdmWithSupabase`/`PDM_FIELD_MAP` (pdmCompare.ts) e
// `fetchPdmAccessories` (pdmDb.ts) tal e qual — nenhuma lógica de
// comparação nova, mesmo padrão de reuso já estabelecido nas checagens
// acima. Fonte Supabase é só `accessories` (mesma tabela que a tela viva
// usa do lado do banco MSM — accessory_groups ali é só pra rótulo de
// grupo, não entra na comparação em si).
//
// PDM é uma conexão à parte do Protheus (ver pdmAuthContext.tsx).
// `AppDiagnosticsGate.tsx` só dispara o pop-up depois que os DOIS já
// conectaram (pedido explícito do usuário — ver comentário lá), então na
// prática `pdm` sempre chega preenchido aqui. O branch `!pdm` abaixo é só
// defesa (o parâmetro é opcional no tipo porque `runPdmDiagnosticSection`
// também pode ser chamada isoladamente) — reporta um aviso informativo em
// vez de lançar erro, mesmo espírito "best-effort, nunca trava o resto"
// já usado em runAppDiagnostics abaixo.
//
// Recebe só `pdm` (não `DiagnosticsCredentials` inteiro) de propósito —
// esta é a única checagem que também precisa rodar sozinha, fora do loop
// de CHECKS, quando o PDM conecta depois do pop-up já ter rodado (ver
// runPdmDiagnosticSection/AppDiagnosticsGate.tsx) — sem isso precisaria
// inventar um ProtheusCredentials vazio só pra montar o objeto combinado.
async function checkPdmVsSupabase(pdm: PdmCredentials | null): Promise<DiagnosticIssue[]> {
  if (!pdm) {
    return [{
      rowLabel: '—',
      message: 'PDM não conectado nesta sessão — conecte ao Banco PDM (oferecido após o Protheus) para incluir esta checagem.',
    }]
  }

  const pdmRows = await fetchPdmAccessories(pdm)

  const { data, error } = await supabaseAdmin
    .from('accessories')
    .select('*')
    .range(0, 24999)
  if (error) throw new Error(`Falha ao ler Cadastro de Componentes: ${error.message}`)

  const comparison = comparePdmWithSupabase(pdmRows, data || [])

  const issues: DiagnosticIssue[] = []
  for (const row of comparison) {
    if (row.status === 'ok') {
      issues.push({ rowLabel: row.protheusCode, message: 'Sem divergência.', group: PDM_COMPARE_GROUPS.ok })
      continue
    }
    if (row.status === 'mismatch') {
      const details: DiagnosticIssueDetail[] = row.diffs.map(d => ({
        property: d.label,
        expected: d.pdmDisplay,
        via: 'PDM',
        dbValue: d.supabaseDisplay,
      }))
      issues.push({
        rowLabel: row.protheusCode,
        message: `${row.diffs.length} campo(s) divergente(s).`,
        group: PDM_COMPARE_GROUPS.mismatch,
        details,
      })
      continue
    }
    if (row.status === 'pdm-only') {
      issues.push({ rowLabel: row.protheusCode, message: 'Existe no PDM, não cadastrado em Cadastro de Componentes.', group: PDM_COMPARE_GROUPS.pdmOnly })
      continue
    }
    issues.push({ rowLabel: row.protheusCode, message: 'Cadastrado em Cadastro de Componentes, não encontrado no PDM.', group: PDM_COMPARE_GROUPS.supabaseOnly })
  }
  return issues
}

// Chave/rótulo da Checagem #4 extraídos em constantes — reusados tanto no
// registro em CHECKS quanto em runPdmDiagnosticSection (re-execução
// avulsa, abaixo), pra nunca divergir entre os dois.
const PDM_CHECK_KEY = 'pdm_vs_supabase'
const PDM_CHECK_LABEL = 'Consulta PDM x Banco MSM'

const CHECKS: Check[] = [
  { key: 'standard_equipment_items', tableLabel: 'Cadastro de Equipamentos', run: checkProtheusStatusVsActive('standard_equipment_items', 'Cadastro de Equipamentos') },
  { key: 'accessories', tableLabel: 'Cadastro de Componentes', run: checkProtheusStatusVsActive('accessories', 'Cadastro de Componentes') },
  { key: 'reverse_search_27_04_27_03', tableLabel: 'Busca Reversa (Protheus) 27.04 / 27.03', mode: 'summary', run: checkReverseSearchStructures },
  { key: PDM_CHECK_KEY, tableLabel: PDM_CHECK_LABEL, mode: 'summary', run: creds => checkPdmVsSupabase(creds.pdm) },
]

// Roda uma checagem (já resolvida pra uma função sem argumento) e embrulha
// o resultado (ou a falha) na seção pronta pro pop-up — nível mais baixo
// que `runCheck` abaixo, pra `runPdmDiagnosticSection` conseguir reusar o
// mesmo try/catch sem precisar montar um `DiagnosticsCredentials`
// (Protheus) só pra satisfazer um parâmetro que a Checagem #4, rodando
// sozinha, nunca usa.
async function runCheckResult(key: string, tableLabel: string, mode: 'problems' | 'summary' | undefined, run: () => Promise<DiagnosticIssue[]>): Promise<DiagnosticSection> {
  try {
    const issues = await run()
    return { key, tableLabel, mode, issues }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido ao rodar esta checagem'
    // Uma falha ao rodar a checagem é sempre tratada como problema (modo
    // padrão 'problems'), mesmo numa checagem 'summary' — o usuário
    // precisa ver que algo deu errado, não que "não achou nada".
    return { key, tableLabel, issues: [{ rowLabel: '—', message }] }
  }
}

function runCheck(check: Check, creds: DiagnosticsCredentials): Promise<DiagnosticSection> {
  return runCheckResult(check.key, check.tableLabel, check.mode, () => check.run(creds))
}

// Roda todas as checagens registradas, em sequência (não Promise.all — uma
// falha isolada numa checagem não deve impedir as outras de rodar; o erro
// vira uma seção com um único "issue" descrevendo a falha, em vez de
// derrubar o diagnóstico inteiro).
export async function runAppDiagnostics(creds: DiagnosticsCredentials): Promise<DiagnosticSection[]> {
  const sections: DiagnosticSection[] = []
  for (const check of CHECKS) {
    sections.push(await runCheck(check, creds))
  }
  return sections
}

// Re-executa só a Checagem #4 — pedido explícito do usuário: "faz o PDM
// re-rodar sozinho quando conectar". Como o PDM conecta bem depois do
// Protheus (passo à parte do Admin, ver checkPdmVsSupabase acima), o
// pop-up normalmente já disparou (e já rodou as outras 3 checagens) antes
// do PDM ficar disponível — reexecutar o diagnóstico inteiro só por causa
// do PDM refaria trabalho que não mudou (Protheus/Busca Reversa não
// dependem do PDM). AppDiagnosticsGate.tsx chama isto assim que o PDM
// conecta e substitui só a seção correspondente no pop-up já aberto, pelo
// key (PDM_CHECK_KEY) — sem passar por CHECKS/runAppDiagnostics de novo.
export async function runPdmDiagnosticSection(pdm: PdmCredentials): Promise<DiagnosticSection> {
  return runCheckResult(PDM_CHECK_KEY, PDM_CHECK_LABEL, 'summary', () => checkPdmVsSupabase(pdm))
}
