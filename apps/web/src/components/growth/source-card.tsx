'use client'

import { useState } from 'react'
import { Button } from '@cloudflare/kumo/components/button'
import { datetimeLocalToIso, type SourceCandidate } from './shared'

// ─── Source Candidate Card ───

export function SourceCard({
  candidate,
  xAccountId,
  onToDraft,
  onDismiss,
}: {
  candidate: SourceCandidate
  xAccountId: string
  onToDraft: (id: string, text: string, scheduledAt: string) => Promise<void>
  onDismiss: (id: string) => Promise<void>
}) {
  const defaultSchedule = (() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`
  })()

  const [quoteText, setQuoteText] = useState(candidate.suggested_quote_text ?? '')
  const [scheduledAt, setScheduledAt] = useState(defaultSchedule)
  const [submitting, setSubmitting] = useState(false)
  const [dismissing, setDismissing] = useState(false)

  const handleToDraft = async () => {
    setSubmitting(true)
    try {
      await onToDraft(candidate.id, quoteText, datetimeLocalToIso(scheduledAt))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDismiss = async () => {
    setDismissing(true)
    try {
      await onDismiss(candidate.id)
    } finally {
      setDismissing(false)
    }
  }

  return (
    <div className="bg-kumo-base rounded-xl border border-kumo-line p-4 space-y-3 max-w-2xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {candidate.author_url ? (
            <a
              href={candidate.author_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-kumo-default hover:underline"
            >
              @{candidate.author}
            </a>
          ) : (
            <span className="text-sm font-semibold text-kumo-default">@{candidate.author}</span>
          )}
          {candidate.theme && (
            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              {candidate.theme}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-kumo-subtle">
          {candidate.views != null && (
            <span className="px-2 py-0.5 rounded bg-kumo-tint text-kumo-subtle font-medium">
              👁 {candidate.views.toLocaleString()}
            </span>
          )}
          {candidate.likes != null && (
            <span className="px-2 py-0.5 rounded bg-pink-50 text-pink-600 font-medium border border-pink-200">
              ♥ {candidate.likes.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* X-hosted embed — twimg direct mp4 is hotlink-protected (403). The official
          embed iframe renders the tweet with a working video player. */}
      <iframe
        src={`https://platform.twitter.com/embed/Tweet.html?id=${candidate.source_tweet_id}&theme=light&hideCard=false&hideThread=true`}
        className="w-full rounded-lg border border-kumo-line"
        style={{ height: 420 }}
        loading="lazy"
        title={`tweet-${candidate.source_tweet_id}`}
      />
      <a
        href={`https://x.com/i/status/${candidate.source_tweet_id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs font-medium text-kumo-link hover:underline"
      >
        ▶ Xで元のポストを見る ↗
      </a>

      {/* Japanese content */}
      {candidate.text_ja && (
        <p className="text-sm text-kumo-default leading-relaxed">{candidate.text_ja}</p>
      )}
      {candidate.summary_ja && (
        <p className="text-xs text-kumo-subtle leading-relaxed border-l-2 border-kumo-line pl-3">{candidate.summary_ja}</p>
      )}

      {/* English original (collapsible) */}
      <details className="text-xs text-kumo-subtle">
        <summary className="cursor-pointer select-none hover:text-kumo-subtle">英語原文</summary>
        <p className="mt-2 leading-relaxed whitespace-pre-wrap pl-2">{candidate.text_en}</p>
      </details>

      {/* Quote text editor */}
      <div>
        <label className="block text-xs font-semibold text-kumo-subtle mb-1">引用ポストの文面</label>
        <textarea
          value={quoteText}
          onChange={(e) => setQuoteText(e.target.value)}
          rows={4}
          className="w-full border border-kumo-line rounded-lg px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-kumo-focus"
        />
        <p className="mt-1 text-xs text-kumo-subtle text-right">{quoteText.length} 文字</p>
      </div>

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

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={handleDismiss} disabled={dismissing || submitting}>{dismissing ? '却下中…' : '却下'}</Button>
        <Button variant="primary" onClick={handleToDraft} disabled={submitting || dismissing || !quoteText.trim()}>{submitting ? '作成中…' : '承認待ちポストに追加'}</Button>
      </div>
    </div>
  )
}
