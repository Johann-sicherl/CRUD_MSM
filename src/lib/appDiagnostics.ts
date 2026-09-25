import { supabaseAdmin } from './supabase'
import { listProductStatuses, type ProtheusCredentials } from './protheusDb'

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
  issues: DiagnosticIssue[]
}

type Check = {
  key: string
  tableLabel: string
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

const CHECKS: Check[] = [
  { key: 'standard_equipment_items', tableLabel: 'Cadastro de Equipamentos', run: checkProtheusStatusVsActive('standard_equipment_items', 'Cadastro de Equipamentos') },
  { key: 'accessories', tableLabel: 'Cadastro de Componentes', run: checkProtheusStatusVsActive('accessories', 'Cadastro de Componentes') },
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
      sections.push({ key: check.key, tableLabel: check.tableLabel, issues })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido ao rodar esta checagem'
      sections.push({ key: check.key, tableLabel: check.tableLabel, issues: [{ rowLabel: '—', message }] })
    }
  }
  return sections
}
