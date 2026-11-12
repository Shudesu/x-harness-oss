import type { ReactNode } from 'react'
import Link from 'next/link'
import { Surface } from '@cloudflare/kumo/components/surface'

export interface HarnessPageHeaderProps {
  title: string
  description?: string
  product?: string
  action?: ReactNode
}

export function HarnessPageHeader({
  title,
  description,
  action,
}: HarnessPageHeaderProps) {
  // Plain, quiet page title. Product branding lives once in the sidebar.
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-kumo-line pb-5">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-kumo-default sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-kumo-subtle">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export interface HarnessStatCardProps {
  title: string
  value: number | null
  loading: boolean
  icon: ReactNode
  href: string
  accentColor: string
  subtitle?: string
  detailLabel?: string
}

export function HarnessStatCard({
  title,
  value,
  loading,
  icon,
  href,
  accentColor,
  subtitle,
  detailLabel = '詳細を見る',
}: HarnessStatCardProps) {
  return (
    <Link
      href={href}
      aria-label={`${title}の詳細を見る`}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-harness-accent focus-visible:ring-offset-2"
    >
      <Surface className="h-full rounded-xl p-5 transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-2 text-sm font-medium text-gray-500">{title}</p>
            {loading ? (
              <div className="h-8 w-20 animate-pulse rounded bg-gray-100" />
            ) : (
              <p className="text-3xl font-bold tabular-nums text-gray-900">
                {value !== null ? value.toLocaleString('ja-JP') : '—'}
              </p>
            )}
            {subtitle && !loading ? <p className="mt-1 text-xs text-gray-400">{subtitle}</p> : null}
          </div>
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
            style={{ backgroundColor: accentColor }}
            aria-hidden="true"
          >
            {icon}
          </span>
        </div>
        <p className="mt-4 text-xs font-medium text-gray-400 transition-colors group-hover:text-emerald-700">
          {detailLabel} <span aria-hidden="true">→</span>
        </p>
      </Surface>
    </Link>
  )
}
