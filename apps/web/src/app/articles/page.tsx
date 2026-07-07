'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import type { ArticleDraft } from '@/lib/api'
import Header from '@/components/layout/header'
import { useCurrentAccountId } from '@/hooks/use-selected-account'

interface DraftRecord extends ArticleDraft {
  createdAt: string
  publishedPostId?: string
  // Account that created the draft — publishing must use the same
  // credentials regardless of the current sidebar selection
  xAccountId?: string
}

const DRAFTS_KEY = 'xh_article_drafts'

function loadDrafts(): DraftRecord[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '[]') as DraftRecord[]
  } catch {
    return []
  }
}

function saveDrafts(drafts: DraftRecord[]) {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts.slice(0, 30)))
}

export default function ArticlesPage() {
  const selectedAccountId = useCurrentAccountId()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [creating, setCreating] = useState(false)
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<DraftRecord[]>([])

  useEffect(() => {
    setDrafts(loadDrafts())
    // Prefill from news page handoff
    const prefill = sessionStorage.getItem('xh_article_prefill')
    if (prefill) {
      sessionStorage.removeItem('xh_article_prefill')
      try {
        const p = JSON.parse(prefill) as { title?: string; body?: string }
        if (p.title) setTitle(p.title)
        if (p.body) setBody(p.body)
      } catch { /* ignore */ }
    }
  }, [])

  const createDraft = async () => {
    if (!selectedAccountId) { setError('Xアカウントを選択してください'); return }
    if (!title.trim() || !body.trim()) { setError('タイトルと本文を入力してください'); return }
    setCreating(true)
    setError('')
    setMessage('')
    try {
      const res = await api.articles.createDraft({ xAccountId: selectedAccountId, title: title.trim(), body })
      const record: DraftRecord = { ...res.data, createdAt: new Date().toISOString(), xAccountId: selectedAccountId }
      setDrafts((prev) => {
        const next = [record, ...prev]
        saveDrafts(next)
        return next
      })
      setMessage(`下書きを作成しました（ID: ${res.data.id}）。Xの記事エディタからも確認できます。`)
      setTitle('')
      setBody('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '下書きの作成に失敗しました')
    } finally {
      setCreating(false)
    }
  }

  const publish = async (draft: DraftRecord) => {
    // Publish with the account that created the draft, not the current selection
    const accountId = draft.xAccountId ?? selectedAccountId
    if (!accountId) { setError('Xアカウントを選択してください'); return }
    if (publishingIds.has(draft.id)) return
    if (!confirm(`「${draft.title}」を公開します。公開ポストとしてタイムラインに表示されます。よろしいですか？`)) return
    setPublishingIds((prev) => new Set(prev).add(draft.id))
    setError('')
    setMessage('')
    try {
      const res = await api.articles.publish(draft.id, accountId)
      setDrafts((prev) => {
        const next = prev.map((d) => (d.id === draft.id ? { ...d, publishedPostId: res.data.post_id } : d))
        saveDrafts(next)
        return next
      })
      setMessage(`公開しました！ポストID: ${res.data.post_id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '公開に失敗しました（アカウントにPremium+が必要です）')
    } finally {
      setPublishingIds((prev) => {
        const next = new Set(prev)
        next.delete(draft.id)
        return next
      })
    }
  }

  return (
    <div>
      <Header
        title="記事作成"
        description="X Article（長文記事）の下書き作成と公開。公開にはアカウントのPremium+が必要です"
      />

      {message && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">{message}</div>
      )}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 作成フォーム */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">タイトル</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="記事タイトル"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">本文</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={'空行で段落を分けます。\n\n# 大見出し\n## 小見出し\n- リスト項目\n> 引用'}
                rows={18}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1.5 text-xs text-gray-400">
                対応記法: <code># 見出し</code> / <code>## 小見出し</code> / <code>- リスト</code> / <code>1. 番号リスト</code> / <code>&gt; 引用</code> / 空行で段落分け
              </p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400">下書き作成・公開とも $0.01/回。下書きは非公開で、公開は右のリストから実行します</p>
              <button
                onClick={createDraft}
                disabled={creating || !title.trim() || !body.trim()}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-40 transition-opacity"
                style={{ backgroundColor: '#1D9BF0' }}
              >
                {creating ? '作成中…' : '下書きを作成'}
              </button>
            </div>
          </div>
        </div>

        {/* 下書きリスト */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-bold text-gray-900 mb-3">作成した下書き</h2>
          {drafts.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">まだありません</p>
          ) : (
            <ul className="space-y-3">
              {drafts.map((d) => (
                <li key={d.id} className="border border-gray-100 rounded-lg p-3">
                  <p className="text-sm font-medium text-gray-900 truncate">{d.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(d.createdAt).toLocaleString('ja-JP')} ・ ID: {d.id}
                  </p>
                  <div className="mt-2">
                    {d.publishedPostId ? (
                      <a
                        href={`https://x.com/i/status/${d.publishedPostId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-blue-600 hover:underline"
                      >
                        公開済み → ポストを見る
                      </a>
                    ) : (
                      <button
                        onClick={() => publish(d)}
                        disabled={publishingIds.has(d.id)}
                        className="px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-gray-900 hover:bg-gray-700 disabled:opacity-40 transition-colors"
                      >
                        {publishingIds.has(d.id) ? '公開中…' : '公開する'}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-gray-400">
            ※このリストはブラウザ保存です。X側の下書き一覧はXの記事エディタで確認できます
          </p>
        </div>
      </div>
    </div>
  )
}
