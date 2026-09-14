import type { ProtheusProductInfo, AccessoryHierarchyGroup } from './protheusDb'
import type { StructurePropertyRule } from './structurePropertyRules'
import { computeStructurePropertyResults } from './structurePropertyMatch'

// Motor de regras de "Inteligência do Produto" — confronta as 9 tabelas de
// engenharia (accessories, accessory_groups, dependant_items, equipments,
// general_alerts, non_combinable_comps, relationship_equip_accessory,
// roller_tables, standard_equipment_items) contra o cadastro/estrutura ao
// vivo do Protheus, buscando inconsistências que a validação de escrita do
// app (validateExistsIn, unique, FK) não cobre — porque nunca olha o
// Protheus, ou porque o dado entrou via Atualizador Global (que apaga e
// recria a tabela inteira sem passar por nenhuma validação de campo).
//
// Porte de um script Python equivalente (validador_engenharia.py) fornecido
// pelo usuário, com três correções feitas depois de conferir contra o
// schema/DB reais deste projeto — ver specs/telas-auxiliares.md:
// 1. R020 (duplicata de oferta): o script original tratava
//    (equipamento, código, operation_time) como chave de negócio de
//    relationship_equip_accessory — errado. A chave real (getAuditKeyFields,
//    sqlAudit.ts) é só (legacy_equipment_id, protheus_code); operation_time
//    não é noBulkEdit, não faz parte dela.
// 2. R002/parte de R003 (FK de equipamento/grupo): já são garantidas por
//    FOREIGN KEY de verdade no Postgres (msm_foreign_keys.sql) — nunca vão
//    achar nada rodando contra o Supabase de produção. Mantidas mesmo assim
//    (defesa em profundidade / reuso futuro contra uma fonte sem essa FK,
//    como um CSV antes de importar), com essa ressalva documentada.
// 3. R070 (alerta órfão) é nova — legacy_general_alert_id não tem FK
//    nenhuma pra general_alerts (conferido em msm_foreign_keys.sql), e o
//    Atualizador Global não valida esse campo — o script original não
//    cobria esse caso.
//
// R080/R081/R090 vieram depois, pedido explícito do usuário, e não existiam
// no script original — mineram/comparam contra a estrutura Protheus AO VIVO
// (não só o cadastro interno):
// - R080: co-ocorrência de itens dentro da hierarquia 26.xx/27.13 (mesma
//   consulta de Busc. Avanç. Acessórios Protheus) — candidato a item
//   dependente ainda não cadastrado.
// - R081: embalagem (27.11.xxxxx) vista na estrutura Protheus de um
//   equipamento divergindo do que está cadastrado em dependant_items.
// - R090: reaproveita o motor de comparação de Busc. Itens Série Estrut.
//   Protheus (computeStructurePropertyResults, extraído pra
//   structurePropertyMatch.ts) em vez de reinventar comparação de texto de
//   descrição — decisão deliberada de não duplicar essa lógica.

export const SEVERIDADES = ['critico', 'alto', 'medio', 'baixo', 'pergunta'] as const
export type Severidade = typeof SEVERIDADES[number]

export interface Achado {
  regra: string
  severidade: Severidade
  categoria: string
  entidade: string
  chave: Record<string, string | number | null>
  mensagem: string
  evidencia?: Record<string, unknown>
  sugestao?: string
  pergunta?: string
}

type Row = Record<string, unknown>

export interface ProductIntelligenceTables {
  accessories: Row[]
  accessory_groups: Row[]
  dependant_items: Row[]
  equipments: Row[]
  general_alerts: Row[]
  non_combinable_comps: Row[]
  relationship_equip_accessory: Row[]
  roller_tables: Row[]
  standard_equipment_items: Row[]
}

export interface ProductIntelligenceContext {
  tables: ProductIntelligenceTables
  // Chave: protheus_code normalizado (.trim().toUpperCase()) — convenção do
  // projeto inteiro pra comparação de código, ver specs/dados-e-schema.md.
  protheusInfo: Map<string, ProtheusProductInfo>
  // Chave: protheus_code (de standard_equipment_items) normalizado; valor:
  // todo componente (recursivo) da estrutura Protheus daquele código.
  bomByVariantCode: Map<string, Set<string>>
  // Hierarquia 26.xx → nível 2 (27.13 etc.) → nível 3, ao vivo do Protheus —
  // mesma consulta/hierarquia de Busc. Avanç. Acessórios Protheus
  // (listAccessoryHierarchy, prefixos padrão ['26']/['27.13']). Usada só por
  // R080 (co-ocorrência).
  accessoryHierarchyGroups: AccessoryHierarchyGroup[]
  // Regras de Parâmetros de Estrutura — usadas só por R090 (reuso do motor
  // de mismatch de Busc. Itens Série Estrut. Protheus).
  structurePropertyRules: StructurePropertyRule[]
}

const norm = (v: unknown) => String(v ?? '').trim()
const normUp = (v: unknown) => norm(v).toUpperCase()

