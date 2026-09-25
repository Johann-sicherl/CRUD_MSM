// Blocos da Busca Reversa (Diagnóstico da Aplicação / "Visão Geral
// Avançada Global") — extraído num arquivo próprio, sem nenhum import de
// protheusDb/supabase, porque appDiagnostics.ts é server-only (usa
// `mssql`, que quebra o build do cliente — "Module not found: Can't
// resolve 'dns'" — se importado por engano num componente 'use client'
// como AppDiagnosticsPopup.tsx, mesmo que só pra pegar uma constante).
// Mantém a lista de blocos como fonte única entre a checagem
// (appDiagnostics.ts) e a UI (AppDiagnosticsPopup.tsx) sem arrastar o
// resto do módulo server-only pro bundle do navegador.

export const REVERSE_SEARCH_GROUPS = {
  errors: 'Com erro(s) de propriedade',
  notRegistered: 'Não cadastrado em Cadastro de Equipamentos',
  ok: 'Cadastrado, sem erros',
} as const

export const REVERSE_SEARCH_GROUP_ORDER: string[] = [
  REVERSE_SEARCH_GROUPS.errors,
  REVERSE_SEARCH_GROUPS.notRegistered,
  REVERSE_SEARCH_GROUPS.ok,
]
