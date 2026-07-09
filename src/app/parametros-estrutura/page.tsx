'use client'

import { useEffect, useState } from 'react'

interface Rule {
  property_field: string
  component_code: string
  expected_value: string
}

export default function ParametrosEstruturaPage() {
  const [rows, setRows] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [filter, setFilter] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    setSuccessMsg('')
    try {
      const res = await fetch('/api/structure-property-rules')
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Falha ao carregar parâmetros'); return }
      const sorted = (json as Rule[]).slice().sort((a, b) =>
        a.property_field.localeCompare(b.property_field) || a.component_code.localeCompare(b.component_code)
      )
      setRows(sorted)
    } catch {
      setError('Falha de rede ao carregar parâmetros')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const updateCell = (index: number, field: keyof Rule, value: string) => {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  const addRow = () => {
    setFilter('')
    setRows(prev => [...prev, { property_field: '', component_code: '', expected_value: '' }])
  }

  const removeRow = (index: number) => {
    setRows(prev => prev.filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    setError('')
    setSuccessMsg('')

    const clean = rows
      .map(r => ({
        property_field: r.property_field.trim(),
        component_code: r.component_code.trim(),
        expected_value: r.expected_value.trim(),
      }))
      .filter(r => r.property_field || r.component_code || r.expected_value)

    for (let i = 0; i < clean.length; i++) {
      const r = clean[i]
      if (!r.property_field || !r.component_code || !r.expected_value) {
        setError(`Linha ${i + 1}: preencha Grupo Acessórios, Código e Output`)
        return
      }
    }

    setSaving(true)
    try {
      const res = await fetch('/api/structure-property-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clean),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Falha ao salvar parâmetros'); return }
      setSuccessMsg(`${json.saved} parâmetro(s) salvos com sucesso`)
      setRows(clean)
    } catch {
      setError('Falha de rede ao salvar parâmetros')
    } finally {
      setSaving(false)
    }
  }

  const filteredIndices = rows.map((_, i) => i).filter(i => {
    const f = filter.trim().toLowerCase()
    if (!f) return true
    const r = rows[i]
    return r.property_field.toLowerCase().includes(f)
      || r.component_code.toLowerCase().includes(f)
      || r.expected_value.toLowerCase().includes(f)
  })

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">SISTEMA</div>
        <h1 className="text-3xl font-bold text-on-surface">Parâmetros de Estrutura</h1>
        <p className="text-on-surface-variant text-base mt-1">
          Regras usadas pelo Analisador de Estruturas, na mesma disposição da planilha original —
          edite qualquer célula diretamente e clique em Salvar. Guardado em{' '}
          <code className="bg-surface-container px-1 rounded">src/data/structure-property-rules.json</code>.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 py-16 text-outline">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-base font-mono">Carregando...</span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-3">
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Filtrar por grupo, código ou output..."
              className="flex-1 bg-surface-container border border-outline-variant rounded px-3 py-2 text-base text-on-surface placeholder:text-outline focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
            <span className="text-sm text-outline font-mono whitespace-nowrap">{filteredIndices.length} de {rows.length}</span>
          </div>

          <div className="overflow-auto border border-outline-variant rounded-lg max-h-[65vh]">
            <table className="text-base w-full">
              <thead className="sticky top-0 bg-surface-container-highest">
                <tr>
                  <th className="text-left px-3 py-2.5 font-semibold text-on-surface-variant">Grupo Acessórios</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-on-surface-variant">Código Acessório Protheus</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-on-surface-variant">Output</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {filteredIndices.map(i => (
                  <tr key={i} className="border-t border-outline-variant/50 odd:bg-surface-container-low">
                    <td className="p-1">
                      <input
                        value={rows[i].property_field}
                        onChange={e => updateCell(i, 'property_field', e.target.value)}
                        className="w-full bg-transparent px-2 py-2 rounded hover:bg-surface-container-high focus:bg-surface-container-high focus:outline-none font-mono text-on-surface text-base"
                      />
                    </td>
                    <td className="p-1">
                      <input
                        value={rows[i].component_code}
                        onChange={e => updateCell(i, 'component_code', e.target.value)}
                        className="w-full bg-transparent px-2 py-2 rounded hover:bg-surface-container-high focus:bg-surface-container-high focus:outline-none font-mono text-on-surface text-base"
                      />
                    </td>
                    <td className="p-1">
                      <input
                        value={rows[i].expected_value}
                        onChange={e => updateCell(i, 'expected_value', e.target.value)}
                        className="w-full bg-transparent px-2 py-2 rounded hover:bg-surface-container-high focus:bg-surface-container-high focus:outline-none font-mono text-on-surface text-base"
                      />
                    </td>
                    <td className="p-1 text-center">
                      <button
                        onClick={() => removeRow(i)}
                        className="text-outline hover:text-error transition-colors text-lg"
                        title="Remover linha"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && (
            <div className="mt-3 flex items-center gap-2 bg-error-container/20 border border-error/20 rounded-lg px-4 py-3 text-error text-base">
              ⚠ {error}
            </div>
          )}
          {successMsg && (
            <div className="mt-3 flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 text-green-400 text-base">
              ✓ {successMsg}
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={addRow}
              className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-base text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
            >
              + Adicionar linha
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 bg-primary text-on-primary rounded text-base font-semibold hover:shadow-neon transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
            <button
              onClick={load}
              disabled={saving}
              className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-base text-on-surface-variant hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
            >
              Descartar alterações e recarregar
            </button>
          </div>
        </>
      )}
    </div>
  )
}