function descricao(ctx: ProductIntelligenceContext, code: string): string {
  return ctx.protheusInfo.get(normUp(code))?.description || '(descrição não encontrada no Protheus)'
}

function bloqueado(ctx: ProductIntelligenceContext, code: string): boolean {
  return ctx.protheusInfo.get(normUp(code))?.status === 'BLOQUEADO'
}

function existeNoProtheus(ctx: ProductIntelligenceContext, code: string): boolean {
  return ctx.protheusInfo.has(normUp(code))
}

// União das BOMs de toda variante Protheus (standard_equipment_items) de um
// equipamento — ctx.bomByVariantCode já vem calculado (um fetchStructureCodes
// por variante, todos batendo no mesmo cache em memória do Protheus).
function bomDoEquipamento(ctx: ProductIntelligenceContext, eq: string): Set<string> {
  const codigos = ctx.tables.standard_equipment_items
    .filter(r => norm(r.legacy_equipment_id) === eq)
    .map(r => normUp(r.protheus_code))
  const uniao = new Set<string>()
  for (const c of codigos) {
    const bom = ctx.bomByVariantCode.get(c)
    if (bom) for (const x of bom) uniao.add(x)
  }
  return uniao
}

// Pares (equipamento, código) ofertados ou padrão — mesma noção de
// "codigos_em_uso" do script original.
function codigosEmUso(ctx: ProductIntelligenceContext): Set<string> {
  const s = new Set<string>()
  for (const r of ctx.tables.standard_equipment_items) s.add(`${norm(r.legacy_equipment_id)}|${normUp(r.protheus_code)}`)
  for (const r of ctx.tables.relationship_equip_accessory) s.add(`${norm(r.legacy_equipment_id)}|${normUp(r.protheus_code)}`)
  return s
}

type Regra = (ctx: ProductIntelligenceContext) => Achado[]

const REGRAS: { codigo: string; categoria: string; fn: Regra }[] = []
function regra(codigo: string, categoria: string, fn: Regra) {
  REGRAS.push({ codigo, categoria, fn })
}

// ─── Camada 1 — integridade referencial ────────────────────────────────

regra('R001', 'integridade', ctx => {
  const achados: Achado[] = []
  const alvos: { tabela: keyof ProductIntelligenceTables; coluna: string; eqCol: string | null }[] = [
    { tabela: 'accessories', coluna: 'protheus_code', eqCol: null },
    { tabela: 'relationship_equip_accessory', coluna: 'protheus_code', eqCol: 'legacy_equipment_id' },
    { tabela: 'non_combinable_comps', coluna: 'protheus_code', eqCol: 'legacy_equipment_id' },
    { tabela: 'non_combinable_comps', coluna: 'remove_list_code', eqCol: 'legacy_equipment_id' },
    { tabela: 'roller_tables', coluna: 'protheus_code', eqCol: 'legacy_equipment_id' },
    { tabela: 'standard_equipment_items', coluna: 'protheus_code', eqCol: 'legacy_equipment_id' },
    { tabela: 'dependant_items', coluna: 'protheus_code', eqCol: 'legacy_equipment_id' },
    { tabela: 'dependant_items', coluna: 'protheus_item_code', eqCol: 'legacy_equipment_id' },
  ]
  for (const { tabela, coluna, eqCol } of alvos) {
    for (const row of ctx.tables[tabela]) {
      const cod = norm(row[coluna])
      if (cod && !existeNoProtheus(ctx, cod)) {
        achados.push({
          regra: 'R001', severidade: 'critico', categoria: 'integridade', entidade: tabela,
          chave: { equipamento: eqCol ? norm(row[eqCol]) : null, codigo: cod, coluna },
          mensagem: `Código ${cod} não existe no cadastro do Protheus.`,
          sugestao: 'Corrigir o código ou cadastrar o item no ERP.',
        })
      }
    }
  }
  return achados
})

// Já garantida por FK real (fk_sei_equipment/fk_rea_equipment/fk_ncc_equipment/
// fk_dep_equipment/fk_rol_equipment, ver msm_foreign_keys.sql) — não vai achar
// nada contra o Supabase de produção. Mantida por defesa em profundidade.
regra('R002', 'integridade', ctx => {
  const achados: Achado[] = []
  const validos = new Set(ctx.tables.equipments.map(r => norm(r.legacy_id)))
  const tabelas: (keyof ProductIntelligenceTables)[] = [
    'relationship_equip_accessory', 'non_combinable_comps', 'roller_tables', 'standard_equipment_items', 'dependant_items',
  ]
  for (const tabela of tabelas) {
    const orfaos = new Set(ctx.tables[tabela].map(r => norm(r.legacy_equipment_id)).filter(eq => eq && !validos.has(eq)))
    for (const eq of Array.from(orfaos).sort()) {
      achados.push({
        regra: 'R002', severidade: 'critico', categoria: 'integridade', entidade: tabela,
        chave: { equipamento: eq },
        mensagem: `Equipamento ${eq} referenciado mas ausente de 'equipments'.`,
        sugestao: 'Cadastrar o equipamento ou corrigir o ID.',
      })
    }
  }
  return achados
})

