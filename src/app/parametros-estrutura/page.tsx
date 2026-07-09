'use client'

import { useEffect, useState } from 'react'

interface Entry {
  component_code: string
  expected_value: string
}

interface Rule {
  property_field: string
  component_code: string
  expected_value: string
}

const FIELD_LABELS: Record<string, string> = {
  processor: 'Processador',
  memory: 'Memória',
  storage: 'Armazenamento',
  graphics_card: 'Placa Gráfica',
  conveyor_belt_load_capacity_kg: 'Cap. Correia (kg)',
  tube_power_kv: 'Potência Tubo (kV)',
  certificate: 'Certificado',
  conveyor_belt_type: 'Tipo Correia',
  motopolia_type: 'Tipo Motopolia',
  language: 'Idioma',
  color: 'Cor',
}

export default function ParametrosEstruturaPage() {
  const [allRules, setAllRules] = useState<Record<string, Entry[]>>({})
  const [loading, setLoading] = useState(true)
  const [codeInputs, setCodeInputs] = useState<Record<string, string>>({})
  const [valueInputs, setValueInputs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/structure-property-rules')
      .then(r => r.json())
      .then((rows: Rule[]) => {
        const grouped: Record<string, Entry[]> = {}
        for (const r of rows) {
          if (!grouped[r.property_field]) grouped[r.property_field] = []
          grouped[r.property_field].push({ component_code: r.component_code, expected_value: r.expected_value })
        }
        setAllRules(grouped)
        setLoading(false)
      })
  }, [])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const addEntry = async (field: string) => {
    const code = (codeInputs[field] || '').trim()
    const value = (valueInputs[field] || '').trim()
    if (!code || !value) return
    setBusy(prev => ({ ...prev, [field]: true }))
    const res = await fetch('/api/structure-property-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ property_field: field, component_code: code, expected_value: value }),
    })
    if (res.ok) {
      const updated: Rule[] = await res.json()
      setAllRules(prev => ({ ...prev, [field]: updated.map(u => ({ component_code: u.component_code, expected_value: u.expected_value })) }))
      setCodeInputs(prev => ({ ...prev, [field]: '' }))
      setValueInputs(prev => ({ ...prev, [field]: '' }))
      showToast(`"${code}" salvo em ${FIELD_LABELS[field] || field}`)
    }
    setBusy(prev => ({ ...prev, [field]: false }))
  }

  const removeEntry = async (field: string, code: string) => {
    const res = await fetch('/api/structure-property-rules', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ property_field: field, component_code: code }),
    })
    if (res.ok) {
      const updated: Rule[] = await res.json()
      setAllRules(prev => ({ ...prev, [field]: updated.map(u => ({ component_code: u.component_code, expected_value: u.expected_value })) }))
      showToast(`"${code}" removido`)
    }
  }

  return (
    <div className="p-6 max-w-[1400px]">
      <div className="mb-6">
        <div className="text-[10px] font-mono text-outline uppercase tracking-[0.2em] mb-1">SISTEMA</div>
        <h1 className="text-2xl font-bold text-on-surface">Parâmetros de Estrutura</h1>
        <p className="text-on-surface-variant text-sm mt-1">
          Regras usadas pelo Analisador de Estruturas: se o código aparecer na estrutura de um
          equipamento, a propriedade correspondente deve ter o valor cadastrado aqui. Salvo
          automaticamente em <code className="bg-surface-container px-1 rounded">src/data/structure-property-rules.json</code>.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 py-16 text-outline">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-mono">Carregando...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Object.entries(FIELD_LABELS).map(([field, label]) => {
            const entries = (allRules[field] || []).slice().sort((a, b) => a.component_code.localeCompare(b.component_code))
            return (
              <div key={field} className="bg-surface-container rounded border border-outline-variant p-4 flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-on-surface">{label}</h3>
                  <div className="text-[10px] font-mono text-outline mt-0.5">{field}</div>
                </div>

                <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                  {entries.length === 0 ? (
                    <span className="text-xs text-outline italic">Nenhum parâmetro cadastrado</span>
                  ) : (
                    entries.map(e => (
                      <span
                        key={e.component_code}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-container-high border border-outline-variant rounded text-xs font-mono text-on-surface-variant"
                      >
                        {e.component_code} → {e.expected_value}
                        <button
                          onClick={() => removeEntry(field, e.component_code)}
                          className="text-outline/50 hover:text-error transition-colors leading-none ml-0.5"
                          title={`Remover "${e.component_code}"`}
                        >
                          ✕
                        </button>
                      </span>
                    ))
                  )}
                </div>

                <div className="flex gap-1.5 mt-auto">
                  <input
                    type="text"
                    value={codeInputs[field] || ''}
                    onChange={e => setCodeInputs(prev => ({ ...prev, [field]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && addEntry(field)}
                    placeholder="Código Protheus..."
                    className="w-28 bg-surface-container-low border border-outline-variant rounded px-2 py-1.5 text-xs font-mono text-on-surface placeholder:text-outline/40 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                  />
                  <input
                    type="text"
                    value={valueInputs[field] || ''}
                    onChange={e => setValueInputs(prev => ({ ...prev, [field]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && addEntry(field)}
                    placeholder="Valor esperado..."
                    className="flex-1 bg-surface-container-low border border-outline-variant rounded px-2 py-1.5 text-xs font-mono text-on-surface placeholder:text-outline/40 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                  />
                  <button
                    onClick={() => addEntry(field)}
                    disabled={busy[field] || !(codeInputs[field] || '').trim() || !(valueInputs[field] || '').trim()}
                    className="px-3 py-1.5 bg-primary text-on-primary rounded text-xs font-bold hover:shadow-neon disabled:opacity-40 transition-all"
                    title="Adicionar (Enter)"
                  >
                    {busy[field] ? '…' : '+'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-5 py-3 bg-surface-container-highest border border-outline-variant rounded-lg shadow-lg text-sm text-on-surface animate-fade-in">
          ✓ {toast}
        </div>
      )}
    </div>
  )
}
