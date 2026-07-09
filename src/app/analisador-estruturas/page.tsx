'use client'

import { useRef, useState } from 'react'

interface PropertyResult {
  field: string
  matched: { code: string; value: string }[]
  computedValue: string | null
  dbValue: string | null
  status: 'ok' | 'mismatch' | 'duplicate'
}

interface AnalysisFile {
  id: string
  name: string
  protheusCode: string
  status: 'analyzing' | 'done' | 'error'
  errorMessage?: string
  equipmentFound?: boolean
  codesAnalyzed?: number
  properties?: PropertyResult[]
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

// The workbook has "2-Estruturas" (hierarchical BOM explosion) and
// "FLAT-LIST" (deduplicated flat list) — both carry a "CÓDIGO" column with
// the component codes that need to be checked against the parameter rules.
async function extractStructureCodes(file: File): Promise<string[]> {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const codes = new Set<string>()

  for (const wanted of ['2-Estruturas', 'FLAT-LIST']) {
    const actualName = wb.SheetNames.find(n => n.trim().toLowerCase() === wanted.toLowerCase())
    if (!actualName) continue
    const ws = wb.Sheets[actualName]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        if (key.trim().toUpperCase() === 'CÓDIGO') {
          const v = String(value ?? '').trim()
          if (v !== '') codes.add(v)
          break
        }
      }
    }
  }
  return Array.from(codes)
}

function Badge({ tone, children }: { tone: 'error' | 'amber' | 'outline' | 'success'; children: React.ReactNode }) {
  const cls = tone === 'error'
    ? 'text-error border-error/30 bg-error-container/20'
    : tone === 'amber'
    ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
    : tone === 'success'
    ? 'text-green-400 border-green-500/30 bg-green-500/10'
    : 'text-outline border-outline-variant bg-surface-container'
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {children}
    </span>
  )
}

