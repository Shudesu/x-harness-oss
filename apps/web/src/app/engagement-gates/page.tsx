'use client'

import { useState, useEffect, useCallback } from 'react'
import { api, type EngagementGate, type Delivery } from '@/lib/api'
import Header from '@/components/layout/header'
import { useCurrentAccountId } from '@/hooks/use-selected-account'

const TRIGGER_LABELS: Record<string, string> = {
  like: 'いいね',
  repost: 'リポスト',
  reply: 'リプライ',
  follow: 'フォロー',
  quote: '引用RT',
}

const ACTION_LABELS: Record<string, string> = {
  dm: 'DM送信',
  mention_post: 'メンション投稿',
  verify_only: '認証のみ',
}

const POLLING_LABELS: Record<string, string> = {
  hot_window: 'ホットウィンドウ',
  constant: '常時',
  manual: '手動',
}

const STATUS_BADGE: Record<string, string> = {
  delivered: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  failed: 'bg-red-100 text-red-700',
}

interface InlineCreateFormProps {
  onCreated: () => void
  xAccountId: string
}

function InlineCreateForm({ onCreated, xAccountId }: InlineCreateFormProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [postId, setPostId] = useState('')
  const [triggerType, setTriggerType] = useState('repost')
  const [actionType, setActionType] = useState('verify_only')
  const [template, setTemplate] = useState('')
  const [pollingStrategy, setPollingStrategy] = useState('hot_window')

  const handleSubmit = async () => {
    if (!postId || !xAccountId) return
    setSubmitting(true)
    setError('')
    try {
      const res = await api.engagementGates.create({
        xAccountId,
        postId,
        triggerType,
        actionType,
        template,
        pollingStrategy,
      } as Partial<EngagementGate>)
      if (res.success) {
        setPostId('')
        setTemplate('')
        onCreated()
      } else {
        setError(res.error || '作成に失敗しました')
      }
    } catch {
      setError('作成に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mb-6 bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-700">新規ゲート作成</h3>
      </div>
      {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">投稿ID <span className="text-red-500">*</span></label>
          <input type="text" className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-xs bg-white" placeholder="ツイートID" value={postId} onChange={(e) => setPostId(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">トリガー</label>
          <select className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-xs bg-white" value={triggerType} onChange={(e) => setTriggerType(e.target.value)}>
            {Object.entries(TRIGGER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">アクション</label>
          <select className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-xs bg-white" value={actionType} onChange={(e) => setActionType(e.target.value)}>
            {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">ポーリング</label>
          <select className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-xs bg-white" value={pollingStrategy} onChange={(e) => setPollingStrategy(e.target.value)}>
            {Object.entries(POLLING_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <div className="mb-3">
        <label className="block text-xs text-gray-500 mb-1">テンプレート</label>
        <textarea className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-xs bg-white" rows={2} placeholder="DM/メンションのテンプレート文" value={template} onChange={(e) => setTemplate(e.target.value)} />
      </div>
      <div className="flex justify-end">
        <button onClick={handleSubmit} disabled={submitting || !postId} className="px-4 py-2 text-xs font-medium text-white rounded-md disabled:opacity-50 hover:opacity-90" style={{ backgroundColor: '#1D9BF0' }}>
          {submitting ? '作成中...' : '作成'}
        </button>
      </div>
    </div>
  )
}

interface GateCardProps {
  gate: EngagementGate
  onToggleActive: (id: string, current: boolean) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

function GateCard({ gate, onToggleActive, onDelete }: GateCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [loadingDeliveries, setLoadingDeliveries] = useState(false)
  const [deliveriesError, setDeliveriesError] = useState('')
  const [toggling, setToggling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [campaignRef, setCampaignRef] = useState('')
  const [campaignFormId, setCampaignFormId] = useState('')
  const [campaignUrlBase, setCampaignUrlBase] = useState(gate.lineHarnessUrl || '')
  const [copied, setCopied] = useState(false)

  const campaignLink = campaignUrlBase && campaignRef && campaignFormId
    ? `${campaignUrlBase.replace(/\/$/, '')}/r/${campaignRef}?form=${campaignFormId}`
    : ''

  const handleCopy = async () => {
    if (!campaignLink) return
    await navigator.clipboard.writeText(campaignLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const loadDeliveries = useCallback(async () => {
    setLoadingDeliveries(true)
    setDeliveriesError('')
    try {
      const res = await api.engagementGates.deliveries(gate.id)
      if (res.success) {
        setDeliveries(res.data)
      } else {
        setDeliveriesError(res.error || '配信履歴の読み込みに失敗しました')
      }
    } catch {
      setDeliveriesError('配信履歴の読み込みに失敗しました')
    } finally {
      setLoadingDeliveries(false)
    }
  }, [gate.id])

  const handleExpand = () => {
    if (!expanded) {
      loadDeliveries()
    }
    setExpanded(!expanded)
  }

  const handleToggle = async () => {
    setToggling(true)
    try {
      await onToggleActive(gate.id, gate.isActive)
    } finally {
      setToggling(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`投稿ID ${gate.postId} のゲートを削除しますか？`)) return
    setDeleting(true)
    try {
      await onDelete(gate.id)
    } finally {
      setDeleting(false)
    }
  }

  const deliveredCount = deliveries.filter((d) => d.status === 'delivered').length
  const pendingCount = deliveries.filter((d) => d.status === 'pending').length

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* カードヘッダー */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">
              投稿ID: <span className="font-mono text-gray-700">{gate.postId}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-500">
              <span>トリガー: <span className="font-medium text-gray-700">{TRIGGER_LABELS[gate.triggerType] ?? gate.triggerType}</span></span>
              <span className="text-gray-300">|</span>
              <span>アクション: <span className="font-medium text-gray-700">{ACTION_LABELS[gate.actionType] ?? gate.actionType}</span></span>
              <span className="text-gray-300">|</span>
              <span>ポーリング: <span className="font-medium text-gray-700">{POLLING_LABELS[gate.pollingStrategy] ?? gate.pollingStrategy}</span></span>
            </div>
            {(gate.requireLike || gate.requireRepost || gate.requireFollow || gate.replyKeyword) && (
              <div className="flex flex-wrap gap-1 mt-1">
                {gate.requireLike && <span className="text-xs bg-pink-50 text-pink-600 px-1.5 py-0.5 rounded">+いいね</span>}
                {gate.requireRepost && <span className="text-xs bg-green-50 text-green-600 px-1.5 py-0.5 rounded">+RT</span>}
                {gate.requireFollow && <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">+フォロー</span>}
                {gate.replyKeyword && <span className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">KW: {gate.replyKeyword}</span>}
              </div>
            )}
          </div>
          <span
            className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
              gate.isActive
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${gate.isActive ? 'bg-blue-500' : 'bg-gray-400'}`} />
            {gate.isActive ? '有効' : '無効'}
          </span>
        </div>

        {/* テンプレートプレビュー */}
        <p className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-2 font-mono break-all mb-3">
          {gate.template}
        </p>

        {/* 配信サマリー（展開後に表示） */}
        {deliveries.length > 0 && (
          <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
            <span className="flex items-center gap-1">
              <span className="text-base">📊</span>
              <span className="font-medium text-gray-700">{deliveredCount}</span> 配信済み
            </span>
            <span className="flex items-center gap-1">
              <span className="text-base">⏳</span>
              <span className="font-medium text-gray-700">{pendingCount}</span> 保留中
            </span>
          </div>
        )}

        {/* アクションボタン */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleToggle}
            disabled={toggling}
            className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors disabled:opacity-50 ${
              gate.isActive
                ? 'border-gray-300 text-gray-700 hover:bg-gray-50'
                : 'border-blue-300 text-blue-700 hover:bg-blue-50'
            }`}
          >
            {toggling ? '...' : gate.isActive ? '停止' : '再開'}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            {deleting ? '...' : '削除'}
          </button>
          <button
            onClick={handleExpand}
            className="ml-auto px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-1"
          >
            {expanded ? '▲ 閉じる' : '▼ 展開'}
          </button>
        </div>
      </div>

      {/* 配信履歴 + キャンペーンリンク（展開時） */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 px-5 py-4 space-y-5">
          {/* 配信履歴 */}
          <div>
            <p className="text-xs font-semibold text-gray-600 mb-3">配信履歴</p>
            {loadingDeliveries ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-8 bg-gray-200 rounded animate-pulse" />
                ))}
              </div>
            ) : deliveriesError ? (
              <p className="text-xs text-red-600">{deliveriesError}</p>
            ) : deliveries.length === 0 ? (
              <p className="text-xs text-gray-400 italic">まだ配信履歴がありません</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-400">
                      <th className="pb-2 font-medium pr-4">ユーザー</th>
                      <th className="pb-2 font-medium pr-4">ステータス</th>
                      <th className="pb-2 font-medium">日時</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {deliveries.map((d) => (
                      <tr key={d.id}>
                        <td className="py-2 pr-4 text-gray-700 font-medium">
                          {d.xUsername ? `@${d.xUsername}` : d.xUserId}
                        </td>
                        <td className="py-2 pr-4">
                          <span className={`px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[d.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {d.status === 'delivered' ? '配信済み' : d.status === 'pending' ? '保留中' : '失敗'}
                          </span>
                        </td>
                        <td className="py-2 text-gray-400">
                          {new Date(d.createdAt).toLocaleDateString('ja-JP')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* キャンペーンリンク */}
          <div className="border-t border-gray-200 pt-4">
            <p className="text-xs font-semibold text-gray-600 mb-3">キャンペーンリンク</p>
            {gate.link ? (
              <div className="bg-white border border-gray-200 rounded-md p-2.5">
                <p className="text-xs font-mono text-gray-700 break-all mb-2">{gate.link}</p>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">※ リプライ検索は7日間有効</p>
                  <button
                    onClick={() => { navigator.clipboard.writeText(gate.link!); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                    className="px-2.5 py-1 text-xs font-medium text-white rounded-md transition-opacity hover:opacity-90"
                    style={{ backgroundColor: '#1D9BF0' }}
                  >
                    {copied ? 'コピー済み' : 'コピー'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">LINE Harness URL</label>
                  <input type="text" className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white" placeholder="https://line-harness.your-subdomain.workers.dev" value={campaignUrlBase} onChange={(e) => setCampaignUrlBase(e.target.value)} />
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">ref名</label>
                    <input type="text" className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white" placeholder="例: x-march" value={campaignRef} onChange={(e) => setCampaignRef(e.target.value)} />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Form ID</label>
                    <input type="text" className="w-full border border-gray-300 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white" placeholder="例: frm_abc123" value={campaignFormId} onChange={(e) => setCampaignFormId(e.target.value)} />
                  </div>
                </div>
                {campaignLink ? (
                  <div className="bg-white border border-gray-200 rounded-md p-2.5">
                    <p className="text-xs font-mono text-gray-700 break-all mb-2">{campaignLink}</p>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-gray-400">※ リプライ検索は7日間有効</p>
                      <button onClick={handleCopy} className="px-2.5 py-1 text-xs font-medium text-white rounded-md transition-opacity hover:opacity-90" style={{ backgroundColor: '#1D9BF0' }}>{copied ? 'コピー済み' : 'コピー'}</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">手動でリンクを作成する場合は上記を入力してください</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function EngagementGatesPage() {
  const selectedAccountId = useCurrentAccountId()
  const [showInlineForm, setShowInlineForm] = useState(false)
  const [gates, setGates] = useState<EngagementGate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const loadGates = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.engagementGates.list(
        selectedAccountId ? { xAccountId: selectedAccountId } : undefined,
      )
      if (res.success) {
        setGates(res.data)
      } else {
        setError(res.error || 'ゲートの読み込みに失敗しました')
      }
    } catch {
      setError('エンゲージメントゲートの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    loadGates()
  }, [loadGates])

  // Gate creation moved to /campaign

  const handleToggleActive = async (id: string, current: boolean) => {
    try {
      await api.engagementGates.update(id, { isActive: !current })
      loadGates()
    } catch {
      setError('ステータスの変更に失敗しました')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.engagementGates.delete(id)
      loadGates()
    } catch {
      setError('削除に失敗しました')
    }
  }

  return (
    <div>
      <Header
        title="エンゲージメントゲート"
        description="Xポストへのエンゲージメント（いいね・リプライ・リポスト）を条件に、LINE連携やverify APIで特典配布を設定します"
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowInlineForm((v) => !v)}
              className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-700 border border-gray-300 rounded-lg transition-colors hover:bg-gray-50 inline-flex items-center"
            >
              {showInlineForm ? '- フォームを閉じる' : '+ 新規作成'}
            </button>
            <a
              href="/campaign"
              className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90 inline-flex items-center"
              style={{ backgroundColor: '#1D9BF0' }}
            >
              + キャンペーン作成
            </a>
          </div>
        }
      />

      {/* インライン作成フォーム */}
      {showInlineForm && (
        <InlineCreateForm xAccountId={selectedAccountId} onCreated={() => { setShowInlineForm(false); loadGates() }} />
      )}

      {/* エラー表示 */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* キャンペーン作成への誘導 */}
      <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-blue-700 font-medium">新しいキャンペーンを作成しますか？</p>
          <p className="text-xs text-blue-500 mt-0.5">ツイート投稿・条件設定・LINE連携をまとめて設定できます</p>
        </div>
        <a href="/campaign" className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90" style={{ backgroundColor: '#1D9BF0' }}>
          キャンペーン作成 →
        </a>
      </div>

      {/* ローディングスケルトン */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse space-y-3">
              <div className="flex justify-between">
                <div className="h-4 bg-gray-200 rounded w-2/3" />
                <div className="h-5 bg-gray-100 rounded-full w-16" />
              </div>
              <div className="h-3 bg-gray-100 rounded w-1/2" />
              <div className="h-10 bg-gray-100 rounded w-full" />
              <div className="flex gap-2">
                <div className="h-7 bg-gray-100 rounded w-16" />
                <div className="h-7 bg-gray-100 rounded w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : gates.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-dashed border-gray-300">
          <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: '#EFF6FF' }}>
            <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-700 mb-1">ゲートがありません</p>
          <p className="text-xs text-gray-400 mb-4">キャンペーン作成からツイート投稿・条件設定・LINE連携をまとめて設定できます</p>
          <a
            href="/campaign"
            className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity inline-block"
            style={{ backgroundColor: '#1D9BF0' }}
          >
            キャンペーン作成 →
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {gates.map((gate) => (
            <GateCard
              key={gate.id}
              gate={gate}
              onToggleActive={handleToggleActive}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
