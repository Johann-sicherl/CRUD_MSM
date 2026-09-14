import { NextRequest, NextResponse } from 'next/server'
import { buildProductIntelligenceContext } from '@/lib/productIntelligenceContext'
import { runProductIntelligence, REGRAS_DISPONIVEIS } from '@/lib/productIntelligence'
import {
  parseProductQuestion, filterAchadosByEntities, findUnknownEntities, buildAskAnswer,
  type ParsedProductQuestion,
} from '@/lib/productIntelligenceNlu'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const CODIGOS_VALIDOS = new Set(REGRAS_DISPONIVEIS.map(r => r.codigo))

// Camada B (aba "Pergunte à IA" de /inteligencia-produto) — decisão
// explícita do usuário: nenhuma chamada a LLM real, nenhuma chave de API
// nova. É a mesma credencial Protheus por requisição de sempre (nunca
// persistida) + o motor de regras determinístico.
//
// Dois jeitos de montar o filtro, nunca misturados na mesma requisição:
// 1. `filtro` (seletores estruturados da UI — equipamento/grupo/código de
//    uma lista real do banco, checkboxes de regra) — sem ambiguidade
//    nenhuma de parsing, porque o valor já vem exato de um <select>. Modo
//    recomendado, adicionado depois de um bug real: perguntar em texto
//    livre sobre "EQUIPAMENTO 6040 SV ID 12" extraía o número errado
//    (6040, parte do nome comercial, em vez de 12, o legacy_id de
//    verdade) e a resposta dava falsa impressão de "coerente" sem ter
//    checado o equipamento certo — ver specs/telas-auxiliares.md.
// 2. `pergunta` (texto livre) — mantido como atalho opcional, ainda sujeito
//    à heurística de productIntelligenceNlu.ts (regex + palavra-chave, não
//    cobre toda forma de perguntar).
export async function POST(request: NextRequest) {
  const body = await request.json()
  const user = String(body?.user ?? '').trim()
  const password = String(body?.password ?? '')
  const pergunta = String(body?.pergunta ?? '').trim()

  const filtroBody = body?.filtro && typeof body.filtro === 'object' ? body.filtro : null
  const filtroEquipamento = String(filtroBody?.equipamento ?? '').trim()
  const filtroGrupo = String(filtroBody?.grupo ?? '').trim()
  const filtroCodigo = String(filtroBody?.codigo ?? '').trim().toUpperCase()
  const filtroRegras: string[] = Array.isArray(filtroBody?.regras)
    ? filtroBody.regras.filter((r: unknown): r is string => typeof r === 'string' && CODIGOS_VALIDOS.has(r))
    : []
  const usaFiltroEstruturado = !!(filtroEquipamento || filtroGrupo || filtroCodigo || filtroRegras.length > 0)

  if (!user || !password) {
    return NextResponse.json({ error: 'Informe usuário e senha do banco Protheus' }, { status: 400 })
  }
  if (!pergunta && !usaFiltroEstruturado) {
    return NextResponse.json({ error: 'Escolha um equipamento/grupo/código/regra, ou digite uma pergunta' }, { status: 400 })
  }

  // Filtro estruturado nunca passa pelo parser heurístico — o valor já
  // veio exato de um <select> alimentado pela lista real do banco, então
  // "reconhecida" é sempre true (não há o que "não reconhecer" aqui).
  const parsed: ParsedProductQuestion = usaFiltroEstruturado
    ? {
        codigos: filtroCodigo ? [filtroCodigo] : [],
        equipamentos: filtroEquipamento ? [filtroEquipamento] : [],
        grupos: filtroGrupo ? [filtroGrupo] : [],
        regras: filtroRegras,
        reconhecida: true,
      }
    : parseProductQuestion(pergunta)

  // Pergunta em texto livre não reconhecida (nenhum código/equipamento/
  // grupo/assunto) — não vale a pena rodar o motor inteiro contra o
  // Protheus só pra devolver "não entendi"; responde direto sem round-trip.
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
