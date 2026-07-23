'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (pathname === '/login') {
      setChecked(true)
      return
    }

    const key = localStorage.getItem('xh_api_key')
    if (!key) {
      router.replace('/login')
      return
    }
    if (pathname !== '/cubelic') {
      router.replace('/cubelic')
      return
    }
    setChecked(true)
  }, [pathname, router])

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-[3px] border-gray-200 border-t-blue-500 rounded-full" />
      </div>
    )
  }

  return <>{children}</>
}