// legacy_group_id de accessories/non_combinable_comps já é garantido por FK
// real (fk_acc_group/fk_ncc_group) — só legacy_second_group_id de
// non_combinable_comps não tem FK nenhuma (checado em msm_foreign_keys.sql).
regra('R003', 'integridade', ctx => {
  const achados: Achado[] = []
  const validos = new Set(ctx.tables.accessory_groups.map(r => norm(r.legacy_id)))
  const alvos: { tabela: keyof ProductIntelligenceTables; colunas: string[] }[] = [
    { tabela: 'accessories', colunas: ['legacy_group_id'] },
    { tabela: 'non_combinable_comps', colunas: ['legacy_group_id', 'legacy_second_group_id'] },
  ]
  for (const { tabela, colunas } of alvos) {
    for (const coluna of colunas) {
      const orfaos = new Set(ctx.tables[tabela].map(r => norm(r[coluna])).filter(g => g && !validos.has(g)))
      for (const g of Array.from(orfaos).sort()) {
        achados.push({
          regra: 'R003', severidade: 'alto', categoria: 'integridade', entidade: tabela,
          chave: { grupo: g, coluna },
          mensagem: `Grupo ${g} inexistente em 'accessory_groups'.`,
        })
      }
    }
  }
  return achados
})

// Nova — legacy_general_alert_id não tem FK real nenhuma pra general_alerts,
// e o Atualizador Global não valida esse campo (bypassa validateExistsIn).
regra('R070', 'integridade', ctx => {
  const achados: Achado[] = []
  const validos = new Set(ctx.tables.general_alerts.map(r => norm(r.legacy_id)))
  const alvos: { tabela: keyof ProductIntelligenceTables; eqCol: string | null }[] = [
    { tabela: 'accessories', eqCol: null },
    { tabela: 'standard_equipment_items', eqCol: 'legacy_equipment_id' },
    { tabela: 'relationship_equip_accessory', eqCol: 'legacy_equipment_id' },
  ]
  for (const { tabela, eqCol } of alvos) {
    for (const row of ctx.tables[tabela]) {
      const alerta = norm(row.legacy_general_alert_id)
      if (!alerta || alerta === '0') continue
      if (!validos.has(alerta)) {
        achados.push({
          regra: 'R070', severidade: 'alto', categoria: 'integridade', entidade: tabela,
          chave: { equipamento: eqCol ? norm(row[eqCol]) : null, codigo: norm(row.protheus_code), alerta },
          mensagem: `Alerta ${alerta} referenciado mas ausente de 'general_alerts'.`,
          sugestao: 'Cadastrar o alerta, corrigir o ID, ou zerar o campo.',
        })
      }
    }
  }
  return achados
})

// ─── Camada 1 — contradição de estado ──────────────────────────────────

regra('R010', 'estado', ctx => {
  const achados: Achado[] = []
  for (const row of ctx.tables.relationship_equip_accessory) {
    if (norm(row.status) !== 'active') continue
    const cod = norm(row.protheus_code)
    if (cod && bloqueado(ctx, cod)) {
      achados.push({
        regra: 'R010', severidade: 'critico', categoria: 'estado', entidade: 'relationship_equip_accessory',
        chave: { equipamento: norm(row.legacy_equipment_id), codigo: cod },
        mensagem: `${cod} está BLOQUEADO no Protheus mas ativo na oferta.`,
        evidencia: { descricao: descricao(ctx, cod) },
        sugestao: 'Inativar a oferta ou desbloquear o item no ERP.',
      })
    }
  }
  return achados
})

regra('R011', 'estado', ctx => {
  const achados: Achado[] = []
  const mortos = new Set(
    ctx.tables.accessories.filter(r => norm(r.status) === 'deactive').map(r => normUp(r.protheus_code))
  )
  for (const row of ctx.tables.relationship_equip_accessory) {
    if (norm(row.status) !== 'active') continue
    const cod = normUp(row.protheus_code)
    if (mortos.has(cod)) {
      achados.push({
        regra: 'R011', severidade: 'alto', categoria: 'estado', entidade: 'relationship_equip_accessory',
        chave: { equipamento: norm(row.legacy_equipment_id), codigo: norm(row.protheus_code) },
        mensagem: `${row.protheus_code} está 'deactive' em accessories mas 'active' aqui.`,
        sugestao: 'Alinhar o status entre catálogo e oferta.',
      })
    }
  }
  return achados
})

