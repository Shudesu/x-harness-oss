'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'
import type { ApiResponse } from '@/lib/api'
import Header from '@/components/layout/header'

// ─── Types ───

interface ArticleDraft {
  id: string
  x_account_id: string
  title: string
  body_md: string
  image_url: string | null
  theme: string | null
  source_tweet_ids: string | null
  status: string
  published_article_id: string | null
  created_at: string
  updated_at: string
}

interface SourceCandidate {
  id: string
  source_tweet_id: string
  author: string
  author_url: string | null
  text_en: string
  text_ja: string | null
  summary_ja: string | null
  suggested_quote_text: string | null
  video_url: string | null
  views: number | null
  likes: number | null
  theme: string | null
  status: string
}

interface GrowthDraft {
  id: string
  x_account_id: string
  type: 'quote_rt' | 'progress' | 'opinion' | 'reply'
  text: string
  quote_tweet_id: string | null
  scheduled_at: string
  status: 'pending' | 'scheduled' | 'rejected'
  scheduled_post_id: string | null
  postStatus: string | null
  postedTweetId: string | null
  created_at: string
  updated_at: string
}

interface DigestPayload {
  date: string
  bench_new: number
  my_updated: number
  news_new: number
  est_cost_usd: number
  budget_stopped: boolean
  bench_top: Array<{ author: string; text: string; impressions: number }>
  commits: Record<string, string[]>
  weekly_report?: string
}

interface Digest {
  date: string
  payload: DigestPayload
}

// ─── Helpers ───

/**
 * Convert ISO+09:00 string → datetime-local value (naive local, i.e. JST)
 * datetime-local format: "YYYY-MM-DDTHH:MM"
 */
function isoToDatetimeLocal(iso: string): string {
  // Parse the timestamp; if it has +09:00 offset info just strip to get local
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  // Format as JST: add 9h offset from UTC
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const yyyy = jst.getUTCFullYear()
  const mm = pad(jst.getUTCMonth() + 1)
  const dd = pad(jst.getUTCDate())
  const hh = pad(jst.getUTCHours())
  const min = pad(jst.getUTCMinutes())
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`
}

/**
 * Convert datetime-local value (naive JST) → ISO+09:00 string
 */
function datetimeLocalToIso(value: string): string {
  if (!value) return ''
  // value = "YYYY-MM-DDTHH:MM"
  return `${value}:00+09:00`
}

const TYPE_BADGE: Record<GrowthDraft['type'], { label: string; className: string }> = {
  quote_rt:  { label: '引用RT',    className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  progress:  { label: '進捗',      className: 'bg-green-50 text-green-700 border border-green-200' },
  opinion:   { label: '意見',      className: 'bg-purple-50 text-purple-700 border border-purple-200' },
  reply:     { label: 'リプライ',  className: 'bg-orange-50 text-orange-700 border border-orange-200' },
}

function TypeBadge({ type }: { type: GrowthDraft['type'] }) {
  const badge = TYPE_BADGE[type] ?? { label: type, className: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${badge.className}`}>
      {badge.label}
    </span>
  )
}

// ─── Pending Draft Card ───

