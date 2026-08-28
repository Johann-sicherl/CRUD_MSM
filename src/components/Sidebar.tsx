'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useProtheusAuth } from '@/lib/protheusAuthContext'
import { useAppAuth } from '@/lib/appAuthContext'
import { MODULES, MODULE_GROUPS } from '@/lib/modules'

interface Props {
  pinned: boolean
  onPinChange: (pinned: boolean) => void
}

export default function Sidebar({ pinned, onPinChange }: Props) {
  const pathname = usePathname()
  const [hovered, setHovered] = useState(false)
  const expanded = pinned || hovered
  const { creds: protheusCreds, disconnect: disconnectProtheus, openPrompt: openProtheusPrompt } = useProtheusAuth()
  const { user: appUser, logout: appLogout } = useAppAuth()

  // Módulos visíveis vêm do perfil (ver Configuração de Usuários). Admin
  // ignora a lista — visibleModules é só um snapshot gravado na criação do
  // perfil e não é recalculado quando um módulo novo é adicionado ao app.
  const visible = new Set(appUser.visibleModules)
  const byGroup = MODULE_GROUPS.map(group => ({
    group,
    items: MODULES.filter(m => m.group === group && (appUser.isAdmin || visible.has(m.key))),
  })).filter(g => g.items.length > 0)

  return (
    <>
      {/* Thin trigger strip — shown only when sidebar is fully collapsed */}
      {!expanded && (
        <div
          className="fixed left-0 top-0 w-3 h-full z-40 bg-primary/20 border-r border-primary/30 cursor-e-resize"
          onMouseEnter={() => setHovered(true)}
        />
      )}

      <aside
        className={`fixed left-0 top-0 h-full z-30 w-64 flex flex-col bg-surface-container-low border-r border-outline-variant shadow-2xl transition-transform duration-200 ease-in-out ${
          expanded ? 'translate-x-0' : '-translate-x-full'
        }`}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Header */}
        <div className="relative px-4 py-2 border-b border-outline-variant flex flex-col items-center gap-2">
          <Image
            src="https://vmisecurity.com/wp-content/uploads/2021/11/logo-vmi-trademark.png"
            alt="VMI Security"
            width={160}
            height={56}
            className="object-contain"
            priority
            unoptimized
          />

          {/* Pin button */}
          <button
            onClick={() => onPinChange(!pinned)}
            title={pinned ? 'Desafixar — sidebar recolhe ao tirar o mouse' : 'Fixar sidebar aberta'}
            className={`absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded transition-all ${
              pinned
                ? 'text-primary bg-primary/15 border border-primary/40 hover:bg-primary/25'
                : 'text-outline border border-outline-variant hover:border-primary/50 hover:text-primary'
            }`}
          >
            <PinIcon pinned={pinned} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3">
          {byGroup.map(({ group, items }) => (
            <div key={group} className="mt-5 first:mt-0">
              <div className="px-4 py-1 text-[10px] font-semibold text-outline uppercase tracking-[0.15em] font-mono">
                {group}
              </div>
              {items.map(m => {
                const isActive = pathname === m.href
                return (
                  <Link
                    key={m.key}
                    href={m.href}
                    // Sem pré-carregar em segundo plano o código de toda tela
                    // listada aqui assim que o menu aparece — em computador
                    // de baixa performance isso competia por CPU/rede com o
                    // que a pessoa realmente estava usando. Cada tela ainda
                    // carrega normalmente ao ser aberta, só não adianta o
                    // trabalho de telas que talvez nunca sejam abertas.
                    prefetch={false}
                    className={`flex items-center px-4 py-2 mx-2 rounded text-sm transition-all ${
                      isActive
                        ? 'bg-primary/10 text-primary border-l-2 border-primary pl-[14px]'
                        : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                    }`}
                  >
                    <span className="truncate">{m.label}</span>
                  </Link>
                )
              })}
            </div>
          ))}

          {appUser.isAdmin && (
            <div className="mt-5">
              <div className="px-4 py-1 text-[10px] font-semibold text-outline uppercase tracking-[0.15em] font-mono">
                Administração
              </div>
              <Link
                href="/configuracao-usuarios"
                prefetch={false}
                className={`flex items-center px-4 py-2 mx-2 rounded text-sm transition-all ${
                  pathname === '/configuracao-usuarios'
                    ? 'bg-primary/10 text-primary border-l-2 border-primary pl-[14px]'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                }`}
              >
                <span className="truncate">Configuração de Usuários</span>
              </Link>
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-outline-variant text-[10px] text-outline font-mono flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span>10 tabelas · v3.1</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono ${
              pinned
                ? 'text-primary border-primary/30 bg-primary/10'
                : 'text-outline border-outline-variant'
            }`}>
              {pinned ? 'FIXADO' : 'AUTO'}
            </span>
          </div>
          {/* Única conexão ao Protheus da aplicação inteira — usada por todas as
              telas que consultam o banco (verificação de status, buscas de
              estrutura, nomes de equipamento etc.) */}
          <button
            onClick={() => protheusCreds ? disconnectProtheus() : openProtheusPrompt()}
            title={protheusCreds ? 'Desconectar do Protheus' : 'Conectar ao Protheus'}
            className={`flex items-center justify-center gap-1.5 px-2 py-1 rounded border text-[9px] font-mono transition-colors ${
              protheusCreds
                ? 'text-green-400 border-green-500/30 bg-green-500/10 hover:bg-green-500/20'
                : 'text-outline border-outline-variant hover:border-primary hover:text-primary'
            }`}
          >
            {protheusCreds ? '✓ Protheus conectado' : '🔌 Conectar ao Protheus'}
          </button>
          {/* Perfil logado neste app (Engenharia do Produto / Gerente Adm
              Comercial) — não confundir com a conexão ao Protheus acima. */}
          <div className="flex items-center justify-between gap-2 px-2 py-1 rounded border border-outline-variant text-[9px] font-mono">
            <span className="truncate text-outline" title={appUser.label}>👤 {appUser.label}</span>
            <button onClick={appLogout} className="shrink-0 text-outline hover:text-error transition-colors">Sair</button>
          </div>
        </div>
      </aside>
    </>
  )
}

function PinIcon({ pinned }: { pinned: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="currentColor"
      style={pinned ? undefined : { transform: 'rotate(45deg)' }}
    >
      <path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5c0 .276-.224 1.5-.5 1.5s-.5-1.224-.5-1.5V10h-4a.5.5 0 0 1-.5-.5c0-.973.64-1.725 1.17-2.189A5.921 5.921 0 0 1 5 6.708V2.277a2.77 2.77 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354z" />
    </svg>
  )
}
