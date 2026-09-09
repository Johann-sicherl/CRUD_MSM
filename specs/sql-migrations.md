# Scripts SQL da raiz

Este projeto **não tem migration runner** — os arquivos `msm_*.sql` na raiz
são scripts manuais, rodados uma única vez no SQL Editor do Supabase pelo
dono do projeto. Convenção dos arquivos "oficiais" (com banner de cabeçalho
`-- ====...` + explicação do propósito):

| Arquivo | Propósito |
|---|---|
| `msm_supabase.sql` | Schema completo original gerado para o Supabase (tabelas, extensões). |
| `msm_seguranca.sql` | RLS ativo + zero políticas = acesso negado para anon/authenticated key — só `supabaseAdmin` (service_role) opera. |
| `msm_foreign_keys.sql` | Relacionamentos entre tabelas (ex.: `standard_equipment_items` → `equipments`). |
| `msm_user_profiles.sql` | Tabela `user_profiles` — substituiu um JSON local antigo de perfis/senha/permissões. |
| `msm_audit_log.sql` | Tabela `audit_log` — queries geradas pelo app para aplicar no banco oficial (ver `specs/auditoria.md`). |
| `msm_global_table_replace.sql` | RPC `global_table_replace` — DELETE+INSERT atômico do Atualizador Global (ver `specs/import-export.md`). |
| `msm_replace_protheus_code.sql` | RPC `replace_protheus_code` — substituição atômica de revisão de componente (ver `specs/pdm-protheus-integracao.md`). |
| `msm_csv_baseline_snapshots.sql` | Tabela de snapshot pré-import, para a comparação "CSV novo vs. banco atual" (ver `specs/csv-baseline-comparacao.md`). |
| `msm_cleanup_backup_tables.sql` | Limpeza única de tabelas `*_backup_*` criadas por uma versão antiga (já descontinuada) do Atualizador Global, que renomeava a tabela real em vez de fazer DELETE+INSERT atômico. |

## Exceções à convenção — sem banner, scripts pontuais

- `msm_update_cost_std.sql` — `UPDATE ... SET cost_std = 10000` em
  `accessories`/`dependant_items`/`standard_equipment_items`. Sem cabeçalho
  explicativo.
- `msm_update_equipments_rates.sql` — `UPDATE equipments SET ipi_tax_rate =
  1, contribution_margin_ratio = 1, ...` (forçamento manual de taxas/
  comissões). Sem cabeçalho explicativo.

Ambos são scripts de correção pontual já aplicados — não está confirmado se
ainda são relevantes/reexecutáveis ou se são só histórico. **Decisão**: manter
a arquitetura como está (não reescrever com banner, não arquivar em pasta
separada) até haver motivo concreto para revisitá-los.

## Padrão de segurança para função `SECURITY DEFINER` nova

Toda função Postgres `SECURITY DEFINER` criada (as duas RPCs acima) precisa,
imediatamente após o `CREATE FUNCTION`:

```sql
REVOKE EXECUTE ON FUNCTION nome_da_funcao FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION nome_da_funcao TO service_role;
```

Sem isso, uma função `SECURITY DEFINER` fica exposta a qualquer cliente com
a chave publicável, contornando o RLS que ela deveria respeitar.