regra('R012', 'estado', ctx => {
  const achados: Achado[] = []
  // Agrupa toda revisão conhecida do Protheus por "família" (código sem
  // revisão) — pra cada código em uso na engenharia, verifica se existe
  // uma revisão irmã mais nova (string maior) e ainda não bloqueada.
  const familias = new Map<string, string[]>()
  for (const [code, info] of ctx.protheusInfo) {
    if (!info.codSemRev) continue
    const lista = familias.get(info.codSemRev)
    if (lista) lista.push(code)
    else familias.set(info.codSemRev, [code])
  }
  for (const par of Array.from(codigosEmUso(ctx)).sort()) {
    const [eq, cod] = par.split('|')
    const info = ctx.protheusInfo.get(cod)
    if (!info) continue
    const irmaos = (familias.get(info.codSemRev) || []).filter(c => c !== cod && !bloqueado(ctx, c))
    const maisNovos = irmaos.filter(c => c > cod)
    if (maisNovos.length > 0) {
      achados.push({
        regra: 'R012', severidade: 'medio', categoria: 'estado', entidade: 'engenharia',
        chave: { equipamento: eq, codigo: cod },
        mensagem: `${cod} tem revisão mais recente ativa: ${maisNovos.sort().join(', ')}.`,
        evidencia: { atual: descricao(ctx, cod), novas: Object.fromEntries(maisNovos.map(c => [c, descricao(ctx, c)])) },
        pergunta: 'A revisão antiga ainda é a correta para este equipamento?',
      })
    }
  }
  return achados
})

// ─── Camada 1 — duplicidade e chave composta ───────────────────────────

// Chave real de relationship_equip_accessory é (legacy_equipment_id,
// protheus_code) — ver getAuditKeyFields/sqlAudit.ts. operation_time NÃO
// faz parte da chave de negócio (não é noBulkEdit); tratá-lo como parte da
// chave (como o script original fazia) deixaria passar duplicatas reais.
regra('R020', 'duplicidade', ctx => {
  const achados: Achado[] = []
  const grupos = new Map<string, Row[]>()
  for (const row of ctx.tables.relationship_equip_accessory) {
    const k = `${norm(row.legacy_equipment_id)}|${normUp(row.protheus_code)}`
    const lista = grupos.get(k)
    if (lista) lista.push(row)
    else grupos.set(k, [row])
  }
  for (const [k, linhas] of grupos) {
    if (linhas.length <= 1) continue
    const [eq, cod] = k.split('|')
    achados.push({
      regra: 'R020', severidade: 'medio', categoria: 'duplicidade', entidade: 'relationship_equip_accessory',
      chave: { equipamento: eq, codigo: cod },
      mensagem: `${linhas.length} linhas na mesma chave (equipamento, código) — deveria haver só uma.`,
      sugestao: 'Remover as linhas excedentes (mesmo se operation_time/maximum_quantity divergirem entre elas).',
    })
  }
  return achados
})

regra('R021', 'duplicidade', ctx => {
  const achados: Achado[] = []
  const equipamentos = new Set(ctx.tables.relationship_equip_accessory.map(r => norm(r.legacy_equipment_id)))
  for (const eq of Array.from(equipamentos).sort()) {
    const bom = bomDoEquipamento(ctx, eq)
    if (bom.size === 0) continue
    const codigos = new Set(
      ctx.tables.relationship_equip_accessory.filter(r => norm(r.legacy_equipment_id) === eq).map(r => normUp(r.protheus_code))
    )
    for (const cod of Array.from(codigos).sort()) {
      if (bom.has(cod)) {
        achados.push({
          regra: 'R021', severidade: 'alto', categoria: 'duplicidade', entidade: 'relationship_equip_accessory',
          chave: { equipamento: eq, codigo: cod },
          mensagem: `${cod} já consta na estrutura padrão do equipamento ${eq}.`,
          evidencia: { descricao: descricao(ctx, cod) },
          pergunta: 'O opcional adiciona uma unidade extra ou está sendo vendido em duplicidade?',
        })
      }
    }
  }
  return achados
})

// ─── Camada 1 — regras de dependência ──────────────────────────────────

regra('R030', 'dependencia', ctx => {
  const achados: Achado[] = []
  const fp = (c: string) => c.slice(0, 5)
  const regrasFamilia = new Map<string, Set<string>>()
  const comDep = new Map<string, Set<string>>() // "eq|protheus_code" -> famílias filho declaradas
  for (const r of ctx.tables.dependant_items) {
    const pai = normUp(r.protheus_code)
    const filho = normUp(r.protheus_item_code)
    const famPai = fp(pai)
    const famFilho = fp(filho)
    const set = regrasFamilia.get(famPai)
    if (set) set.add(famFilho)
    else regrasFamilia.set(famPai, new Set([famFilho]))
    const k = `${norm(r.legacy_equipment_id)}|${pai}`
    const declarados = comDep.get(k)
    if (declarados) declarados.add(famFilho)
    else comDep.set(k, new Set([famFilho]))
  }

  const emUso = codigosEmUso(ctx)
  for (const [famPai, familiasFilho] of regrasFamilia) {
    const alvos = Array.from(emUso).filter(k => k.split('|')[1].startsWith(famPai))
    if (alvos.length < 5) continue
    for (const ff of familiasFilho) {
      const declarados = new Set(alvos.filter(k => (comDep.get(k) || new Set()).has(ff)))
      const cobertura = declarados.size / alvos.length
      if (cobertura < 0.5) continue
      for (const k of alvos) {
        if (declarados.has(k)) continue
        const [eq, cod] = k.split('|')
        achados.push({
          regra: 'R030', severidade: 'alto', categoria: 'dependencia', entidade: 'dependant_items',
          chave: { equipamento: eq, codigo: cod },
          mensagem: `${cod} não declara dependente da família ${ff}, mas ${Math.round(cobertura * 100)}% dos itens ${famPai} declaram.`,
          evidencia: { descricao: descricao(ctx, cod), coberturaDaRegra: Math.round(cobertura * 1000) / 1000, casosBase: alvos.length },
          pergunta: `Este item dispensa o componente ${ff} ou o cadastro está incompleto?`,
        })
      }
    }
  }
  return achados
})

