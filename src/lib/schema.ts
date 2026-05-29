export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'decimal'
  | 'boolean'
  | 'select'
  | 'jsonb'
  | 'uuid'
  | 'timestamp'
  | 'password'

export interface LookupConfig {
  table: string
  keyField: string
  displayField: string  // for through lookups this is the intermediate FK field
  sourceField?: string  // use row[sourceField] as the lookup key instead of row[field.name]
  through?: {           // second-hop: displayField values become keys into this table
    table: string
    keyField: string
    displayField: string
  }
  filterVia?: {
    table: string      // table whose rows determine the allowed set
    joinField: string  // field in that table referencing keyField
    filterField: string
    filterValue: string
  }
}

export interface CascadeLookupConfig {
  groupTable: string         // e.g. 'accessory_groups'
  groupKeyField: string      // e.g. 'legacy_id'
  groupDisplayField: string  // e.g. 'name'
  itemTable: string          // e.g. 'accessories'
  itemGroupField: string     // field in itemTable that references group key
  itemKeyField: string       // field whose value fills the form field
  itemDisplayField: string   // display label in picker list
}

export interface Field {
  name: string
  label: string
  type: FieldType
  nullable: boolean
  isPk?: boolean
  isReadonly?: boolean
  showInList?: boolean
  options?: string[]
  defaultValue?: string | number | boolean | null
  placeholder?: string
  lookupFrom?: LookupConfig
  fetchOptions?: LookupConfig
  cascadeLookup?: CascadeLookupConfig
  validateExistsIn?: { table: string; field: string; errorMessage?: string }
  autoIncrement?: boolean
  hideInForm?: boolean
  formFullWidth?: boolean
  listExpand?: boolean       // truncate cell in list view and show expand/collapse button
  listFilterType?: 'select' | 'text'  // override column filter style (default: select)
  dynamicOptions?: string    // key in /api/field-options; renders a managed select with + button
}

export interface TableSchema {
  label: string
  description: string
  domain: 'catalogo' | 'regras' | 'transacional' | 'plataforma'
  hasTimestamps: boolean
  orderBy: string
  fields: Field[]
  doubleInsert?: boolean
  batchInsert?: boolean
  columnFilters?: boolean   // show per-column filter inputs in the list header
}

export const DOMAIN_LABELS: Record<string, string> = {
  catalogo: 'Portifólio',
  regras: 'Regras',
  transacional: 'Transacional',
  plataforma: 'Plataforma',
}

export const DOMAIN_COLORS: Record<string, string> = {
  catalogo: 'blue',
  regras: 'amber',
  transacional: 'green',
  plataforma: 'purple',
}

