'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type { XAccount } from '@/lib/api'
import Header from '@/components/layout/header'

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<XAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)

  // Create form state
  const [formXUserId, setFormXUserId] = useState('')
  const [formUsername, setFormUsername] = useState('')
  const [formAccessToken, setFormAccessToken] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Toggle active state
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.accounts.list()
      if (res.success) {
        setAccounts(res.data)
      } else {
        setError(res.error ?? 'エラーが発生しました')
      }
    } catch {
      setError('アカウントの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formXUserId.trim() || !formUsername.trim() || !formAccessToken.trim()) return
    setCreating(true)
    setCreateError('')
    try {
      const res = await api.accounts.create({
        xUserId: formXUserId.trim(),
        username: formUsername.trim(),
        accessToken: formAccessToken.trim(),
      })
      if (res.success) {
        setFormXUserId('')
        setFormUsername('')
        setFormAccessToken('')
        setShowCreateForm(false)
        loadAccounts()
      } else {
        setCreateError(res.error ?? 'エラーが発生しました')
      }
    } catch {
      setCreateError('アカウントの追加に失敗しました')
    } finally {
      setCreating(false)
    }
  }

  const handleToggleActive = async (account: XAccount) => {
    setTogglingId(account.id)
    try {
      await api.accounts.update(account.id, { isActive: !account.isActive })
      loadAccounts()
    } catch {
      setError('アカウントの更新に失敗しました')
    } finally {
      setTogglingId(null)
    }
  }
// 0618追加開始
const handleRefreshProfile = async (account: XAccount) => {
  try {
    const res = await api.accounts.refreshProfile(account.id);

    if (res.success) {
      await loadAccounts();
      window.dispatchEvent(new CustomEvent('xh_accounts_refresh'));
      alert('プロフィールを更新しました');
    } else {
      alert(res.error ?? 'プロフィール更新に失敗しました');
    }
  } catch {
    alert('プロフィール更新に失敗しました');
  }
};
// 0618追加終了
  return (
    <div>
      <Header
        title="X Accounts"
        description="連携アカウントの管理"
        action={
          <button
            onClick={() => setShowCreateForm((v) => !v)}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {showCreateForm ? 'キャンセル' : '+ Add Account'}
          </button>
        }
      />

      {/* Create form */}
      {showCreateForm && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">新規アカウント追加</h2>
          {createError && (
            <div className="mb-4 bg-red-50 border border-red-200 p-3 text-red-700 text-sm rounded-lg">
              {createError}
            </div>
          )}
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  X User ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formXUserId}
                  onChange={(e) => setFormXUserId(e.target.value)}
                  placeholder="123456789"
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Username <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 text-sm">@</span>
                  <input
                    type="text"
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                    placeholder="username"
                    required
                    className="w-full border border-gray-300 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Access Token <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={formAccessToken}
                  onChange={(e) => setFormAccessToken(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={creating || !formXUserId.trim() || !formUsername.trim() || !formAccessToken.trim()}
                className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {creating ? '追加中...' : '追加'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 p-4 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Account list */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 animate-pulse">
              <div className="space-y-3">
                <div className="h-4 bg-gray-200 rounded w-32" />
                <div className="h-3 bg-gray-100 rounded w-24" />
                <div className="h-7 bg-gray-100 rounded w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-400">アカウントが登録されていません</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((account) => (
            <div key={account.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
              {/* 202606修正開始 */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  {account.profileImageUrl ? (
                    <img
                      src={account.profileImageUrl}
                      alt={account.displayName ?? account.username}
                      className="h-10 w-10 rounded-full"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-gray-200" />
                  )}

                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {account.displayName ?? account.username}
                    </p>

                    <p className="text-xs text-gray-500 mt-0.5">
                      @{account.username}
                    </p>
                  </div>
                </div>
              {/* 202606修正終了 */}
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    account.isActive
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {account.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>

              <p className="text-xs text-gray-400 font-mono mb-4 truncate">{account.xUserId}</p>

              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400">
                  {new Date(account.createdAt).toLocaleDateString('ja-JP')}
                </p>
                {/* 0618追加開始 */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRefreshProfile(account)}
                    className="text-xs px-3 py-1.5 rounded-md border border-blue-200 text-blue-600 hover:bg-blue-50"
                  >
                    更新
                  </button>
                {/* 0618追加終了 */}
                <button
                  onClick={() => handleToggleActive(account)}
                  disabled={togglingId === account.id}
                  className={`text-xs px-3 py-1.5 rounded-md border font-medium disabled:opacity-50 transition-colors ${
                    account.isActive
                      ? 'text-gray-600 border-gray-200 hover:bg-gray-50'
                      : 'text-blue-500 border-blue-100 hover:bg-blue-50'
                  }`}
                >
                  {togglingId === account.id
                    ? '更新中...'
                    : account.isActive
                    ? '無効化'
                    : '有効化'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