regra('R031', 'dependencia', ctx => {
  const achados: Achado[] = []
  const emUso = codigosEmUso(ctx)
  const vistos = new Set<string>()
  for (const r of ctx.tables.dependant_items) {
    const eq = norm(r.legacy_equipment_id)
    const pai = normUp(r.protheus_code)
    const k = `${eq}|${pai}`
    if (vistos.has(k)) continue
    vistos.add(k)
    if (!emUso.has(k)) {
      achados.push({
        regra: 'R031', severidade: 'medio', categoria: 'dependencia', entidade: 'dependant_items',
        chave: { equipamento: eq, codigo: pai },
        mensagem: `Regra de dependência para ${pai}, que não é ofertado no equipamento ${eq}.`,
        sugestao: 'Remover a regra ou incluir o item na oferta.',
      })
    }
  }
  return achados
})

// ─── Camada 1 — incompatibilidade ──────────────────────────────────────

regra('R040', 'incompatibilidade', ctx => {
  const achados: Achado[] = []
  const pares = new Set(
    ctx.tables.non_combinable_comps.map(r => `${norm(r.legacy_equipment_id)}|${normUp(r.protheus_code)}|${normUp(r.remove_list_code)}`)
  )
  for (const par of Array.from(pares).sort()) {
    const [eq, a, b] = par.split('|')
    if (!pares.has(`${eq}|${b}|${a}`)) {
      achados.push({
        regra: 'R040', severidade: 'medio', categoria: 'incompatibilidade', entidade: 'non_combinable_comps',
        chave: { equipamento: eq, codigo: a, exclui: b },
        mensagem: `${a} exclui ${b}, mas ${b} não exclui ${a}.`,
        sugestao: `Inserir a linha recíproca (${b} exclui ${a}).`,
      })
    }
  }
  return achados
})

regra('R041', 'incompatibilidade', ctx => {
  const achados: Achado[] = []
  const rel = new Set(ctx.tables.relationship_equip_accessory.map(r => `${norm(r.legacy_equipment_id)}|${normUp(r.protheus_code)}`))
  const vistos = new Set<string>()
  for (const r of ctx.tables.non_combinable_comps) {
    const eq = norm(r.legacy_equipment_id)
    for (const coluna of ['protheus_code', 'remove_list_code'] as const) {
      const cod = normUp(r[coluna])
      const k = `${eq}|${cod}`
      if (rel.has(k) || vistos.has(k)) continue
      vistos.add(k)
      achados.push({
        regra: 'R041', severidade: 'medio', categoria: 'incompatibilidade', entidade: 'non_combinable_comps',
        chave: { equipamento: eq, codigo: cod, coluna },
        mensagem: `${cod} aparece em regra de incompatibilidade mas não é opcional do equipamento ${eq}.`,
      })
    }
  }
  return achados
})

// ─── Camada 1 — completude (perguntas, não acusações) ──────────────────

regra('R050', 'completude', ctx => {
  const achados: Achado[] = []
  const tabelasConfig: (keyof ProductIntelligenceTables)[] = [
    'relationship_equip_accessory', 'standard_equipment_items', 'dependant_items', 'roller_tables', 'non_combinable_comps',
  ]
  const presenca = tabelasConfig.map(t => new Set(ctx.tables[t].map(r => norm(r.legacy_equipment_id))))
  for (const eqRow of ctx.tables.equipments) {
    const eq = norm(eqRow.legacy_id)
    if (!eq) continue
    const vazio = presenca.every(s => !s.has(eq))
    if (vazio) {
      achados.push({
        regra: 'R050', severidade: 'pergunta', categoria: 'completude', entidade: 'equipments',
        chave: { equipamento: eq },
        mensagem: `Equipamento ${eq} (${eqRow.commercial_name || eqRow.name}) não tem nenhuma configuração cadastrada.`,
        pergunta: 'Este equipamento já foi projetado e cadastrado no ERP, ou ainda é uma expectativa comercial?',
      })
    }
  }
  return achados.sort((a, b) => Number(a.chave.equipamento) - Number(b.chave.equipamento))
})

