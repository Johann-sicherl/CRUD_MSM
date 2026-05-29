'use client'

import { useState, useEffect } from 'react'

const OPTION_LABELS: Record<string, string> = {
  accessory_color:       'Cor — Componentes',
  predominant_material:  'Material Predominante',
  processor:             'Processador',
  memory:                'Memória RAM',
  storage:               'Armazenamento',
  graphics_card:         'Placa de Vídeo',
  belt_load_capacity:    'Cap. Carga Esteira',
  tube_power:            'Potência Tubo',
  certificate:           'Certificado',
  belt_type:             'Tipo Esteira',
  motopolia_type:        'Tipo Motopolia',
  language:              'Idioma',
  equip_color:           'Cor — Equipamentos',
}

export default function OptionsPage() {
  const [allOptions, setAllOptions] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/field-options')
      .then(r => r.json())
      .then(d => { setAllOptions(d); setLoading(false) })
  }, [])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const addValue = async (key: string) => {
    const value = (inputs[key] || '').trim().toUpperCase()
    if (!value) return
    setBusy(prev => ({ ...prev, [key]: true }))
    const res = await fetch('/api/field-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    if (res.ok) {
      const updated: string[] = await res.json()
      setAllOptions(prev => ({ ...prev, [key]: updated }))
      setInputs(prev => ({ ...prev, [key]: '' }))
      showToast(`"${value}" adicionado`)
    }
    setBusy(prev => ({ ...prev, [key]: false }))
  }

  const deleteValue = async (key: string, value: string) => {
    const res = await fetch('/api/field-options', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    if (res.ok) {
      const updated: string[] = await res.json()
      setAllOptions(prev => ({ ...prev, [key]: updated }))
      showToast(`"${value}" removido`)
    }
  }

  return (
    <div className="p-6 max-w-[1400px]">
      {/* Header */}
      <div className="mb-6">
        <div className="text-[10px] font-mono text-outline uppercase tracking-[0.2em] mb-1">SISTEMA</div>
        <h1 className="text-2xl font-bold text-on-surface">Listas de Opções</h1>
        <p className="text-on-surface-variant text-sm mt-1">
          Gerencie os valores disponíveis para campos do tipo lista. Novos valores são salvos automaticamente em maiúsculo.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 py-16 text-outline">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-mono">Carregando...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Object.entries(OPTION_LABELS).map(([key, label]) => {
            const values = allOptions[key] || []
            return (
              <div key={key} className="bg-surface-container rounded border border-outline-variant p-4 flex flex-col gap-3">
                {/* Card header */}
                <div>
                  <h3 className="text-sm font-semibold text-on-surface">{label}</h3>
                  <div className="text-[10px] font-mono text-outline mt-0.5">{key}</div>
                </div>

                {/* Values */}
                <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                  {values.length === 0 ? (
                    <span className="text-xs text-outline italic">Nenhum valor cadastrado</span>
                  ) : (
                    values.map(val => (
                      <span
                        key={val}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-container-high border border-outline-variant rounded text-xs font-mono text-on-surface-variant group"
                      >
                        {val}
                        <button
                          onClick={() => deleteValue(key, val)}
                          className="text-outline/50 hover:text-error transition-colors leading-none ml-0.5"
                          title={`Remover "${val}"`}
                        >
                          ✕
                        </button>
                      </span>
                    ))
                  )}
                </div>

                {/* Add input */}
                <div className="flex gap-1.5 mt-auto">
                  <input
                    type="text"
                    value={inputs[key] || ''}
                    onChange={e => setInputs(prev => ({ ...prev, [key]: e.target.value.toUpperCase() }))}
                    onKeyDown={e => e.key === 'Enter' && addValue(key)}
                    placeholder="NOVO VALOR..."
                    className="flex-1 bg-surface-container-low border border-outline-variant rounded px-2 py-1.5 text-xs font-mono text-on-surface placeholder:text-outline/40 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 uppercase"
                  />
                  <button
                    onClick={() => addValue(key)}
                    disabled={busy[key] || !(inputs[key] || '').trim()}
                    className="px-3 py-1.5 bg-primary text-on-primary rounded text-xs font-bold hover:shadow-neon disabled:opacity-40 transition-all"
                    title="Adicionar (Enter)"
                  >
                    {busy[key] ? '…' : '+'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-5 py-3 bg-surface-container-highest border border-outline-variant rounded-lg shadow-lg text-sm text-on-surface animate-fade-in">
          ✓ {toast}
        </div>
      )}
    </div>
  )
}
