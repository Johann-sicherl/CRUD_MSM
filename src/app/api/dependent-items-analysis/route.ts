import { NextRequest, NextResponse } from 'next/server'
import { listAccessoryHierarchy } from '@/lib/protheusDb'
import { computeCooccurrence, type CooccurrenceOrder } from '@/lib/cooccurrenceAnalysis'
import { supabaseAdmin } from '@/lib/supabase'

// Feeds "Pesquisa de Itens Dependentes Avançada" — mesma coleta de
// listAccessoryHierarchy já usada em Busc. Avanç. Acessórios Protheus
// (26.xx → nível 2 → nível 3), mas em vez de listar os itens, monta o
// "conjunto de códigos por pedido" (cada 26.xx é um pedido) e roda a
// mineração de coocorrência (cooccurrenceAnalysis.ts, mesma matemática
// que a regra R080 usa) pra achar pares que sempre saem juntos — depois
// cruza contra dependant_items pra marcar o que já é uma dependência
// formal e o que é candidato novo.
//
// **Nunca desce além de nível 3 — decisão final, depois de duas rodadas
// de ajuste.** Pedido original: incluir a subárvore inteira de cada item
// (nível 4+, "até o último nível") como sinal extra. 1ª correção: limitar
// essa subárvore a 2 níveis (SUBTREE_MAX_DEPTH), depois do usuário
// reportar ruído (parafuso/cabo/suporte virando "candidato a item
// dependente"). 2ª correção, pedido explícito do usuário, mesmo sintoma
// ainda acontecendo: "quero que desça somente nos NIVEL 1 e NIVEL 2,
// apenas, não a máquina toda, estou encontrando todo tipo de componente
// em níveis muito inferiores ainda, é para varrer somente o que tem em
// 26. e 27.13, abaixo disso não." A subárvore (`others`/`filhos`) foi
// **removida por completo** — o conjunto de código por pedido agora é só
// os códigos de nível 3 (os itens diretamente dentro de 27.13, a peça de
// verdade ofertada), exatamente como a regra R080 sempre fez. Nenhum
// componente interno do BOM de um item (nível 4 em diante) entra na
// análise, ponto final.
//
// Achado real, mantido mesmo depois desta simplificação (pedido explícito
// do usuário: "a consulta está extremamente demorada, as outras consultas
// de estrutura são mais rápidas"): mesmo só com nível 3, o conjunto de
// código por pedido continua indo pra `CooccurrenceOrder.anchors` — nunca
// um único array achatado pra all-pairs O(n²) sem critério, mesmo padrão
// que blindou o R080 original contra esse mesmo tipo de explosão.

export async function POST(request: NextRequest) {
  const body = await request.json()
  const user = String(body?.user ?? '').trim()
  const password = String(body?.password ?? '')
  const headerPrefixes: string[] = Array.isArray(body?.headerPrefixes) ? body.headerPrefixes.map((p: unknown) => String(p)) : []
  const nivel2Prefixes: string[] = Array.isArray(body?.nivel2Prefixes) ? body.nivel2Prefixes.map((p: unknown) => String(p)) : []
  const minSupportRaw = Number(body?.minSupport)
  const minConfidenceRaw = Number(body?.minConfidence)
  const minSupport = Number.isFinite(minSupportRaw) && minSupportRaw > 0 ? minSupportRaw : 3
  const minConfidence = Number.isFinite(minConfidenceRaw) && minConfidenceRaw > 0 ? minConfidenceRaw : 0.9

  if (!user || !password) {
    return NextResponse.json({ error: 'Informe usuário e senha do banco Protheus' }, { status: 400 })
  }
  if (headerPrefixes.length === 0) {
    return NextResponse.json({ error: 'Informe ao menos um prefixo de estrutura' }, { status: 400 })
  }

  try {
    const groups = await listAccessoryHierarchy(headerPrefixes, nivel2Prefixes, { user, password })

    const descriptions = new Map<string, string>()
    const orders: CooccurrenceOrder[] = []
    for (const g of groups) {
      const anchors = new Set<string>()
      for (const row of g.rows) {
        if (row.nivel !== 3) continue
        const code = row.codigo.trim().toUpperCase()
        if (!code) continue
        anchors.add(code)
        if (!descriptions.has(code)) descriptions.set(code, row.denominacao)
      }
      orders.push({ anchors: Array.from(anchors) })
    }

    const pairs = computeCooccurrence(orders, { minSupport, minConfidence })

    // .range() explícito — non_combinable_comps/relationship_equip_accessory
    // já passam do cap padrão de 1000 do PostgREST em produção; dependant_items
    // ainda não, mas o padrão é sempre explicitar aqui (ver specs/dados-e-schema.md).
    const { data: depRows, error: depErr } = await supabaseAdmin
      .from('dependant_items')
      .select('protheus_code, protheus_item_code')
      .range(0, 24999)
    if (depErr) throw new Error(`Falha ao ler Produtos Dependentes: ${depErr.message}`)

    const declared = new Set(
      (depRows || []).map(r => `${String(r.protheus_code ?? '').trim().toUpperCase()}|${String(r.protheus_item_code ?? '').trim().toUpperCase()}`)
    )

    const result = pairs
      .map(p => ({
        ...p,
        denominacaoA: descriptions.get(p.codigoA) || '',
        denominacaoB: descriptions.get(p.codigoB) || '',
        jaDeclarado: declared.has(`${p.codigoA}|${p.codigoB}`) || declared.has(`${p.codigoB}|${p.codigoA}`),
      }))
      .sort((a, b) => b.coOcorrencias - a.coOcorrencias)

    return NextResponse.json({ pairs: result, totalPedidos: orders.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar o banco Protheus'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
