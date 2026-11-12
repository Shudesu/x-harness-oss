'use client'

import { useEffect, useState, type ComponentType } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ArrowSquareOut, ArrowUUpLeft, Article, ChartBar, ChatCircleDots, ChatsCircle, Gear, House, Lightning,
  List, Megaphone, Newspaper, PencilSimpleLine, SignOut, Tag, TrendUp, UserCircle, UsersThree, X,
  type IconProps,
} from '@phosphor-icons/react'
import { useSelectedAccount } from '@/hooks/use-selected-account'
import { APP_VERSION, BUILD_DATE, versionLabel } from '@/lib/build-info'

// One navigation for the whole console. Sub-sections of a page (e.g. 承認待ち /
// 処理済み, 新規投稿 / 予約・失敗) live as tabs inside that page — never as a
// second menu here.
type NavItem = { href: string; label: string; icon: ComponentType<IconProps> }
const NAV: Array<{ label: string; items: NavItem[] }> = [
  { label: '', items: [{ href: '/', label: 'ダッシュボード', icon: House }] },
  {
    label: '投稿',
    items: [
      { href: '/posts', label: '投稿・予約', icon: PencilSimpleLine },
      { href: '/growth', label: '投稿・記事の承認', icon: TrendUp },
      { href: '/articles', label: '記事', icon: Article },
      { href: '/news', label: 'ニュース', icon: Newspaper },
    ],
  },
  {
    label: '反応',
    items: [
      { href: '/replies', label: 'リプライ', icon: ArrowUUpLeft },
      { href: '/quotes', label: '引用', icon: ChatsCircle },
      { href: '/messages', label: 'DM', icon: ChatCircleDots },
      { href: '/followers', label: 'フォロワー', icon: UsersThree },
    ],
  },
  {
    label: '集客',
    items: [
      { href: '/engagement-gates', label: 'エンゲージメントゲート', icon: Lightning },
      { href: '/campaign', label: 'キャンペーン', icon: Megaphone },
    ],
  },
  {
    label: '設定',
    items: [
      { href: '/accounts', label: 'アカウント', icon: UserCircle },
      { href: '/tags', label: 'タグ', icon: Tag },
      { href: '/staff', label: 'スタッフ', icon: UsersThree },
      { href: '/usage', label: 'API使用量', icon: ChartBar },
      { href: '/settings', label: '設定', icon: Gear },
    ],
  },
]

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}

function AccountSwitcher() {
  const { accounts, loading, selectedAccountId, setSelectedAccountId } = useSelectedAccount()
  if (loading) return <div className="mx-3 h-9 animate-pulse rounded-lg bg-kumo-tint" />
  if (accounts.length === 0) return null
  return (
    <label className="mx-3 block">
      <span className="sr-only">Xアカウント</span>
      <select
        value={selectedAccountId}
        onChange={(e) => setSelectedAccountId(e.target.value)}
        className="w-full cursor-pointer truncate rounded-lg border border-kumo-line bg-kumo-base px-2.5 py-2 text-sm font-medium text-kumo-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            @{a.username}{a.displayName ? `（${a.displayName}）` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

function NavLinks({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="メインメニュー" className="flex-1 overflow-y-auto px-3 py-2">
      {NAV.map((section) => (
        <div key={section.label || 'top'} className="mb-3">
          {section.label && (
            <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold tracking-wide text-kumo-subtle">{section.label}</p>
          )}
          <ul className="space-y-0.5">
            {section.items.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href)
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors focus-visible:outline focus-visible:outline-2 ${
                      active
                        ? 'bg-kumo-tint font-semibold text-kumo-default'
                        : 'text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default'
                    }`}
                  >
                    <Icon size={18} weight={active ? 'fill' : 'regular'} aria-hidden="true" />
                    {label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function SidebarBody({ pathname }: { pathname: string }) {
  const lineHarnessUrl = process.env.NEXT_PUBLIC_LINE_HARNESS_URL
  const lineConnected = Boolean(lineHarnessUrl && lineHarnessUrl !== '#')
  return (
    <>
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-kumo-brand text-sm font-bold text-white">X</span>
        <div className="leading-tight">
          <p className="text-sm font-bold text-kumo-default">X Harness</p>
          <p className="text-[11px] text-kumo-subtle">管理画面</p>
        </div>
      </div>
      <AccountSwitcher />
      <div className="mt-3 border-t border-kumo-line" />
      <NavLinks pathname={pathname} />
      <div className="space-y-1 border-t border-kumo-line px-3 py-3">
        {lineConnected && (
          <a href={lineHarnessUrl} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default">
            <ArrowSquareOut size={18} aria-hidden="true" />L Harness を開く
          </a>
        )}
        <button
          type="button"
          onClick={() => {
            sessionStorage.removeItem('xh_session')
            window.location.href = '/login'
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-danger"
        >
          <SignOut size={18} aria-hidden="true" />ログアウト
        </button>
        <a
          className="block px-2.5 pt-1 font-mono text-[11px] text-kumo-subtle hover:underline"
          href={`https://github.com/Shudesu/x-harness-oss/releases/tag/v${APP_VERSION}`}
          target="_blank"
          rel="noopener noreferrer"
          title={BUILD_DATE ? `ビルド ${BUILD_DATE}` : undefined}
        >
          {versionLabel()}
        </a>
      </div>
    </>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  useEffect(() => { setOpen(false) }, [pathname])
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex items-center gap-2 border-b border-kumo-line bg-kumo-base px-3 py-2 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="メニューを開く"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-kumo-default hover:bg-kumo-tint"
        >
          <List size={22} />
        </button>
        <span className="text-sm font-bold text-kumo-default">X Harness</span>
      </div>

      {/* Mobile drawer (same navigation, not a second one) */}
      {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside
        aria-hidden={!open}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-kumo-base shadow-xl transition-transform duration-200 lg:hidden ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="メニューを閉じる"
          className="absolute right-3 top-4 flex h-9 w-9 items-center justify-center rounded-lg text-kumo-subtle hover:bg-kumo-tint"
        >
          <X size={18} />
        </button>
        {open && <SidebarBody pathname={pathname} />}
      </aside>

      {/* Desktop */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-kumo-line bg-kumo-base lg:flex">
        <SidebarBody pathname={pathname} />
      </aside>
    </>
  )
}
