import type { Metadata } from 'next'
import './globals.css'
import AppShell from '@/components/app-shell'

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_MAINTENANCE_MODE === 'true' ? 'CUBΣLIC Content OS — 準備中' : 'X Harness',
  description: process.env.NEXT_PUBLIC_MAINTENANCE_MODE === 'true'
    ? 'CUBΣLIC Content OSの本番環境を準備しています'
    : 'X account automation dashboard',
}

function MaintenanceScreen() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-6 py-16 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(29,155,240,0.22),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(139,92,246,0.18),transparent_40%)]" />
      <section className="relative w-full max-w-2xl rounded-3xl border border-white/10 bg-white/[0.06] p-8 shadow-2xl backdrop-blur sm:p-12">
        <div className="mb-8 flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500 text-lg font-black shadow-lg shadow-sky-500/25">Σ</div>
          <div>
            <p className="text-sm font-medium tracking-[0.2em] text-sky-300">CUBΣLIC</p>
            <p className="text-sm text-slate-400">Content OS</p>
          </div>
        </div>
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-medium text-amber-200">
          <span className="h-2 w-2 rounded-full bg-amber-300" />
          本番環境を準備中
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">管理画面はまだ利用できません</h1>
        <p className="mt-5 max-w-xl text-base leading-8 text-slate-300">
          現在、安全確認と本番APIの準備を進めています。準備が完了するまで、APIキーやXのアクセストークンを入力する必要はありません。
        </p>
        <div className="mt-9 border-t border-white/10 pt-6 text-sm text-slate-400">
          公開・予約・自動反応機能は停止した状態です。
        </div>
      </section>
    </main>
  )
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const maintenanceMode = process.env.NEXT_PUBLIC_MAINTENANCE_MODE === 'true'

  return (
    <html lang="ja">
      <body className="bg-gray-50 text-gray-900 antialiased" style={{ fontFamily: "'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', system-ui, sans-serif" }}>
        {maintenanceMode ? <MaintenanceScreen /> : <AppShell>{children}</AppShell>}
      </body>
    </html>
  )
}