regra('R051', 'completude', ctx => {
  const achados: Achado[] = []
  const esperado = new Set(['start', 'middle', 'end', 'unique'])
  const porEquipamento = new Map<string, Set<string>>()
  for (const r of ctx.tables.roller_tables) {
    const eq = norm(r.legacy_equipment_id)
    const tipos = porEquipamento.get(eq)
    if (tipos) tipos.add(norm(r.type))
    else porEquipamento.set(eq, new Set([norm(r.type)]))
  }
  for (const [eq, tipos] of porEquipamento) {
    const faltam = Array.from(esperado).filter(t => !tipos.has(t)).sort()
    if (faltam.length > 0) {
      achados.push({
        regra: 'R051', severidade: 'pergunta', categoria: 'completude', entidade: 'roller_tables',
        chave: { equipamento: eq },
        mensagem: `Equipamento ${eq} não tem mesa de roletes do tipo: ${faltam.join(', ')}.`,
        pergunta: 'Essas posições já foram projetadas pela engenharia ou o cadastro está pendente?',
      })
    }
  }
  return achados
})

regra('R052', 'completude', ctx => {
  const achados: Achado[] = []
  const ofertados = new Set(ctx.tables.relationship_equip_accessory.map(r => normUp(r.protheus_code)))
  for (const r of ctx.tables.accessories) {
    const cod = normUp(r.protheus_code)
    if (!ofertados.has(cod)) {
      achados.push({
        regra: 'R052', severidade: 'pergunta', categoria: 'completude', entidade: 'accessories',
        chave: { codigo: norm(r.protheus_code) },
        mensagem: `Acessório ${r.protheus_code} (${r.name}) cadastrado mas nunca ofertado.`,
        pergunta: 'Está reservado para projeto futuro ou foi esquecido em algum equipamento?',
      })
    }
  }
  const usadosGrupo = new Set(ctx.tables.accessories.map(r => norm(r.legacy_group_id)))
  for (const g of ctx.tables.accessory_groups) {
    const id = norm(g.legacy_id)
    if (!usadosGrupo.has(id)) {
      achados.push({
        regra: 'R052', severidade: 'pergunta', categoria: 'completude', entidade: 'accessory_groups',
        chave: { grupo: id },
        mensagem: `Grupo ${id} (${g.name}) não tem nenhum acessório.`,
        pergunta: 'Grupo previsto para projeto futuro?',
      })
    }
  }
  return achados
})

// ─── Camada 2 — inferência por analogia ────────────────────────────────

regra('R060', 'analogia', ctx => {
  const achados: Achado[] = []
  const oferta = new Map<string, Set<string>>()
  for (const r of ctx.tables.relationship_equip_accessory) {
    const eq = norm(r.legacy_equipment_id)
    const set = oferta.get(eq)
    if (set) set.add(normUp(r.protheus_code))
    else oferta.set(eq, new Set([normUp(r.protheus_code)]))
  }

  const porFamilia = new Map<string, string[]>()
  for (const eqRow of ctx.tables.equipments) {
    const familia = String(eqRow.commercial_name ?? '').trim().split(/\s+/).slice(0, 2).join(' ')
    const lid = norm(eqRow.legacy_id)
    if (!familia || !lid) continue
    const lista = porFamilia.get(familia)
    if (lista) lista.push(lid)
    else porFamilia.set(familia, [lid])
  }

  for (const [familia, membrosTodos] of porFamilia) {
    const membros = membrosTodos.filter(m => oferta.has(m))
    if (membros.length < 3) continue
    const contagem = new Map<string, number>()
    for (const m of membros) for (const c of oferta.get(m)!) contagem.set(c, (contagem.get(c) || 0) + 1)
    const n = membros.length
    for (const [cod, qtd] of contagem) {
      if (qtd / n < 0.75 || qtd === n) continue
      const faltando = membros.filter(m => !oferta.get(m)!.has(cod))
      for (const m of faltando) {
        achados.push({
          regra: 'R060', severidade: 'medio', categoria: 'analogia', entidade: 'relationship_equip_accessory',
          chave: { equipamento: m, codigo: cod },
          mensagem: `${qtd} de ${n} equipamentos da família '${familia}' ofertam ${cod}, mas o equipamento ${m} não.`,
          evidencia: { familia, descricao: descricao(ctx, cod), irmaosQueOfertam: qtd, totalIrmaos: n },
          pergunta: 'Ausência intencional ou opcional esquecido neste equipamento?',
        })
      }
    }
  }
  return achados
})

// ─── Regras a partir da estrutura Protheus ao vivo (não só do cadastro) ─
// Diferente de tudo acima: estas três não comparam duas fontes internas
// entre si — mineram padrão real da estrutura Protheus (hierarquia
// 26.xx/27.13 e BOM de cada equipamento) e cruzam contra o que já está
// cadastrado, pra sugerir cadastro que ainda não existe ou já ficou
// desatualizado. Pedido explícito do usuário, com exemplos concretos:
// "esse acessório sempre saiu com esse outro" (R080) e "essa embalagem
// está diferente do item dependente no banco de dados local" (R081).

