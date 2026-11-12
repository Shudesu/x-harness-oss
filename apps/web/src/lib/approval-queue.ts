// 承認キューの並べ方。投稿案を「今日の案」「明日以降」「期限切れ」に分ける。
// 日付の境目は日本時間（JST）。期限切れ = 予定日が昨日以前の案で、
// まとめてアーカイブの対象（Worker の archive-expired と同じ境目）。

const JST_OFFSET_MS = 9 * 3600_000

// Zone-less legacy timestamps ("YYYY-MM-DD HH:MM:SS") are JST, as on the worker.
export function parseJstMs(value: string): number {
  const t = value.replace(' ', 'T')
  return Date.parse(/Z$|[+-]\d{2}:\d{2}$/.test(t) ? t : `${t}+09:00`)
}
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** YYYY-MM-DD in JST, or null for an unparsable timestamp. */
export function jstDate(value: string | Date): string | null {
  const t = typeof value === 'string' ? parseJstMs(value) : value.getTime()
  if (Number.isNaN(t)) return null
  return new Date(t + JST_OFFSET_MS).toISOString().slice(0, 10)
}

/** Start of the JST day of `now`, as ISO with +09:00 (the archive cutoff). */
export function jstDayStartIso(now: Date): string {
  return `${jstDate(now)}T00:00:00+09:00`
}

export interface QueueBuckets<T> {
  /** 予定日が今日（時刻を過ぎたものも含む）。早い順。 */
  today: T[]
  /** 予定日が明日以降。早い順。 */
  later: T[]
  /** 予定日が昨日以前。新しい順。 */
  expired: T[]
}

export function bucketDrafts<T extends { scheduled_at: string }>(drafts: T[], now: Date): QueueBuckets<T> {
  const today = jstDate(now)!
  const out: QueueBuckets<T> = { today: [], later: [], expired: [] }
  for (const d of drafts) {
    const day = jstDate(d.scheduled_at)
    // An unparsable time cannot be judged expired; keep it visible today.
    if (day === null || day === today) out.today.push(d)
    else if (day > today) out.later.push(d)
    else out.expired.push(d)
  }
  const at = (d: T) => parseJstMs(d.scheduled_at) || 0
  out.today.sort((a, b) => at(a) - at(b))
  out.later.sort((a, b) => at(a) - at(b))
  out.expired.sort((a, b) => at(b) - at(a))
  return out
}

/** 「今日 18:00」「明日 08:00」「11/10(火) 21:00」 */
export function scheduleLabel(iso: string, now: Date): string {
  const t = parseJstMs(iso)
  if (Number.isNaN(t)) return '時刻未設定'
  const jst = new Date(t + JST_OFFSET_MS)
  const hm = `${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`
  const day = jstDate(iso)!
  const today = jstDate(now)!
  const tomorrow = jstDate(new Date(now.getTime() + 24 * 3600_000))!
  if (day === today) return `今日 ${hm}`
  if (day === tomorrow) return `明日 ${hm}`
  const md = `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}(${WEEKDAYS[jst.getUTCDay()]})`
  return jst.getUTCFullYear() === new Date(now.getTime() + JST_OFFSET_MS).getUTCFullYear() ? `${md} ${hm}` : `${jst.getUTCFullYear()}/${md} ${hm}`
}

/** 予定時刻をもう過ぎているか。 */
export function isPastDue(iso: string, now: Date): boolean {
  const t = parseJstMs(iso)
  return !Number.isNaN(t) && t <= now.getTime()
}
