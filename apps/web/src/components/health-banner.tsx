'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Banner } from '@cloudflare/kumo/components/banner'
import { WarningCircle, CheckCircle } from '@phosphor-icons/react'
import { api } from '@/lib/api'
import type { HealthDetails } from '@/lib/api'

/** Operational status from /api/health/details, in plain Japanese. */
export default function HealthBanner() {
  const [health, setHealth] = useState<HealthDetails | null>(null)
  const [failed, setFailed] = useState(false)
  const [unsupported, setUnsupported] = useState(false)

  useEffect(() => {
    api.healthDetails().then((r) => setHealth(r.data)).catch((err: unknown) => {
      // Workers without /api/health/details answer 404: show nothing rather
      // than a false outage.
      if (err instanceof Error && /^(Not Found|HTTP 404|404)/i.test(err.message)) setUnsupported(true)
      else setFailed(true)
    })
  }, [])

  if (unsupported) return null
  if (failed) {
    return (
      <Banner className="mb-6" variant="error" icon={<WarningCircle weight="fill" />} title="稼働状態を取得できません" description="Worker またはデータベースに接続できない可能性があります。予約投稿が止まっていないか確認してください。" />
    )
  }
  if (!health) return <div className="mb-6 h-14 animate-pulse rounded-xl bg-kumo-tint" />

  const sp = health.scheduledPosts
  const items: string[] = []
  if (health.scheduler?.scheduledPostsPaused) {
    items.push(`自動機能がOFFのため、予約投稿は送信されません${sp?.blockedByAutoFeaturesFlag ? `（送信待ち ${sp.blockedByAutoFeaturesFlag} 件）` : ''}。設定画面でONにすると再開します。`)
  }
  if ((sp?.last24h?.failed ?? 0) > 0) items.push(`直近24時間に失敗した予約が ${sp?.last24h.failed} 件あります。`)
  if ((sp?.overdue ?? 0) > 0 && !health.scheduler?.scheduledPostsPaused) items.push(`予定時刻を15分以上過ぎた予約が ${sp?.overdue} 件あります。`)
  if ((sp?.claimedButUnrecorded ?? 0) > 0) items.push(`送信を始めたが結果を記録できなかった予約が ${sp?.claimedButUnrecorded} 件あります（自動では再送しません）。`)
  if (health.problems.includes('cron_heartbeat_stale')) items.push('定期実行（cron）がしばらく動いていません。')
  if (health.problems.includes('last_cron_run_errored') && health.scheduler?.cron?.lastError && !health.scheduler.scheduledPostsPaused) {
    items.push(`前回の定期実行でエラー: ${health.scheduler.cron.lastError.slice(0, 120)}`)
  }

  const known = new Set(['auto_features_disabled_scheduled_posts_will_not_send', 'scheduled_posts_blocked_by_auto_features_flag', 'scheduled_posts_failed_last_24h', 'scheduled_posts_overdue', 'scheduled_posts_claimed_but_unrecorded', 'cron_heartbeat_stale', 'last_cron_run_errored'])
  if (health.problems.some((p) => p.includes('migration'))) items.push('データベースの更新（マイグレーション）が未適用です。二重送信防止などが働いていません。')
  if (health.problems.some((p) => p.startsWith('query_failed'))) items.push('一部の稼働状況を確認できませんでした（データベースのテーブルが不足している可能性があります）。')
  const other = health.problems.filter((p) => !known.has(p) && !p.includes('migration') && !p.startsWith('query_failed'))
  if (other.length > 0) items.push(`その他の検出: ${other.join(', ')}`)

  if (items.length === 0 && health.status === 'ok') {
    return (
      <Banner className="mb-6" variant="default" icon={<CheckCircle weight="fill" />} title="正常に動いています" description="予約投稿に問題は見つかりませんでした。" />
    )
  }
  return (
    <Banner
      className="mb-6"
      variant={health.scheduler?.scheduledPostsPaused || (sp?.last24h?.failed ?? 0) > 0 ? 'error' : 'alert'}
      icon={<WarningCircle weight="fill" />}
      title="確認が必要です"
      description={
        <span className="block space-y-1">
          {items.length === 0 && <span className="block">稼働状態: {health.status}</span>}
          {items.map((t) => <span key={t} className="block">{t}</span>)}
          <span className="mt-1 flex flex-wrap gap-4">
            <Link className="underline underline-offset-2" href="/posts?tab=queue">予約・失敗を見る</Link>
            {health.scheduler?.scheduledPostsPaused && <Link className="underline underline-offset-2" href="/settings">設定を開く</Link>}
          </span>
        </span>
      }
    />
  )
}