// Prefixo de embalagem — convenção já vista nesta base (accessory_groups
// legacy_id 22 = "EMBALAGEM", accessories com protheus_code 27.11.xxxxx).
// Lista, não valor único, pra dar pra estender a outras famílias sem tocar
// na lógica da regra.
const PACKAGING_PREFIXES = ['27.11']

// R080 é estatística, não determinística — precisa de um piso mínimo de
// amostra (senão "co-ocorreu 1 de 1 vez" vira falso positivo garantido) e
// de confiança alta nos dois sentidos (A quase sempre com B E B quase
// sempre com A) — um acessório genérico que entra em quase todo pedido
// junto de tudo não deve virar "candidato a dependência" só porque aparece
// muito, se ele não for tão exclusivo do outro lado do par.
const MIN_COOCCURRENCE_SUPPORT = 3
const MIN_COOCCURRENCE_CONFIDENCE = 0.9

// Um código de nível 3 (26.xx/27.13) pode estar associado a mais de um
// equipamento (ofertado como opcional em vários, ou ser a própria variante
// de standard_equipment_items) — mapeado uma vez aqui pra achado carregar
// `equipamentosRelacionados` em chave.chave e permitir filtro por
// equipamento na Camada B (productIntelligenceNlu.ts/filterAchadosByEntities).
// Sem isso, achado real já causou falso "nada encontrado": R080 não tem
// noção nativa de "equipamento" (é par de código, pode atravessar vários
// pedidos/equipamentos diferentes) — filtrar por equipamento sem essa
// chave zerava sempre o resultado, mesmo com achado de verdade existindo.
function mapaEquipamentosPorCodigo(ctx: ProductIntelligenceContext): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  const add = (code: string, eq: string) => {
    if (!code || !eq) return
    const set = map.get(code)
    if (set) set.add(eq)
    else map.set(code, new Set([eq]))
  }
  for (const r of ctx.tables.relationship_equip_accessory) add(normUp(r.protheus_code), norm(r.legacy_equipment_id))
  for (const r of ctx.tables.standard_equipment_items) add(normUp(r.protheus_code), norm(r.legacy_equipment_id))
  return map
}

regra('R080', 'analogia', ctx => {
  const achados: Achado[] = []
  const grupos = ctx.accessoryHierarchyGroups
    .map(g => Array.from(new Set(g.rows.filter(r => r.nivel === 3).map(r => normUp(r.codigo)))))
    .filter(codes => codes.length >= 2)
  const codeToEquip = mapaEquipamentosPorCodigo(ctx)

  const suporte = new Map<string, number>()
  const coOcorrencia = new Map<string, number>() // "A|B" com A<B
  for (const codes of grupos) {
    for (const c of codes) suporte.set(c, (suporte.get(c) || 0) + 1)
    for (let i = 0; i < codes.length; i++) {
      for (let j = i + 1; j < codes.length; j++) {
        const [a, b] = [codes[i], codes[j]].sort()
        const k = `${a}|${b}`
        coOcorrencia.set(k, (coOcorrencia.get(k) || 0) + 1)
      }
    }
  }

  const dependenciasConhecidas = new Set(
    ctx.tables.dependant_items.map(r => `${normUp(r.protheus_code)}|${normUp(r.protheus_item_code)}`)
  )

  for (const [par, conjuntas] of coOcorrencia) {
    const [a, b] = par.split('|')
    const suporteA = suporte.get(a) || 0
    const suporteB = suporte.get(b) || 0
    if (suporteA < MIN_COOCCURRENCE_SUPPORT || suporteB < MIN_COOCCURRENCE_SUPPORT) continue
    if (conjuntas / suporteA < MIN_COOCCURRENCE_CONFIDENCE || conjuntas / suporteB < MIN_COOCCURRENCE_CONFIDENCE) continue
    if (dependenciasConhecidas.has(`${a}|${b}`) || dependenciasConhecidas.has(`${b}|${a}`)) continue
    const equipamentosRelacionados = Array.from(new Set([
      ...(codeToEquip.get(a) || []), ...(codeToEquip.get(b) || []),
    ])).sort()
    achados.push({
      regra: 'R080', severidade: 'pergunta', categoria: 'analogia', entidade: 'dependant_items',
      chave: { codigoA: a, codigoB: b, equipamentosRelacionados: equipamentosRelacionados.join(',') || null },
      mensagem: `${a} e ${b} saíram juntos em ${conjuntas} de até ${Math.max(suporteA, suporteB)} estruturas Protheus (26.xx/27.13) — nunca registrados como dependência um do outro.`,
      evidencia: { descricaoA: descricao(ctx, a), descricaoB: descricao(ctx, b), coOcorrencias: conjuntas, suporteA, suporteB },
      pergunta: 'É um candidato real a item dependente, ou coincidência de pedidos que sempre pediram os dois juntos?',
    })
  }
  return achados
})

