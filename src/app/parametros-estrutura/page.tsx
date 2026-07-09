'use client'

import { useEffect, useState } from 'react'

interface ParamRow {
  property_field: string
  component_code: string
  expected_value: string
}

const KNOWN_FIELDS = [
  'processor', 'memory', 'storage', 'graphics_card',
  'conveyor_belt_load_capacity_kg', 'tube_power_kv', 'certificate',
  'conveyor_belt_type', 'motopolia_type', 'language', 'color',
]

function toJsonText(rows: ParamRow[]): string {
  return JSON.stringify(rows, null, 2)
}

export default function ParametrosEstruturaPage() {
  const [jsonText, setJsonText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [warning, setWarning] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const loadFromFile = async () => {
    setLoading(true)
    setError('')
    setSuccessMsg('')
    try {
      const res = await fetch('/api/structure-property-rules')
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Falha ao carregar parâmetros'); return }
      const rows: ParamRow[] = (json as ParamRow[])
        .slice()
        .sort((a, b) => a.property_field.localeCompare(b.property_field) || a.component_code.localeCompare(b.component_code))
      setJsonText(toJsonText(rows))
    } catch {
      setError('Falha de rede ao carregar parâmetros')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadFromFile() }, [])

  const handleSave = async () => {
    setError('')
    setWarning('')
    setSuccessMsg('')

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch (e) {
      setError(`JSON inválido: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    if (!Array.isArray(parsed)) {
      setError('O JSON precisa ser uma lista (array) de parâmetros — [ {...}, {...} ]')
      return
    }

    const unknownFields = new Set<string>()
    for (const row of parsed as Record<string, unknown>[]) {
      const field = String(row?.property_field ?? '').trim()
      if (field && !KNOWN_FIELDS.includes(field)) unknownFields.add(field)
    }
    if (unknownFields.size > 0) {
      setWarning(`Atenção: "${Array.from(unknownFields).join('", "')}" não é uma coluna conhecida de Cadastro de Equipamentos — confira a grafia.`)
    }

    const ok = window.confirm(
      `Isso vai substituir TODOS os parâmetros atuais pelos ${parsed.length} deste JSON. Confirma?`
    )
    if (!ok) return

    setSaving(true)
    try {
      const res = await fetch('/api/structure-property-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Falha ao salvar parâmetros'); return }
      setSuccessMsg(`${json.saved} parâmetro(s) salvos com sucesso`)
      await loadFromFile()
    } catch {
      setError('Falha de rede ao salvar parâmetros')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Sistema · parâmetros de estrutura
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Parâmetros de Estrutura</h1>
        <p className="text-on-surface-variant text-base mt-1">
          Edite livremente a lista de parâmetros usada pelo Analisador de Estruturas — cada item
          diz que, se <code className="bg-surface-container px-1 rounded">component_code</code> aparecer
          na estrutura, a coluna <code className="bg-surface-container px-1 rounded">property_field</code> do
          equipamento (em Cadastro de Equipamentos) deve ter o valor de{' '}
          <code className="bg-surface-container px-1 rounded">expected_value</code>. Adicione, edite ou
          remova entradas diretamente no JSON abaixo e clique em Salvar — isso substitui todo o arquivo.
          Guardado em <code className="bg-surface-container px-1 rounded">src/data/structure-property-rules.json</code>,
          sem depender de nenhuma tabela no banco de dados — mesmo padrão de Listas de Opções.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-outline text-sm py-8">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Carregando…
        </div>
      ) : (
        <>
          <textarea
            value={jsonText}
            onChange={e => setJsonText(e.target.value)}
            spellCheck={false}
            className="w-full h-[60vh] bg-surface-container border border-outline-variant rounded-lg p-4 text-xs font-mono text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 resize-y"
          />

          {error && (
            <div className="mt-3 flex items-center gap-2 bg-error-container/20 border border-error/20 rounded-lg px-4 py-3 text-error text-sm">
              ⚠ {error}
            </div>
          )}
          {warning && (
            <div className="mt-3 flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 text-amber-400 text-sm">
              ⚠ {warning}
            </div>
          )}
          {successMsg && (
            <div className="mt-3 flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 text-green-400 text-sm">
              ✓ {successMsg}
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
            <button
              onClick={loadFromFile}
              disabled={saving}
              className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
            >
              Descartar alterações e recarregar do arquivo
            </button>
          </div>
        </>
      )}
    </div>
  )
}
