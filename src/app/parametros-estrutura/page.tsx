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

  const loadFromDb = async () => {
    setLoading(true)
    setError('')
    setSuccessMsg('')
    try {
      const res = await fetch('/api/structure_property_rules?limit=25000')
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Falha ao carregar parâmetros'); return }
      const rows: ParamRow[] = (json.data || [])
        .map((r: ParamRow) => ({ property_field: r.property_field, component_code: r.component_code, expected_value: r.expected_value }))
        .sort((a: ParamRow, b: ParamRow) => a.property_field.localeCompare(b.property_field) || a.component_code.localeCompare(b.component_code))
      setJsonText(toJsonText(rows))
    } catch {
      setError('Falha de rede ao carregar parâmetros')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadFromDb() }, [])

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
    for (let i = 0; i < parsed.length; i++) {
      const row = parsed[i] as Record<string, unknown>
      const field = String(row?.property_field ?? '').trim()
      const code = String(row?.component_code ?? '').trim()
      const value = String(row?.expected_value ?? '').trim()
      if (!field || !code || !value) {
        setError(`Linha ${i + 1}: precisa ter "property_field", "component_code" e "expected_value" preenchidos`)
        return
      }
      if (!KNOWN_FIELDS.includes(field)) unknownFields.add(field)
    }
    if (unknownFields.size > 0) {
      setWarning(`Atenção: "${Array.from(unknownFields).join('", "')}" não é uma coluna conhecida de Cadastro de Equipamentos — confira a grafia.`)
    }

    const nowIso = new Date().toISOString()
    const rows = (parsed as Record<string, unknown>[]).map(row => ({
      id: crypto.randomUUID(),
      property_field: String(row.property_field).trim(),
      component_code: String(row.component_code).trim(),
      expected_value: String(row.expected_value).trim(),
      created_at: nowIso,
      updated_at: nowIso,
    }))

    const ok = window.confirm(
      `Isso vai substituir TODOS os parâmetros atuais pelos ${rows.length} deste JSON. Confirma?`
    )
    if (!ok) return

    setSaving(true)
    try {
      const res = await fetch('/api/global-update/structure_property_rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Falha ao salvar parâmetros'); return }
      setSuccessMsg(`${json.inserted} parâmetro(s) salvos com sucesso`)
      await loadFromDb()
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
          remova entradas diretamente no JSON abaixo e clique em Salvar — isso substitui toda a lista atual.
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
              onClick={loadFromDb}
              disabled={saving}
              className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
            >
              Descartar alterações e recarregar do banco
            </button>
          </div>
        </>
      )}
    </div>
  )
}
