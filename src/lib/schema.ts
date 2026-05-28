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
  displayField: string
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
}

export interface TableSchema {
  label: string
  description: string
  domain: 'catalogo' | 'regras' | 'transacional' | 'plataforma'
  hasTimestamps: boolean
  orderBy: string
  fields: Field[]
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
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'legacy_id', label: 'ID Legado (Protheus)', type: 'number', nullable: false, showInList: true },
      { name: 'name', label: 'Nome / Modelo', type: 'text', nullable: false, showInList: true },
      { name: 'commercial_name', label: 'Nome Comercial', type: 'text', nullable: false, showInList: true },
      { name: 'ipi_tax_rate', label: 'Taxa IPI (%)', type: 'decimal', nullable: false, defaultValue: 0, placeholder: '0.00' },
      { name: 'contribution_margin_ratio', label: 'Margem Contribuição (%)', type: 'decimal', nullable: false, defaultValue: 0 },
      { name: 'seller_commission', label: 'Comissão Vendedor (%)', type: 'decimal', nullable: false, defaultValue: 0 },
      { name: 'manager_commission', label: 'Comissão Gerente (%)', type: 'decimal', nullable: false, defaultValue: 0 },
      { name: 'director_commission', label: 'Comissão Diretoria (%)', type: 'decimal', nullable: false, defaultValue: 0 },
      { name: 'certification_cost', label: 'Custo Certificação (R$)', type: 'decimal', nullable: false, defaultValue: 0 },
      { name: 'labor_cost_rate', label: 'Taxa Mão de Obra (%)', type: 'decimal', nullable: false, defaultValue: 0 },
      { name: 'warranty_rate', label: 'Taxa Garantia (%)', type: 'decimal', nullable: false, defaultValue: 0 },
      { name: 'parts_provision_rate', label: 'Taxa Provisão Peças (%)', type: 'decimal', nullable: false, defaultValue: 0 },
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
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'legacy_id', label: 'ID Legado (Protheus)', type: 'number', nullable: false, showInList: true },
      { name: 'name', label: 'Nome', type: 'text', nullable: false, showInList: true },
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
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'legacy_equipment_id', label: 'ID Equip. Legado', type: 'number', nullable: false, showInList: true },
      { name: 'protheus_code', label: 'Código Protheus', type: 'text', nullable: false, showInList: true },
      { name: 'processor', label: 'Processador', type: 'text', nullable: true },
      { name: 'memory', label: 'Memória RAM', type: 'text', nullable: true },
      { name: 'storage', label: 'Armazenamento', type: 'text', nullable: true },
      { name: 'graphics_card', label: 'Placa de Vídeo', type: 'text', nullable: true },
      { name: 'conveyor_belt_load_capacity_kg', label: 'Cap. Carga Esteira (kg)', type: 'text', nullable: true },
      { name: 'tube_power_kv', label: 'Potência Tubo (kV)', type: 'text', nullable: true },
      { name: 'certificate', label: 'Certificado', type: 'text', nullable: true },
      { name: 'conveyor_belt_type', label: 'Tipo Esteira', type: 'text', nullable: true },
      { name: 'motopolia_type', label: 'Tipo Motopolia', type: 'text', nullable: true },
      { name: 'language', label: 'Idioma', type: 'text', nullable: true },
      { name: 'color', label: 'Cor', type: 'text', nullable: true, showInList: true },
      { name: 'legacy_general_alert_id', label: 'ID Alerta Legado', type: 'number', nullable: true, defaultValue: 0 },
      { name: 'status', label: 'Status', type: 'select', nullable: false, defaultValue: 'active', options: ['active', 'inactive', 'deactive'], showInList: true },
      { name: 'cost_std', label: 'Custo Padrão (R$)', type: 'decimal', nullable: false, defaultValue: 0, showInList: true },
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
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'protheus_code', label: 'Código Protheus', type: 'text', nullable: false, showInList: true },
      { name: 'name', label: 'Nome', type: 'text', nullable: false, showInList: true },
      { name: 'legacy_group_id', label: 'Grupo', type: 'number', nullable: true, lookupFrom: { table: 'accessory_groups', keyField: 'legacy_id', displayField: 'name' } },
      { name: 'color', label: 'Cor', type: 'text', nullable: true },
      { name: 'predominant_material', label: 'Material Predominante', type: 'text', nullable: true },
      { name: 'dimensional_mm', label: 'Dimensão (mm)', type: 'number', nullable: true },
      { name: 'monitor_size', label: 'Tamanho Monitor (pol)', type: 'decimal', nullable: true },
      { name: 'quantity_monitor_totem', label: 'Qtd. Monitor Totem', type: 'number', nullable: true },
      { name: 'cost_std', label: 'Custo Padrão (R$)', type: 'decimal', nullable: false, defaultValue: 0, showInList: true },
      { name: 'description', label: 'Descrição', type: 'textarea', nullable: true },
      { name: 'legacy_general_alert_id', label: 'ID Alerta Legado', type: 'number', nullable: true, defaultValue: 0 },
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
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'legacy_id', label: 'ID Legado (Protheus)', type: 'number', nullable: false, showInList: true },
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
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'legacy_equipment_id', label: 'ID Equip. Legado', type: 'number', nullable: false, showInList: true },
      { name: 'protheus_code', label: 'Código Protheus Acessório', type: 'text', nullable: false, showInList: true },
      { name: 'description', label: 'Descrição', type: 'textarea', nullable: true },
      { name: 'legacy_general_alert_id', label: 'ID Alerta Legado', type: 'number', nullable: true, defaultValue: 0 },
      { name: 'operation_time', label: 'Tempo de Operação (min)', type: 'number', nullable: true },
      { name: 'maximum_quantity', label: 'Qtd. Máxima', type: 'number', nullable: true },
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
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'legacy_equipment_id', label: 'ID Equip. Legado', type: 'number', nullable: false, showInList: true },
      { name: 'legacy_group_id', label: 'ID Grupo Legado', type: 'number', nullable: false, showInList: true },
      { name: 'protheus_code', label: 'Código Protheus', type: 'text', nullable: false, showInList: true },
      { name: 'legacy_second_group_id', label: 'ID 2º Grupo Legado', type: 'number', nullable: true },
      { name: 'remove_list_code', label: 'Código a Remover', type: 'text', nullable: false, showInList: true },
      { name: 'status', label: 'Status', type: 'select', nullable: false, defaultValue: 'active', options: ['active', 'inactive'] },
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
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'legacy_equipment_id', label: 'ID Equip. Legado', type: 'number', nullable: false, showInList: true },
      { name: 'protheus_code', label: 'Código Protheus Item', type: 'text', nullable: false, showInList: true },
      { name: 'protheus_item_code', label: 'Código Protheus Gatilho', type: 'text', nullable: false, showInList: true },
      { name: 'quantity', label: 'Quantidade', type: 'number', nullable: false, defaultValue: 1 },
      { name: 'cost_std', label: 'Custo Padrão (R$)', type: 'decimal', nullable: false, defaultValue: 0, showInList: true },
      { name: 'proportional_factor', label: 'Fator Proporcional', type: 'decimal', nullable: true },
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
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'legacy_equipment_id', label: 'ID Equip. Legado', type: 'number', nullable: false, showInList: true },
      { name: 'protheus_code', label: 'Código Protheus', type: 'text', nullable: false, showInList: true },
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
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true, showInList: true },
      { name: 'external_id', label: 'ID Externo (Zoho CRM)', type: 'text', nullable: true, showInList: true },
      { name: 'deal_external_id', label: 'ID Deal (Zoho)', type: 'text', nullable: true },
      { name: 'status', label: 'Status', type: 'select', nullable: false, defaultValue: 'draft', options: ['draft', 'sent', 'approved', 'rejected'], showInList: true },
      { name: 'raw_quote', label: 'Snapshot da Proposta (JSON)', type: 'jsonb', nullable: false, defaultValue: '{}' },
      { name: 'created_at', label: 'Criado em', type: 'timestamp', nullable: false, isReadonly: true, showInList: true },
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
      { name: 'quote_id', label: 'ID Proposta (FK)', type: 'uuid', nullable: false, showInList: true },
      { name: 'equipment_id', label: 'ID Equipamento (FK)', type: 'uuid', nullable: false, showInList: true },
      { name: 'raw_standard_equip_item', label: 'Snapshot Item Padrão (JSON)', type: 'jsonb', nullable: false, defaultValue: '{}' },
      { name: 'price', label: 'Preço Informado (R$)', type: 'decimal', nullable: true },
      { name: 'suggested_price', label: 'Preço Sugerido (JSON)', type: 'jsonb', nullable: true },
      { name: 'selling_price', label: 'Preço de Venda (JSON)', type: 'jsonb', nullable: true },
      { name: 'created_at', label: 'Criado em', type: 'timestamp', nullable: false, isReadonly: true, showInList: true },
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
      { name: 'machine_id', label: 'ID Máquina (FK)', type: 'uuid', nullable: false, showInList: true },
      { name: 'accessory_id', label: 'ID Acessório (FK)', type: 'uuid', nullable: false, showInList: true },
      { name: 'raw_accessory', label: 'Snapshot Acessório (JSON)', type: 'jsonb', nullable: false, defaultValue: '{}' },
      { name: 'quantity', label: 'Quantidade', type: 'decimal', nullable: false, defaultValue: 1 },
      { name: 'position', label: 'Posição', type: 'select', nullable: true, options: ['input', 'output', 'side', 'top'] },
      { name: 'item_id', label: 'Item ID (config)', type: 'text', nullable: true },
      { name: 'parent_item_id', label: 'ID Item Pai', type: 'text', nullable: true },
      { name: 'customized', label: 'Customizado?', type: 'boolean', nullable: false, defaultValue: false, showInList: true },
      { name: 'exported', label: 'Exportado?', type: 'boolean', nullable: false, defaultValue: false, showInList: true },
      { name: 'origin', label: 'Origem', type: 'select', nullable: false, options: ['user', 'combination', 'rule'], showInList: true },
      { name: 'observations', label: 'Observações', type: 'textarea', nullable: true },
      { name: 'price', label: 'Preço Informado (R$)', type: 'decimal', nullable: true },
      { name: 'suggested_price', label: 'Preço Sugerido (JSON)', type: 'jsonb', nullable: true },
      { name: 'selling_price', label: 'Preço de Venda (JSON)', type: 'jsonb', nullable: true },
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
      { name: 'machine_id', label: 'ID Máquina (FK)', type: 'uuid', nullable: false, showInList: true },
      { name: 'dependant_item_id', label: 'ID Item Dep. (FK)', type: 'uuid', nullable: false, showInList: true },
      { name: 'raw_dependant_item', label: 'Snapshot Item Dep. (JSON)', type: 'jsonb', nullable: false, defaultValue: '{}' },
      { name: 'quantity', label: 'Quantidade Calculada', type: 'number', nullable: false, defaultValue: 1, showInList: true },
      { name: 'price', label: 'Preço Base (R$)', type: 'decimal', nullable: true },
      { name: 'suggested_price', label: 'Preço Sugerido (JSON)', type: 'jsonb', nullable: false, defaultValue: '{}' },
      { name: 'selling_price', label: 'Preço de Venda (JSON)', type: 'jsonb', nullable: false, defaultValue: '{}' },
    ],
  },

  // ── PLATAFORMA ────────────────────────────────────────────────────────────

  users: {
    label: 'Usuários',
    description: 'Usuários do sistema com controle de acesso JWT',
    domain: 'plataforma',
    hasTimestamps: true,
    orderBy: 'email',
    fields: [
      { name: 'id', label: 'ID', type: 'uuid', nullable: false, isPk: true, isReadonly: true },
      { name: 'email', label: 'E-mail', type: 'text', nullable: false, showInList: true, placeholder: 'usuario@empresa.com' },
      { name: 'first_name', label: 'Nome', type: 'text', nullable: false, showInList: true },
      { name: 'last_name', label: 'Sobrenome', type: 'text', nullable: true },
      { name: 'password', label: 'Senha (hash)', type: 'password', nullable: false, placeholder: 'Deixe em branco para manter' },
      { name: 'active', label: 'Ativo?', type: 'boolean', nullable: false, defaultValue: true, showInList: true },
      { name: 'role', label: 'Perfil', type: 'select', nullable: false, defaultValue: 'user', options: ['user', 'admin'], showInList: true },
      { name: 'deleted', label: 'Excluído?', type: 'boolean', nullable: true, defaultValue: false },
      { name: 'last_login', label: 'Último Login', type: 'timestamp', nullable: true, isReadonly: true },
      { name: 'created_at', label: 'Criado em', type: 'timestamp', nullable: false, isReadonly: true },
      { name: 'updated_at', label: 'Atualizado em', type: 'timestamp', nullable: false, isReadonly: true },
    ],
  },
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
