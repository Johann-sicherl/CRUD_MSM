import { tables, DOMAIN_LABELS } from './schema'

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

export const MODULES: ModuleDef[] = [
  { key: 'dashboard',            label: 'Dashboard',                          href: '/',                     group: 'Geral' },
  { key: 'explorador-relacoes',  label: 'Janela de Pesquisa Avançada',        href: '/explorador-relacoes',  group: 'Geral' },
  { key: 'atualizador-global',   label: 'Atualizador Global de Tabelas MSM',  href: '/atualizador-global',   group: 'Geral' },
  { key: 'importar-custos-locais', label: 'Importador de Custos Locais',      href: '/importar-custos-locais', group: 'Geral' },

  ...CATALOGO_TABLES.map(([key, s]) => ({ key, label: s.label, href: `/${key}`, group: DOMAIN_LABELS.catalogo })),
  { key: 'custos-gerais-vmi',    label: 'Custos Gerais VMI',                  href: '/custos-gerais-vmi',    group: DOMAIN_LABELS.catalogo },

  ...REGRAS_TABLES.map(([key, s]) => ({ key, label: s.label, href: `/${key}`, group: DOMAIN_LABELS.regras })),

  { key: 'auditoria',                    label: 'Desenvolvedor de Queries',       href: '/auditoria',                    group: 'Sistema' },
  { key: 'clonagem-estrutural-avancada', label: 'Clonagem Estrut. Avançada',      href: '/clonagem-estrutural-avancada', group: 'Sistema' },
  { key: 'analisador-estruturas',        label: 'Busc. Itens Série Estrut.',      href: '/analisador-estruturas',        group: 'Sistema' },
  { key: 'busca-avancada-acessorios',    label: 'Busc. Avançada Acessórios',      href: '/busca-avancada-acessorios',    group: 'Sistema' },
  { key: 'depurador-solic-comercial',    label: 'Depurador Solic. Comercial',     href: '/depurador-solic-comercial',    group: 'Sistema' },

  { key: 'options',               label: 'Lista Itens de Série',   href: '/options',               group: 'Parâmetros' },
  { key: 'parametros-estrutura',  label: 'Param. Itens de Série',  href: '/parametros-estrutura',  group: 'Parâmetros' },
]

export const MODULE_GROUPS: string[] = ['Geral', DOMAIN_LABELS.catalogo, DOMAIN_LABELS.regras, 'Sistema', 'Parâmetros']

export const ALL_MODULE_KEYS: string[] = MODULES.map(m => m.key)