function DraftCard({
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
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <TypeBadge type={draft.type} />
          <span className="text-xs text-gray-400">{draft.x_account_id}</span>
          {draft.quote_tweet_id && (
            <a
              href={`https://x.com/i/status/${draft.quote_tweet_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline"
            >
              元ツイート →
            </a>
          )}
        </div>
        <span className="text-xs text-gray-400 shrink-0">
          {new Date(draft.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
        </span>
      </div>

      {/* Text editor */}
      <div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-400 text-right">{text.length} 文字</p>
      </div>

      {/* Scheduled at */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700 shrink-0">予約日時 (JST)</label>
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Action row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 transition-colors"
          >
            {saving ? '保存中…' : '保存'}
          </button>
          {saveMsg && <span className="text-xs text-green-600">{saveMsg}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReject}
            disabled={rejecting || approving}
            className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-40 transition-colors"
          >
            {rejecting ? '却下中…' : '却下'}
          </button>
          <button
            onClick={handleApprove}
            disabled={approving || rejecting}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40 transition-opacity"
            style={{ backgroundColor: '#1D9BF0' }}
          >
            {approving ? '承認中…' : '承認'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Processed Draft Row ───

function ProcessedRow({ draft }: { draft: GrowthDraft }) {
  const isPosted = draft.postStatus === 'posted'
  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0 opacity-60">
      <TypeBadge type={draft.type} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-600 truncate">{draft.text}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {draft.status === 'rejected' ? '却下' : '予約済み'}
          {' · '}
          {new Date(draft.scheduled_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
        </p>
      </div>
      <div className="shrink-0">
        {isPosted && draft.postedTweetId ? (
          <a
            href={`https://x.com/i/status/${draft.postedTweetId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-blue-500 hover:underline"
          >
            投稿済み →
          </a>
        ) : (
          <span className={`text-xs font-medium ${draft.status === 'rejected' ? 'text-red-400' : 'text-gray-400'}`}>
            {draft.status === 'rejected' ? '却下' : draft.postStatus ?? '待機中'}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Source Candidate Card ───

function SourceCard({
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
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 max-w-xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {candidate.author_url ? (
            <a
              href={candidate.author_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-gray-800 hover:underline"
            >
              @{candidate.author}
            </a>
          ) : (
            <span className="text-sm font-semibold text-gray-800">@{candidate.author}</span>
          )}
          {candidate.theme && (
            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              {candidate.theme}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-gray-400">
          {candidate.views != null && (
            <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">
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
        className="w-full rounded-lg border border-gray-100"
        style={{ height: 420 }}
        loading="lazy"
        title={`tweet-${candidate.source_tweet_id}`}
      />
      <a
        href={`https://x.com/i/status/${candidate.source_tweet_id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-xs font-medium text-blue-500 hover:underline"
      >
        ▶ X で元投稿を見る →
      </a>

      {/* Japanese content */}
      {candidate.text_ja && (
        <p className="text-sm text-gray-700 leading-relaxed">{candidate.text_ja}</p>
      )}
      {candidate.summary_ja && (
        <p className="text-xs text-gray-500 leading-relaxed border-l-2 border-gray-200 pl-3">{candidate.summary_ja}</p>
      )}

      {/* English original (collapsible) */}
      <details className="text-xs text-gray-400">
        <summary className="cursor-pointer select-none hover:text-gray-600">英語原文</summary>
        <p className="mt-2 leading-relaxed whitespace-pre-wrap pl-2">{candidate.text_en}</p>
      </details>

      {/* Quote text editor */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1">引用RT テキスト</label>
        <textarea
          value={quoteText}
          onChange={(e) => setQuoteText(e.target.value)}
          rows={4}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-400 text-right">{quoteText.length} 文字</p>
      </div>

      {/* Scheduled at */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700 shrink-0">予約日時 (JST)</label>
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={handleDismiss}
          disabled={dismissing || submitting}
          className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-40 transition-colors"
        >
          {dismissing ? '却下中…' : '却下'}
        </button>
        <button
          onClick={handleToDraft}
          disabled={submitting || dismissing || !quoteText.trim()}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40 transition-opacity"
          style={{ backgroundColor: '#1D9BF0' }}
        >
          {submitting ? '作成中…' : '引用RT下書きにする'}
        </button>
      </div>
    </div>
  )
}

// ─── Article Card ───

// Minimal, dependency-free markdown preview — renders inline images, headings, lists.
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? <strong key={i} className="font-bold text-gray-900">{p.slice(2, -2)}</strong> : p
      )}
    </>
  )
}

function MarkdownPreview({ md }: { md: string }) {
  const blocks = md.split(/\n{2,}/)
  return (
    <div className="space-y-3 text-sm text-gray-800 leading-relaxed">
      {blocks.map((b, i) => {
        const img = b.trim().match(/^!\[[^\]]*\]\(([^)]+)\)(?:\n\*(.+)\*)?$/)
        if (img)
          return (
            <figure key={i}>
              <img src={img[1]} alt="" className="w-full rounded-lg border border-gray-100" />
              {img[2] && <figcaption className="mt-1 text-xs text-gray-500 italic">{img[2]}</figcaption>}
            </figure>
          )
        if (b.startsWith('### ')) return <h4 key={i} className="text-sm font-bold text-gray-900">{b.slice(4)}</h4>
        if (b.startsWith('## ')) return <h3 key={i} className="text-base font-bold text-gray-900">{b.slice(3)}</h3>
        if (b.startsWith('# ')) return <h2 key={i} className="text-lg font-bold text-gray-900">{b.slice(2)}</h2>
        if (b.trimStart().startsWith('> '))
          return (
            <blockquote key={i} className="border-l-4 border-gray-200 pl-3 text-gray-600 whitespace-pre-wrap">
              <Inline text={b.replace(/^> ?/gm, '')} />
            </blockquote>
          )
        if (b.trimStart().startsWith('■')) return <p key={i} className="font-bold text-gray-900">{b.replace(/\*\*/g, '')}</p>
        return <p key={i} className="whitespace-pre-wrap"><Inline text={b} /></p>
      })}
    </div>
  )
}

function ArticleCard({
  article,
  onSaved,
  onDiscard,
  onPublish,
}: {
  article: ArticleDraft
  onSaved: (id: string, title: string, bodyMd: string) => Promise<void>
  onDiscard: (id: string) => Promise<void>
  onPublish: () => void
}) {
  const [title, setTitle] = useState(article.title)
  const [bodyMd, setBodyMd] = useState(article.body_md)
  const [saving, setSaving] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [expanded, setExpanded] = useState(false)

  const isDirty = title !== article.title || bodyMd !== article.body_md

  const sourceTweetCount = (() => {
    if (!article.source_tweet_ids) return null
    try {
      const parsed = JSON.parse(article.source_tweet_ids)
      return Array.isArray(parsed) ? parsed.length : null
    } catch {
      return null
    }
  })()

  const handleSave = async () => {
    setSaving(true)
    setSaveMsg('')
    try {
      await onSaved(article.id, title, bodyMd)
      setSaveMsg('保存しました')
      setTimeout(() => setSaveMsg(''), 2000)
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = async () => {
    setDiscarding(true)
    try { await onDiscard(article.id) } finally { setDiscarding(false) }
  }

  // Collapsed row — the drafts list gets long, so cards fold to one line
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full text-left bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-3 hover:bg-gray-50 transition-colors"
      >
        {article.image_url ? (
          <img src={article.image_url} alt="" className="w-20 h-8 object-cover rounded border border-gray-100 shrink-0" />
        ) : (
          <div className="w-20 h-8 rounded border border-dashed border-gray-200 bg-gray-50 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{title || article.title}</p>
          <p className="text-[11px] text-gray-400 truncate">
            {article.theme ? `${article.theme} ・ ` : ''}
            {new Date(article.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
          </p>
        </div>
        {isDirty && <span className="text-[11px] font-semibold text-amber-600 shrink-0">未保存</span>}
        <span className="text-gray-400 shrink-0">▸</span>
      </button>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      {/* Header image */}
      {article.image_url ? (
        <img
          src={article.image_url}
          alt="記事ヘッダー"
          className="w-full aspect-[5/2] object-contain bg-gray-50 rounded-lg border border-gray-100"
        />
      ) : (
        <div className="w-full h-24 rounded-lg border border-dashed border-gray-200 bg-gray-50 flex items-center justify-center">
          <span className="text-xs text-gray-400">画像なし</span>
        </div>
      )}

      {/* Header row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {article.theme && (
            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              {article.theme}
            </span>
          )}
          {sourceTweetCount != null && (
            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-100 text-gray-500">
              元ネタ {sourceTweetCount} 件
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-gray-400">
            {new Date(article.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
          </span>
          <button
            onClick={() => setExpanded(false)}
            className="text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
          >
            ▾ たたむ
          </button>
        </div>
      </div>

      {/* Title editor */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1">タイトル</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-medium leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Body editor */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 mb-1">本文 (Markdown)</label>
        <textarea
          value={bodyMd}
          onChange={(e) => setBodyMd(e.target.value)}
          rows={14}
          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm leading-relaxed font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-xs text-gray-400 text-right">{bodyMd.length} 文字</p>
      </div>

      {/* Body preview (renders inline images) */}
      <details className="border border-gray-100 rounded-lg p-3 bg-gray-50/50">
        <summary className="cursor-pointer select-none text-xs font-semibold text-gray-500 mb-2">プレビュー(画像込み)</summary>
        <div className="mt-2"><MarkdownPreview md={bodyMd} /></div>
      </details>

      {/* Action row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 transition-colors"
          >
            {saving ? '保存中…' : '保存'}
          </button>
          {saveMsg && <span className="text-xs text-green-600">{saveMsg}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDiscard}
            disabled={discarding}
            className="px-4 py-2 rounded-lg text-sm font-medium text-red-600 border border-red-200 hover:bg-red-50 disabled:opacity-40 transition-colors"
          >
            {discarding ? '破棄中…' : '破棄'}
          </button>
          <button
            onClick={onPublish}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity"
            style={{ backgroundColor: '#1D9BF0' }}
          >
            公開
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Digest Card ───

function DigestCard({ digest }: { digest: Digest }) {
  const p = digest.payload
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) // YYYY-MM-DD
  const digestDate = p.date
  const diffDays = Math.floor(
    (new Date(today).getTime() - new Date(digestDate).getTime()) / (1000 * 60 * 60 * 24)
  )

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900">ダイジェスト</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{digestDate}</span>
          {diffDays >= 2 && (
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200">
              {diffDays}日前のデータ
            </span>
          )}
          {diffDays === 1 && (
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-yellow-50 text-yellow-700 border border-yellow-200">
              昨日のデータ
            </span>
          )}
        </div>
      </div>

      {p.budget_stopped && (
        <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm font-semibold text-red-700">
          予算上限に達したため処理を停止しています
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-50 rounded-lg px-3 py-3 text-center">
          <p className="text-[11px] text-gray-400 mb-1">推定コスト</p>
          <p className="text-base font-bold text-gray-900">${p.est_cost_usd.toFixed(3)}</p>
        </div>
        <div className="bg-gray-50 rounded-lg px-3 py-3 text-center">
          <p className="text-[11px] text-gray-400 mb-1">新規ベンチ</p>
          <p className="text-base font-bold text-gray-900">{p.bench_new}</p>
        </div>
        <div className="bg-gray-50 rounded-lg px-3 py-3 text-center">
          <p className="text-[11px] text-gray-400 mb-1">新規ニュース</p>
          <p className="text-base font-bold text-gray-900">{p.news_new}</p>
        </div>
      </div>

      {/* Bench top */}
      {p.bench_top && p.bench_top.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2">バズツイート上位</p>
          <div className="space-y-2">
            {p.bench_top.slice(0, 3).map((b, i) => (
              <div key={i} className="border border-gray-100 rounded-lg px-3 py-2.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-gray-700">@{b.author}</span>
                  <span className="text-[11px] text-gray-400">{b.impressions.toLocaleString()} IMP</span>
                </div>
                <p className="text-xs text-gray-600 line-clamp-2">{b.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Commits */}
      {p.commits && Object.keys(p.commits).length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2">コミット</p>
          <div className="space-y-2">
            {Object.entries(p.commits).map(([repo, msgs]) => (
              <div key={repo}>
                <p className="text-[11px] font-semibold text-gray-400 mb-1">{repo}</p>
                <ul className="space-y-0.5">
                  {msgs.slice(0, 5).map((msg, i) => (
                    <li key={i} className="text-xs text-gray-600 pl-2 border-l-2 border-gray-200">{msg}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weekly report */}
      {p.weekly_report && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2">週次レポート</p>
          <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">{p.weekly_report}</p>
        </div>
      )}
    </div>
  )
}

// ─── Page ───

type Tab = 'pending' | 'discovery' | 'processed' | 'articles'

// Derive xAccountId from pending drafts (first one wins) or fall back to env.
function deriveXAccountId(pending: GrowthDraft[]): string {
  return pending[0]?.x_account_id ?? process.env.NEXT_PUBLIC_X_ACCOUNT_ID ?? ''
}

export default function GrowthPage() {
  const [tab, setTab] = useState<Tab>('pending')
  const [pending, setPending] = useState<GrowthDraft[]>([])
  const [processed, setProcessed] = useState<GrowthDraft[]>([])
  const [sources, setSources] = useState<SourceCandidate[]>([])
  const [articles, setArticles] = useState<ArticleDraft[]>([])
  const [digest, setDigest] = useState<Digest | null>(null)
  const [loading, setLoading] = useState(true)
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [articlesLoading, setArticlesLoading] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  const loadDrafts = useCallback(async () => {
    setError('')
    try {
      const [pendingRes, scheduledRes, rejectedRes] = await Promise.all([
        fetchApi<ApiResponse<GrowthDraft[]>>('/api/growth/drafts?status=pending'),
        fetchApi<ApiResponse<GrowthDraft[]>>('/api/growth/drafts?status=scheduled'),
        fetchApi<ApiResponse<GrowthDraft[]>>('/api/growth/drafts?status=rejected'),
      ])
      setPending(pendingRes.data ?? [])
      const done = [...(scheduledRes.data ?? []), ...(rejectedRes.data ?? [])]
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
        .slice(0, 10)
      setProcessed(done)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'データの取得に失敗しました')
    }
  }, [])

  const loadSources = useCallback(async () => {
    setSourcesLoading(true)
    try {
      const res = await fetchApi<ApiResponse<SourceCandidate[]>>('/api/growth/sources?status=new')
      setSources(res.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '海外ネタの取得に失敗しました')
    } finally {
      setSourcesLoading(false)
    }
  }, [])

  const loadArticles = useCallback(async () => {
    setArticlesLoading(true)
    try {
      const res = await fetchApi<ApiResponse<ArticleDraft[]>>('/api/growth/articles?status=draft')
      setArticles(res.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '記事の取得に失敗しました')
    } finally {
      setArticlesLoading(false)
    }
  }, [])

  const loadDigest = useCallback(async () => {
    try {
      const res = await fetchApi<ApiResponse<Digest | null>>('/api/growth/digest/latest')
      setDigest(res.data ?? null)
    } catch {
      // digest is non-critical — ignore errors
    }
  }, [])

  useEffect(() => {
    Promise.all([loadDrafts(), loadDigest()]).finally(() => setLoading(false))
  }, [loadDrafts, loadDigest])

  // Lazy-load sources when switching to discovery tab
  useEffect(() => {
    if (tab === 'discovery' && sources.length === 0 && !sourcesLoading) {
      loadSources()
    }
  }, [tab, sources.length, sourcesLoading, loadSources])

  // Lazy-load articles when switching to articles tab
  useEffect(() => {
    if (tab === 'articles' && articles.length === 0 && !articlesLoading) {
      loadArticles()
    }
  }, [tab, articles.length, articlesLoading, loadArticles])

  const handleSave = async (id: string, text: string, scheduledAt: string) => {
    await fetchApi<ApiResponse<GrowthDraft>>(`/api/growth/drafts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ text, scheduledAt }),
    })
    setPending((prev) => prev.map((d) => (d.id === id ? { ...d, text, scheduled_at: scheduledAt } : d)))
  }

  const handleApprove = async (id: string) => {
    await fetchApi<ApiResponse<GrowthDraft>>(`/api/growth/drafts/${id}/approve`, { method: 'POST' })
    showToast('承認しました')
    await loadDrafts()
  }

  const handleReject = async (id: string) => {
    await fetchApi<ApiResponse<GrowthDraft>>(`/api/growth/drafts/${id}/reject`, { method: 'POST' })
    showToast('却下しました')
    await loadDrafts()
  }

  const handleToDraft = async (id: string, text: string, scheduledAt: string) => {
    const xAccountId = deriveXAccountId(pending)
    if (!xAccountId) {
      showToast('Xアカウントが特定できません（NEXT_PUBLIC_X_ACCOUNT_ID 未設定・承認待ちも空）')
      return
    }
    await fetchApi<ApiResponse<unknown>>(`/api/growth/sources/${id}/to-draft`, {
      method: 'POST',
      body: JSON.stringify({ xAccountId, text, scheduledAt }),
    })
    setSources((prev) => prev.filter((s) => s.id !== id))
    showToast('下書きを作成しました')
    // Refresh pending drafts so the new draft shows up
    await loadDrafts()
    setTab('pending')
  }

  const handleDismiss = async (id: string) => {
    await fetchApi<ApiResponse<unknown>>(`/api/growth/sources/${id}/dismiss`, { method: 'POST' })
    setSources((prev) => prev.filter((s) => s.id !== id))
    showToast('却下しました')
  }

  const handleArticleSave = async (id: string, title: string, bodyMd: string) => {
    const res = await fetchApi<ApiResponse<ArticleDraft>>(`/api/growth/articles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title, bodyMd }),
    })
    if (res.data) setArticles((prev) => prev.map((a) => (a.id === id ? { ...a, ...res.data } : a)))
    showToast('記事を保存しました')
  }

  const handleArticleDiscard = async (id: string) => {
    await fetchApi<ApiResponse<unknown>>(`/api/growth/articles/${id}/discard`, { method: 'POST' })
    setArticles((prev) => prev.filter((a) => a.id !== id))
    showToast('破棄しました')
  }

  const handleArticlePublish = () => {
    showToast('X Articles 公開は手動(Premium+必要)')
  }

  // Health line
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
  const digestDate = digest?.payload?.date ?? null
  const digestAge = digestDate
    ? Math.floor((new Date(today).getTime() - new Date(digestDate).getTime()) / (1000 * 60 * 60 * 24))
    : null

  const xAccountId = deriveXAccountId(pending)

  const TAB_ITEMS: { id: Tab; label: string; count?: number }[] = [
    { id: 'pending', label: '承認待ち', count: pending.length },
    { id: 'discovery', label: '海外ネタ', count: sources.length || undefined },
    { id: 'processed', label: '処理済み' },
    { id: 'articles', label: '記事', count: articles.length || undefined },
  ]

  return (
    <div>
      <Header
        title="Growth 承認"
        description="X Growth パイプラインの投稿承認・ダイジェスト確認"
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl bg-gray-900 text-white text-sm font-medium shadow-lg transition-opacity">
          {toast}
        </div>
      )}

      {/* Health line */}
      <div className={`mb-5 px-4 py-2.5 rounded-lg text-sm font-medium flex items-center justify-between ${
        digestAge === null
          ? 'bg-gray-50 border border-gray-200 text-gray-500'
          : digestAge >= 2
          ? 'bg-red-50 border border-red-200 text-red-700'
          : digestAge === 1
          ? 'bg-yellow-50 border border-yellow-200 text-yellow-700'
          : 'bg-green-50 border border-green-200 text-green-700'
      }`}>
        <span>
          {digestAge === null
            ? 'ダイジェスト未取得'
            : digestAge === 0
            ? 'ダイジェスト: 今日のデータ'
            : digestAge === 1
            ? 'ダイジェスト: 昨日のデータ（更新されていません）'
            : `ダイジェスト: ${digestAge}日前のデータ（更新されていません）`}
        </span>
        <span>承認待ち {pending.length} 件</span>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: Tab panel */}
        <div className="xl:col-span-2 space-y-4">
          {/* Tab bar */}
          <div className="flex gap-1 border-b border-gray-200 mb-4">
            {TAB_ITEMS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-blue-500 text-blue-600 bg-blue-50/50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                {t.label}
                {t.count != null && t.count > 0 && (
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold ${
                    tab === t.id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Tab: 承認待ち ── */}
          {tab === 'pending' && (
            loading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-48 bg-white rounded-xl border border-gray-200 animate-pulse" />
                ))}
              </div>
            ) : pending.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
                <p className="text-sm text-gray-400">承認待ちなし</p>
              </div>
            ) : (
              <div className="space-y-4">
                {pending.map((draft) => (
                  <DraftCard
                    key={draft.id}
                    draft={draft}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onSaved={handleSave}
                  />
                ))}
              </div>
            )
          )}

          {/* ── Tab: 海外ネタ ── */}
          {tab === 'discovery' && (
            sourcesLoading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-64 bg-white rounded-xl border border-gray-200 animate-pulse" />
                ))}
              </div>
            ) : sources.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
                <p className="text-sm text-gray-400">海外ネタなし</p>
              </div>
            ) : (
              <div className="space-y-4">
                {sources.map((candidate) => (
                  <SourceCard
                    key={candidate.id}
                    candidate={candidate}
                    xAccountId={xAccountId}
                    onToDraft={handleToDraft}
                    onDismiss={handleDismiss}
                  />
                ))}
              </div>
            )
          )}

          {/* ── Tab: 処理済み ── */}
          {tab === 'processed' && (
            processed.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
                <p className="text-sm text-gray-400">処理済みなし</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 px-5 py-1">
                {processed.map((draft) => (
                  <ProcessedRow key={draft.id} draft={draft} />
                ))}
              </div>
            )
          )}

          {/* ── Tab: 記事 ── */}
          {tab === 'articles' && (
            articlesLoading ? (
              <div className="space-y-4">
                {[...Array(2)].map((_, i) => (
                  <div key={i} className="h-96 bg-white rounded-xl border border-gray-200 animate-pulse" />
                ))}
              </div>
            ) : articles.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 py-16 text-center">
                <p className="text-sm text-gray-400">記事ドラフトなし</p>
              </div>
            ) : (
              <div className="space-y-4">
                {articles.map((article) => (
                  <ArticleCard
                    key={article.id}
                    article={article}
                    onSaved={handleArticleSave}
                    onDiscard={handleArticleDiscard}
                    onPublish={handleArticlePublish}
                  />
                ))}
              </div>
            )
          )}
        </div>

        {/* Right: Digest */}
        <div>
          {digest ? (
            <DigestCard digest={digest} />
          ) : !loading ? (
            <div className="bg-white rounded-xl border border-gray-200 py-12 text-center">
              <p className="text-sm text-gray-400">ダイジェストなし</p>
            </div>
          ) : (
            <div className="h-64 bg-white rounded-xl border border-gray-200 animate-pulse" />
          )}
        </div>
      </div>
    </div>
  )
}
