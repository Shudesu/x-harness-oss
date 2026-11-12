'use client'

import { Button } from '@cloudflare/kumo/components/button'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'

// Simple previous/next pager for lists where the total is unknown or large.
export function Pager({ page, hasNext, onPage, label, disabled }: {
  page: number
  hasNext: boolean
  onPage: (page: number) => void
  label?: string
  disabled?: boolean
}) {
  if (page === 1 && !hasNext) return null
  return (
    <nav aria-label="ページ送り" className="flex items-center justify-between gap-3 pt-3">
      <p className="text-xs text-kumo-subtle">{label ?? `${page} ページ目`}</p>
      <div className="flex gap-2">
        <Button size="sm" icon={<CaretLeft />} disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>前へ</Button>
        <Button size="sm" disabled={disabled || !hasNext} onClick={() => onPage(page + 1)}>次へ <CaretRight /></Button>
      </div>
    </nav>
  )
}
