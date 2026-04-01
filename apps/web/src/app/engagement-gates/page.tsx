'use client'

import { useState, useEffect, useCallback } from 'react'
import { api, type EngagementGate, type Delivery } from '@/lib/api'
import Header from '@/components/layout/header'

const TRIGGER_LABELS: Record<string, string> = {
  like: 'いいね',
  repost: 'リポスト',
  reply: 'リプライ',
  follow: 'フォロー',
  quote: '引用',
}

const STATUS_BADGE: Record<string, string> = {
  delivered: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  failed: 'bg-red-100 text-red-700',
}

interface CreateFormState {
  postId: string
  triggerType: 'like' | 'repost' | 'reply'
  actionType: 'mention_post' | 'dm' | 'verify_only'
  template: string
  link: string
  lineHarnessTag: string
  lineHarnessScenarioId: string
  xAccountId: string
  requireLike: boolean
  requireRepost: boolean
  requireFollow: boolean
  replyKeyword: string
}

const defaultForm: CreateFormState = {
  postId: '',
  triggerType: 'like',
  actionType: 'mention_post',
  template: '',
  link: '',
  lineHarnessTag: '',
  lineHarnessScenarioId: '',
  xAccountId: '',
  requireLike: false,
  requireRepost: false,
  requireFollow: false,
  replyKeyword: '',
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

  const loadDeliveries = useCallback(async () => {
    setLoadingDeliveries(true)
    setDeliveriesError('')
    try {
      const res = await api.engagementGates.deliveries(gate.id)
      if (res.success) {
        setDeliveries(res.data)
      } else {
        setDeliveriesError(res.error || 'Failed to load deliveries')
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
    if (!confirm(`Gate for post ${gate.postId} を削除しますか？`)) return
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
      {/* Card header */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">
              Post: <span className="font-mono text-gray-700">{gate.postId}</span>
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-500">
              <span>Trigger: <span className="font-medium text-gray-700">{TRIGGER_LABELS[gate.triggerType] ?? gate.triggerType}</span></span>
              <span className="text-gray-300">|</span>
              <span>Action: <span className="font-medium text-gray-700">{gate.actionType}</span></span>
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
            {gate.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>

        {/* Template preview */}
        <p className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-2 font-mono break-all mb-3">
          {gate.template}
        </p>

        {/* Delivery summary (shown after first expand) */}
        {deliveries.length > 0 && (
          <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
            <span className="flex items-center gap-1">
              <span className="text-base">📊</span>
              <span className="font-medium text-gray-700">{deliveredCount}</span> delivered
            </span>
            <span className="flex items-center gap-1">
              <span className="text-base">⏳</span>
              <span className="font-medium text-gray-700">{pendingCount}</span> pending
            </span>
          </div>
        )}

        {/* Actions */}
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
            {toggling ? '...' : gate.isActive ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            {deleting ? '...' : 'Delete'}
          </button>
          <button
            onClick={handleExpand}
            className="ml-auto px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-1"
          >
            {expanded ? '▲ 閉じる' : '▼ 展開'}
          </button>
        </div>
      </div>

      {/* Delivery history (expanded) */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 px-5 py-4">
          <p className="text-xs font-semibold text-gray-600 mb-3">Delivery History</p>
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
                    <th className="pb-2 font-medium pr-4">User</th>
                    <th className="pb-2 font-medium pr-4">Status</th>
                    <th className="pb-2 font-medium">Date</th>
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
                          {d.status}
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
      )}
    </div>
  )
}

export default function EngagementGatesPage() {
  const [gates, setGates] = useState<EngagementGate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateFormState>(defaultForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const loadGates = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.engagementGates.list()
      if (res.success) {
        setGates(res.data)
      } else {
        setError(res.error || 'Failed to load gates')
      }
    } catch {
      setError('Engagement Gatesの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadGates()
  }, [loadGates])

  const handleCreate = async () => {
    if (!form.postId.trim()) {
      setFormError('Post IDを入力してください')
      return
    }
    if (!form.template.trim()) {
      setFormError('テンプレートを入力してください')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const res = await api.engagementGates.create({
        postId: form.postId.trim(),
        triggerType: form.triggerType,
        actionType: form.actionType,
        template: form.template.trim(),
        link: form.link.trim() || null,
        lineHarnessTag: form.lineHarnessTag.trim() || null,
        lineHarnessScenarioId: form.lineHarnessScenarioId.trim() || null,
        xAccountId: form.xAccountId.trim() || undefined,
        requireLike: form.requireLike,
        requireRepost: form.requireRepost,
        requireFollow: form.requireFollow,
        replyKeyword: form.replyKeyword.trim() || null,
        isActive: true,
      })
      if (res.success) {
        setShowCreate(false)
        setForm(defaultForm)
        loadGates()
      } else {
        setFormError(res.error || '作成に失敗しました')
      }
    } catch {
      setFormError('作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

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
        title="Engagement Gates"
        description="Like or repost a post → auto DM delivery"
        action={
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#1D9BF0' }}
          >
            + New Gate
          </button>
        }
      />

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">New Engagement Gate</h2>
          <div className="space-y-4 max-w-lg">
            {/* Post ID */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Post ID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: 1234567890123456789"
                value={form.postId}
                onChange={(e) => setForm({ ...form, postId: e.target.value })}
              />
              <p className="text-xs text-gray-400 mt-1">X投稿のID（URLの末尾の数字）</p>
            </div>

            {/* Trigger Type */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Trigger Type</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.triggerType}
                onChange={(e) => setForm({ ...form, triggerType: e.target.value as 'like' | 'repost' | 'reply' })}
              >
                <option value="like">いいね (Like)</option>
                <option value="repost">リポスト (Repost)</option>
                <option value="reply">リプライ (Reply)</option>
              </select>
            </div>

            {/* Action Type */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Action Type</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                value={form.actionType}
                onChange={(e) => setForm({ ...form, actionType: e.target.value as 'mention_post' | 'dm' | 'verify_only' })}
              >
                <option value="mention_post">メンションリプライ (Mention Post)</option>
                <option value="dm">DM（Phase 2）</option>
                <option value="verify_only">検知のみ (Verify Only)</option>
              </select>
              <p className="text-xs text-gray-400 mt-1">verify_only は検知・記録のみ（メッセージ送信なし）</p>
            </div>

            {/* Template */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Template <span className="text-red-500">*</span>
              </label>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-mono"
                rows={3}
                placeholder="特典はこちら→ {link}"
                value={form.template}
                onChange={(e) => setForm({ ...form, template: e.target.value })}
              />
              <p className="text-xs text-gray-400 mt-1"><code className="bg-gray-100 px-1 rounded">{'{link}'}</code> でリンクURLを埋め込めます</p>
            </div>

            {/* Link URL */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Link URL</label>
              <input
                type="url"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://example.com/lp"
                value={form.link}
                onChange={(e) => setForm({ ...form, link: e.target.value })}
              />
            </div>

            {/* Reply keyword filter */}
            {form.triggerType === 'reply' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">リプライキーワード</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例: 参加"
                  value={form.replyKeyword}
                  onChange={(e) => setForm({ ...form, replyKeyword: e.target.value })}
                />
                <p className="text-xs text-gray-400 mt-1">このキーワードを含むリプライのみ検知します（空欄で全リプライ対象）</p>
              </div>
            )}

            {/* Condition checkboxes for reply trigger */}
            {form.triggerType === 'reply' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">追加条件（リプライ + 以下を必須にする）</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={form.requireLike} onChange={(e) => setForm({ ...form, requireLike: e.target.checked })} className="rounded border-gray-300" />
                    いいね必須
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={form.requireRepost} onChange={(e) => setForm({ ...form, requireRepost: e.target.checked })} className="rounded border-gray-300" />
                    リポスト必須
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={form.requireFollow} onChange={(e) => setForm({ ...form, requireFollow: e.target.checked })} className="rounded border-gray-300" />
                    フォロー必須
                  </label>
                </div>
              </div>
            )}

            {/* LINE Harness Tag */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">LINE Harness Tag</label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: campaign_march"
                value={form.lineHarnessTag}
                onChange={(e) => setForm({ ...form, lineHarnessTag: e.target.value })}
              />
            </div>

            {/* LINE Harness Scenario ID */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">LINE Harness Scenario ID</label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: scn_abc123"
                value={form.lineHarnessScenarioId}
                onChange={(e) => setForm({ ...form, lineHarnessScenarioId: e.target.value })}
              />
            </div>

            {/* X Account ID */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">X Account ID</label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: acc_abc123"
                value={form.xAccountId}
                onChange={(e) => setForm({ ...form, xAccountId: e.target.value })}
              />
            </div>

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={saving}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#1D9BF0' }}
              >
                {saving ? '作成中...' : 'Create Gate'}
              </button>
              <button
                onClick={() => { setShowCreate(false); setFormError(''); setForm(defaultForm) }}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
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
          <p className="text-sm font-medium text-gray-700 mb-1">No gates yet</p>
          <p className="text-xs text-gray-400 mb-4">Create your first engagement gate to start automating DMs</p>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#1D9BF0' }}
          >
            + New Gate
          </button>
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
