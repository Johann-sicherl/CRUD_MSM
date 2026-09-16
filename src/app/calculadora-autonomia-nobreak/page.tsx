'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  upsTechnologies, upsByTechnology, findBatteryGroup, nearestBatteryGroup,
  equipmentApparentPowerVA, calculateAutonomy, formatHoursAsHM,
  type UpsModel, type BatteryGroup, type ExternalBatteryModule,
  type EquipmentBomComponent, type EquipmentLoadParams, type LoadSegment,
} from '@/lib/upsAutonomyCalc'

const MANUAL_EQUIPMENT = 'Manual (digitar valores)'
const NO_EXTERNAL = 'Nenhuma'

function NumberField({ label, value, onChange, step = 1, suffix }: {
  label: string
  value: number
  onChange: (v: number) => void
  step?: number
  suffix?: string
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
      <span>{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          step={step}
          value={value}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          className="w-full bg-surface-container-low border border-outline-variant rounded px-2.5 py-1.5 text-sm text-on-surface focus:outline-none focus:border-primary"
        />
        {suffix && <span className="text-outline text-xs shrink-0">{suffix}</span>}
      </div>
    </label>
  )
}

function Cell({ value, onChange, type = 'text', width = 'w-28' }: {
  value: string | number
  onChange: (v: string) => void
  type?: 'text' | 'number'
  width?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      step={type === 'number' ? 'any' : undefined}
      className={`${width} bg-transparent px-2 py-1.5 rounded hover:bg-surface-container-high focus:bg-surface-container-high focus:outline-none font-mono text-on-surface text-xs`}
    />
  )
}

interface CatalogState {
  ups: UpsModel[]
  batteryGroups: BatteryGroup[]
  batteryExternal: ExternalBatteryModule[]
}

interface EquipmentState {
  equipmentNames: string[]
  equipmentBom: EquipmentBomComponent[]
  equipmentLoadParams: Record<string, EquipmentLoadParams>
}

const blankUps = (): UpsModel => ({
  brand: '', model: '', fullId: '', technology: '', code: `novo-${Date.now()}`,
  apparentPowerVA: 0, pf: 0, activePowerW: 0, peakActivePowerW: null,
  batteryVoltageV: 12, bankCapacityAh: 0, energyWh: 0, batteryType: '',
  batteryExpansion: 'Não', family: '', output: '', input: '',
  batteryLines: 1, batteryCapacityAh: 7.2, erpCode: null,
})

const blankExternal = (): ExternalBatteryModule => ({
  brand: '', product: '', fullId: '', spec: '', code: `novo-${Date.now()}`,
  voltageV: 12, bankCapacityAh: 0, lines: 1, seriesCount: 1,
  batteryCapacityAh: 7.2, energyWh: 0, family: '', erpCode: null,
})

const blankBatteryGroup = (): BatteryGroup => ({
  capacityAh: 0, name: '', curve: { a: 0, b: 1, c: 1, d: 0, e: 0 },
})

const blankLoadParams = (): EquipmentLoadParams => ({
  activeTimeS: 0, standbyTimeS: 0, activePf: 0.95, standbyPf: 0.85, powerSafetyFactor: 0.4,
})

export default function CalculadoraAutonomiaNobreakPage() {
  const [tab, setTab] = useState<'calculadora' | 'catalogos'>('calculadora')
  const [loadingData, setLoadingData] = useState(true)
  const [dataError, setDataError] = useState('')
  const [catalog, setCatalog] = useState<CatalogState>({ ups: [], batteryGroups: [], batteryExternal: [] })
  const [equipment, setEquipment] = useState<EquipmentState>({ equipmentNames: [], equipmentBom: [], equipmentLoadParams: {} })

  const [catalogSaving, setCatalogSaving] = useState(false)
  const [catalogSaveMsg, setCatalogSaveMsg] = useState('')
  const [equipmentSaving, setEquipmentSaving] = useState(false)
  const [equipmentSaveMsg, setEquipmentSaveMsg] = useState('')

  const loadAll = async () => {
    setLoadingData(true)
    setDataError('')
    try {
      const [catRes, eqRes] = await Promise.all([
        fetch('/api/ups-autonomy-catalog'),
        fetch('/api/ups-autonomy-equipment'),
      ])
      if (!catRes.ok || !eqRes.ok) { setDataError('Falha ao carregar os catálogos'); return }
      setCatalog(await catRes.json())
      setEquipment(await eqRes.json())
    } catch {
      setDataError('Falha de rede ao carregar os catálogos')
    } finally {
      setLoadingData(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  const saveCatalog = async (next: CatalogState) => {
    setCatalogSaving(true)
    setCatalogSaveMsg('')
    try {
      const res = await fetch('/api/ups-autonomy-catalog', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      const json = await res.json()
      if (!res.ok) { setCatalogSaveMsg(`⚠ ${json.error || 'Falha ao salvar'}`); return }
      setCatalog(next)
      setCatalogSaveMsg('✓ Catálogo salvo')
    } catch {
      setCatalogSaveMsg('⚠ Falha de rede ao salvar')
    } finally {
      setCatalogSaving(false)
    }
  }

  const saveEquipment = async (next: EquipmentState) => {
    setEquipmentSaving(true)
    setEquipmentSaveMsg('')
    try {
      const res = await fetch('/api/ups-autonomy-equipment', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      const json = await res.json()
      if (!res.ok) { setEquipmentSaveMsg(`⚠ ${json.error || 'Falha ao salvar'}`); return }
      setEquipment(next)
      setEquipmentSaveMsg('✓ Equipamentos salvos')
    } catch {
      setEquipmentSaveMsg('⚠ Falha de rede ao salvar')
    } finally {
      setEquipmentSaving(false)
    }
  }

  return (
    // Sem max-w fixo — mesma convenção de qualquer tela de tabela larga
    // (ver specs/ui-componentes.md): um cap fixo deixa a tela visivelmente
    // mais estreita que o resto do app em painéis largos, ainda mais
    // notável aqui com as tabelas de catálogo (19 colunas em alguns casos).
    <div className="p-8 flex flex-col gap-8">
      <div>
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Sistema · calculadora-autonomia-nobreak
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Calculadora de Autonomia de Nobreak</h1>
        <p className="text-on-surface-variant text-base mt-1 max-w-3xl">
          Estima a autonomia (h:min) de um banco de baterias sob um UPS/nobreak, a partir da carga aplicada,
          do modelo de UPS e da configuração do banco de baterias interno/externo.
        </p>
      </div>

      <div className="flex items-center gap-2 border-b border-outline-variant">
        <button
          onClick={() => setTab('calculadora')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${tab === 'calculadora' ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}
        >
          Calculadora
        </button>
        <button
          onClick={() => setTab('catalogos')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${tab === 'catalogos' ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}
        >
          Catálogos (UPS, bateria, equipamentos)
        </button>
      </div>

      {loadingData ? (
        <div className="flex items-center gap-3 py-16 text-outline">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-base font-mono">Carregando catálogos...</span>
        </div>
      ) : dataError ? (
        <div className="bg-error-container/20 border border-error/30 text-error rounded-lg px-4 py-3 text-sm">{dataError}</div>
      ) : tab === 'calculadora' ? (
        <CalculatorTab catalog={catalog} equipment={equipment} />
      ) : (
        <CatalogosTab
          catalog={catalog} setCatalog={setCatalog} saveCatalog={saveCatalog}
          catalogSaving={catalogSaving} catalogSaveMsg={catalogSaveMsg}
          equipment={equipment} setEquipment={setEquipment} saveEquipment={saveEquipment}
          equipmentSaving={equipmentSaving} equipmentSaveMsg={equipmentSaveMsg}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Aba "Calculadora"
// ─────────────────────────────────────────────────────────────────────────

function CalculatorTab({ catalog, equipment }: { catalog: CatalogState; equipment: EquipmentState }) {
  const { ups: UPS_CATALOG, batteryGroups: BATTERY_GROUPS, batteryExternal: EXTERNAL_BATTERY_CATALOG } = catalog
  const { equipmentNames: EQUIPMENT_NAMES, equipmentBom: EQUIPMENT_BOM, equipmentLoadParams: EQUIPMENT_LOAD_PARAMS } = equipment

  const [equipmentName, setEquipmentName] = useState(MANUAL_EQUIPMENT)
  const [activeVA, setActiveVA] = useState(732)
  const [standbyVA, setStandbyVA] = useState(255)
  const [activeTimeS, setActiveTimeS] = useState(7)
  const [standbyTimeS, setStandbyTimeS] = useState(23)
  const [activePf, setActivePf] = useState(0.95)
  const [standbyPf, setStandbyPf] = useState(0.85)
  const [powerSafetyFactor, setPowerSafetyFactor] = useState(0.4)

  const applyEquipment = (name: string) => {
    setEquipmentName(name)
    if (name === MANUAL_EQUIPMENT) return
    const { active, standby } = equipmentApparentPowerVA(EQUIPMENT_BOM, name)
    const params = EQUIPMENT_LOAD_PARAMS[name]
    setActiveVA(active)
    setStandbyVA(standby)
    if (params) {
      setActiveTimeS(params.activeTimeS)
      setStandbyTimeS(params.standbyTimeS)
      setActivePf(params.activePf)
      setStandbyPf(params.standbyPf)
      setPowerSafetyFactor(params.powerSafetyFactor)
    }
  }

  const [technology, setTechnology] = useState('Todos')
  const technologies = useMemo(() => upsTechnologies(UPS_CATALOG), [UPS_CATALOG])
  const upsOptions = useMemo(() => upsByTechnology(UPS_CATALOG, technology), [UPS_CATALOG, technology])
  const [selectedUpsId, setSelectedUpsId] = useState('')
  useEffect(() => { if (!selectedUpsId && UPS_CATALOG[0]) setSelectedUpsId(UPS_CATALOG[0].code) }, [UPS_CATALOG, selectedUpsId])
  const selectedUps: UpsModel | undefined = useMemo(
    () => UPS_CATALOG.find(u => u.code === selectedUpsId) ?? upsOptions[0],
    [selectedUpsId, upsOptions, UPS_CATALOG]
  )

  const [internalOverride, setInternalOverride] = useState<{ seriesCount: number; lines: number; capacityAh: number } | null>(null)
  const internalDefaults = useMemo(() => {
    if (!selectedUps || BATTERY_GROUPS.length === 0) return { seriesCount: 1, lines: 1, capacityAh: BATTERY_GROUPS[0]?.capacityAh ?? 0 }
    const group = findBatteryGroup(BATTERY_GROUPS, selectedUps.batteryCapacityAh) ?? nearestBatteryGroup(BATTERY_GROUPS, selectedUps.batteryCapacityAh)
    return {
      seriesCount: Math.round(selectedUps.batteryVoltageV / 12) || 1,
      lines: selectedUps.batteryLines || 1,
      capacityAh: group.capacityAh,
    }
  }, [selectedUps, BATTERY_GROUPS])
  const internalBattery = internalOverride ?? internalDefaults
  const internalIsApproximated = selectedUps ? !findBatteryGroup(BATTERY_GROUPS, selectedUps.batteryCapacityAh) : false

  const selectUps = (code: string) => {
    setSelectedUpsId(code)
    setInternalOverride(null)
  }

  const [externalId, setExternalId] = useState(NO_EXTERNAL)
  const externalModule = EXTERNAL_BATTERY_CATALOG.find(m => m.code === externalId)
  const externalBattery = externalModule
    ? { seriesCount: externalModule.seriesCount, lines: externalModule.lines, capacityAh: externalModule.batteryCapacityAh }
    : null

  const [upsPf, setUpsPf] = useState(0.9)
  const [batteryEfficiency, setBatteryEfficiency] = useState(0.95)
  const [autonomySafetyFactor, setAutonomySafetyFactor] = useState(0.2)
  const [ambientTempC, setAmbientTempC] = useState(15)

  const result = useMemo(() => {
    if (!selectedUps || BATTERY_GROUPS.length === 0) return null
    const loadSegments: LoadSegment[] = [
      { label: 'Ativo', apparentPowerVA: activeVA, timeS: activeTimeS, pf: activePf },
      { label: 'Stand By', apparentPowerVA: standbyVA, timeS: standbyTimeS, pf: standbyPf },
    ]
    try {
      return calculateAutonomy({
        loadSegments,
        selectedUps,
        batteryGroups: BATTERY_GROUPS,
        internalBattery,
        externalBattery,
        upsPf,
        batteryEfficiency,
        autonomySafetyFactor,
        ambientTempC,
        powerSafetyFactor,
      })
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Erro ao calcular' }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUps, BATTERY_GROUPS, activeVA, standbyVA, activeTimeS, standbyTimeS, activePf, standbyPf,
      internalBattery, externalBattery, upsPf, batteryEfficiency, autonomySafetyFactor, ambientTempC, powerSafetyFactor])

  const hasError = result && 'error' in result

  if (UPS_CATALOG.length === 0) {
    return (
      <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-lg px-4 py-3 text-sm">
        Nenhum modelo de UPS cadastrado ainda — vá na aba &quot;Catálogos&quot; e cadastre pelo menos um.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ── Carga ── */}
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-on-surface">1. Carga</h2>

          <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
            <span>Equipamento (preenche automaticamente a partir do BOM cadastrado)</span>
            <select
              value={equipmentName}
              onChange={e => applyEquipment(e.target.value)}
              className="bg-surface-container-low border border-outline-variant rounded px-2.5 py-1.5 text-sm text-on-surface focus:outline-none focus:border-primary"
            >
              <option value={MANUAL_EQUIPMENT}>{MANUAL_EQUIPMENT}</option>
              {EQUIPMENT_NAMES.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>

          <div className="rounded-xl border border-outline-variant bg-surface-container p-4 flex flex-col gap-3">
            <div className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Ativo</div>
            <div className="grid grid-cols-3 gap-3">
              <NumberField label="Potência aparente" value={activeVA} onChange={setActiveVA} suffix="VA" />
              <NumberField label="Tempo" value={activeTimeS} onChange={setActiveTimeS} suffix="s" />
              <NumberField label="FP" value={activePf} onChange={setActivePf} step={0.01} />
            </div>
          </div>

          <div className="rounded-xl border border-outline-variant bg-surface-container p-4 flex flex-col gap-3">
            <div className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Stand By</div>
            <div className="grid grid-cols-3 gap-3">
              <NumberField label="Potência aparente" value={standbyVA} onChange={setStandbyVA} suffix="VA" />
              <NumberField label="Tempo" value={standbyTimeS} onChange={setStandbyTimeS} suffix="s" />
              <NumberField label="FP" value={standbyPf} onChange={setStandbyPf} step={0.01} />
            </div>
          </div>

          <NumberField label="FS Potência (margem de segurança sobre a potência de pico)" value={powerSafetyFactor} onChange={setPowerSafetyFactor} step={0.05} />
        </section>

        {/* ── UPS ── */}
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-on-surface">2. UPS</h2>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              <span>Tecnologia</span>
              <select
                value={technology}
                onChange={e => { setTechnology(e.target.value); setInternalOverride(null) }}
                className="bg-surface-container-low border border-outline-variant rounded px-2.5 py-1.5 text-sm text-on-surface focus:outline-none focus:border-primary"
              >
                <option value="Todos">Todos</option>
                {technologies.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              <span>Modelo</span>
              <select
                value={selectedUps?.code ?? ''}
                onChange={e => selectUps(e.target.value)}
                className="bg-surface-container-low border border-outline-variant rounded px-2.5 py-1.5 text-sm text-on-surface focus:outline-none focus:border-primary"
              >
                {upsOptions.map(u => <option key={u.code} value={u.code}>{u.fullId || `${u.brand} ${u.model}`}</option>)}
              </select>
            </label>
          </div>

          {selectedUps && (
            <div className="rounded-xl border border-outline-variant bg-surface-container p-4 text-xs text-on-surface-variant grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono">
              <span>Pot. aparente: <b className="text-on-surface">{selectedUps.apparentPowerVA} VA</b></span>
              <span>FP: <b className="text-on-surface">{selectedUps.pf}</b></span>
              <span>Pot. ativa: <b className="text-on-surface">{selectedUps.activePowerW} W</b></span>
              <span>Tensão bateria: <b className="text-on-surface">{selectedUps.batteryVoltageV} V</b></span>
              <span>Expansão bat. externa: <b className="text-on-surface">{selectedUps.batteryExpansion}</b></span>
              <span>Tipo bateria: <b className="text-on-surface">{selectedUps.batteryType}</b></span>
            </div>
          )}

          <h2 className="text-lg font-semibold text-on-surface mt-2">3. Banco de baterias</h2>

          <div className="rounded-xl border border-outline-variant bg-surface-container p-4 flex flex-col gap-3">
            <div className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Interno (do próprio UPS)</div>
            {internalIsApproximated && (
              <p className="text-[11px] text-amber-400">
                Este UPS usa bateria de {selectedUps?.batteryCapacityAh} Ah, sem curva de descarga própria —
                usando a curva de {internalBattery.capacityAh} Ah (mais próxima) como aproximação.
              </p>
            )}
            <div className="grid grid-cols-3 gap-3">
              <NumberField
                label="Nº bat. série"
                value={internalBattery.seriesCount}
                onChange={v => setInternalOverride({ ...internalBattery, seriesCount: v })}
              />
              <NumberField
                label="Nº linhas"
                value={internalBattery.lines}
                onChange={v => setInternalOverride({ ...internalBattery, lines: v })}
              />
              <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
                <span>Capacidade (Ah)</span>
                <select
                  value={internalBattery.capacityAh}
                  onChange={e => setInternalOverride({ ...internalBattery, capacityAh: parseFloat(e.target.value) })}
                  className="bg-surface-container-low border border-outline-variant rounded px-2.5 py-1.5 text-sm text-on-surface focus:outline-none focus:border-primary"
                >
                  {BATTERY_GROUPS.map(g => <option key={g.capacityAh} value={g.capacityAh}>{g.capacityAh} Ah</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-outline-variant bg-surface-container p-4 flex flex-col gap-3">
            <div className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Externo (opcional)</div>
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              <span>Módulo</span>
              <select
                value={externalId}
                onChange={e => setExternalId(e.target.value)}
                className="bg-surface-container-low border border-outline-variant rounded px-2.5 py-1.5 text-sm text-on-surface focus:outline-none focus:border-primary"
              >
                <option value={NO_EXTERNAL}>{NO_EXTERNAL}</option>
                {EXTERNAL_BATTERY_CATALOG.map(m => <option key={m.code} value={m.code}>{m.fullId || `${m.brand} ${m.product}`}</option>)}
              </select>
            </label>
            {externalModule && (
              <div className="text-[11px] text-on-surface-variant font-mono">
                {externalModule.seriesCount}× em série · {externalModule.lines}× linha(s) · {externalModule.batteryCapacityAh} Ah/bateria ·
                {' '}{externalModule.energyWh} Wh
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ── Parâmetros gerais ── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-on-surface">4. Parâmetros gerais</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl">
          <NumberField label="FP UPS" value={upsPf} onChange={setUpsPf} step={0.01} />
          <NumberField label="Rendimento bateria" value={batteryEfficiency} onChange={setBatteryEfficiency} step={0.01} />
          <NumberField label="FS Autonomia" value={autonomySafetyFactor} onChange={setAutonomySafetyFactor} step={0.05} />
          <NumberField label="Menor temp. média" value={ambientTempC} onChange={setAmbientTempC} suffix="°C" />
        </div>
      </section>

      {/* ── Resultado ── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-on-surface">Resultado</h2>

        {hasError && (
          <div className="bg-error-container/20 border border-error/30 text-error rounded-lg px-4 py-3 text-sm">
            {'error' in result! ? result.error : ''}
          </div>
        )}

        {result && !hasError && 'autonomyHours' in result && (
          <>
            <div className="rounded-xl border-2 border-primary/40 bg-primary/10 p-6 flex flex-col items-center gap-1">
              <span className="text-xs uppercase tracking-widest text-primary/80 font-mono">Autonomia estimada</span>
              <span className="text-4xl font-bold text-primary font-mono">{formatHoursAsHM(result.autonomyHours)}</span>
            </div>

            {result.warnings.length > 0 && (
              <div className="flex flex-col gap-2">
                {result.warnings.map((w, i) => (
                  <div key={i} className="bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-lg px-4 py-2.5 text-sm">
                    ⚠ {w}
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-xl border border-outline-variant bg-surface-container p-4 text-xs text-on-surface-variant grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 font-mono">
              <span>Pot. ativa máx.: <b className="text-on-surface">{result.maxActivePowerW.toFixed(1)} W</b></span>
              <span>Pot. ativa média: <b className="text-on-surface">{result.avgActivePowerW.toFixed(1)} W</b></span>
              <span>Pot. aparente média: <b className="text-on-surface">{result.avgApparentPowerVA.toFixed(1)} VA</b></span>
              <span>Pot. mín. UPS (aparente): <b className="text-on-surface">{result.minUpsApparentPowerVA.toFixed(1)} VA</b></span>
              <span>Pot. mín. UPS (ativa): <b className="text-on-surface">{result.minUpsActivePowerW.toFixed(1)} W</b></span>
              <span>Pot. média consumida da bateria: <b className="text-on-surface">{result.avgBatteryPowerW.toFixed(1)} W</b></span>
              <span>Energia banco interno: <b className="text-on-surface">{result.internalTotalEnergyWh.toFixed(1)} Wh</b></span>
              <span>Energia banco externo: <b className="text-on-surface">{result.externalTotalEnergyWh.toFixed(1)} Wh</b></span>
              <span>Fator de derating (temp.): <b className="text-on-surface">{(result.temperatureFactor * 100).toFixed(1)}%</b></span>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Aba "Catálogos" — os 4 catálogos editáveis (pedido explícito do
// usuário: "Tudo" quando perguntado quais precisava editar pela tela).
// Cada catálogo é um GET/PUT que substitui a lista inteira, mesmo padrão
// de structure-property-rules.ts — nada de save parcial.
// ─────────────────────────────────────────────────────────────────────────

function CatalogosTab({
  catalog, setCatalog, saveCatalog, catalogSaving, catalogSaveMsg,
  equipment, setEquipment, saveEquipment, equipmentSaving, equipmentSaveMsg,
}: {
  catalog: CatalogState
  setCatalog: (c: CatalogState) => void
  saveCatalog: (c: CatalogState) => void
  catalogSaving: boolean
  catalogSaveMsg: string
  equipment: EquipmentState
  setEquipment: (e: EquipmentState) => void
  saveEquipment: (e: EquipmentState) => void
  equipmentSaving: boolean
  equipmentSaveMsg: string
}) {
  return (
    <div className="flex flex-col gap-12">
      <UpsCatalogEditor catalog={catalog} setCatalog={setCatalog} save={saveCatalog} saving={catalogSaving} saveMsg={catalogSaveMsg} />
      <BatteryGroupsEditor catalog={catalog} setCatalog={setCatalog} save={saveCatalog} saving={catalogSaving} saveMsg={catalogSaveMsg} />
      <ExternalBatteryEditor catalog={catalog} setCatalog={setCatalog} save={saveCatalog} saving={catalogSaving} saveMsg={catalogSaveMsg} />
      <EquipmentEditor equipment={equipment} setEquipment={setEquipment} save={saveEquipment} saving={equipmentSaving} saveMsg={equipmentSaveMsg} />
    </div>
  )
}

function SaveBar({ onSave, saving, saveMsg }: { onSave: () => void; saving: boolean; saveMsg: string }) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onSave}
        disabled={saving}
        className="px-5 py-2 bg-primary text-on-primary rounded text-sm font-semibold hover:shadow-neon transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? 'Salvando…' : 'Salvar'}
      </button>
      {saveMsg && <span className="text-sm">{saveMsg}</span>}
    </div>
  )
}

function UpsCatalogEditor({ catalog, setCatalog, save, saving, saveMsg }: {
  catalog: CatalogState; setCatalog: (c: CatalogState) => void; save: (c: CatalogState) => void; saving: boolean; saveMsg: string
}) {
  const update = (i: number, field: keyof UpsModel, value: string) => {
    const list = catalog.ups.slice()
    const row = { ...list[i] }
    const numeric: (keyof UpsModel)[] = ['apparentPowerVA', 'pf', 'activePowerW', 'batteryVoltageV', 'bankCapacityAh', 'energyWh', 'batteryLines', 'batteryCapacityAh']
    if (field === 'peakActivePowerW') {
      (row as UpsModel).peakActivePowerW = value === '' ? null : parseFloat(value) || 0
    } else if (numeric.includes(field)) {
      (row as unknown as Record<string, number>)[field] = parseFloat(value) || 0
    } else {
      (row as unknown as Record<string, string>)[field] = value
    }
    list[i] = row
    setCatalog({ ...catalog, ups: list })
  }
  const addRow = () => setCatalog({ ...catalog, ups: [...catalog.ups, blankUps()] })
  const removeRow = (i: number) => setCatalog({ ...catalog, ups: catalog.ups.filter((_, idx) => idx !== i) })

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-on-surface">Modelos de UPS ({catalog.ups.length})</h2>
      <div className="overflow-auto border border-outline-variant rounded-lg max-h-[32rem]">
        <table className="text-xs w-full">
          <thead className="sticky top-0 bg-surface-container-highest z-10">
            <tr>
              {['Marca', 'Modelo', 'ID completa', 'Tecnologia', 'Código', 'VA', 'FP', 'W ativa', 'W pico', 'V bat.', 'Cap. banco (Ah)', 'Energia (Wh)', 'Tipo bat.', 'Expansão', 'Família', 'Saída', 'Entrada', 'Linhas bat.', 'Cap. bat. (Ah)', 'Cód. ERP', ''].map(h => (
                <th key={h} className="text-left px-2 py-2 font-semibold text-on-surface-variant whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {catalog.ups.map((u, i) => (
              <tr key={u.code || i} className="border-t border-outline-variant/50 odd:bg-surface-container-low">
                <td><Cell value={u.brand} onChange={v => update(i, 'brand', v)} width="w-20" /></td>
                <td><Cell value={u.model} onChange={v => update(i, 'model', v)} width="w-32" /></td>
                <td><Cell value={u.fullId} onChange={v => update(i, 'fullId', v)} width="w-64" /></td>
                <td><Cell value={u.technology} onChange={v => update(i, 'technology', v)} width="w-28" /></td>
                <td><Cell value={u.code} onChange={v => update(i, 'code', v)} width="w-32" /></td>
                <td><Cell type="number" value={u.apparentPowerVA} onChange={v => update(i, 'apparentPowerVA', v)} width="w-20" /></td>
                <td><Cell type="number" value={u.pf} onChange={v => update(i, 'pf', v)} width="w-16" /></td>
                <td><Cell type="number" value={u.activePowerW} onChange={v => update(i, 'activePowerW', v)} width="w-20" /></td>
                <td><Cell type="number" value={u.peakActivePowerW ?? ''} onChange={v => update(i, 'peakActivePowerW', v)} width="w-20" /></td>
                <td><Cell type="number" value={u.batteryVoltageV} onChange={v => update(i, 'batteryVoltageV', v)} width="w-16" /></td>
                <td><Cell type="number" value={u.bankCapacityAh} onChange={v => update(i, 'bankCapacityAh', v)} width="w-20" /></td>
                <td><Cell type="number" value={u.energyWh} onChange={v => update(i, 'energyWh', v)} width="w-20" /></td>
                <td><Cell value={u.batteryType} onChange={v => update(i, 'batteryType', v)} width="w-24" /></td>
                <td>
                  <select
                    value={u.batteryExpansion}
                    onChange={e => update(i, 'batteryExpansion', e.target.value)}
                    className="w-24 bg-transparent px-1.5 py-1.5 rounded hover:bg-surface-container-high focus:bg-surface-container-high focus:outline-none text-on-surface text-xs"
                  >
                    <option value="Sim">Sim</option>
                    <option value="Não">Não</option>
                    <option value="Opcional">Opcional</option>
                  </select>
                </td>
                <td><Cell value={u.family} onChange={v => update(i, 'family', v)} width="w-20" /></td>
                <td><Cell value={u.output} onChange={v => update(i, 'output', v)} width="w-24" /></td>
                <td><Cell value={u.input} onChange={v => update(i, 'input', v)} width="w-24" /></td>
                <td><Cell type="number" value={u.batteryLines} onChange={v => update(i, 'batteryLines', v)} width="w-16" /></td>
                <td><Cell type="number" value={u.batteryCapacityAh} onChange={v => update(i, 'batteryCapacityAh', v)} width="w-20" /></td>
                <td><Cell value={u.erpCode ?? ''} onChange={v => update(i, 'erpCode', v)} width="w-28" /></td>
                <td className="text-center px-1">
                  <button onClick={() => removeRow(i)} className="text-outline hover:text-error transition-colors text-base" title="Remover modelo">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={addRow} className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors">
          + Modelo de UPS
        </button>
        <SaveBar onSave={() => save(catalog)} saving={saving} saveMsg={saveMsg} />
      </div>
    </section>
  )
}

function BatteryGroupsEditor({ catalog, setCatalog, save, saving, saveMsg }: {
  catalog: CatalogState; setCatalog: (c: CatalogState) => void; save: (c: CatalogState) => void; saving: boolean; saveMsg: string
}) {
  const update = (i: number, field: 'capacityAh' | 'name', value: string) => {
    const list = catalog.batteryGroups.slice()
    const row = { ...list[i] }
    if (field === 'capacityAh') row.capacityAh = parseFloat(value) || 0
    else row.name = value
    list[i] = row
    setCatalog({ ...catalog, batteryGroups: list })
  }
  const updateCurve = (i: number, field: keyof BatteryGroup['curve'], value: string) => {
    const list = catalog.batteryGroups.slice()
    list[i] = { ...list[i], curve: { ...list[i].curve, [field]: parseFloat(value) || 0 } }
    setCatalog({ ...catalog, batteryGroups: list })
  }
  const addRow = () => setCatalog({ ...catalog, batteryGroups: [...catalog.batteryGroups, blankBatteryGroup()] })
  const removeRow = (i: number) => setCatalog({ ...catalog, batteryGroups: catalog.batteryGroups.filter((_, idx) => idx !== i) })

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-on-surface">Grupos de capacidade de bateria ({catalog.batteryGroups.length})</h2>
      <p className="text-xs text-on-surface-variant max-w-2xl">
        Cada grupo é a curva de energia ajustada a partir da tabela de descarga do fabricante daquela
        capacidade (Ah) — E(P) = a·(e^(-P/b) + e^(-P/c) + e^(-P/d)) + e/P. Só mexa nos coeficientes se
        tiver uma tabela de descarga nova do fabricante pra reajustar.
      </p>
      <div className="overflow-auto border border-outline-variant rounded-lg">
        <table className="text-xs w-full">
          <thead className="bg-surface-container-highest">
            <tr>
              {['Capacidade (Ah)', 'Nome/modelo', 'a', 'b', 'c', 'd', 'e', ''].map(h => (
                <th key={h} className="text-left px-2 py-2 font-semibold text-on-surface-variant whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {catalog.batteryGroups.map((g, i) => (
              <tr key={i} className="border-t border-outline-variant/50 odd:bg-surface-container-low">
                <td><Cell type="number" value={g.capacityAh} onChange={v => update(i, 'capacityAh', v)} width="w-24" /></td>
                <td><Cell value={g.name} onChange={v => update(i, 'name', v)} width="w-72" /></td>
                <td><Cell type="number" value={g.curve.a} onChange={v => updateCurve(i, 'a', v)} width="w-24" /></td>
                <td><Cell type="number" value={g.curve.b} onChange={v => updateCurve(i, 'b', v)} width="w-24" /></td>
                <td><Cell type="number" value={g.curve.c} onChange={v => updateCurve(i, 'c', v)} width="w-24" /></td>
                <td><Cell type="number" value={g.curve.d} onChange={v => updateCurve(i, 'd', v)} width="w-24" /></td>
                <td><Cell type="number" value={g.curve.e} onChange={v => updateCurve(i, 'e', v)} width="w-24" /></td>
                <td className="text-center px-1">
                  <button onClick={() => removeRow(i)} className="text-outline hover:text-error transition-colors text-base" title="Remover grupo">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={addRow} className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors">
          + Grupo de capacidade
        </button>
        <SaveBar onSave={() => save(catalog)} saving={saving} saveMsg={saveMsg} />
      </div>
    </section>
  )
}

function ExternalBatteryEditor({ catalog, setCatalog, save, saving, saveMsg }: {
  catalog: CatalogState; setCatalog: (c: CatalogState) => void; save: (c: CatalogState) => void; saving: boolean; saveMsg: string
}) {
  const update = (i: number, field: keyof ExternalBatteryModule, value: string) => {
    const list = catalog.batteryExternal.slice()
    const row = { ...list[i] }
    const numeric: (keyof ExternalBatteryModule)[] = ['voltageV', 'bankCapacityAh', 'lines', 'seriesCount', 'batteryCapacityAh', 'energyWh']
    if (numeric.includes(field)) (row as unknown as Record<string, number>)[field] = parseFloat(value) || 0
    else (row as unknown as Record<string, string>)[field] = value
    list[i] = row
    setCatalog({ ...catalog, batteryExternal: list })
  }
  const addRow = () => setCatalog({ ...catalog, batteryExternal: [...catalog.batteryExternal, blankExternal()] })
  const removeRow = (i: number) => setCatalog({ ...catalog, batteryExternal: catalog.batteryExternal.filter((_, idx) => idx !== i) })

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-on-surface">Módulos de bateria externa ({catalog.batteryExternal.length})</h2>
      <div className="overflow-auto border border-outline-variant rounded-lg max-h-[28rem]">
        <table className="text-xs w-full">
          <thead className="sticky top-0 bg-surface-container-highest z-10">
            <tr>
              {['Marca', 'Produto', 'ID completa', 'Especificação', 'Código', 'V', 'Cap. banco (Ah)', 'Linhas', 'Nº série', 'Cap. bat. (Ah)', 'Energia (Wh)', 'Família', 'Cód. ERP', ''].map(h => (
                <th key={h} className="text-left px-2 py-2 font-semibold text-on-surface-variant whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {catalog.batteryExternal.map((m, i) => (
              <tr key={m.code || i} className="border-t border-outline-variant/50 odd:bg-surface-container-low">
                <td><Cell value={m.brand} onChange={v => update(i, 'brand', v)} width="w-20" /></td>
                <td><Cell value={m.product} onChange={v => update(i, 'product', v)} width="w-32" /></td>
                <td><Cell value={m.fullId} onChange={v => update(i, 'fullId', v)} width="w-64" /></td>
                <td><Cell value={m.spec} onChange={v => update(i, 'spec', v)} width="w-24" /></td>
                <td><Cell value={m.code} onChange={v => update(i, 'code', v)} width="w-32" /></td>
                <td><Cell type="number" value={m.voltageV} onChange={v => update(i, 'voltageV', v)} width="w-16" /></td>
                <td><Cell type="number" value={m.bankCapacityAh} onChange={v => update(i, 'bankCapacityAh', v)} width="w-20" /></td>
                <td><Cell type="number" value={m.lines} onChange={v => update(i, 'lines', v)} width="w-16" /></td>
                <td><Cell type="number" value={m.seriesCount} onChange={v => update(i, 'seriesCount', v)} width="w-16" /></td>
                <td><Cell type="number" value={m.batteryCapacityAh} onChange={v => update(i, 'batteryCapacityAh', v)} width="w-20" /></td>
                <td><Cell type="number" value={m.energyWh} onChange={v => update(i, 'energyWh', v)} width="w-20" /></td>
                <td><Cell value={m.family} onChange={v => update(i, 'family', v)} width="w-20" /></td>
                <td><Cell value={m.erpCode ?? ''} onChange={v => update(i, 'erpCode', v)} width="w-28" /></td>
                <td className="text-center px-1">
                  <button onClick={() => removeRow(i)} className="text-outline hover:text-error transition-colors text-base" title="Remover módulo">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={addRow} className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors">
          + Módulo de bateria externa
        </button>
        <SaveBar onSave={() => save(catalog)} saving={saving} saveMsg={saveMsg} />
      </div>
    </section>
  )
}

function EquipmentEditor({ equipment, setEquipment, save, saving, saveMsg }: {
  equipment: EquipmentState; setEquipment: (e: EquipmentState) => void; save: (e: EquipmentState) => void; saving: boolean; saveMsg: string
}) {
  const [newEquipName, setNewEquipName] = useState('')
  const [newComponentName, setNewComponentName] = useState('')

  const addEquipment = () => {
    const name = newEquipName.trim()
    if (!name || equipment.equipmentNames.includes(name)) return
    setEquipment({
      ...equipment,
      equipmentNames: [...equipment.equipmentNames, name],
      equipmentLoadParams: { ...equipment.equipmentLoadParams, [name]: blankLoadParams() },
    })
    setNewEquipName('')
  }

  const removeEquipment = (name: string) => {
    const ok = window.confirm(`Remover o equipamento "${name}"? Ele some da lista de preenchimento automático e dos parâmetros de carga (a quantidade dele no BOM de cada componente também é apagada). Não pode ser desfeito.`)
    if (!ok) return
    const { [name]: _removed, ...restParams } = equipment.equipmentLoadParams
    void _removed
    setEquipment({
      equipmentNames: equipment.equipmentNames.filter(n => n !== name),
      equipmentBom: equipment.equipmentBom.map(c => {
        const { [name]: _q, ...restQty } = c.qtyByEquipment
        void _q
        return { ...c, qtyByEquipment: restQty }
      }),
      equipmentLoadParams: restParams,
    })
  }

  const updateLoadParam = (name: string, field: keyof EquipmentLoadParams, value: string) => {
    const current = equipment.equipmentLoadParams[name] ?? blankLoadParams()
    setEquipment({
      ...equipment,
      equipmentLoadParams: { ...equipment.equipmentLoadParams, [name]: { ...current, [field]: parseFloat(value) || 0 } },
    })
  }

  const addComponent = () => {
    const name = newComponentName.trim()
    if (!name) return
    setEquipment({
      ...equipment,
      equipmentBom: [...equipment.equipmentBom, { name, unitVA: 0, standby: false, qtyByEquipment: {} }],
    })
    setNewComponentName('')
  }

  const removeComponent = (i: number) => {
    setEquipment({ ...equipment, equipmentBom: equipment.equipmentBom.filter((_, idx) => idx !== i) })
  }

  const updateComponent = (i: number, field: 'name' | 'unitVA', value: string) => {
    const list = equipment.equipmentBom.slice()
    const row = { ...list[i] }
    if (field === 'unitVA') row.unitVA = parseFloat(value) || 0
    else row.name = value
    list[i] = row
    setEquipment({ ...equipment, equipmentBom: list })
  }

  const toggleStandby = (i: number) => {
    const list = equipment.equipmentBom.slice()
    list[i] = { ...list[i], standby: !list[i].standby }
    setEquipment({ ...equipment, equipmentBom: list })
  }

  const updateQty = (i: number, equipName: string, value: string) => {
    const list = equipment.equipmentBom.slice()
    const qty = value === '' ? 0 : parseFloat(value) || 0
    const qtyByEquipment = { ...list[i].qtyByEquipment }
    if (qty > 0) qtyByEquipment[equipName] = qty
    else delete qtyByEquipment[equipName]
    list[i] = { ...list[i], qtyByEquipment }
    setEquipment({ ...equipment, equipmentBom: list })
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-on-surface">Equipamentos e BOM de potência</h2>
        <p className="text-xs text-on-surface-variant max-w-2xl mt-1">
          Cada modelo de equipamento vira uma opção no seletor &quot;Equipamento&quot; da Calculadora — escolher
          um lá soma a potência (VA) de cada componente cadastrado × a quantidade dele naquele equipamento.
        </p>
      </div>

      {/* Lista de equipamentos + parâmetros de carga */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-on-surface-variant uppercase tracking-wide">Equipamentos ({equipment.equipmentNames.length})</h3>
        <div className="overflow-auto border border-outline-variant rounded-lg">
          <table className="text-xs w-full">
            <thead className="bg-surface-container-highest">
              <tr>
                {['Equipamento', 'Tempo ativo (s)', 'Tempo stand by (s)', 'FP ativo', 'FP stand by', 'FS potência', ''].map(h => (
                  <th key={h} className="text-left px-2 py-2 font-semibold text-on-surface-variant whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {equipment.equipmentNames.map(name => {
                const p = equipment.equipmentLoadParams[name] ?? blankLoadParams()
                return (
                  <tr key={name} className="border-t border-outline-variant/50 odd:bg-surface-container-low">
                    <td className="px-2 py-1.5 font-mono text-on-surface whitespace-nowrap">{name}</td>
                    <td><Cell type="number" value={p.activeTimeS} onChange={v => updateLoadParam(name, 'activeTimeS', v)} width="w-24" /></td>
                    <td><Cell type="number" value={p.standbyTimeS} onChange={v => updateLoadParam(name, 'standbyTimeS', v)} width="w-24" /></td>
                    <td><Cell type="number" value={p.activePf} onChange={v => updateLoadParam(name, 'activePf', v)} width="w-20" /></td>
                    <td><Cell type="number" value={p.standbyPf} onChange={v => updateLoadParam(name, 'standbyPf', v)} width="w-20" /></td>
                    <td><Cell type="number" value={p.powerSafetyFactor} onChange={v => updateLoadParam(name, 'powerSafetyFactor', v)} width="w-20" /></td>
                    <td className="text-center px-1">
                      <button onClick={() => removeEquipment(name)} className="text-outline hover:text-error transition-colors text-base" title="Remover equipamento">✕</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newEquipName}
            onChange={e => setNewEquipName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addEquipment()}
            placeholder="NOME DO NOVO EQUIPAMENTO..."
            className="bg-surface-container border border-outline-variant rounded px-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
          />
          <button onClick={addEquipment} disabled={!newEquipName.trim()} className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors disabled:opacity-40">
            + Equipamento
          </button>
        </div>
      </div>

      {/* BOM de componentes */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-on-surface-variant uppercase tracking-wide">Componentes (BOM) — {equipment.equipmentBom.length}</h3>
        <p className="text-xs text-on-surface-variant">
          &quot;Stand by&quot; marca componentes que continuam ligados fora do ciclo ativo (eletrônica de controle,
          monitor, ventilação etc.) — entram na potência de Stand By além da de Ativo.
        </p>
        <div className="overflow-auto border border-outline-variant rounded-lg max-h-[32rem]">
          <table className="text-xs w-full">
            <thead className="sticky top-0 bg-surface-container-highest z-10">
              <tr>
                <th className="text-left px-2 py-2 font-semibold text-on-surface-variant whitespace-nowrap">Componente</th>
                <th className="text-left px-2 py-2 font-semibold text-on-surface-variant whitespace-nowrap">VA unit.</th>
                <th className="text-center px-2 py-2 font-semibold text-on-surface-variant whitespace-nowrap">Stand by?</th>
                {equipment.equipmentNames.map(name => (
                  <th key={name} className="text-left px-2 py-2 font-semibold text-on-surface-variant whitespace-nowrap">{name}</th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {equipment.equipmentBom.map((c, i) => (
                <tr key={i} className="border-t border-outline-variant/50 odd:bg-surface-container-low">
                  <td><Cell value={c.name} onChange={v => updateComponent(i, 'name', v)} width="w-40" /></td>
                  <td><Cell type="number" value={c.unitVA} onChange={v => updateComponent(i, 'unitVA', v)} width="w-16" /></td>
                  <td className="text-center">
                    <input type="checkbox" checked={c.standby} onChange={() => toggleStandby(i)} className="w-3.5 h-3.5 cursor-pointer accent-primary" />
                  </td>
                  {equipment.equipmentNames.map(name => (
                    <td key={name}><Cell type="number" value={c.qtyByEquipment[name] ?? ''} onChange={v => updateQty(i, name, v)} width="w-14" /></td>
                  ))}
                  <td className="text-center px-1">
                    <button onClick={() => removeComponent(i)} className="text-outline hover:text-error transition-colors text-base" title="Remover componente">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newComponentName}
            onChange={e => setNewComponentName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addComponent()}
            placeholder="NOME DO NOVO COMPONENTE..."
            className="bg-surface-container border border-outline-variant rounded px-3 py-2 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
          />
          <button onClick={addComponent} disabled={!newComponentName.trim()} className="px-4 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface-variant hover:border-primary hover:text-primary transition-colors disabled:opacity-40">
            + Componente
          </button>
        </div>
      </div>

      <SaveBar onSave={() => save(equipment)} saving={saving} saveMsg={saveMsg} />
    </section>
  )
}