export default function AnalisadorEstruturasPage() {
  const [files, setFiles] = useState<AnalysisFile[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    for (const file of Array.from(fileList)) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const protheusCode = file.name.replace(/\.xlsx?$/i, '').trim()
      setFiles(prev => [...prev, { id, name: file.name, protheusCode, status: 'analyzing' }])
      setExpandedId(prevId => prevId ?? id)

      try {
        const codes = await extractStructureCodes(file)
        const res = await fetch('/api/analisador-estruturas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ protheusCode, codes }),
        })
        const json = await res.json()
        if (!res.ok) {
          setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'error', errorMessage: json.error || 'Falha ao analisar' } : f))
          continue
        }
        setFiles(prev => prev.map(f => f.id === id ? {
          ...f,
          status: 'done',
          equipmentFound: json.equipmentFound,
          codesAnalyzed: json.codesAnalyzed,
          properties: json.properties,
        } : f))
      } catch {
        setFiles(prev => prev.map(f => f.id === id ? { ...f, status: 'error', errorMessage: 'Não foi possível ler este arquivo (.xlsx inválido)' } : f))
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id))
    setExpandedId(prev => (prev === id ? null : prev))
  }

  return (
    <div className="p-8 max-w-[108rem]">
      <div className="mb-6">
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Sistema · analisador de estruturas
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Analisador de Estruturas</h1>
        <p className="text-on-surface-variant text-base mt-1">
          Envie um ou mais arquivos .xlsx de estrutura (planilhas &quot;2-Estruturas&quot; e &quot;FLAT-LIST&quot;) —
          o nome do arquivo deve ser o código Protheus do equipamento. Cada código da estrutura é
          comparado com as regras cadastradas em{' '}
          <a href="/parametros-estrutura" className="text-primary hover:underline">Parâmetros de Estrutura</a>
          : se dois códigos do mesmo grupo indicarem valores diferentes, gera alerta de duplicidade;
          se o valor não bater com o cadastro do equipamento em Cadastro de Equipamentos, gera alerta de erro.
        </p>
      </div>

      <div className="mb-6">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          multiple
          onChange={e => handleFilesSelected(e.target.files)}
          className="hidden"
          id="structure-analyzer-file-input"
        />
        <label
          htmlFor="structure-analyzer-file-input"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary cursor-pointer transition-colors text-sm font-semibold"
        >
          ⇪ Selecionar arquivo(s) .xlsx
        </label>
      </div>

      {files.length === 0 ? (
        <div className="text-sm text-outline italic">Nenhum arquivo carregado ainda.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {files.map(file => {
            const isOpen = expandedId === file.id
            const props = file.properties || []
            const errorCount = props.filter(p => p.status === 'mismatch').length
            const duplicateCount = props.filter(p => p.status === 'duplicate').length
            return (
              <div key={file.id} className="rounded-xl border border-outline-variant bg-surface-container overflow-hidden">
                <div
                  className="flex items-center justify-between gap-3 px-5 py-3.5 cursor-pointer hover:bg-surface-container-high transition-colors"
                  onClick={() => setExpandedId(isOpen ? null : file.id)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="font-mono text-sm text-on-surface truncate">{file.name}</span>
                    <Badge tone="outline">Cód. {file.protheusCode}</Badge>
                    {file.status === 'analyzing' && <Badge tone="outline">Analisando…</Badge>}
                    {file.status === 'error' && <Badge tone="error">{file.errorMessage}</Badge>}
                    {file.status === 'done' && (
                      <>
                        {file.equipmentFound
                          ? <Badge tone="success">Equipamento encontrado</Badge>
                          : <Badge tone="error">Equipamento não encontrado</Badge>}
                        {errorCount > 0 && <Badge tone="error">{errorCount} erro(s)</Badge>}
                        {duplicateCount > 0 && <Badge tone="amber">{duplicateCount} duplicidade(s)</Badge>}
                        {errorCount === 0 && duplicateCount === 0 && <Badge tone="success">Tudo OK</Badge>}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); removeFile(file.id) }}
                      className="text-outline hover:text-error text-sm px-1"
                      title="Remover da lista"
                    >
                      ✕
                    </button>
                    <span className={`text-outline text-lg leading-none transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
                  </div>
                </div>

                {isOpen && file.status === 'done' && (
                  <div className="border-t border-outline-variant p-5">
                    {props.length === 0 ? (
                      <div className="text-sm text-outline italic">Nenhum código da estrutura corresponde a alguma regra cadastrada.</div>
                    ) : (
                      <div className="overflow-auto border border-outline-variant rounded-lg">
                        <table className="text-xs w-full">
                          <thead className="bg-surface-container-highest">
                            <tr>
                              <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Propriedade</th>
                              <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Valor Esperado (Estrutura)</th>
                              <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Código(s) que Geraram</th>
                              <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Valor no Banco</th>
                              <th className="text-left px-3 py-2 font-semibold text-on-surface-variant">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {props.map((p: PropertyResult) => (
                              <tr key={p.field} className={`border-t border-outline-variant/50 ${
                                p.status === 'mismatch' ? 'bg-error-container/10' : p.status === 'duplicate' ? 'bg-amber-500/5' : ''
                              }`}>
                                <td className="px-3 py-2 font-semibold text-on-surface whitespace-nowrap">
                                  {FIELD_LABELS[p.field] || p.field}
                                </td>
                                <td className="px-3 py-2 text-on-surface">
                                  {p.status === 'duplicate' ? <span className="text-amber-400 italic">valores conflitantes</span> : (p.computedValue ?? '—')}
                                </td>
                                <td className="px-3 py-2 text-outline font-mono">
                                  {p.matched.map(m => `${m.code} → ${m.value}`).join(' · ')}
                                </td>
                                <td className="px-3 py-2 text-on-surface">{p.dbValue ?? '—'}</td>
                                <td className="px-3 py-2">
                                  {p.status === 'ok' && <Badge tone="success">OK</Badge>}
                                  {p.status === 'mismatch' && <Badge tone="error">Erro — diverge do banco</Badge>}
                                  {p.status === 'duplicate' && <Badge tone="amber">Duplicidade</Badge>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
