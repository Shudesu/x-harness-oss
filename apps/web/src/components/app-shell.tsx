'use client'
import { usePathname } from 'next/navigation'
import Sidebar from './layout/sidebar'
import AuthGuard from './auth-guard'
import CampaignUpdate from './campaign-update'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === '/login' || pathname === '/ui-preview') {
    return <>{children}</>
  }

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="min-w-0 flex-1 px-4 pb-10 pt-[72px] sm:px-6 lg:px-10 lg:pt-8">
          <div className="mx-auto w-full max-w-6xl">
            <CampaignUpdate autoShow={pathname === '/'} />
            {children}
          </div>
        </main>
      </div>
    </AuthGuard>
  )
}
