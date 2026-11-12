'use client'

// 承認キューの1枚: 元ポスト・投稿予定時刻・「OKして予約」「直す」「捨てる」。
// 「直す」を押したときだけ文面と時刻の編集欄を出す。
import { useState } from 'react'
import { Button } from '@cloudflare/kumo/components/button'
import { TypeBadge, extractVideoTweetId, isoToDatetimeLocal, datetimeLocalToIso, type GrowthDraft } from './shared'
import { isPastDue, scheduleLabel } from '@/lib/approval-queue'

function TweetEmbed({ id }: { id: string }) {
  return <iframe
    title="元ポスト"
    src={`https://platform.twitter.com/embed/Tweet.html?id=${id}&theme=light&hideThread=true`}
    className="h-96 w-full rounded-lg border border-kumo-line bg-white"
  />
}

export function QueueCard({ draft, now, onApprove, onReject, onSaved }: {
  draft: GrowthDraft
  now: Date
  onApprove: (id: string) => Promise<void>
  onReject: (id: string) => Promise<void>
  onSaved: (id: string, text: string, scheduledAt: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(draft.text)
  const [scheduledAt, setScheduledAt] = useState(isoToDatetimeLocal(draft.scheduled_at))
  const [busy, setBusy] = useState<'' | 'ok' | 'reject' | 'save'>('')
  const [error, setError] = useState('')
  const [showSource, setShowSource] = useState(false)
  const [showVideo, setShowVideo] = useState(false)

  const past = isPastDue(draft.scheduled_at, now)
  const videoTweetId = extractVideoTweetId(draft.text)
  const run = async (kind: 'ok' | 'reject' | 'save', fn: () => Promise<void>) => {
    setBusy(kind); setError('')
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : '処理に失敗しました') } finally { setBusy('') }
  }
  const cancelEdit = () => { setText(draft.text); setScheduledAt(isoToDatetimeLocal(draft.scheduled_at)); setEditing(false) }

  return (
    <article className="space-y-4 rounded-xl border border-kumo-line bg-kumo-base p-5">
      {/* 投稿予定時刻 */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-base font-semibold text-kumo-default">
          <span className="tabular-nums">{scheduleLabel(draft.scheduled_at, now)}</span>
          <span className="ml-1 text-sm font-normal text-kumo-subtle">に投稿予定</span>
        </p>
        <TypeBadge type={draft.type} />
      </div>
      {past && (
        <p className="rounded-lg bg-kumo-warning-tint px-3 py-2 text-xs leading-5 text-kumo-warning">
          予定の時刻を過ぎています。OKすると、次の空いている時刻に予約します。
        </p>
      )}

      {/* 文面 */}
      {editing ? (
        <div className="space-y-3">
          <div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} aria-label="投稿の文面"
              className="w-full rounded-lg border border-kumo-line px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-kumo-focus" />
            <p className="mt-1 text-right text-xs text-kumo-subtle">{text.length} 文字</p>
          </div>
          <label className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">投稿予定時刻（日本時間）</span>
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
              className="rounded-lg border border-kumo-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-kumo-focus" />
          </label>
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm leading-7 text-kumo-default">{draft.text}</p>
      )}

      {/* 元ポスト */}
      <div className="rounded-lg bg-kumo-tint px-3 py-2.5 text-sm">
        {draft.quote_tweet_id ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium text-kumo-default">元ポスト（このポストを引用します）</span>
              <button type="button" className="text-kumo-link underline-offset-2 hover:underline" onClick={() => setShowSource((v) => !v)} aria-expanded={showSource}>
                {showSource ? '閉じる' : 'ここで見る'}
              </button>
              <a href={`https://x.com/i/status/${draft.quote_tweet_id}`} target="_blank" rel="noopener noreferrer" className="text-kumo-link hover:underline">Xで開く ↗</a>
            </div>
            {showSource && <TweetEmbed id={draft.quote_tweet_id} />}
          </div>
        ) : (
          <span className="text-kumo-subtle">元ポストなし（引用しない、ふつうの投稿です）</span>
        )}
        {videoTweetId && (
          <div className="mt-2 space-y-2">
            <button type="button" className="text-kumo-link underline-offset-2 hover:underline" onClick={() => setShowVideo((v) => !v)} aria-expanded={showVideo}>
              {showVideo ? '動画を閉じる' : '添付される動画を見る'}
            </button>
            {showVideo && <TweetEmbed id={videoTweetId} />}
          </div>
        )}
      </div>

      {error && <p role="alert" className="rounded-lg bg-kumo-danger-tint px-3 py-2 text-sm text-kumo-danger">{error}</p>}

      {/* ボタン */}
      {editing ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={cancelEdit} disabled={busy !== ''}>やめる</Button>
          <Button variant="primary" disabled={busy !== '' || !text.trim() || !scheduledAt}
            onClick={() => run('save', async () => { await onSaved(draft.id, text, datetimeLocalToIso(scheduledAt)); setEditing(false) })}>
            {busy === 'save' ? '保存中…' : '直した内容を保存'}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => run('reject', () => onReject(draft.id))} disabled={busy !== ''}>{busy === 'reject' ? '処理中…' : '捨てる'}</Button>
          <Button variant="secondary" onClick={() => setEditing(true)} disabled={busy !== ''}>直す</Button>
          <Button variant="primary" onClick={() => run('ok', () => onApprove(draft.id))} disabled={busy !== ''}>{busy === 'ok' ? '予約中…' : 'OKして予約'}</Button>
        </div>
      )}
    </article>
  )
}
