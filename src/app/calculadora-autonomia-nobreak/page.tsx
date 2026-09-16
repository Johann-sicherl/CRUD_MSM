'use client'

import { useMemo, useState } from 'react'
import {
  UPS_CATALOG, UPS_TECHNOLOGIES, BATTERY_GROUPS, EXTERNAL_BATTERY_CATALOG,
  EQUIPMENT_NAMES, EQUIPMENT_LOAD_PARAMS, equipmentApparentPowerVA,
  findBatteryGroup, nearestBatteryGroup, calculateAutonomy, formatHoursAsHM,
  type UpsModel, type LoadSegment,
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

export default function CalculadoraAutonomiaNobreakPage() {
  // ── Carga (Ativo / Stand By) ──────────────────────────────────────────
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
    const { active, standby } = equipmentApparentPowerVA(name)
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

  // ── UPS ─────────────────────────────────────────────────────────────
  const [technology, setTechnology] = useState('Todos')
  const upsOptions = useMemo(
    () => technology === 'Todos' ? UPS_CATALOG : UPS_CATALOG.filter(u => u.technology === technology),
    [technology]
  )
  const [selectedUpsId, setSelectedUpsId] = useState(() => UPS_CATALOG[0]?.code ?? '')
  const selectedUps: UpsModel | undefined = useMemo(
    () => UPS_CATALOG.find(u => u.code === selectedUpsId) ?? upsOptions[0],
    [selectedUpsId, upsOptions]
  )

  // ── Banco de bateria interno (derivado do UPS, editável) ──────────────
  const [internalOverride, setInternalOverride] = useState<{ seriesCount: number; lines: number; capacityAh: number } | null>(null)
  const internalDefaults = useMemo(() => {
    if (!selectedUps) return { seriesCount: 1, lines: 1, capacityAh: BATTERY_GROUPS[0].capacityAh }
    const group = findBatteryGroup(selectedUps.batteryCapacityAh) ?? nearestBatteryGroup(selectedUps.batteryCapacityAh)
    return {
      seriesCount: Math.round(selectedUps.batteryVoltageV / 12) || 1,
      lines: selectedUps.batteryLines || 1,
      capacityAh: group.capacityAh,
    }
  }, [selectedUps])
  const internalBattery = internalOverride ?? internalDefaults
  const internalIsApproximated = selectedUps ? !findBatteryGroup(selectedUps.batteryCapacityAh) : false

  const selectUps = (code: string) => {
    setSelectedUpsId(code)
    setInternalOverride(null) // volta a derivar automaticamente do novo UPS
  }

  // ── Banco de bateria externo ───────────────────────────────────────────
  const [externalId, setExternalId] = useState(NO_EXTERNAL)
  const externalModule = EXTERNAL_BATTERY_CATALOG.find(m => m.code === externalId)
  const externalBattery = externalModule
    ? { seriesCount: externalModule.seriesCount, lines: externalModule.lines, capacityAh: externalModule.batteryCapacityAh }
    : null

  // ── Parâmetros gerais (mesmos defaults da planilha original) ──────────
  const [upsPf, setUpsPf] = useState(0.9)
  const [batteryEfficiency, setBatteryEfficiency] = useState(0.95)
  const [autonomySafetyFactor, setAutonomySafetyFactor] = useState(0.2)
  const [ambientTempC, setAmbientTempC] = useState(15)

  const result = useMemo(() => {
    if (!selectedUps) return null
    const loadSegments: LoadSegment[] = [
      { label: 'Ativo', apparentPowerVA: activeVA, timeS: activeTimeS, pf: activePf },
      { label: 'Stand By', apparentPowerVA: standbyVA, timeS: standbyTimeS, pf: standbyPf },
    ]
    try {
      return calculateAutonomy({
        loadSegments,
        selectedUps,
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
  }, [selectedUps, activeVA, standbyVA, activeTimeS, standbyTimeS, activePf, standbyPf,
      internalBattery, externalBattery, upsPf, batteryEfficiency, autonomySafetyFactor, ambientTempC, powerSafetyFactor])

  const hasError = result && 'error' in result

  return (
    <div className="p-8 max-w-6xl flex flex-col gap-10">
      <div>
        <div className="text-xs font-mono text-outline uppercase tracking-[0.2em] mb-1">
          Sistema · calculadora-autonomia-nobreak
        </div>
        <h1 className="text-3xl font-bold text-on-surface tracking-tight">Calculadora de Autonomia de Nobreak</h1>
        <p className="text-on-surface-variant text-base mt-1 max-w-3xl">
          Estima a autonomia (h:min) de um banco de baterias sob um UPS/nobreak, a partir da carga aplicada,
          do modelo de UPS e da configuração do banco de baterias interno/externo — mesmo motor de cálculo de
          uma planilha de dimensionamento de engenharia (curva de descarga por capacidade de bateria + curva de
          derating por temperatura ambiente + fatores de segurança).
        </p>
      </div>

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
                {UPS_TECHNOLOGIES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              <span>Modelo</span>
              <select
                value={selectedUps?.code ?? ''}
                onChange={e => selectUps(e.target.value)}
                className="bg-surface-container-low border border-outline-variant rounded px-2.5 py-1.5 text-sm text-on-surface focus:outline-none focus:border-primary"
              >
                {upsOptions.map(u => <option key={u.code} value={u.code}>{u.fullId}</option>)}
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
                {EXTERNAL_BATTERY_CATALOG.map(m => <option key={m.code} value={m.code}>{m.fullId}</option>)}
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
