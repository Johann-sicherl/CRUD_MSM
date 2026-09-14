import { NextRequest, NextResponse } from 'next/server'
import { buildProductIntelligenceContext } from '@/lib/productIntelligenceContext'
import { runProductIntelligence, REGRAS_DISPONIVEIS } from '@/lib/productIntelligence'
import { parseProductQuestion, filterAchadosByEntities, findUnknownEntities, buildAskAnswer } from '@/lib/productIntelligenceNlu'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

// Camada B (aba "Pergunte à IA" de /inteligencia-produto) — decisão
// explícita do usuário: nenhuma chamada a LLM real, nenhuma chave de API
// nova. É a mesma credencial Protheus por requisição de sempre (nunca
// persistida) + o motor de regras determinístico, só que agora escolhido e
// filtrado por uma pergunta em texto livre em vez de rodado inteiro sempre
// — ver productIntelligenceNlu.ts pro parser heurístico e
// specs/contexto-negocio-inteligencia-produto.md pra "regra de ouro" (nunca
// inventar achado, sempre rodar a regra de verdade).
export async function POST(request: NextRequest) {
  const body = await request.json()
  const user = String(body?.user ?? '').trim()
  const password = String(body?.password ?? '')
  const pergunta = String(body?.pergunta ?? '').trim()

  if (!user || !password) {
    return NextResponse.json({ error: 'Informe usuário e senha do banco Protheus' }, { status: 400 })
  }
  if (!pergunta) {
    return NextResponse.json({ error: 'Digite uma pergunta' }, { status: 400 })
  }

  const parsed = parseProductQuestion(pergunta)

  // Pergunta não reconhecida (nenhum código/equipamento/grupo/assunto) —
  // não vale a pena rodar o motor inteiro contra o Protheus só pra devolver
  // "não entendi"; responde direto sem round-trip nenhum.
  if (!parsed.reconhecida) {
    return NextResponse.json({
      resposta: buildAskAnswer(parsed, [], []),
      achados: [], parsed, regrasRodadas: [],
    })
  }

  try {
    const ctx = await buildProductIntelligenceContext({ user, password })
    const regrasRodadas = parsed.regras.length > 0 ? parsed.regras : REGRAS_DISPONIVEIS.map(r => r.codigo)
    const achadosBrutos = runProductIntelligence(ctx, parsed.regras.length > 0 ? parsed.regras : undefined)
    const achados = filterAchadosByEntities(achadosBrutos, parsed)
    const unknown = findUnknownEntities(ctx, parsed)
    const resposta = buildAskAnswer(parsed, achados, regrasRodadas, unknown)

    return NextResponse.json({ resposta, achados, parsed, regrasRodadas, unknown })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao consultar o banco Protheus'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
