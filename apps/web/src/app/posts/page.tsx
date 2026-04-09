'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import type { TweetHistory, ScheduledPost } from '@/lib/api'
import Header from '@/components/layout/header'
import ApiCostGate from '@/components/api-cost-gate'
import { useCurrentAccountId } from '@/hooks/use-selected-account'

type Tab = 'immediate' | 'scheduled'

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const ALLOWED_VIDEO_TYPES = ['video/mp4']
const MAX_IMAGES = 4

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

interface MediaFile {
  file: File
  previewUrl: string
  type: 'image' | 'video'
}

function CharCounter({ length, limit }: { length: number; limit: number }) {
  const pct = limit > 0 ? length / limit : 0
  const color =
    pct >= 1 ? 'text-red-500 font-semibold' :
    pct >= 0.9 ? 'text-yellow-500 font-semibold' :
    'text-gray-400'
  return (
    <p className={`text-xs text-right mt-0.5 ${color}`}>
      {length}/{limit}
    </p>
  )
}

export default function PostsPage() {
  const selectedAccountId = useCurrentAccountId()

  // Tab
  const [tab, setTab] = useState<Tab>('immediate')

  // Subscription / char limit
  const [charLimit, setCharLimit] = useState(280)
  const [subscriptionType, setSubscriptionType] = useState('')

  // Immediate post form
  const [immTexts, setImmTexts] = useState([''])
  const [immQuoteMode, setImmQuoteMode] = useState(false)
  const [immQuoteId, setImmQuoteId] = useState('')
  const [immPosting, setImmPosting] = useState(false)
  const [immError, setImmError] = useState('')
  const [immSuccess, setImmSuccess] = useState('')

  // Media
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Scheduled post form
  const [schText, setSchText] = useState('')
  const [schAt, setSchAt] = useState('')
  const [schCreating, setSchCreating] = useState(false)
  const [schError, setSchError] = useState('')
  const [schSuccess, setSchSuccess] = useState('')

  // Scheduled posts list
  const [scheduled, setScheduled] = useState<ScheduledPost[]>([])
  const [scheduledLoading, setScheduledLoading] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  // History
  const [history, setHistory] = useState<TweetHistory[]>([])
  // Account id the currently displayed history rows belong to. Used to bind
  // each row to its source account so an in-flight account switch (where
  // selectedAccountId has already changed but loadHistory hasn't refreshed
  // the list yet) can't delete the wrong account's tweet.
  const [historyAccountId, setHistoryAccountId] = useState<string>('')
  // Mirror of historyAccountId so loadHistory can read the *latest* binding
  // when its async fetch resolves, without taking historyAccountId as a
  // dependency (which would recreate loadHistory and double-trigger the
  // mount/account-switch effect).
  const historyAccountIdRef = useRef<string>('')
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  const loadSubscription = useCallback(async (accountId: string) => {
    if (!accountId) return
    try {
      const res = await api.accounts.subscription(accountId)
      if (res.success) {
        setCharLimit(res.data.charLimit)
        setSubscriptionType(res.data.subscriptionType)
      }
    } catch {
      // fall back to 280
      setCharLimit(280)
      setSubscriptionType('')
    }
  }, [])

  const loadHistory = useCallback(async (cursor?: string, accountId?: string) => {
    const effectiveAccountId = accountId || selectedAccountId || ''
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const res = await api.posts.history({ xAccountId: effectiveAccountId || undefined, limit: 20, cursor })
      if (res.success) {
        if (cursor) {
          // Drop stale paginated responses if the binding has shifted to
          // another account between dispatch and resolution. Read from the
          // ref so we always see the *latest* binding rather than the value
          // captured when this loadHistory closure was created.
          if (effectiveAccountId !== historyAccountIdRef.current) {
            return
          }
          setHistory((prev) => [...prev, ...res.data.items])
          setNextCursor(res.data.nextCursor)
        } else {
          setHistory(res.data.items)
          // Reset binding only on a fresh (non-paginated) load — pagination
          // appends rows that belong to the same account as the first page.
          historyAccountIdRef.current = effectiveAccountId
          setHistoryAccountId(effectiveAccountId)
          setNextCursor(res.data.nextCursor)
        }
      } else {
        setHistoryError('投稿履歴の読み込みに失敗しました')
      }
    } catch {
      setHistoryError('投稿履歴の読み込みに失敗しました')
    } finally {
      setHistoryLoading(false)
    }
  }, [selectedAccountId])

  const handleDeletePost = useCallback(async (tweetId: string, preview: string) => {
    // Bind to historyAccountId (the account these rows were loaded for), not
    // selectedAccountId — these can drift mid-account-switch and we'd otherwise
    // send the wrong credentials for the visible row.
    if (!historyAccountId) {
      alert('アカウントが選択されていません')
      return
    }
    if (!confirm(`この投稿を削除しますか？\n\n「${preview.length > 60 ? preview.slice(0, 60) + '…' : preview}」\n\nXからも完全に削除されます。元には戻せません。`)) {
      return
    }
    setDeletingIds((prev) => new Set(prev).add(tweetId))
    try {
      const res = await api.posts.delete(tweetId, historyAccountId)
      if (res.success) {
        // Refresh from cursor=undefined (first page) instead of just filtering
        // out the row. Filtering would leave nextCursor stale: deleting the
        // last visible row on a multi-page history would hit the empty-state
        // branch and hide the 次へ button, stranding older tweets behind a
        // cursor the user can no longer reach.
        await loadHistory(undefined, historyAccountId)
      } else {
        alert('削除に失敗しました: ' + ((res as { error?: string }).error ?? 'unknown'))
      }
    } catch (err) {
      alert('削除に失敗しました: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev)
        next.delete(tweetId)
        return next
      })
    }
  }, [historyAccountId, loadHistory])

  const loadScheduled = useCallback(async () => {
    setScheduledLoading(true)
    try {
      const res = await api.posts.listScheduled()
      if (res.success) setScheduled(res.data)
    } catch {
      // silently fail
    } finally {
      setScheduledLoading(false)
    }
  }, [])

  const [fetched, setFetched] = useState(false)
  const handleManualFetch = () => {
    if (selectedAccountId) {
      setFetched(true)
      loadHistory(undefined, selectedAccountId)
      loadSubscription(selectedAccountId)
    }
  }

  useEffect(() => {
    if (tab === 'scheduled') {
      loadScheduled()
    }
  }, [tab, loadScheduled])

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      mediaFiles.forEach((m) => URL.revokeObjectURL(m.previewUrl))
    }
  }, [mediaFiles])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    const newMedia: MediaFile[] = []
    for (const file of files) {
      const isImage = ALLOWED_IMAGE_TYPES.includes(file.type)
      const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type)
      if (!isImage && !isVideo) continue

      // Can't mix video with images; video is solo
      if (isVideo) {
        // Replace all with single video
        mediaFiles.forEach((m) => URL.revokeObjectURL(m.previewUrl))
        const entry: MediaFile = { file, previewUrl: URL.createObjectURL(file), type: 'video' }
        setMediaFiles([entry])
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }

      newMedia.push({ file, previewUrl: URL.createObjectURL(file), type: 'image' })
    }

    setMediaFiles((prev) => {
      // Don't add more than MAX_IMAGES total
      const combined = [...prev.filter((m) => m.type === 'image'), ...newMedia]
      return combined.slice(0, MAX_IMAGES)
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removeMedia = (idx: number) => {
    setMediaFiles((prev) => {
      URL.revokeObjectURL(prev[idx].previewUrl)
      return prev.filter((_, i) => i !== idx)
    })
  }

  const uploadAllMedia = async (): Promise<string[]> => {
    if (mediaFiles.length === 0) return []
    setUploading(true)
    try {
      const ids: string[] = []
      for (const m of mediaFiles) {
        const res = await api.media.upload(m.file, selectedAccountId)
        if (res.success) ids.push(res.data.mediaId)
      }
      return ids
    } finally {
      setUploading(false)
    }
  }

  const handleImmediatePost = async (e: React.FormEvent) => {
    e.preventDefault()
    const texts = immTexts.filter((t) => t.trim())
    if (!selectedAccountId || texts.length === 0) return
    setImmPosting(true)
    setImmError('')
    setImmSuccess('')
    try {
      const mediaIds = await uploadAllMedia()

      if (texts.length === 1) {
        const res = await api.posts.create({
          xAccountId: selectedAccountId,
          text: texts[0],
          ...(immQuoteMode && immQuoteId.trim() ? { quoteTweetId: immQuoteId.trim() } : {}),
          ...(mediaIds.length > 0 ? { mediaIds } : {}),
        })
        if (res.success) {
          setImmTexts([''])
          setImmQuoteId('')
          setImmQuoteMode(false)
          setMediaFiles([])
          setImmSuccess('投稿しました')
          loadHistory()
        } else {
          setImmError('投稿に失敗しました')
        }
      } else {
        const res = await api.posts.thread({
          xAccountId: selectedAccountId,
          texts,
          ...(mediaIds.length > 0 ? { mediaIds } : {}),
        })
        if (res.success) {
          setImmTexts([''])
          setMediaFiles([])
          setImmSuccess(`${texts.length}件のスレッドを投稿しました`)
          loadHistory()
        } else {
          setImmError('スレッド投稿に失敗しました')
        }
      }
    } catch {
      setImmError('投稿に失敗しました')
    } finally {
      setImmPosting(false)
    }
  }

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAccountId || !schText.trim() || !schAt) return
    setSchCreating(true)
    setSchError('')
    setSchSuccess('')
    try {
      const res = await api.posts.schedule({
        xAccountId: selectedAccountId,
        text: schText.trim(),
        scheduledAt: new Date(schAt).toISOString(),
      })
      if (res.success) {
        setSchText('')
        setSchAt('')
        setSchSuccess('スケジュールしました')
        loadScheduled()
      } else {
        setSchError(res.error ?? 'エラーが発生しました')
      }
    } catch {
      setSchError('スケジュールに失敗しました')
    } finally {
      setSchCreating(false)
    }
  }

  const handleCancel = async (id: string) => {
    if (!confirm('この投稿をキャンセルしますか？')) return
    setCancellingId(id)
    try {
      await api.posts.cancel(id)
      loadScheduled()
    } catch {
      // silently fail
    } finally {
      setCancellingId(null)
    }
  }

  const addThread = () => setImmTexts((prev) => [...prev, ''])
  const removeThread = (i: number) => setImmTexts((prev) => prev.filter((_, idx) => idx !== i))
  const updateThread = (i: number, v: string) =>
    setImmTexts((prev) => prev.map((t, idx) => (idx === i ? v : t)))

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const canAddMedia =
    mediaFiles.length === 0 ||
    (mediaFiles[0]?.type === 'image' && mediaFiles.length < MAX_IMAGES)

  return (
    <div>
      <Header title="投稿管理" description="即時投稿・予約投稿・履歴" />

      {!fetched && !historyLoading && (
        <div className="mb-4">
          <ApiCostGate onFetch={handleManualFetch} loading={historyLoading} description="投稿履歴・サブスクリプション情報を X API から取得します（$0.005 × 2回）" />
        </div>
      )}

      {/* Top section: tabs */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
        {/* Tab header */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setTab('immediate')}
            className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === 'immediate'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            新規投稿
          </button>
          <button
            onClick={() => setTab('scheduled')}
            className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === 'scheduled'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            予約投稿
          </button>
        </div>

        <div className="p-5">
          {/* Immediate post tab */}
          {tab === 'immediate' && (
            <form onSubmit={handleImmediatePost} className="space-y-4">
              {immTexts.map((text, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-600">
                      {immTexts.length > 1 ? `ツイート ${i + 1}` : '投稿テキスト'}
                      <span className="text-red-500"> *</span>
                    </label>
                    <div className="flex items-center gap-2">
                      {/* Subscription badge (only on first tweet) */}
                      {i === 0 && subscriptionType && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                          {subscriptionType}
                        </span>
                      )}
                      {immTexts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeThread(i)}
                          className="text-xs text-red-400 hover:text-red-600"
                        >
                          削除
                        </button>
                      )}
                    </div>
                  </div>
                  <textarea
                    value={text}
                    onChange={(e) => updateThread(i, e.target.value)}
                    placeholder="ツイートの内容を入力..."
                    required
                    rows={3}
                    maxLength={charLimit}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                  <CharCounter length={text.length} limit={charLimit} />
                </div>
              ))}

              {/* Media attachment (only for single tweets) */}
              {immTexts.length === 1 && (
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={[...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES].join(',')}
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  {canAddMedia && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      画像/動画を添付
                      <span className="text-xs text-gray-400">
                        ({mediaFiles.length}/{MAX_IMAGES})
                      </span>
                    </button>
                  )}

                  {/* Media previews */}
                  {mediaFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {mediaFiles.map((m, idx) => (
                        <div key={idx} className="relative group">
                          {m.type === 'image' ? (
                            <img
                              src={m.previewUrl}
                              alt=""
                              className="w-20 h-20 object-cover rounded-lg border border-gray-200"
                            />
                          ) : (
                            <video
                              src={m.previewUrl}
                              className="w-20 h-20 object-cover rounded-lg border border-gray-200"
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => removeMedia(idx)}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-700 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Upload progress indicator */}
                  {uploading && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-blue-600">
                      <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      メディアをアップロード中...
                    </div>
                  )}
                </div>
              )}

              {/* Quote RT toggle (only for single tweets) */}
              {immTexts.length === 1 && (
                <div>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={immQuoteMode}
                      onChange={(e) => setImmQuoteMode(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    引用RTする
                  </label>
                  {immQuoteMode && (
                    <input
                      type="text"
                      value={immQuoteId}
                      onChange={(e) => setImmQuoteId(e.target.value)}
                      placeholder="引用するツイートのID"
                      className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                </div>
              )}

              {immError && (
                <div className="bg-red-50 border border-red-200 p-3 text-red-700 text-sm rounded-lg">
                  {immError}
                </div>
              )}
              {immSuccess && (
                <div className="bg-green-50 border border-green-200 p-3 text-green-700 text-sm rounded-lg">
                  {immSuccess}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={addThread}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  + スレッド追加
                </button>
                <button
                  type="submit"
                  disabled={immPosting || uploading || !selectedAccountId || immTexts.every((t) => !t.trim())}
                  className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {(immPosting || uploading) && (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  )}
                  {uploading ? 'アップロード中...' : immPosting ? '投稿中...' : '投稿'}
                </button>
              </div>
            </form>
          )}

          {/* Scheduled post tab */}
          {tab === 'scheduled' && (
            <div className="space-y-6">
              <form onSubmit={handleSchedule} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    投稿テキスト <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={schText}
                    onChange={(e) => setSchText(e.target.value)}
                    placeholder="ツイートの内容を入力..."
                    required
                    rows={4}
                    maxLength={280}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                  <CharCounter length={schText.length} limit={280} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    投稿日時 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={schAt}
                    onChange={(e) => setSchAt(e.target.value)}
                    required
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {schError && (
                  <div className="bg-red-50 border border-red-200 p-3 text-red-700 text-sm rounded-lg">
                    {schError}
                  </div>
                )}
                {schSuccess && (
                  <div className="bg-green-50 border border-green-200 p-3 text-green-700 text-sm rounded-lg">
                    {schSuccess}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={schCreating || !selectedAccountId || !schText.trim() || !schAt}
                    className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    {schCreating ? 'スケジュール中...' : 'スケジュール'}
                  </button>
                </div>
              </form>

              {/* Scheduled list */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">スケジュール済み</h3>
                {scheduledLoading ? (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
                    ))}
                  </div>
                ) : scheduled.length === 0 ? (
                  <p className="text-sm text-gray-400">スケジュール投稿がありません</p>
                ) : (
                  <div className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
                    <table className="w-full min-w-[500px] text-sm">
                      <thead>
                        <tr className="bg-gray-100 border-b border-gray-200">
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">内容</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">投稿日時</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500">状態</th>
                          <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {scheduled.map((p) => (
                          <tr key={p.id} className="hover:bg-white transition-colors">
                            <td className="px-4 py-2 text-gray-700 max-w-xs">
                              <p className="truncate">{p.text}</p>
                            </td>
                            <td className="px-4 py-2 text-gray-500 whitespace-nowrap text-xs">
                              {formatDate(p.scheduledAt)}
                            </td>
                            <td className="px-4 py-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                p.status === 'scheduled' ? 'bg-blue-100 text-blue-700' :
                                p.status === 'posted' ? 'bg-green-100 text-green-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                {p.status === 'scheduled' ? '予約中' : p.status === 'posted' ? '投稿済' : '失敗'}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right">
                              {p.status === 'scheduled' && (
                                <button
                                  onClick={() => handleCancel(p.id)}
                                  disabled={cancellingId === p.id}
                                  className="text-xs text-red-500 hover:text-red-600 px-3 py-1 rounded-md border border-red-100 hover:border-red-200 disabled:opacity-50 transition-colors"
                                >
                                  {cancellingId === p.id ? 'キャンセル中...' : 'キャンセル'}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* History section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">投稿履歴</h2>
        </div>

        {historyError && (
          <div className="px-5 py-3 bg-red-50 border-b border-red-100 text-red-700 text-sm">
            {historyError}
          </div>
        )}

        {historyLoading && history.length === 0 ? (
          <div className="divide-y divide-gray-100">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-4 py-4 animate-pulse">
                <div className="flex items-start gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-gray-200 rounded w-3/4" />
                    <div className="h-3 bg-gray-100 rounded w-1/2" />
                  </div>
                  <div className="flex gap-4">
                    <div className="h-3 bg-gray-100 rounded w-8" />
                    <div className="h-3 bg-gray-100 rounded w-8" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : history.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-400 text-sm">投稿履歴がありません</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">内容</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">いいね</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">RT</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">リプライ</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">インプレッション</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">日時</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {history.map((tweet) => {
                    const isExpanded = expandedIds.has(tweet.id)
                    const truncated = tweet.text.length > 50
                    return (
                      <>
                        <tr key={tweet.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-sm text-gray-700 max-w-xs">
                            {isExpanded || !truncated ? tweet.text : `${tweet.text.slice(0, 50)}…`}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 text-right">
                            {tweet.public_metrics?.like_count ?? '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 text-right">
                            {tweet.public_metrics?.retweet_count ?? '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 text-right">
                            {tweet.public_metrics?.reply_count ?? '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 text-right">
                            {tweet.public_metrics?.impression_count ?? '-'}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400 text-right whitespace-nowrap">
                            {formatDate(tweet.created_at)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-3">
                              {truncated && (
                                <button
                                  onClick={() => toggleExpanded(tweet.id)}
                                  className="text-xs text-blue-500 hover:text-blue-700"
                                >
                                  {isExpanded ? '折りたたむ' : '展開'}
                                </button>
                              )}
                              <button
                                onClick={() => handleDeletePost(tweet.id, tweet.text)}
                                disabled={deletingIds.has(tweet.id) || historyAccountId !== selectedAccountId || historyLoading}
                                className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                title={historyAccountId !== selectedAccountId ? '別アカウントの履歴を読み込み中…' : 'この投稿をXから削除'}
                              >
                                {deletingIds.has(tweet.id) ? '削除中…' : '削除'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {nextCursor && (
              <div className="px-5 py-4 border-t border-gray-100 flex justify-center">
                <button
                  onClick={() => loadHistory(nextCursor)}
                  disabled={historyLoading}
                  className="text-sm text-blue-500 hover:text-blue-700 font-medium disabled:opacity-50"
                >
                  {historyLoading ? '読み込み中...' : '次へ'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