export const tables: Record<string, TableSchema> = {

  // ── PORTIFÓLIO ────────────────────────────────────────────────────────────

  equipments: {
    label: 'Grupo de Equipamentos',
    description: 'Máquinas configuráveis — entidade central do catálogo',
    domain: 'catalogo',
    hasTimestamps: true,
    orderBy: 'legacy_id',
    columnFilters: true,
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'legacy_id', label: 'ID Leg.', type: 'number', nullable: false, autoIncrement: true, isReadonly: true, showInList: true, listFilterType: 'text' },
      { name: 'name', label: 'Modelo', type: 'text', nullable: false, showInList: true, listFilterType: 'text' },
      { name: 'commercial_name', label: 'Nome Com.', type: 'text', nullable: false, showInList: true, listFilterType: 'text' },
      { name: 'ipi_tax_rate', label: 'IPI (%)', type: 'decimal', nullable: false, defaultValue: 0, placeholder: '0.00', showInList: true, listFilterType: 'text' },
      { name: 'contribution_margin_ratio', label: 'Marg. (%)', type: 'decimal', nullable: false, defaultValue: 0, showInList: true, listFilterType: 'text' },
      { name: 'seller_commission', label: 'Com. Vend. (%)', type: 'decimal', nullable: false, defaultValue: 0, showInList: true, listFilterType: 'text' },
      { name: 'manager_commission', label: 'Com. Ger. (%)', type: 'decimal', nullable: false, defaultValue: 0, showInList: true, listFilterType: 'text' },
      { name: 'director_commission', label: 'Com. Dir. (%)', type: 'decimal', nullable: false, defaultValue: 0, showInList: true, listFilterType: 'text' },
      { name: 'certification_cost', label: 'Cert. (R$)', type: 'decimal', nullable: false, defaultValue: 0, showInList: true, listFilterType: 'text' },
      { name: 'labor_cost_rate', label: 'M.O. (%)', type: 'decimal', nullable: false, defaultValue: 0, showInList: true, listFilterType: 'text' },
      { name: 'warranty_rate', label: 'Garantia (%)', type: 'decimal', nullable: false, defaultValue: 0, showInList: true, listFilterType: 'text' },
      { name: 'parts_provision_rate', label: 'Prov. Peças (%)', type: 'decimal', nullable: false, defaultValue: 0, showInList: true, listFilterType: 'text' },
      { name: 'created_at', label: 'Criado em', type: 'timestamp', nullable: false, isReadonly: true },
      { name: 'updated_at', label: 'Atualizado em', type: 'timestamp', nullable: false, isReadonly: true },
    ],
  },

  accessory_groups: {
    label: 'Grupo de Acessórios',
    description: 'Grupos para organização e aplicação de regras de acessórios',
    domain: 'catalogo',
    hasTimestamps: true,
    orderBy: 'legacy_id',
    columnFilters: true,
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'legacy_id', label: 'ID Leg.', type: 'number', nullable: false, autoIncrement: true, isReadonly: true, showInList: true, listFilterType: 'text' },
      { name: 'name', label: 'Nome', type: 'text', nullable: false, showInList: true, listFilterType: 'text' },
      { name: 'description', label: 'Descrição', type: 'textarea', nullable: true },
      { name: 'created_at', label: 'Criado em', type: 'timestamp', nullable: false, isReadonly: true },
      { name: 'updated_at', label: 'Atualizado em', type: 'timestamp', nullable: false, isReadonly: true },
    ],
  },

  standard_equipment_items: {
    label: 'Cadastro de Equipamentos',
    description: 'Itens que compõem cada equipamento — Bill of Materials',
    domain: 'catalogo',
    hasTimestamps: true,
    orderBy: 'legacy_equipment_id',
    columnFilters: true,
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'legacy_equipment_id', label: 'Equipamento', type: 'number', nullable: false, showInList: true, listFilterType: 'text',
        lookupFrom: { table: 'equipments', keyField: 'legacy_id', displayField: 'name' },
        fetchOptions: { table: 'equipments', keyField: 'legacy_id', displayField: 'name' } },
      { name: 'protheus_code', label: 'Cód. Protheus', type: 'text', nullable: false, showInList: true, listFilterType: 'text' },
      { name: 'processor', label: 'Processador', type: 'text', nullable: true, showInList: true, dynamicOptions: 'processor' },
      { name: 'memory', label: 'Memória RAM', type: 'text', nullable: true, showInList: true, dynamicOptions: 'memory' },
      { name: 'storage', label: 'Armazenamento', type: 'text', nullable: true, showInList: true, dynamicOptions: 'storage' },
      { name: 'graphics_card', label: 'Placa de Vídeo', type: 'text', nullable: true, showInList: true, dynamicOptions: 'graphics_card' },
      { name: 'conveyor_belt_load_capacity_kg', label: 'Cap. Esteira (kg)', type: 'text', nullable: true, showInList: true, dynamicOptions: 'belt_load_capacity' },
      { name: 'tube_power_kv', label: 'Potência Tubo (kV)', type: 'text', nullable: true, showInList: true, dynamicOptions: 'tube_power' },
      { name: 'certificate', label: 'Certificado', type: 'text', nullable: true, showInList: true, dynamicOptions: 'certificate' },
      { name: 'conveyor_belt_type', label: 'Tipo Esteira', type: 'text', nullable: true, showInList: true, dynamicOptions: 'belt_type' },
      { name: 'motopolia_type', label: 'Tipo Motopolia', type: 'text', nullable: true, showInList: true, dynamicOptions: 'motopolia_type' },
      { name: 'language', label: 'Idioma', type: 'text', nullable: true, showInList: true, dynamicOptions: 'language' },
      { name: 'color', label: 'Cor', type: 'text', nullable: true, showInList: true, dynamicOptions: 'equip_color' },
      { name: 'legacy_general_alert_id', label: 'Alerta', type: 'number', nullable: true, defaultValue: 0, showInList: true,
        fetchOptions: { table: 'general_alerts', keyField: 'legacy_id', displayField: 'description' } },
      { name: 'status', label: 'Status', type: 'select', nullable: false, defaultValue: 'active', options: ['active', 'inactive', 'deactive'], showInList: true },
      { name: 'cost_std', label: 'Custo (R$)', type: 'decimal', nullable: false, defaultValue: 0, showInList: true },
      { name: 'created_at', label: 'Criado em', type: 'timestamp', nullable: false, isReadonly: true },
      { name: 'updated_at', label: 'Atualizado em', type: 'timestamp', nullable: false, isReadonly: true },
    ],
  },

  accessories: {
    label: 'Cadastro de Componentes',
    description: 'Acessórios que podem ser adicionados aos equipamentos',
    domain: 'catalogo',
    hasTimestamps: true,
    orderBy: 'legacy_group_id',
    columnFilters: true,
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'protheus_code', label: 'Código Protheus', type: 'text', nullable: false, showInList: true },
      { name: 'name', label: 'Nome', type: 'text', nullable: false, showInList: true },
      { name: 'legacy_group_id', label: 'Grupo', type: 'number', nullable: true, showInList: true,
        lookupFrom: { table: 'accessory_groups', keyField: 'legacy_id', displayField: 'name' },
        fetchOptions: { table: 'accessory_groups', keyField: 'legacy_id', displayField: 'name' } },
      { name: 'color', label: 'Cor', type: 'text', nullable: true, showInList: true, dynamicOptions: 'accessory_color' },
      { name: 'predominant_material', label: 'Material', type: 'text', nullable: true, showInList: true, dynamicOptions: 'predominant_material' },
      { name: 'dimensional_mm', label: 'Dimensão (mm)', type: 'number', nullable: true },
      { name: 'monitor_size', label: 'Tamanho Monitor (pol)', type: 'decimal', nullable: true },
      { name: 'quantity_monitor_totem', label: 'Qtd. Monitor Totem', type: 'number', nullable: true },
      { name: 'cost_std', label: 'Custo (R$)', type: 'decimal', nullable: false, defaultValue: 0, showInList: true },
      { name: 'description', label: 'Descrição', type: 'textarea', nullable: true },
      { name: 'legacy_general_alert_id', label: 'Alerta', type: 'number', nullable: true, defaultValue: 0,
        fetchOptions: { table: 'general_alerts', keyField: 'legacy_id', displayField: 'description' } },
      { name: 'status', label: 'Status', type: 'select', nullable: false, defaultValue: 'active', options: ['active', 'inactive'], showInList: true },
      { name: 'created_at', label: 'Criado em', type: 'timestamp', nullable: false, isReadonly: true },
      { name: 'updated_at', label: 'Atualizado em', type: 'timestamp', nullable: false, isReadonly: true },
    ],
  },

  general_alerts: {
    label: 'Cadastro de Alertas',
    description: 'Alertas associados a equipamentos ou acessórios',
    domain: 'catalogo',
    hasTimestamps: true,
    orderBy: 'legacy_id',
    columnFilters: true,
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'legacy_id', label: 'ID Legado', type: 'number', nullable: false, autoIncrement: true, isReadonly: true, showInList: true },
      { name: 'description', label: 'Descrição do Alerta', type: 'textarea', nullable: false, showInList: true },
      { name: 'created_at', label: 'Criado em', type: 'timestamp', nullable: false, isReadonly: true },
      { name: 'updated_at', label: 'Atualizado em', type: 'timestamp', nullable: false, isReadonly: true },
    ],
  },

  // ── REGRAS ────────────────────────────────────────────────────────────────

  relationship_equip_accessory: {
    label: 'Equipamento x Acessórios',
    description: 'Relacionamentos e compatibilidades entre equipamentos e acessórios',
    domain: 'regras',
    hasTimestamps: true,
    orderBy: 'legacy_equipment_id',
    batchInsert: true,
    columnFilters: true,
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'legacy_equipment_id', label: 'Equipamento', type: 'number', nullable: false, showInList: true,
        lookupFrom: { table: 'equipments', keyField: 'legacy_id', displayField: 'name' },
        fetchOptions: { table: 'equipments', keyField: 'legacy_id', displayField: 'name',
          filterVia: { table: 'standard_equipment_items', joinField: 'legacy_equipment_id', filterField: 'status', filterValue: 'active' } } },
      { name: 'group_name', label: 'Grupo', type: 'text', nullable: true, showInList: true, hideInForm: true,
        lookupFrom: { table: 'accessories', keyField: 'protheus_code', displayField: 'legacy_group_id', sourceField: 'protheus_code',
          through: { table: 'accessory_groups', keyField: 'legacy_id', displayField: 'name' } } },
      { name: 'protheus_code', label: 'Código Protheus Acessório', type: 'text', nullable: false, showInList: true,
        listFilterType: 'text',
        validateExistsIn: { table: 'accessories', field: 'protheus_code',
          errorMessage: 'Código Protheus não encontrado em Cadastro de Componentes. Cadastre o componente antes de criar a regra.' },
        cascadeLookup: {
          groupTable: 'accessory_groups', groupKeyField: 'legacy_id', groupDisplayField: 'name',
          itemTable: 'accessories', itemGroupField: 'legacy_group_id', itemKeyField: 'protheus_code', itemDisplayField: 'name',
        } },
      { name: 'accessory_name', label: 'Nome Acessório', type: 'text', nullable: true, showInList: true, hideInForm: true,
        listFilterType: 'text',
        lookupFrom: { table: 'accessories', keyField: 'protheus_code', displayField: 'name', sourceField: 'protheus_code' } },
      { name: 'description', label: 'Descrição', type: 'textarea', nullable: true },
      { name: 'legacy_general_alert_id', label: 'Alerta', type: 'number', nullable: true, defaultValue: 0, listExpand: true,
        lookupFrom: { table: 'general_alerts', keyField: 'legacy_id', displayField: 'description' },
        fetchOptions: { table: 'general_alerts', keyField: 'legacy_id', displayField: 'description' } },
      { name: 'operation_time', label: 'Tempo de Operação (min)', type: 'number', nullable: true },
      { name: 'maximum_quantity', label: 'Qtd. Máxima', type: 'number', nullable: false, defaultValue: 1 },
      { name: 'status', label: 'Status', type: 'select', nullable: false, defaultValue: 'active', options: ['active', 'inactive'], showInList: true },
      { name: 'created_at', label: 'Criado em', type: 'timestamp', nullable: false, isReadonly: true },
      { name: 'updated_at', label: 'Atualizado em', type: 'timestamp', nullable: false, isReadonly: true },
    ],
  },

  non_combinable_comps: {
    label: 'Produtos Não Combináveis',
    description: 'Acessórios que não podem ser combinados em certas condições',
    domain: 'regras',
    hasTimestamps: true,
    orderBy: 'legacy_equipment_id',
    doubleInsert: true,
    columnFilters: true,
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'legacy_equipment_id', label: 'Equipamento', type: 'number', nullable: false, showInList: true, formFullWidth: true, listExpand: true,
        lookupFrom: { table: 'equipments', keyField: 'legacy_id', displayField: 'name' },
        fetchOptions: { table: 'equipments', keyField: 'legacy_id', displayField: 'name' } },
      { name: 'legacy_group_id', label: 'Grupo', type: 'number', nullable: false, showInList: true, hideInForm: true,
        lookupFrom: { table: 'accessory_groups', keyField: 'legacy_id', displayField: 'name' } },
      { name: 'protheus_code', label: '1° Código', type: 'text', nullable: false, showInList: true, listFilterType: 'text' },
      { name: 'accessory_name', label: 'Nome 1° Acessório', type: 'text', nullable: true, showInList: true, hideInForm: true,
        listFilterType: 'text',
        lookupFrom: { table: 'accessories', keyField: 'protheus_code', displayField: 'name', sourceField: 'protheus_code' } },
      { name: 'legacy_second_group_id', label: '2° Grupo', type: 'number', nullable: true, showInList: true, hideInForm: true,
        lookupFrom: { table: 'accessory_groups', keyField: 'legacy_id', displayField: 'name' } },
      { name: 'remove_list_code', label: '2° Código', type: 'text', nullable: false, showInList: true, listFilterType: 'text' },
      { name: 'accessory_name_2', label: 'Nome 2° Acessório', type: 'text', nullable: true, showInList: true, hideInForm: true,
        listFilterType: 'text',
        lookupFrom: { table: 'accessories', keyField: 'protheus_code', displayField: 'name', sourceField: 'remove_list_code' } },
      { name: 'status', label: 'Status', type: 'select', nullable: false, defaultValue: 'active', options: ['active', 'inactive'], formFullWidth: true },
      { name: 'created_at', label: 'Criado em', type: 'timestamp', nullable: false, isReadonly: true },
      { name: 'updated_at', label: 'Atualizado em', type: 'timestamp', nullable: false, isReadonly: true },
    ],
  },

  dependant_items: {
    label: 'Produtos Dependentes',
    description: 'Itens adicionados automaticamente com base em outros acessórios',
    domain: 'regras',
    hasTimestamps: true,
    orderBy: 'legacy_equipment_id',
    columnFilters: true,
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'legacy_equipment_id', label: 'Equipamento', type: 'number', nullable: false, showInList: true, listExpand: true,
        lookupFrom: { table: 'equipments', keyField: 'legacy_id', displayField: 'name' },
        fetchOptions: { table: 'equipments', keyField: 'legacy_id', displayField: 'name' } },
      { name: 'protheus_code', label: 'Cód. Item', type: 'text', nullable: false, showInList: true, listFilterType: 'text' },
      { name: 'nome_item', label: 'Nome Item', type: 'text', nullable: true, showInList: true, hideInForm: true, listFilterType: 'text',
        lookupFrom: { table: 'accessories', keyField: 'protheus_code', displayField: 'name', sourceField: 'protheus_code' } },
      { name: 'group_name_item', label: 'Grupo Item', type: 'text', nullable: true, showInList: true, hideInForm: true,
        lookupFrom: { table: 'accessories', keyField: 'protheus_code', displayField: 'legacy_group_id', sourceField: 'protheus_code',
          through: { table: 'accessory_groups', keyField: 'legacy_id', displayField: 'name' } } },
      { name: 'protheus_item_code', label: 'Cód. Dependente', type: 'text', nullable: false, showInList: true, listFilterType: 'text' },
      { name: 'nome_dependente', label: 'Nome Dependente', type: 'text', nullable: true, showInList: true, hideInForm: true, listFilterType: 'text',
        lookupFrom: { table: 'accessories', keyField: 'protheus_code', displayField: 'name', sourceField: 'protheus_item_code' } },
      { name: 'group_name_dep', label: 'Grupo Dependente', type: 'text', nullable: true, showInList: true, hideInForm: true,
        lookupFrom: { table: 'accessories', keyField: 'protheus_code', displayField: 'legacy_group_id', sourceField: 'protheus_item_code',
          through: { table: 'accessory_groups', keyField: 'legacy_id', displayField: 'name' } } },
      { name: 'quantity', label: 'Qtd.', type: 'number', nullable: false, defaultValue: 1, showInList: true },
      { name: 'cost_std', label: 'Custo (R$)', type: 'decimal', nullable: false, defaultValue: 0, showInList: true },
      { name: 'proportional_factor', label: 'Fat. Prop.', type: 'decimal', nullable: true, showInList: true },
      { name: 'created_at', label: 'Criado em', type: 'timestamp', nullable: false, isReadonly: true },
      { name: 'updated_at', label: 'Atualizado em', type: 'timestamp', nullable: false, isReadonly: true },
    ],
  },

  roller_tables: {
    label: 'Tipo Mesas de Roletes',
    description: 'Peças para composição de mesas de roletes',
    domain: 'regras',
    hasTimestamps: true,
    orderBy: 'legacy_equipment_id',
    columnFilters: true,
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'legacy_equipment_id', label: 'Equipamento', type: 'number', nullable: false, showInList: true,
        lookupFrom: { table: 'equipments', keyField: 'legacy_id', displayField: 'name' },
        fetchOptions: { table: 'equipments', keyField: 'legacy_id', displayField: 'name' } },
      { name: 'protheus_code', label: 'Código Protheus', type: 'text', nullable: false, showInList: true },
      { name: 'nome_componente', label: 'Nome', type: 'text', nullable: true, showInList: true, hideInForm: true,
        lookupFrom: { table: 'accessories', keyField: 'protheus_code', displayField: 'name', sourceField: 'protheus_code' } },
      { name: 'type', label: 'Tipo da Peça', type: 'select', nullable: false, options: ['start', 'middle', 'end', 'unique'], showInList: true },
      { name: 'created_at', label: 'Criado em', type: 'timestamp', nullable: false, isReadonly: true },
      { name: 'updated_at', label: 'Atualizado em', type: 'timestamp', nullable: false, isReadonly: true },
    ],
  },

  // ── TRANSACIONAL (oculto da UI) ───────────────────────────────────────────

  quotes: {
    label: 'Propostas',
    description: 'Propostas comerciais geradas pelo configurador',
    domain: 'transacional',
    hasTimestamps: true,
    orderBy: 'created_at DESC',
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'external_id', label: 'ID Externo (Zoho CRM)', type: 'text', nullable: true },
      { name: 'deal_external_id', label: 'ID Deal (Zoho)', type: 'text', nullable: true },
      { name: 'status', label: 'Status', type: 'select', nullable: false, defaultValue: 'draft', options: ['draft', 'sent', 'approved', 'rejected'] },
      { name: 'raw_quote', label: 'Snapshot JSON', type: 'jsonb', nullable: false, defaultValue: '{}' },
      { name: 'created_at', label: 'Criado em', type: 'timestamp', nullable: false, isReadonly: true },
      { name: 'updated_at', label: 'Atualizado em', type: 'timestamp', nullable: false, isReadonly: true },
    ],
  },

  machines: {
    label: 'Máquinas',
    description: 'Máquinas configuradas dentro de uma proposta',
    domain: 'transacional',
    hasTimestamps: true,
    orderBy: 'created_at DESC',
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'quote_id', label: 'ID Proposta', type: 'uuid', nullable: false },
      { name: 'equipment_id', label: 'ID Equipamento', type: 'uuid', nullable: false },
      { name: 'raw_standard_equip_item', label: 'Snapshot JSON', type: 'jsonb', nullable: false, defaultValue: '{}' },
      { name: 'price', label: 'Preço (R$)', type: 'decimal', nullable: true },
      { name: 'suggested_price', label: 'Preço Sugerido JSON', type: 'jsonb', nullable: true },
      { name: 'selling_price', label: 'Preço de Venda JSON', type: 'jsonb', nullable: true },
      { name: 'created_at', label: 'Criado em', type: 'timestamp', nullable: false, isReadonly: true },
      { name: 'updated_at', label: 'Atualizado em', type: 'timestamp', nullable: false, isReadonly: true },
    ],
  },

  machine_accessories: {
    label: 'Acessórios da Máquina',
    description: 'Acessórios adicionados a cada máquina na proposta',
    domain: 'transacional',
    hasTimestamps: false,
    orderBy: 'machine_id',
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'machine_id', label: 'ID Máquina', type: 'uuid', nullable: false },
      { name: 'accessory_id', label: 'ID Acessório', type: 'uuid', nullable: false },
      { name: 'raw_accessory', label: 'Snapshot JSON', type: 'jsonb', nullable: false, defaultValue: '{}' },
      { name: 'quantity', label: 'Quantidade', type: 'decimal', nullable: false, defaultValue: 1 },
      { name: 'position', label: 'Posição', type: 'select', nullable: true, options: ['input', 'output', 'side', 'top'] },
      { name: 'customized', label: 'Customizado?', type: 'boolean', nullable: false, defaultValue: false },
      { name: 'exported', label: 'Exportado?', type: 'boolean', nullable: false, defaultValue: false },
      { name: 'origin', label: 'Origem', type: 'select', nullable: false, options: ['user', 'combination', 'rule'] },
      { name: 'observations', label: 'Observações', type: 'textarea', nullable: true },
      { name: 'price', label: 'Preço (R$)', type: 'decimal', nullable: true },
    ],
  },

  machine_dependant_items: {
    label: 'Itens Dep. da Máquina',
    description: 'Itens dependentes calculados para cada máquina',
    domain: 'transacional',
    hasTimestamps: false,
    orderBy: 'machine_id',
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'machine_id', label: 'ID Máquina', type: 'uuid', nullable: false },
      { name: 'dependant_item_id', label: 'ID Item Dep.', type: 'uuid', nullable: false },
      { name: 'raw_dependant_item', label: 'Snapshot JSON', type: 'jsonb', nullable: false, defaultValue: '{}' },
      { name: 'quantity', label: 'Quantidade', type: 'number', nullable: false, defaultValue: 1 },
      { name: 'price', label: 'Preço (R$)', type: 'decimal', nullable: true },
      { name: 'suggested_price', label: 'Preço Sugerido JSON', type: 'jsonb', nullable: false, defaultValue: '{}' },
      { name: 'selling_price', label: 'Preço de Venda JSON', type: 'jsonb', nullable: false, defaultValue: '{}' },
    ],
  },

  // ── PLATAFORMA ────────────────────────────────────────────────────────────

}

export const TABLE_NAMES = Object.keys(tables)

export function getSearchableFields(tableName: string): string[] {
  const schema = tables[tableName]
  if (!schema) return []
  return schema.fields
    .filter(f => ['text', 'textarea', 'select'].includes(f.type) && !f.isPk && !f.isReadonly)
    .map(f => f.name)
}

export function getEditableFields(tableName: string): Field[] {
  const schema = tables[tableName]
  if (!schema) return []
  return schema.fields.filter(f => !f.isPk && !f.isReadonly)
}

export function getListFields(tableName: string): Field[] {
  const schema = tables[tableName]
  if (!schema) return []
  return schema.fields.filter(f =>
    f.type !== 'password' &&
    f.type !== 'uuid' &&
    f.name !== 'created_at' &&
    f.name !== 'updated_at'
  )
}
