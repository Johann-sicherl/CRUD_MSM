import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

type RouteParams = { params: { code: string } }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const code = decodeURIComponent(params.code).trim()
  if (!code) return NextResponse.json({ error: 'Informe um código' }, { status: 400 })

  // ── 1. Try as a Cadastro de Equipamentos code (standard_equipment_items.protheus_code) ──
  const { data: item } = await supabaseAdmin
    .from('standard_equipment_items')
    .select('*')
    .ilike('protheus_code', code)
    .maybeSingle()

  if (item) {
    const legacyEquipmentId = item.legacy_equipment_id

    const [equipRes, bomRes, compatRes, nonCombRes, depRes, rollerRes] = await Promise.all([
      supabaseAdmin.from('equipments').select('*').eq('legacy_id', legacyEquipmentId).maybeSingle(),
      supabaseAdmin.from('standard_equipment_items').select('*').eq('legacy_equipment_id', legacyEquipmentId).order('protheus_code'),
      supabaseAdmin.from('relationship_equip_accessory').select('*').eq('legacy_equipment_id', legacyEquipmentId),
      supabaseAdmin.from('non_combinable_comps').select('*').eq('legacy_equipment_id', legacyEquipmentId),
      supabaseAdmin.from('dependant_items').select('*').eq('legacy_equipment_id', legacyEquipmentId),
      supabaseAdmin.from('roller_tables').select('*').eq('legacy_equipment_id', legacyEquipmentId),
    ])

    const bomRows:   Row[] = bomRes.data       || []
    const compat:    Row[] = compatRes.data    || []
    const nonComb:   Row[] = nonCombRes.data   || []
    const dependants: Row[] = depRes.data      || []
    const roller:    Row[] = rollerRes.data    || []

    const accessoryCodes = new Set<string>()
    for (const r of compat)     accessoryCodes.add(r.protheus_code)
    for (const r of nonComb)    { accessoryCodes.add(r.protheus_code); accessoryCodes.add(r.remove_list_code) }
    for (const r of dependants) { accessoryCodes.add(r.protheus_code); accessoryCodes.add(r.protheus_item_code) }
    for (const r of roller)     accessoryCodes.add(r.protheus_code)

    const { data: accessoryRows } = accessoryCodes.size > 0
      ? await supabaseAdmin.from('accessories').select('*').in('protheus_code', Array.from(accessoryCodes))
      : { data: [] as Row[] }

    // Full accessory row per code (used to show every property when a group is expanded)
    const accessoryMap: Record<string, Row> = {}
    for (const a of (accessoryRows || [])) accessoryMap[a.protheus_code] = a

    const groupIds = new Set<number>()
    for (const a of Object.values(accessoryMap)) if (a.legacy_group_id != null) groupIds.add(a.legacy_group_id)
    const { data: groupRows } = groupIds.size > 0
      ? await supabaseAdmin.from('accessory_groups').select('legacy_id, name').in('legacy_id', Array.from(groupIds))
      : { data: [] as Row[] }
    const groupNameMap: Record<number, string> = {}
    for (const g of (groupRows || [])) groupNameMap[g.legacy_id] = g.name

    // Resolve alert ids (from BOM items and from accessories) to their description
    const alertIds = new Set<number>()
    for (const r of bomRows) if (r.legacy_general_alert_id) alertIds.add(r.legacy_general_alert_id)
    for (const a of Object.values(accessoryMap)) if (a.legacy_general_alert_id) alertIds.add(a.legacy_general_alert_id)
    const { data: alertRows } = alertIds.size > 0
      ? await supabaseAdmin.from('general_alerts').select('legacy_id, description').in('legacy_id', Array.from(alertIds))
      : { data: [] as Row[] }
    const alertMap: Record<number, string> = {}
    for (const al of (alertRows || [])) alertMap[al.legacy_id] = al.description

    return NextResponse.json({
      type: 'equipment',
      code,
      equipment: equipRes.data,
      bom: bomRows.map((r: Row) => ({
        ...r,
        isSearched: r.protheus_code === item.protheus_code,
        alertDescription: r.legacy_general_alert_id ? (alertMap[r.legacy_general_alert_id] ?? null) : null,
      })),
      compatibleAccessories: compat.map(r => {
        const acc = accessoryMap[r.protheus_code] ?? null
        return {
          ...r,
          accessoryName: acc?.name ?? null,
          groupId: acc?.legacy_group_id ?? null,
          groupName: acc?.legacy_group_id != null ? (groupNameMap[acc.legacy_group_id] ?? null) : null,
          accessory: acc,
          alertDescription: acc?.legacy_general_alert_id ? (alertMap[acc.legacy_general_alert_id] ?? null) : null,
        }
      }),
      nonCombinable: nonComb.map(r => {
        const otherAcc = accessoryMap[r.remove_list_code] ?? null
        return {
          ...r,
          name1: accessoryMap[r.protheus_code]?.name ?? null,
          name2: otherAcc?.name ?? null,
          otherAccessory: otherAcc,
          otherGroupName: otherAcc?.legacy_group_id != null ? (groupNameMap[otherAcc.legacy_group_id] ?? null) : null,
          otherAlertDescription: otherAcc?.legacy_general_alert_id ? (alertMap[otherAcc.legacy_general_alert_id] ?? null) : null,
        }
      }),
      dependants: dependants.map(r => {
        const itemAcc = accessoryMap[r.protheus_code] ?? null
        const depAcc = accessoryMap[r.protheus_item_code] ?? null
        return {
          ...r,
          itemName: itemAcc?.name ?? null,
          codeGroupName: itemAcc?.legacy_group_id != null ? (groupNameMap[itemAcc.legacy_group_id] ?? null) : null,
          dependentName: depAcc?.name ?? null,
          dependentAccessory: depAcc,
          dependentGroupName: depAcc?.legacy_group_id != null ? (groupNameMap[depAcc.legacy_group_id] ?? null) : null,
          dependentAlertDescription: depAcc?.legacy_general_alert_id ? (alertMap[depAcc.legacy_general_alert_id] ?? null) : null,
        }
      }),
      rollerTables: roller.map(r => ({ ...r, accessoryName: accessoryMap[r.protheus_code]?.name ?? null })),
    })
  }

  // ── 2. Try as a Cadastro de Componentes code (accessories.protheus_code) ──
  const { data: accessory } = await supabaseAdmin
    .from('accessories')
    .select('*')
    .ilike('protheus_code', code)
    .maybeSingle()

  if (accessory) {
    const [groupRes, compatRes, nonCombRes, depRes, rollerRes] = await Promise.all([
      accessory.legacy_group_id != null
        ? supabaseAdmin.from('accessory_groups').select('name').eq('legacy_id', accessory.legacy_group_id).maybeSingle()
        : Promise.resolve({ data: null as Row | null }),
      supabaseAdmin.from('relationship_equip_accessory').select('*').eq('protheus_code', accessory.protheus_code),
      supabaseAdmin.from('non_combinable_comps').select('*').or(`protheus_code.eq.${accessory.protheus_code},remove_list_code.eq.${accessory.protheus_code}`),
      supabaseAdmin.from('dependant_items').select('*').or(`protheus_code.eq.${accessory.protheus_code},protheus_item_code.eq.${accessory.protheus_code}`),
      supabaseAdmin.from('roller_tables').select('*').eq('protheus_code', accessory.protheus_code),
    ])

    const compat:    Row[] = compatRes.data  || []
    const nonComb:   Row[] = nonCombRes.data || []
    const dependants: Row[] = depRes.data    || []
    const roller:    Row[] = rollerRes.data  || []

    const equipmentIds = new Set<number>()
    for (const r of compat)     equipmentIds.add(r.legacy_equipment_id)
    for (const r of nonComb)    equipmentIds.add(r.legacy_equipment_id)
    for (const r of dependants) equipmentIds.add(r.legacy_equipment_id)
    for (const r of roller)     equipmentIds.add(r.legacy_equipment_id)

    const { data: equipRows } = equipmentIds.size > 0
      ? await supabaseAdmin.from('equipments').select('*').in('legacy_id', Array.from(equipmentIds))
      : { data: [] as Row[] }
    // Full equipment row per legacy_id (used to show every property in Usado nestes Equipamentos)
    const equipMap: Record<number, Row> = {}
    for (const e of (equipRows || [])) equipMap[e.legacy_id] = e

    const otherCodes = new Set<string>()
    for (const r of nonComb)    otherCodes.add(r.protheus_code === accessory.protheus_code ? r.remove_list_code : r.protheus_code)
    for (const r of dependants) otherCodes.add(r.protheus_code === accessory.protheus_code ? r.protheus_item_code : r.protheus_code)
    const { data: otherRows } = otherCodes.size > 0
      ? await supabaseAdmin.from('accessories').select('*').in('protheus_code', Array.from(otherCodes))
      : { data: [] as Row[] }
    // Full accessory row per "other side" code (used to show every property in the cascade)
    const otherMap: Record<string, Row> = {}
    for (const a of (otherRows || [])) otherMap[a.protheus_code] = a

    const otherGroupIds = new Set<number>()
    for (const a of Object.values(otherMap)) if (a.legacy_group_id != null) otherGroupIds.add(a.legacy_group_id)
    const { data: otherGroupRows } = otherGroupIds.size > 0
      ? await supabaseAdmin.from('accessory_groups').select('legacy_id, name').in('legacy_id', Array.from(otherGroupIds))
      : { data: [] as Row[] }
    const otherGroupNameMap: Record<number, string> = {}
    for (const g of (otherGroupRows || [])) otherGroupNameMap[g.legacy_id] = g.name

    const otherAlertIds = new Set<number>()
    for (const a of Object.values(otherMap)) if (a.legacy_general_alert_id) otherAlertIds.add(a.legacy_general_alert_id)
    const { data: otherAlertRows } = otherAlertIds.size > 0
      ? await supabaseAdmin.from('general_alerts').select('legacy_id, description').in('legacy_id', Array.from(otherAlertIds))
      : { data: [] as Row[] }
    const otherAlertMap: Record<number, string> = {}
    for (const al of (otherAlertRows || [])) otherAlertMap[al.legacy_id] = al.description

    return NextResponse.json({
      type: 'accessory',
      code,
      accessory,
      groupName: groupRes.data?.name ?? null,
      usedInEquipments: compat.map(r => ({
        ...r,
        equipmentName: equipMap[r.legacy_equipment_id]?.name ?? null,
        equipment: equipMap[r.legacy_equipment_id] ?? null,
      })),
      nonCombinable: nonComb.map(r => {
        const isFirst = r.protheus_code === accessory.protheus_code
        const otherCode = isFirst ? r.remove_list_code : r.protheus_code
        const otherAcc = otherMap[otherCode] ?? null
        return {
          ...r,
          equipmentName: equipMap[r.legacy_equipment_id]?.name ?? null,
          otherCode,
          otherName: otherAcc?.name ?? null,
          otherAccessory: otherAcc,
          otherGroupName: otherAcc?.legacy_group_id != null ? (otherGroupNameMap[otherAcc.legacy_group_id] ?? null) : null,
          otherAlertDescription: otherAcc?.legacy_general_alert_id ? (otherAlertMap[otherAcc.legacy_general_alert_id] ?? null) : null,
        }
      }),
      dependants: dependants.map(r => {
        const isFirst = r.protheus_code === accessory.protheus_code
        const otherCode = isFirst ? r.protheus_item_code : r.protheus_code
        const otherAcc = otherMap[otherCode] ?? null
        // r.protheus_code is the search accessory itself when isFirst, otherwise it's
        // the "other" accessory already resolved above (otherCode === r.protheus_code then).
        const codeGroupName = isFirst
          ? (groupRes.data?.name ?? null)
          : (otherAcc?.legacy_group_id != null ? (otherGroupNameMap[otherAcc.legacy_group_id] ?? null) : null)
        return {
          ...r,
          equipmentName: equipMap[r.legacy_equipment_id]?.name ?? null,
          role: isFirst ? 'item' : 'dependente',
          codeGroupName,
          otherCode,
          otherName: otherAcc?.name ?? null,
          otherAccessory: otherAcc,
          otherGroupName: otherAcc?.legacy_group_id != null ? (otherGroupNameMap[otherAcc.legacy_group_id] ?? null) : null,
          otherAlertDescription: otherAcc?.legacy_general_alert_id ? (otherAlertMap[otherAcc.legacy_general_alert_id] ?? null) : null,
        }
      }),
      rollerTables: roller.map(r => ({ ...r, equipmentName: equipMap[r.legacy_equipment_id]?.name ?? null })),
    })
  }

  return NextResponse.json({
    error: `Código "${code}" não encontrado em Cadastro de Equipamentos nem em Cadastro de Componentes`,
  }, { status: 404 })
}
