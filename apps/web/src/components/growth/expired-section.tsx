'use client'

// 期限切れ（予定日が昨日以前）の投稿案を折りたたんで見せる。
// 「まとめてアーカイブ」は削除ではなく一覧から外すだけで、元に戻せる。
import { useState } from 'react'
import { Button } from '@cloudflare/kumo/components/button'
import { Pager } from '@/components/ui/pager'
import { ConfirmDialog } from './confirm-dialog'
import { TypeBadge, type GrowthDraft } from './shared'
import { scheduleLabel } from '@/lib/approval-queue'
import { QueueCard } from './queue-card'

const PAGE = 20

export function ExpiredSection({ drafts, now, onArchive, onApprove, onReject, onSaved }: {
  drafts: GrowthDraft[]
  now: Date
  onArchive: () => Promise<void>
  onApprove: (id: string) => Promise<void>
  onReject: (id: string) => Promise<void>
  onSaved: (id: string, text: string, scheduledAt: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  // 1件だけ開いて、今日の案と同じカード（OK・直す・捨てる）で扱えるようにする。
  const [openId, setOpenId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [page, setPage] = useState(1)
  if (drafts.length === 0) return null
  const last = Math.max(1, Math.ceil(drafts.length / PAGE))
  const p = Math.min(page, last)

  return (
    <section className="rounded-xl border border-kumo-line bg-kumo-base">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 items-center gap-2 text-left">
          <span aria-hidden className="text-kumo-subtle">{open ? '▾' : '▸'}</span>
          <span>
            <span className="font-semibold text-kumo-default">期限切れ {drafts.length}件</span>
            <span className="ml-2 text-sm text-kumo-subtle">予定日を過ぎた古い案です。このままでは投稿されません。</span>
          </span>
        </button>
        <Button variant="secondary" size="sm" onClick={() => setConfirm(true)}>まとめてアーカイブ</Button>
      </div>
      {open && (
        <div className="border-t border-kumo-line px-4 pb-3">
          <ul>
            {drafts.slice((p - 1) * PAGE, p * PAGE).map((d) => (
              <li key={d.id} className="border-b border-kumo-line py-2.5 last:border-0">
                <div className="flex items-start gap-3">
                  <span className="w-28 shrink-0 text-xs tabular-nums text-kumo-subtle">{scheduleLabel(d.scheduled_at, now)}</span>
                  <TypeBadge type={d.type} />
                  <p className="min-w-0 flex-1 text-sm text-kumo-subtle line-clamp-2">{d.text}</p>
                  <button type="button" className="shrink-0 text-xs text-kumo-link underline-offset-2 hover:underline" aria-expanded={openId === d.id}
                    onClick={() => setOpenId((v) => (v === d.id ? null : d.id))}>{openId === d.id ? '閉じる' : '開く'}</button>
                </div>
                {openId === d.id && (
                  <div className="mt-3">
                    <QueueCard draft={d} now={now} onApprove={onApprove} onReject={onReject} onSaved={onSaved} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          <Pager page={p} hasNext={p < last} onPage={setPage} label={`全${drafts.length}件中 ${(p - 1) * PAGE + 1}〜${Math.min(p * PAGE, drafts.length)}件`} />
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`期限切れの ${drafts.length}件をアーカイブしますか？`}
        description={<>削除はしません。この一覧から外すだけで、Xには何も出ません。あとから「元に戻す」でそのまま戻せます。今日と明日以降の案は対象外です。</>}
        confirmLabel="アーカイブする"
        onConfirm={onArchive}
      />
    </section>
  )
}

export function ArchivedNote({ count, onRestore }: { count: number; onRestore: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false)
  if (count === 0) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-kumo-line px-4 py-2.5 text-sm text-kumo-subtle">
      <span>アーカイブ済み {count}件（削除はしていません）</span>
      <button type="button" className="text-kumo-link underline-offset-2 hover:underline" onClick={() => setConfirm(true)}>元に戻す</button>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`アーカイブした ${count}件を元に戻しますか？`}
        description="期限切れの一覧にもう一度並びます。" confirmLabel="元に戻す" onConfirm={onRestore} />
    </div>
  )
}
