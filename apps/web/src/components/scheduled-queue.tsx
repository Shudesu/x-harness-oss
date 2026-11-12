'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Button } from '@cloudflare/kumo/components/button'
import { Surface } from '@cloudflare/kumo/components/surface'
import { Table } from '@cloudflare/kumo/components/table'
import { Tabs } from '@cloudflare/kumo/components/tabs'
import { ArrowClockwise } from '@phosphor-icons/react'
import { api } from '@/lib/api'
import type { ScheduledPost, ScheduledPostStatusFilter } from '@/lib/api'
import { Pager } from '@/components/ui/pager'

const PAGE_SIZE = 20
const STATUS_TABS: Array<{ value: ScheduledPostStatusFilter; label: string }> = [
  { value: 'scheduled', label: '予約中' },
  { value: 'failed', label: '失敗' },
  { value: 'posted', label: '投稿済み' },
  { value: 'all', label: 'すべて' },
]
const STAGE_LABEL: Record<string, string> = {
  precheck: '送信前チェック',
  create_tweet: 'Xへの送信',
  record_result: '結果の記録',
}

function formatDate(s: string) {
  const d = new Date(s.includes('T') || s.includes('+') ? s : `${s.replace(' ', 'T')}+09:00`)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'scheduled') return <Badge variant="blue">予約中</Badge>
  if (status === 'posted') return <Badge variant="green">投稿済み</Badge>
  return <Badge variant="red">失敗</Badge>
}

/** Scheduled / failed / posted queue with requeue + cancel and paging. */
export default function ScheduledQueue({ accountId, refreshKey = 0, initialStatus = 'scheduled' }: {
  accountId: string
  refreshKey?: number
  initialStatus?: ScheduledPostStatusFilter
}) {
  const [status, setStatus] = useState<ScheduledPostStatusFilter>(initialStatus)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<ScheduledPost[]>([])
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const reqRef = useRef(0)
  // A different account starts from page 1 (its list may be shorter).
  // Rows are tied to the account they were loaded for: clear them on switch so
  // another account's reservations can never be acted on from this view.
  const [rowsAccount, setRowsAccount] = useState(accountId)
  useEffect(() => { setPage(1); setRows([]); setHasNext(false); setNotice('') }, [accountId])

  const load = useCallback(async () => {
    const id = ++reqRef.current
    setLoading(true)
    setError('')
    try {
      const res = await api.posts.listScheduledPage({ status, xAccountId: accountId || undefined, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE })
      if (id !== reqRef.current) return
      setRows(res.data.slice(0, PAGE_SIZE))
      setRowsAccount(accountId)
      setHasNext(res.data.length > PAGE_SIZE)
    } catch (e) {
      if (id === reqRef.current) setError(e instanceof Error ? e.message : '一覧を読み込めませんでした')
    } finally {
      if (id === reqRef.current) setLoading(false)
    }
  }, [status, page, accountId])

  useEffect(() => { void load() }, [load, refreshKey])

  const requeue = async (p: ScheduledPost) => {
    if (rowsAccount !== accountId) return
    if (!window.confirm('この失敗した予約を、もう一度送信待ちに戻しますか？（次の空き枠に入ります）\n\n送信の途中で失敗した場合、Xには投稿済みのことがあります。先にXのプロフィールで投稿されていないことを確認してください。戻すと二重投稿になるおそれがあります。')) return
    setBusyId(p.id); setError(''); setNotice('')
    try {
      const res = await api.posts.requeue(p.id, { confirmNotPosted: true })
      setNotice(`予約に戻しました（${formatDate(res.data.scheduledAt)}）`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '再キューに失敗しました')
    } finally { setBusyId(null) }
  }

  const cancel = async (p: ScheduledPost) => {
    if (rowsAccount !== accountId) return
    if (!window.confirm('この予約を取り消しますか？')) return
    setBusyId(p.id); setError(''); setNotice('')
    try {
      await api.posts.cancel(p.id)
      setNotice('予約を取り消しました')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '取り消しに失敗しました')
    } finally { setBusyId(null) }
  }

  return (
    <Surface className="overflow-hidden rounded-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-kumo-line px-4 py-3">
        <Tabs
          variant="segmented"
          size="sm"
          value={status}
          onValueChange={(v) => { setStatus(v as ScheduledPostStatusFilter); setPage(1) }}
          tabs={STATUS_TABS}
        />
        <Button size="sm" variant="ghost" icon={<ArrowClockwise />} disabled={loading} onClick={() => void load()}>更新</Button>
      </div>
      {error && <p role="alert" className="border-b border-kumo-line bg-kumo-danger-tint px-4 py-2 text-sm text-kumo-danger">{error}</p>}
      {notice && <p role="status" className="border-b border-kumo-line px-4 py-2 text-sm text-kumo-success">{notice}</p>}
      {loading && rows.length === 0 ? (
        <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-kumo-tint" />)}</div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-kumo-subtle">
          {status === 'failed' ? '失敗した予約はありません' : status === 'scheduled' ? '予約中の投稿はありません' : '該当する投稿はありません'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[640px]">
            <Table.Header>
              <Table.Row>
                <Table.Head>内容</Table.Head>
                <Table.Head className="w-28">予定日時</Table.Head>
                <Table.Head className="w-64">状態</Table.Head>
                <Table.Head className="w-32 text-right">操作</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {rows.map((p) => (
                <Table.Row key={p.id}>
                  <Table.Cell className="max-w-sm">
                    <p className="line-clamp-2 break-words text-sm">{p.text}</p>
                    {(p.replyToTweetId || p.quoteTweetId) && (
                      <p className="mt-1 text-xs text-kumo-subtle">{p.replyToTweetId ? `返信先 ${p.replyToTweetId}` : `引用 ${p.quoteTweetId}`}</p>
                    )}
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-xs text-kumo-subtle">{formatDate(p.scheduledAt)}</Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={p.status} />
                      {p.status === 'failed' && p.lastErrorStage && <span className="text-xs text-kumo-subtle">{STAGE_LABEL[p.lastErrorStage] ?? p.lastErrorStage}</span>}
                      {p.status === 'failed' && p.lastErrorStatus ? <span className="text-xs text-kumo-subtle">HTTP {p.lastErrorStatus}</span> : null}
                    </div>
                    {p.lastError && <p className="mt-1 line-clamp-3 break-words text-xs text-kumo-danger" title={p.lastError}>{p.lastError}</p>}
                    {p.status === 'posted' && p.postedTweetId && (
                      <a className="mt-1 inline-block text-xs underline underline-offset-2" href={`https://x.com/i/status/${encodeURIComponent(p.postedTweetId)}`} target="_blank" rel="noopener noreferrer">Xで見る ↗</a>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    {p.status === 'failed' && !p.postedTweetId && (
                      <Button size="sm" variant="primary" disabled={busyId === p.id || rowsAccount !== accountId} onClick={() => void requeue(p)}>{busyId === p.id ? '処理中…' : '再キュー'}</Button>
                    )}
                    {p.status === 'scheduled' && (
                      <Button size="sm" variant="secondary-destructive" disabled={busyId === p.id || rowsAccount !== accountId} onClick={() => void cancel(p)}>{busyId === p.id ? '処理中…' : '取り消し'}</Button>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}
      <div className="px-4 pb-3">
        <Pager page={page} hasNext={hasNext} onPage={setPage} disabled={loading} label={`${(page - 1) * PAGE_SIZE + 1}〜${(page - 1) * PAGE_SIZE + rows.length} 件目`} />
      </div>
    </Surface>
  )
}
