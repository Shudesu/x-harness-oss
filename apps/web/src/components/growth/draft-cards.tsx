'use client'

import { useState } from 'react'
import { Button } from '@cloudflare/kumo/components/button'
import { TypeBadge, extractVideoTweetId, isoToDatetimeLocal, datetimeLocalToIso, type GrowthDraft, type ArticleDraft } from './shared'

export function DraftCard({
  draft,
  onApprove,
  onReject,
  onSaved,
}: {
  draft: GrowthDraft
  onApprove: (id: string) => Promise<void>
  onReject: (id: string) => Promise<void>
  onSaved: (id: string, text: string, scheduledAt: string) => Promise<void>
}) {
  const [text, setText] = useState(draft.text)
  const [scheduledAt, setScheduledAt] = useState(isoToDatetimeLocal(draft.scheduled_at))
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [showVideo, setShowVideo] = useState(false)

  const videoTweetId = extractVideoTweetId(text)
  const isDirty = text !== draft.text || scheduledAt !== isoToDatetimeLocal(draft.scheduled_at)

  const handleSave = async () => {
    setSaving(true)
    setSaveMsg('')
    try {
      await onSaved(draft.id, text, datetimeLocalToIso(scheduledAt))
      setSaveMsg('保存しました')
      setTimeout(() => setSaveMsg(''), 2000)
    } finally {
      setSaving(false)
    }
  }

  const handleApprove = async () => {
    setApproving(true)
    try { await onApprove(draft.id) } finally { setApproving(false) }
  }

  const handleReject = async () => {
    setRejecting(true)
    try { await onReject(draft.id) } finally { setRejecting(false) }
  }

  return (
    <div className="bg-kumo-base rounded-xl border border-kumo-line p-5 space-y-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <TypeBadge type={draft.type} />
          {draft.type === 'quote_rt' && (
            videoTweetId ? (
              <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                🎬 動画あり
              </span>
            ) : (
              <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200">
                動画なし
              </span>
            )
          )}
          {draft.quote_tweet_id && (
            <a
              href={`https://x.com/i/status/${draft.quote_tweet_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-kumo-link hover:underline"
            >
              引用元のポスト ↗
            </a>
          )}
        </div>
        <span className="text-xs text-kumo-subtle shrink-0">
          {new Date(draft.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
        </span>
      </div>

      {/* Text editor */}
      <div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className="w-full border border-kumo-line rounded-lg px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-kumo-focus"
        />
        <p className="mt-1 text-xs text-kumo-subtle text-right">{text.length} 文字</p>
      </div>

      {/* Embedded video preview — the official X embed iframe is the only
          reliable player (direct twimg mp4 URLs 403). Lazy: load on click. */}
      {videoTweetId && (
        showVideo ? (
          <iframe
            src={`https://platform.twitter.com/embed/Tweet.html?id=${videoTweetId}&theme=light&hideCard=false&hideThread=true`}
            className="w-full h-96 rounded-lg border border-kumo-line"
            allow="autoplay; encrypted-media"
          />
        ) : (
          <button
            onClick={() => setShowVideo(true)}
            className="w-full py-2.5 rounded-lg border border-purple-200 bg-purple-50 text-sm font-medium text-purple-700 hover:bg-purple-100 transition-colors"
          >
            🎬 動画を再生して確認
          </button>
        )
      )}

      {/* Scheduled at */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-kumo-default shrink-0">予約日時 (JST)</label>
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="border border-kumo-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-kumo-focus"
        />
      </div>

      {/* Action row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleSave} disabled={!isDirty || saving}>{saving ? '保存中…' : '保存'}</Button>
          {saveMsg && <span className="text-xs text-kumo-success">{saveMsg}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleReject} disabled={rejecting || approving}>{rejecting ? '却下中…' : '却下'}</Button>
          <Button variant="primary" onClick={handleApprove} disabled={approving || rejecting}>{approving ? '承認中…' : '承認'}</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Processed Draft Row ───

export function ProcessedRow({ draft }: { draft: GrowthDraft }) {
  const isPosted = draft.postStatus === 'posted'
  return (
    <div className="flex items-start gap-3 py-3 border-b border-kumo-line last:border-0 opacity-60">
      <TypeBadge type={draft.type} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-kumo-subtle truncate">{draft.text}</p>
        <p className="text-xs text-kumo-subtle mt-0.5">
          {draft.status === 'rejected' ? '却下' : '予約済み'}
          {' · '}
          {new Date(draft.scheduled_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
        </p>
        {draft.postStatus === 'failed' && draft.postLastError && (
          <p className="text-xs text-red-600 mt-0.5 break-words" title={draft.postLastError}>
            失敗理由: {draft.postLastError.length > 160 ? `${draft.postLastError.slice(0, 160)}…` : draft.postLastError}
          </p>
        )}
      </div>
      <div className="shrink-0">
        {isPosted && draft.postedTweetId ? (
          <a
            href={`https://x.com/i/status/${draft.postedTweetId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-kumo-link hover:underline"
          >
            投稿済み →
          </a>
        ) : (
          <span className={`text-xs font-medium ${draft.status === 'rejected' || draft.postStatus === 'failed' ? 'text-red-400' : 'text-kumo-subtle'}`}>
            {draft.status === 'rejected'
              ? '却下'
              : draft.postStatus === 'failed'
                ? `失敗${draft.postLastErrorStatus ? ` (${draft.postLastErrorStatus})` : ''}`
                : ({ posted: '投稿済み', pending: '予約中', scheduled: '予約中', posting: '送信中', cancelled: '取り消し' } as Record<string, string>)[draft.postStatus ?? ''] ?? '予約中'}
          </span>
        )}
      </div>
    </div>
  )
}

// 枝葉タブ: ピラー記事(公開済み)ごとに、それを引用する動画付きドラフトを
// まとめて見る。生成は自動 — discovery(毎朝05:30)が海外動画を発見・文字起こし
// し、planner(07:30)の LLM がピラーとの紐付け・文面を判断してここに溜まる。
export function EdahaView({
  pillars,
  drafts,
  onApprove,
  onReject,
  onSaved,
}: {
  pillars: ArticleDraft[]
  drafts: GrowthDraft[]
  onApprove: (id: string) => Promise<void>
  onReject: (id: string) => Promise<void>
  onSaved: (id: string, text: string, scheduledAt: string) => Promise<void>
}) {
  const byPillar = new Map<string, GrowthDraft[]>()
  for (const d of drafts) {
    if (!d.quote_tweet_id) continue
    const list = byPillar.get(d.quote_tweet_id) ?? []
    list.push(d)
    byPillar.set(d.quote_tweet_id, list)
  }
  const knownPillarIds = new Set(pillars.map((p) => p.published_article_id).filter(Boolean) as string[])
  const orphanIds = [...byPillar.keys()].filter((id) => !knownPillarIds.has(id))

  if (drafts.length === 0) {
    return (
      <div className="bg-kumo-base rounded-xl border border-kumo-line py-14 px-6 text-center space-y-2">
        <p className="text-sm text-kumo-subtle font-medium">枝葉ドラフトはまだありません</p>
        <p className="text-xs text-kumo-subtle leading-relaxed">
          毎朝 05:30 に discovery が海外の動画バズを発見・文字起こしし、07:30 に planner の LLM が
          「どのピラー記事に紐付けるか・どんな文面にするか」を自動判断してここに溜まります。
          承認するとピラー記事の引用RT(動画URL付き)として予約されます。
        </p>
      </div>
    )
  }

  const renderDraft = (d: GrowthDraft) =>
    d.status === 'pending' ? (
      <DraftCard key={d.id} draft={d} onApprove={onApprove} onReject={onReject} onSaved={onSaved} />
    ) : (
      <div key={d.id} className="bg-kumo-base rounded-xl border border-kumo-line px-4 py-2.5 flex items-center gap-3">
        <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
          予約済み
        </span>
        {extractVideoTweetId(d.text) && (
          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 shrink-0">
            🎬
          </span>
        )}
        <p className="text-sm text-kumo-default truncate flex-1">{d.text}</p>
        {d.scheduled_at && (
          <span className="text-[11px] text-kumo-subtle shrink-0">
            {new Date(d.scheduled_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
          </span>
        )}
      </div>
    )

  return (
    <div className="space-y-6">
      {pillars.filter((p) => p.published_article_id).map((pillar) => {
        const list = byPillar.get(pillar.published_article_id as string) ?? []
        return (
          <div key={pillar.id} className="space-y-3">
            <div className="flex items-center gap-3">
              {pillar.image_url && (
                <img src={pillar.image_url} alt="" className="w-16 h-7 object-cover rounded border border-kumo-line shrink-0" />
              )}
              <a
                href={`https://x.com/i/status/${pillar.published_article_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-kumo-default hover:text-kumo-link truncate"
              >
                {pillar.title}
              </a>
              <span className="text-[11px] text-kumo-subtle shrink-0">
                枝葉 {list.length} 本(承認待ち {list.filter((d) => d.status === 'pending').length})
              </span>
            </div>
            {list.length === 0 ? (
              <p className="text-xs text-kumo-subtle pl-1">このピラーへの枝葉はまだありません</p>
            ) : (
              <div className="space-y-3">{list.map(renderDraft)}</div>
            )}
          </div>
        )
      })}
      {orphanIds.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-kumo-subtle">その他の引用先</p>
          {orphanIds.flatMap((id) => (byPillar.get(id) ?? []).map(renderDraft))}
        </div>
      )}
    </div>
  )
}
