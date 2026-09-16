import { tables } from './schema'

// Catálogo único de "módulos" (páginas/tabelas) do app — usado pela Sidebar
// pra renderizar a navegação e pela Configuração de Usuários pra montar o
// checklist de "módulos visíveis" de cada perfil. Uma tabela nova em
// schema.ts já aparece aqui sozinha (via CATALOGO_TABLES/REGRAS_TABLES);
// uma página nova precisa ser adicionada à mão na lista abaixo.

export interface ModuleDef {
  key: string
  label: string
  href: string
  group: string
}

const CATALOGO_TABLES = Object.entries(tables).filter(([, s]) => s.domain === 'catalogo')
const REGRAS_TABLES = Object.entries(tables).filter(([, s]) => s.domain === 'regras')

// Grupo único da Sidebar para as tabelas de Portifólio + Regras — pedido
// explícito do usuário: "as janelas que estão em Portifólio e as Janelas de
// Regras estejam na nova aba chamada Engenharia". Não é o mesmo conceito de
// DOMAIN_LABELS (que continua distinguindo catalogo/regras nos badges de
// DataTable/Dashboard) — só a navegação lateral foi fundida.
const ENGINEERING_GROUP = 'Engenharia'

export const MODULES: ModuleDef[] = [
  { key: 'dashboard',            label: 'Dashboard',                          href: '/',                     group: 'Geral' },
  // 'inteligencia-produto' removida daqui de propósito — pedido explícito do
  // usuário pra tirar a janela de navegação (ver specs/telas-auxiliares.md,
  // "Inteligência do Produto — módulo desativado"). O código inteiro (rota,
  // motor de regras, página) continua no repo, só não aparece mais na
  // Sidebar nem no checklist de Configuração de Usuários.
  { key: 'explorador-relacoes',  label: 'Janela de Pesquisa Avançada',        href: '/explorador-relacoes',  group: 'Geral' },
  { key: 'atualizador-global',   label: 'Atualizador Global de Tabelas MSM',  href: '/atualizador-global',   group: 'Geral' },
  { key: 'importar-custos-locais', label: 'Importador de Custos Locais',      href: '/importar-custos-locais', group: 'Geral' },

  // Portifólio (DOMAIN_LABELS.catalogo) e Regras (DOMAIN_LABELS.regras)
  // continuam duas categorias distintas no schema (badge de domínio em
  // DataTable/Dashboard, ver DOMAIN_LABELS/DOMAIN_COLORS) — só a navegação
  // da Sidebar foi unificada num único grupo "Engenharia", pedido explícito
  // do usuário.
  ...CATALOGO_TABLES.map(([key, s]) => ({ key, label: s.label, href: `/${key}`, group: ENGINEERING_GROUP })),
  { key: 'custos-gerais-vmi',    label: 'Custos Gerais VMI',                  href: '/custos-gerais-vmi',    group: ENGINEERING_GROUP },

  ...REGRAS_TABLES.map(([key, s]) => ({ key, label: s.label, href: `/${key}`, group: ENGINEERING_GROUP })),

  { key: 'auditoria',                    label: 'Desenvolvedor de Queries',       href: '/auditoria',                    group: 'Sistema' },
  // Double-check de Queries: até esta sessão era admin-only, link hardcoded
  // na Sidebar fora de MODULES — pedido explícito do usuário pra virar
  // módulo normal (liberável por perfil, ex.: Analista de Dados), logo
  // abaixo de Desenvolvedor de Queries. Ver checagem de permissão própria
  // em duplo-check-queries/page.tsx e nas rotas
  // global-update-check/[table]/query-double-check (isAdmin OU módulo
  // visível — nunca confia só no client).
  { key: 'duplo-check-queries',          label: 'Double-check de Queries',        href: '/duplo-check-queries',          group: 'Sistema' },
  { key: 'clonagem-estrutural-avancada', label: 'Clonagem Estrut. Avançada',      href: '/clonagem-estrutural-avancada', group: 'Sistema' },
  { key: 'depurador-solic-comercial',    label: 'Depurador Solic. Comercial',     href: '/depurador-solic-comercial',    group: 'Sistema' },
  { key: 'calculadora-autonomia-nobreak', label: 'Calculadora de Autonomia de Nobreak', href: '/calculadora-autonomia-nobreak', group: 'Sistema' },

  { key: 'analisador-estruturas',        label: 'Busc. Itens Série Estrut. Protheus', href: '/analisador-estruturas',        group: 'Consulta Banco de Dados' },
  { key: 'busca-avancada-acessorios',    label: 'Busc. Avanc. Acessórios Protheus',   href: '/busca-avancada-acessorios',    group: 'Consulta Banco de Dados' },
  { key: 'pesquisa-itens-dependentes-avancada', label: 'Pesquisa de Itens Dependentes Avançada', href: '/pesquisa-itens-dependentes-avancada', group: 'Consulta Banco de Dados' },

  { key: 'options',               label: 'Lista Itens de Série',            href: '/options',               group: 'Parâmetros' },
  { key: 'parametros-estrutura',  label: 'Param. Itens de Série e Acessórios', href: '/parametros-estrutura',  group: 'Parâmetros' },
]

export const MODULE_GROUPS: string[] = ['Geral', ENGINEERING_GROUP, 'Sistema', 'Consulta Banco de Dados', 'Parâmetros']

export const ALL_MODULE_KEYS: string[] = MODULES.map(m => m.key)
