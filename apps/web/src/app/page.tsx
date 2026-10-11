'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import type { AccountStats, FollowerSnapshot } from '@/lib/api'
import Header from '@/components/layout/header'
import { useCurrentAccountId } from '@/hooks/use-selected-account'
import { HarnessStatCard } from '@/components/ui/harness-ui'

interface DashboardStats {
  activeGateCount: number | null
  followerCount: number | null
  tagCount: number | null
  scheduledPostCount: number | null
  staffCount: number | null
  monthlyRequests: number | null
  monthlyCost: number | null
  accountStats: AccountStats | null
}

function MiniBarChart({ data }: { data: FollowerSnapshot[] }) {
  if (data.length === 0) return null
  const values = data.map((d) => d.followersCount)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return (
    <div className="flex items-end gap-[2px] h-10 mt-2">
      {data.map((d, i) => {
        const pct = ((d.followersCount - min) / range) * 100
        const height = Math.max(pct, 4)
        return (
          <div
            key={i}
            className="flex-1 rounded-t min-w-[1px] max-w-[4px] transition-opacity hover:opacity-100"
            style={{ height: `${height}%`, backgroundColor: '#c7d2fe', opacity: 0.6 }}
            title={`${d.recordedAt}: ${d.followersCount.toLocaleString('ja-JP')}`}
          />
        )
      })}
    </div>
  )
}

function GrowthBadge({ value, label }: { value: number | null; label: string }) {
  if (value === null || value === undefined) return null
  const color = value >= 0 ? 'text-green-600' : 'text-red-600'
  const prefix = value >= 0 ? '+' : ''
  return (
    <span>
      <span className="text-gray-400">{label}</span>{' '}
      <span className={`font-semibold ${color}`}>{prefix}{value.toLocaleString('ja-JP')}</span>
    </span>
  )
}

