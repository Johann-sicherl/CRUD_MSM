import { supabaseAdmin } from './supabase'
import { listProductStatuses, listStructureHeaders, type ProtheusCredentials } from './protheusDb'

// Diagnóstico da Aplicação — pedido explícito do usuário: um pop-up que
// roda sozinho na primeira abertura do app (ou depois de uma atualização,
// ver AppDiagnosticsGate.tsx) e varre a base procurando inconsistências que
// o usuário precisa saber de cara, sem precisar abrir tela por tela. Cada
// checagem vira uma "seção" (uma tabela) no pop-up — pensado pra crescer:
// hoje só tem a primeira, mais podem ser adicionadas em CHECKS abaixo, sem
// mexer no pop-up nem no gatilho.

export interface DiagnosticIssue {
  rowLabel: string
  message: string
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

type Check = {
  key: string
  tableLabel: string
  mode?: 'problems' | 'summary'
  run: (creds: ProtheusCredentials) => Promise<DiagnosticIssue[]>
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
  return async (creds: ProtheusCredentials): Promise<DiagnosticIssue[]> => {
    const { data, error } = await supabaseAdmin
      .from(tableName)
      .select('protheus_code, status')
      .range(0, 24999)
    if (error) throw new Error(`Falha ao ler ${tableLabel}: ${error.message}`)

    const statusByCode = await listProductStatuses(creds)

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
// só por ter itens — ver AppDiagnosticsPopup.tsx), com a mensagem dizendo
// se já está ou não em Cadastro de Equipamentos.
const REVERSE_SEARCH_PREFIXES = ['27.04', '27.03']

async function checkReverseSearchStructures(creds: ProtheusCredentials): Promise<DiagnosticIssue[]> {
  const headers = await listStructureHeaders(REVERSE_SEARCH_PREFIXES, creds)
  if (headers.length === 0) return []

  const { data, error } = await supabaseAdmin
    .from('standard_equipment_items')
    .select('protheus_code')
    .range(0, 24999)
  if (error) throw new Error(`Falha ao ler Cadastro de Equipamentos: ${error.message}`)

  const registered = new Set((data || []).map(r => String(r.protheus_code ?? '').trim().toUpperCase()))

  return headers.map(code => {
    const normalized = code.trim().toUpperCase()
    return {
      rowLabel: normalized,
      message: registered.has(normalized)
        ? 'Já cadastrado em Cadastro de Equipamentos.'
        : 'NÃO cadastrado em Cadastro de Equipamentos.',
    }
  })
}

const CHECKS: Check[] = [
  { key: 'standard_equipment_items', tableLabel: 'Cadastro de Equipamentos', run: checkProtheusStatusVsActive('standard_equipment_items', 'Cadastro de Equipamentos') },
  { key: 'accessories', tableLabel: 'Cadastro de Componentes', run: checkProtheusStatusVsActive('accessories', 'Cadastro de Componentes') },
  { key: 'reverse_search_27_04_27_03', tableLabel: 'Busca Reversa (Protheus) 27.04 / 27.03', mode: 'summary', run: checkReverseSearchStructures },
]

// Roda todas as checagens registradas, em sequência (não Promise.all — uma
// falha isolada numa checagem não deve impedir as outras de rodar; o erro
// vira uma seção com um único "issue" descrevendo a falha, em vez de
// derrubar o diagnóstico inteiro).
export async function runAppDiagnostics(creds: ProtheusCredentials): Promise<DiagnosticSection[]> {
  const sections: DiagnosticSection[] = []
  for (const check of CHECKS) {
    try {
      const issues = await check.run(creds)
      sections.push({ key: check.key, tableLabel: check.tableLabel, mode: check.mode, issues })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido ao rodar esta checagem'
      // Uma falha ao rodar a checagem é sempre tratada como problema (modo
      // padrão 'problems'), mesmo numa checagem 'summary' — o usuário
      // precisa ver que algo deu errado, não que "não achou nada".
      sections.push({ key: check.key, tableLabel: check.tableLabel, issues: [{ rowLabel: '—', message }] })
    }
  }
  return sections
}
