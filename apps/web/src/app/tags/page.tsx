'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type { Tag } from '@/lib/api'
import Header from '@/components/layout/header'
//0625追加開始
import { useSelectedAccount } from '@/hooks/use-selected-account'

function formatAccountLabel(
  account: { displayName: string | null; username: string } | null
): string {
  if (!account?.username) return ''

  return account.displayName
    ? `${account.displayName} / @${account.username}`
    : `@${account.username}`
}
//0625追加終了

function TagBadgePreview({ name, color }: { name: string; color: string }) {
  const bg = color || '#3B82F6'
  const r = parseInt(bg.slice(1, 3), 16)
  const g = parseInt(bg.slice(3, 5), 16)
  const b = parseInt(bg.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  const textColor = luminance > 0.5 ? '#1f2937' : '#ffffff'

  return (
    <span
      style={{ backgroundColor: bg, color: textColor }}
      className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium"
    >
      {name || 'Preview'}
    </span>
  )
}

export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  //0625追加開始
  const {
  loading: accountsLoading,
  selectedAccountId,
  selectedAccount,
} = useSelectedAccount()

const selectedAccountLabel = formatAccountLabel(selectedAccount)
  //0625追加終了

  // Create form state
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#3B82F6')
  //0625修正開始
  //const [newAccountId, setNewAccountId] = useState('')
  //0625修正終了
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState('')

  //0625修正開始
  // const loadTags = useCallback(async () => {
  //   setLoading(true)
  //   setError('')
  //   try {
  //     const res = await api.tags.list()
  //     if (res.success) {
  //       setTags(res.data)
  //     } else {
  //       setError(res.error ?? 'エラーが発生しました')
  //     }
  //   } catch {
  //     setError('タグの読み込みに失敗しました。もう一度お試しください。')
  //   } finally {
  //     setLoading(false)
  //   }
  // }, [])

 const loadTags = useCallback(async () => {
  if (accountsLoading) return

  if (!selectedAccountId) {
    setTags([])
    setLoading(false)
    return
  }

  setLoading(true)
  setError('')

  try {
    const res = await api.tags.list({
      xAccountId: selectedAccountId,
    })

    if (res.success) {
      setTags(res.data)
    } else {
      setError(res.error ?? 'エラーが発生しました')
    }
  } catch {
    setError('タグの読み込みに失敗しました。もう一度お試しください。')
  } finally {
    setLoading(false)
  }
}, [accountsLoading, selectedAccountId])
  //0625修正終了
  

  useEffect(() => {
    loadTags()
  }, [loadTags])

  //0625修正開始
  // const handleCreate = async (e: React.FormEvent) => {
  //   e.preventDefault()
  //   if (!newName.trim() || !newAccountId.trim()) return
  //   setCreating(true)
  //   setCreateError('')
  //   try {
  //     const res = await api.tags.create(newAccountId.trim(), newName.trim(), newColor)
  //     if (res.success) {
  //       setNewName('')
  //       setNewColor('#3B82F6')
  //       setNewAccountId('')
  //       setShowCreateForm(false)
  //       loadTags()
  //     } else {
  //       setCreateError(res.error ?? 'エラーが発生しました')
  //     }
  //   } catch {
  //     setCreateError('タグの作成に失敗しました')
  //   } finally {
  //     setCreating(false)
  //   }
  // }

  const handleCreate = async (e: React.FormEvent) => {
  e.preventDefault()

  if (!selectedAccountId) {
    setCreateError('Xアカウントを選択してください')
    return
  }

  if (!newName.trim()) return

  setCreating(true)
  setCreateError('')

  try {
    const res = await api.tags.create(selectedAccountId, newName.trim(), newColor)
    if (res.success) {
      setNewName('')
      setNewColor('#3B82F6')
      setShowCreateForm(false)
      loadTags()
    } else {
      setCreateError(res.error ?? 'エラーが発生しました')
    }
  } catch {
    setCreateError('タグの作成に失敗しました')
  } finally {
    setCreating(false)
  }
}
  //0625修正完了
  const startEdit = (tag: Tag) => {
    setEditingId(tag.id)
    setEditName(tag.name)
    setEditColor(tag.color || '#3B82F6')
    setEditError('')
  }

  const handleUpdate = async (id: string) => {
    if (!editName.trim()) return
    setEditLoading(true)
    setEditError('')
    try {
      const res = await api.tags.update(id, { name: editName.trim(), color: editColor })
      if (res.success) {
        setEditingId(null)
        loadTags()
      } else {
        setEditError(res.error ?? 'エラーが発生しました')
      }
    } catch {
      setEditError('タグの更新に失敗しました')
    } finally {
      setEditLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このタグを削除しますか？')) return
    try {
      await api.tags.delete(id)
      loadTags()
    } catch {
      setError('タグの削除に失敗しました')
    }
  }

  return (
    <div>
      <Header
        title="Tags"
        description="フォロワーのセグメント管理"
        action={
          <button
            onClick={() => setShowCreateForm((v) => !v)}
            //0625追加開始
            disabled={accountsLoading || !selectedAccountId}
            //0625追加終了
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {showCreateForm ? 'キャンセル' : '+ New Tag'}
          </button>
        }
      />

      {/* Create form */}
      {showCreateForm && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">新規タグ作成</h2>
          {createError && (
            <div className="mb-4 bg-red-50 border border-red-200 p-3 text-red-700 text-sm rounded-lg">
              {createError}
            </div>
          )}
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* 0625修正開始 */}
              {/* <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  X Account ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newAccountId}
                  onChange={(e) => setNewAccountId(e.target.value)}
                  placeholder="account_id"
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div> */}

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  対象アカウント
                </label>
                <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm text-gray-700">
                  {selectedAccountLabel || 'Xアカウントを選択してください'}
                </div>
              </div>
              {/* 0625修正完了 */}

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  タグ名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例: VIP顧客"
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">カラー</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    className="h-9 w-14 rounded border border-gray-300 cursor-pointer"
                  />
                  <TagBadgePreview name={newName || 'Preview'} color={newColor} />
                </div>
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
                //0625修正開始
                //disabled={creating || !newName.trim() || !newAccountId.trim()}
                disabled={creating || !newName.trim() || !selectedAccountId}
                //0625修正開始
                className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {creating ? '作成中...' : '作成'}
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

      {/* Tag list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="h-7 w-20 bg-gray-200 rounded-full" />
                <div className="h-4 bg-gray-100 rounded w-32" />
              </div>
            </div>
          ))}
        </div>
      ) : tags.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-400 py-12">タグがありません。「+ New Tag」から作成してください。</p>
        </div>
      ) : (
        <div className="space-y-2">
          {editError && (
            <div className="bg-red-50 border border-red-200 p-3 text-red-700 text-sm rounded-lg">
              {editError}
            </div>
          )}
          {tags.map((tag) => {
            const isEditing = editingId === tag.id
            return (
              <div
                key={tag.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-5"
              >
                {isEditing ? (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 flex-1"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={editColor}
                        onChange={(e) => setEditColor(e.target.value)}
                        className="h-9 w-14 rounded border border-gray-300 cursor-pointer"
                      />
                      <TagBadgePreview name={editName || 'Preview'} color={editColor} />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleUpdate(tag.id)}
                        disabled={editLoading || !editName.trim()}
                        className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                      >
                        {editLoading ? '保存中...' : '保存'}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <TagBadgePreview name={tag.name} color={tag.color || '#3B82F6'} />
                      <span className="text-xs text-gray-400 font-mono">
                        {new Date(tag.createdAt).toLocaleDateString('ja-JP')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => startEdit(tag)}
                        className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-md border border-gray-200 hover:border-gray-300 transition-colors"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => handleDelete(tag.id)}
                        className="text-xs text-red-500 hover:text-red-600 px-3 py-1.5 rounded-md border border-red-100 hover:border-red-200 transition-colors"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