export default function DashboardPage() {
  const selectedAccountId = useCurrentAccountId()
  const [stats, setStats] = useState<DashboardStats>({
    activeGateCount: null,
    followerCount: null,
    tagCount: null,
    scheduledPostCount: null,
    staffCount: null,
    monthlyRequests: null,
    monthlyCost: null,
    accountStats: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const now = new Date()
        const monthStartDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]

        const [gatesRes, followersRes, tagsRes, postsRes, staffRes, usageRes, accountsRes] = await Promise.allSettled([
          api.engagementGates.list(selectedAccountId ? { xAccountId: selectedAccountId } : undefined),
          api.followers.list({ limit: 1, xAccountId: selectedAccountId || undefined }),
          api.tags.list(),
          api.posts.listScheduled(),
          api.staff.list(),
          api.usage.summary({ startDate: monthStartDate, xAccountId: selectedAccountId || undefined }),
          api.accounts.list(),
        ])

        // Load account stats for the selected account (or first active)
        let accountStats: AccountStats | null = null
        const targetAccountId = selectedAccountId ||
          (accountsRes.status === 'fulfilled' && accountsRes.value.success && accountsRes.value.data[0]?.id) || null
        if (targetAccountId) {
          try {
            const statsRes = await api.accounts.stats(targetAccountId)
            if (statsRes.success) accountStats = statsRes.data
          } catch { /* non-blocking */ }
        }

        setStats({
          activeGateCount:
            gatesRes.status === 'fulfilled' && gatesRes.value.success
              ? gatesRes.value.data.filter((g) => g.isActive).length
              : null,
          followerCount:
            followersRes.status === 'fulfilled' && followersRes.value.success
              ? followersRes.value.data.total
              : null,
          tagCount:
            tagsRes.status === 'fulfilled' && tagsRes.value.success
              ? tagsRes.value.data.length
              : null,
          scheduledPostCount:
            postsRes.status === 'fulfilled' && postsRes.value.success
              ? postsRes.value.data.filter((p) => p.status === 'scheduled').length
              : null,
          staffCount:
            staffRes.status === 'fulfilled' && staffRes.value.success
              ? staffRes.value.data.length
              : null,
          monthlyRequests:
            usageRes.status === 'fulfilled' && usageRes.value.success
              ? usageRes.value.data.totalRequests
              : null,
          monthlyCost:
            usageRes.status === 'fulfilled' && usageRes.value.success
              ? usageRes.value.data.totalCost
              : null,
          accountStats,
        })
      } catch {
        setError('データの読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [selectedAccountId])

  return (
    <div>
      <Header title="ダッシュボード" description="X Harness の概要" product="X" />

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Stat cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <HarnessStatCard
          title="エンゲージメントゲート"
          value={stats.activeGateCount}
          loading={loading}
          href="/engagement-gates"
          accentColor="#1D9BF0"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
        <HarnessStatCard
          title="フォロワー"
          value={stats.followerCount}
          loading={loading}
          href="/followers"
          accentColor="#6366F1"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        />
        <HarnessStatCard
          title="タグ"
          value={stats.tagCount}
          loading={loading}
          href="/tags"
          accentColor="#8B5CF6"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          }
        />
        <HarnessStatCard
          title="予約投稿"
          value={stats.scheduledPostCount}
          loading={loading}
          href="/posts"
          accentColor="#F59E0B"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <HarnessStatCard
          title="スタッフ"
          value={stats.staffCount}
          loading={loading}
          href="/staff"
          accentColor="#10B981"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          }
        />
        <HarnessStatCard
          title="今月のAPIリクエスト"
          value={stats.monthlyRequests}
          loading={loading}
          href="/usage"
          accentColor="#6366F1"
          subtitle={stats.monthlyCost !== null ? `推定コスト: $${stats.monthlyCost.toFixed(4)}` : undefined}
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          }
        />
      </div>

      {/* Follower stats - compact */}
      {stats.accountStats?.current && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-5 py-3 mb-6 flex items-center gap-6">
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold text-gray-900">{stats.accountStats.current.followersCount.toLocaleString('ja-JP')}</span>
            <span className="text-xs text-gray-400">フォロワー</span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <GrowthBadge value={stats.accountStats.growth.days7} label="7d" />
            <GrowthBadge value={stats.accountStats.growth.days30} label="30d" />
          </div>
          <div className="flex-1 max-w-[200px] ml-auto">
            <MiniBarChart data={stats.accountStats.history} />
          </div>
        </div>
      )}

      {/* Quick action links */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">クイックアクション</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href="/posts"
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-amber-300 hover:bg-amber-50 transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 bg-amber-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 group-hover:text-amber-700 transition-colors">新規投稿</p>
              <p className="text-xs text-gray-400">投稿を作成・スケジュール</p>
            </div>
          </Link>

          <Link
            href="/replies"
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-sky-300 hover:bg-sky-50 transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 bg-sky-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 group-hover:text-sky-700 transition-colors">リプライ確認</p>
              <p className="text-xs text-gray-400">リプライを管理・返信</p>
            </div>
          </Link>

          <Link
            href="/campaign"
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={{ backgroundColor: '#1D9BF0' }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 group-hover:text-blue-700 transition-colors">キャンペーン作成</p>
              <p className="text-xs text-gray-400">投稿→ゲート→LINE連携を一括設定</p>
            </div>
          </Link>

          <Link
            href="/engagement-gates"
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 bg-blue-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 group-hover:text-blue-700 transition-colors">エンゲージメントゲート</p>
              <p className="text-xs text-gray-400">エンゲージメント条件 → LINE連携・verify API</p>
            </div>
          </Link>

          <Link
            href="/followers"
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 bg-indigo-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 group-hover:text-indigo-700 transition-colors">フォロワー</p>
              <p className="text-xs text-gray-400">フォロワーの管理・タグ付け</p>
            </div>
          </Link>

          <Link
            href="/tags"
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 bg-purple-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 group-hover:text-purple-700 transition-colors">タグ</p>
              <p className="text-xs text-gray-400">タグでフォロワーをセグメント</p>
            </div>
          </Link>

          <Link
            href="/messages"
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-teal-300 hover:bg-teal-50 transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 bg-teal-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 group-hover:text-teal-700 transition-colors">DM</p>
              <p className="text-xs text-gray-400">ダイレクトメッセージを管理</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
