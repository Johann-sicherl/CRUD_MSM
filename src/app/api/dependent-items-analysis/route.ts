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
// **Nunca desce além de nível 3 — decisão final, mantida.** Pedido
// original: incluir a subárvore inteira de cada item (nível 4+, "até o
// último nível") como sinal extra. 1ª correção: limitar essa subárvore a
// 2 níveis, depois do usuário reportar ruído (parafuso/cabo/suporte
// virando "candidato a item dependente"). 2ª correção, mesmo sintoma
// ainda acontecendo: "varrer somente o que tem em 26. e 27.13, abaixo
// disso não" — a subárvore (`others`/`filhos`) foi removida por completo.
// Nenhum componente interno do BOM de um item (nível 4 em diante) entra
// na análise, ponto final — isso não mudou nesta rodada.
//
// **"Pacote completo" — pedido explícito do usuário, rodada seguinte**:
// "quando encontrar uma estrutura que começa com 26., tem que gerar o
// nível 26. e o 27.13 dela, isso resultará em um pacote de códigos...
// a partir daí se faz as análises dentro do pacote completo... não
// somente entre o nível 26. para 26. ou 27.13 para 27.13, mas sim,
// pacote completo." Até então o conjunto de código por pedido era só
// NIVEL 3 (os itens diretamente dentro de 27.13) — um código de NIVEL 2
// (a própria linha 27.13, Embalagens, Gastos Gerais etc.) nunca entrava
// na mineração, mesmo sendo parte legítima do mesmo pedido. Corrigido:
// o conjunto de código por pedido agora é TODAS as linhas do grupo
// (`g.rows`, NIVEL 2 e NIVEL 3 juntos, sem distinção de nível) — um
// único "pacote", cruzado por completo entre si (qualquer código do
// pacote pode formar par com qualquer outro do mesmo pacote, não só
// nível-com-nível). O nível 2 não expandido pra 3 (fora do prefixo do
// campo "Prefixo(s) para abrir NIVEL 2") continua entrando como código
// de pacote — só não tem filhos explorados, exatamente como antes.
//
// Achado real, mantido mesmo depois desta mudança de escopo (pedido
// explícito do usuário: "a consulta está extremamente demorada, as
// outras consultas de estrutura são mais rápidas"): o pacote de um
// pedido continua pequeno (NIVEL 2 + NIVEL 3 diretos, nunca a subárvore
// de nível 4+), então o all-pairs dentro dele nunca reintroduz a
// explosão combinatória que motivou separar `anchors`/`others` em
// `cooccurrenceAnalysis.ts` — aqui não há `others`, só um `anchors`
// achatado por pedido, e isso é seguro justamente porque o tamanho do
// pacote continua limitado ao mesmo nível 2/3 de sempre.

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
