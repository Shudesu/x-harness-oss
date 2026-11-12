'use client'

// ─── Types ───

export interface ArticleDraft {
  id: string
  x_account_id: string
  title: string
  body_md: string
  image_url: string | null
  theme: string | null
  source_tweet_ids: string | null
  status: string
  published_article_id: string | null
  x_article_draft_id: string | null
  created_at: string
  updated_at: string
}

export interface SourceCandidate {
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

export interface GrowthDraft {
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
  postLastError?: string | null
  postLastErrorStatus?: number | null
  archived_at?: string | null
  created_at: string
  updated_at: string
}

// ─── Helpers ───

/**
 * Convert ISO+09:00 string → datetime-local value (naive local, i.e. JST)
 * datetime-local format: "YYYY-MM-DDTHH:MM"
 */
export function isoToDatetimeLocal(iso: string): string {
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
export function datetimeLocalToIso(value: string): string {
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

export function TypeBadge({ type }: { type: GrowthDraft['type'] }) {
  const badge = TYPE_BADGE[type] ?? { label: type, className: 'bg-kumo-tint text-kumo-subtle' }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${badge.className}`}>
      {badge.label}
    </span>
  )
}

// ─── Pending Draft Card ───

// A /video/1 URL in the draft text is the embedded-video contract: X expands
// the referenced post's video inline when the tweet is published. Extract the
// post id so the card can badge it and render a playable preview.
export function extractVideoTweetId(text: string): string | null {
  const m = text.match(/https:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/(\d+)\/video\/1/)
  return m ? m[1] : null
}