regra('R081', 'dependencia', ctx => {
  const achados: Achado[] = []
  for (const eqItem of ctx.tables.standard_equipment_items) {
    const eq = norm(eqItem.legacy_equipment_id)
    const variante = normUp(eqItem.protheus_code)
    const bom = ctx.bomByVariantCode.get(variante)
    if (!bom) continue

    const emProtheus = new Set(Array.from(bom).filter(c => PACKAGING_PREFIXES.some(p => c.startsWith(p))))
    const emCadastroLocal = new Set(
      ctx.tables.dependant_items
        .filter(r => norm(r.legacy_equipment_id) === eq)
        .map(r => normUp(r.protheus_item_code))
        .filter(c => PACKAGING_PREFIXES.some(p => c.startsWith(p)))
    )
    if (emProtheus.size === 0 && emCadastroLocal.size === 0) continue

    const faltamNoLocal = Array.from(emProtheus).filter(c => !emCadastroLocal.has(c)).sort()
    const sobramNoLocal = Array.from(emCadastroLocal).filter(c => !emProtheus.has(c)).sort()
    if (faltamNoLocal.length === 0 && sobramNoLocal.length === 0) continue

    achados.push({
      regra: 'R081', severidade: 'alto', categoria: 'dependencia', entidade: 'dependant_items',
      chave: { equipamento: eq, codigo: variante },
      mensagem: `Embalagem da estrutura Protheus diverge do item dependente cadastrado para ${variante}.`,
      evidencia: { naEstruturaProtheus: Array.from(emProtheus).sort(), noCadastroLocal: Array.from(emCadastroLocal).sort() },
      sugestao: faltamNoLocal.length > 0
        ? `Cadastrar ${faltamNoLocal.join(', ')} como item dependente.`
        : `Revisar/remover ${sobramNoLocal.join(', ')} do cadastro — não aparece mais na estrutura Protheus.`,
    })
  }
  return achados
})

// Reaproveita o mesmo motor de comparação de Busc. Itens Série Estrut.
// Protheus (computeStructurePropertyResults) em vez de reinventar uma
// comparação de texto livre de descrição — mais confiável, porque casa por
// código (via Parâmetros de Estrutura), não por palavra dentro de B1_DESC.
// Só "mismatch"/"duplicate" viram achado aqui: "missing" é normal pra
// propriedade que não se aplica àquele tipo de equipamento (ex.: correia
// num equipamento sem correia) — incluir "missing" numa varredura em lote
// do catálogo inteiro geraria ruído enorme; a ferramenta interativa (um
// equipamento por vez, com contexto) já mostra "missing" onde faz sentido.
regra('R090', 'itens-de-serie', ctx => {
  const achados: Achado[] = []
  for (const eqItem of ctx.tables.standard_equipment_items) {
    const variante = normUp(eqItem.protheus_code)
    const bom = ctx.bomByVariantCode.get(variante)
    if (!bom) continue
    const results = computeStructurePropertyResults(bom, eqItem, ctx.structurePropertyRules)
    for (const r of results) {
      if (r.status !== 'mismatch' && r.status !== 'duplicate') continue
      achados.push({
        regra: 'R090', severidade: r.status === 'mismatch' ? 'alto' : 'medio', categoria: 'itens-de-serie',
        entidade: 'standard_equipment_items',
        chave: { equipamento: norm(eqItem.legacy_equipment_id), codigo: variante, campo: r.field },
        mensagem: r.status === 'mismatch'
          ? `${r.field}: a estrutura Protheus indica '${r.computedValue}', mas o banco tem '${r.dbValue ?? '(vazio)'}'.`
          : `${r.field}: códigos conflitantes na estrutura Protheus indicam valores diferentes (${r.matched.map(m => `${m.code}→${m.value}`).join(', ')}).`,
        evidencia: { matched: r.matched, computedValue: r.computedValue, dbValue: r.dbValue },
        sugestao: r.status === 'mismatch'
          ? 'Corrigir o valor cadastrado ou revisar o código na estrutura.'
          : 'Revisar Parâmetros de Estrutura — dois códigos apontando valores diferentes para a mesma propriedade.',
      })
    }
  }
  return achados
})

// ─── Execução ───────────────────────────────────────────────────────────

const ORDEM_SEVERIDADE: Record<Severidade, number> = { critico: 0, alto: 1, medio: 2, baixo: 3, pergunta: 4 }

export function runProductIntelligence(ctx: ProductIntelligenceContext, apenas?: string[]): Achado[] {
  const achados: Achado[] = []
  for (const { codigo, fn } of REGRAS) {
    if (apenas && apenas.length > 0 && !apenas.includes(codigo)) continue
    try {
      achados.push(...fn(ctx))
    } catch (e) {
      achados.push({
        regra: codigo, severidade: 'baixo', categoria: 'motor', entidade: 'validador', chave: {},
        mensagem: `Regra ${codigo} falhou: ${e instanceof Error ? e.message : 'erro desconhecido'}.`,
      })
    }
  }
  achados.sort((a, b) => ORDEM_SEVERIDADE[a.severidade] - ORDEM_SEVERIDADE[b.severidade] || a.regra.localeCompare(b.regra))
  return achados
}

export const REGRAS_DISPONIVEIS = REGRAS.map(r => ({ codigo: r.codigo, categoria: r.categoria }))
