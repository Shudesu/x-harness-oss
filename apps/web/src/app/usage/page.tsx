'use client'
import SpendPanel from '@/components/spend-panel'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type { UsageSummary, DailyUsage, GateUsage } from '@/lib/api'
import Header from '@/components/layout/header'
import { useCurrentAccountId } from '@/hooks/use-selected-account'

type Period = '7' | '30' | 'all'

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`
}

function getDateRange(period: Period): { startDate?: string; endDate?: string; days?: number } {
  if (period === 'all') return { days: 9999 }
  const days = parseInt(period)
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
    days,
  }
}

function BarChart({ data }: { data: DailyUsage[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-gray-400 py-8 text-center">データなし</p>
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1)

  return (
    <div className="overflow-x-auto">
      <div className="flex items-end gap-1 min-w-0" style={{ minHeight: '140px' }}>
        {data.map((d) => {
          const heightPct = (d.count / maxCount) * 100
          const label = d.date.slice(5) // MM-DD
          return (
            <div
              key={d.date}
              className="flex flex-col items-center gap-1 flex-1 min-w-[28px]"
            >
              <span className="text-[10px] text-gray-500 font-medium">{d.count}</span>
              <div className="w-full flex justify-center">
                <div
                  className="w-full max-w-[40px] bg-blue-500 rounded-t transition-all"
                  style={{ height: `${Math.max(heightPct * 1.0, 2)}px`, minHeight: d.count > 0 ? '4px' : '0' }}
                />
              </div>
              <span className="text-[10px] text-gray-400 leading-none">{label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function UsagePage() {
  const selectedAccountId = useCurrentAccountId()
  const [period, setPeriod] = useState<Period>('7')
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [daily, setDaily] = useState<DailyUsage[]>([])
  const [byGate, setByGate] = useState<GateUsage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { startDate, endDate, days } = getDateRange(period)
      const xAccountId = selectedAccountId || undefined
      const [sumRes, dailyRes, gateRes] = await Promise.allSettled([
        api.usage.summary({ startDate, endDate, xAccountId }),
        api.usage.daily({ days, xAccountId }),
        api.usage.byGate(),
      ])

      if (sumRes.status === 'fulfilled' && sumRes.value.success) {
        setSummary(sumRes.value.data)
      } else {
        setSummary(null)
      }

      if (dailyRes.status === 'fulfilled' && dailyRes.value.success) {
        setDaily(dailyRes.value.data)
      } else {
        setDaily([])
      }

      if (gateRes.status === 'fulfilled' && gateRes.value.success) {
        setByGate(gateRes.value.data)
      } else {
        setByGate([])
      }
    } catch {
      setError('データの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [period, selectedAccountId])

  useEffect(() => {
    load()
  }, [load])

  const todayCount = daily.length > 0 ? daily[daily.length - 1]?.count ?? 0 : 0

  return (
    <div>
      <SpendPanel />
      <Header title="API使用量" description="リクエスト数・コスト・ゲート別統計" />

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Top: 3 stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {/* 総リクエスト数 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">総リクエスト数</p>
              {loading ? (
                <div className="h-8 w-24 bg-gray-100 rounded animate-pulse" />
              ) : (
                <p className="text-3xl font-bold text-gray-900">
                  {summary ? summary.totalRequests.toLocaleString('ja-JP') : '-'}
                </p>
              )}
            </div>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0 bg-blue-500">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">期間内の合計</p>
        </div>

        {/* 推定コスト */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">推定コスト</p>
              {loading ? (
                <div className="h-8 w-24 bg-gray-100 rounded animate-pulse" />
              ) : (
                <p className="text-3xl font-bold text-gray-900">
                  {summary ? formatCost(summary.totalCost) : '-'}
                </p>
              )}
            </div>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0 bg-emerald-500">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">期間内の推定費用</p>
        </div>

        {/* 本日のリクエスト */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">本日のリクエスト</p>
              {loading ? (
                <div className="h-8 w-24 bg-gray-100 rounded animate-pulse" />
              ) : (
                <p className="text-3xl font-bold text-gray-900">
                  {todayCount.toLocaleString('ja-JP')}
                </p>
              )}
            </div>
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0 bg-amber-500">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">今日の実績</p>
        </div>
      </div>

      {/* Middle: Bar chart with period tabs */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">日別リクエスト数</h2>
          <div className="flex gap-1">
            {(['7', '30', 'all'] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  period === p
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {p === '7' ? '7日' : p === '30' ? '30日' : '全期間'}
              </button>
            ))}
          </div>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="h-36 bg-gray-50 rounded animate-pulse" />
          ) : (
            <BarChart data={daily} />
          )}
        </div>
      </div>

      {/* Bottom: 2 tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* エンドポイント別 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">エンドポイント別</h2>
          </div>
          {loading ? (
            <div className="p-5 space-y-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : !summary || summary.byEndpoint.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-gray-400">データなし</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">エンドポイント</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">件数</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {summary.byEndpoint.map((row) => (
                    <tr key={row.endpoint} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-sm text-gray-700 font-mono">{row.endpoint}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">
                        {row.count.toLocaleString('ja-JP')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ゲート別 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">ゲート別</h2>
          </div>
          {loading ? (
            <div className="p-5 space-y-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : byGate.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-gray-400">データなし</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">投稿ID</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">トリガー</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">件数</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">コスト</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {byGate.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-sm text-gray-700 font-mono">
                        {row.postId.length > 12 ? `${row.postId.slice(0, 12)}…` : row.postId}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{row.triggerType}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">
                        {row.apiCallsTotal.toLocaleString('ja-JP')}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 text-right">
                        {row.estimatedCostAvailable === false ? '台帳を参照' : formatCost(row.estimatedCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
