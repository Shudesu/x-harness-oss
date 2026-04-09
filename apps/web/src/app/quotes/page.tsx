'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type { MentionReply, TweetHistory } from '@/lib/api'
import Header from '@/components/layout/header'
import ApiCostGate from '@/components/api-cost-gate'
import { useCurrentAccountId } from '@/hooks/use-selected-account'

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function MetricsBadge({ metrics }: { metrics?: Record<string, number> | null }) {
  if (!metrics) return null
  return (
    <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
      {metrics.like_count != null && <span>♡ {metrics.like_count}</span>}
      {metrics.retweet_count != null && <span>↻ {metrics.retweet_count}</span>}
      {metrics.reply_count != null && <span>💬 {metrics.reply_count}</span>}
      {metrics.impression_count != null && <span>👁 {metrics.impression_count.toLocaleString()}</span>}
    </div>
  )
}

function QuoteRow({ quote, xAccountId, actions }: { quote: MentionReply; xAccountId: string; actions?: string[] }) {
  const [liked, setLiked] = useState(actions?.includes('like') ?? false)
  const [retweeted, setRetweeted] = useState(actions?.includes('repost') ?? false)
  const [liking, setLiking] = useState(false)
  const [retweeting, setRetweeting] = useState(false)
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(actions?.includes('reply') ?? false)
  const [quoteRtOpen, setQuoteRtOpen] = useState(false)
  const [quoteRtText, setQuoteRtText] = useState('')
  const [quoteRtSending, setQuoteRtSending] = useState(false)
  const [quoteRtSent, setQuoteRtSent] = useState(false)

  const handleLike = async () => {
    setLiking(true)
    try {
      await api.posts.like(quote.id, xAccountId)
      setLiked(true)
    } catch { /* silent */ }
    finally { setLiking(false) }
  }

  const handleRetweet = async () => {
    setRetweeting(true)
    try {
      await api.posts.retweet(quote.id, xAccountId)
      setRetweeted(true)
    } catch { /* silent */ }
    finally { setRetweeting(false) }
  }

  const handleReply = async () => {
    if (!replyText.trim()) return
    setSending(true)
    try {
      const res = await api.posts.reply(quote.id, { xAccountId, text: replyText.trim() })
      if (res.success) { setSent(true); setReplyOpen(false); setReplyText('') }
    } catch { /* silent */ }
    finally { setSending(false) }
  }

  const handleQuoteRt = async () => {
    if (!quoteRtText.trim()) return
    setQuoteRtSending(true)
    try {
      const res = await api.posts.create({ xAccountId, text: quoteRtText.trim(), quoteTweetId: quote.id })
      if (res.success) { setQuoteRtSent(true); setQuoteRtOpen(false); setQuoteRtText('') }
    } catch { /* silent */ }
    finally { setQuoteRtSending(false) }
  }

  return (
    <div className="flex items-start gap-3 py-3">
      {quote.authorProfileImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={quote.authorProfileImageUrl} alt="" className="w-9 h-9 rounded-full shrink-0 bg-gray-100" />
      ) : (
        <div className="w-9 h-9 rounded-full shrink-0 bg-gray-200 flex items-center justify-center text-gray-400 text-xs font-bold">
          {(quote.authorDisplayName ?? quote.authorUsername ?? '?')[0]?.toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-gray-900">{quote.authorDisplayName ?? quote.authorUsername ?? quote.authorId}</span>
          {quote.authorUsername && <span className="text-xs text-gray-400">@{quote.authorUsername}</span>}
          <span className="text-xs text-gray-400 ml-auto shrink-0">{formatDate(quote.createdAt)}</span>
        </div>
        <p className="text-sm text-gray-700 mb-1 break-words">{quote.text}</p>

        <MetricsBadge metrics={quote.publicMetrics} />

        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={handleLike}
            disabled={liked || liking}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
              liked ? 'bg-pink-50 text-pink-500' : 'bg-gray-50 hover:bg-gray-100 text-gray-500'
            } disabled:opacity-60`}
          >
            {liked ? '❤️' : '♡'} {liking ? '...' : liked ? '済' : 'いいね'}
          </button>
          <button
            onClick={handleRetweet}
            disabled={retweeted || retweeting}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
              retweeted ? 'bg-green-50 text-green-600' : 'bg-gray-50 hover:bg-gray-100 text-gray-500'
            } disabled:opacity-60`}
          >
            {retweeted ? '✓' : '↻'} {retweeting ? '...' : retweeted ? '済' : 'リポスト'}
          </button>
          {sent ? (
            <span className="text-xs text-green-600 font-medium">返信済み</span>
          ) : (
            <button
              onClick={() => setReplyOpen(!replyOpen)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-gray-50 hover:bg-gray-100 text-gray-500 transition-colors"
            >
              💬 返信
            </button>
          )}
          {quoteRtSent ? (
            <span className="text-xs text-blue-600 font-medium">引用済み</span>
          ) : (
            <button
              onClick={() => setQuoteRtOpen(!quoteRtOpen)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-gray-50 hover:bg-gray-100 text-gray-500 transition-colors"
            >
              🔁 引用RT
            </button>
          )}
          <a
            href={`https://x.com/i/status/${quote.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-600 ml-auto"
          >
            Xで見る ↗
          </a>
        </div>

        {replyOpen && (
          <div className="mt-2 space-y-2">
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="返信を入力..."
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="flex gap-2">
              <button onClick={handleReply} disabled={sending || !replyText.trim()} className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50">
                {sending ? '送信中...' : '送信'}
              </button>
              <button onClick={() => { setReplyOpen(false); setReplyText('') }} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg font-medium">
                キャンセル
              </button>
            </div>
          </div>
        )}

        {quoteRtOpen && (
          <div className="mt-2 space-y-2">
            <textarea
              value={quoteRtText}
              onChange={(e) => setQuoteRtText(e.target.value)}
              placeholder="引用ツイートのテキストを入力..."
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
            />
            <div className="flex gap-2">
              <button onClick={handleQuoteRt} disabled={quoteRtSending || !quoteRtText.trim()} className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50">
                {quoteRtSending ? '送信中...' : '引用RT'}
              </button>
              <button onClick={() => { setQuoteRtOpen(false); setQuoteRtText('') }} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg font-medium">
                キャンセル
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface QuoteGroup {
  tweetId: string
  tweetText: string
  quotes: MentionReply[]
}

export default function QuotesPage() {
  const selectedAccountId = useCurrentAccountId()
  const [groups, setGroups] = useState<QuoteGroup[]>([])
  const [actionsMap, setActionsMap] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [lastSync, setLastSync] = useState<string | null>(null)

  const loadQuotes = useCallback(async (accountId: string) => {
    if (!accountId) return
    setLoading(true)
    setError('')
    try {
      // Get recent posts
      const historyRes = await api.posts.history({ xAccountId: accountId, limit: 100 })
      if (!historyRes.success) { setError('投稿の取得に失敗しました'); return }
      const tweets = historyRes.data.items

      // Fetch quotes for each tweet in parallel (API + DB merged on server)
      const results = await Promise.allSettled(
        tweets.map(async (t: TweetHistory) => {
          const res = await api.posts.quotes(t.id, accountId)
          return { tweetId: t.id, tweetText: t.text, quotes: res.success ? res.data : [] }
        })
      )

      const quoteGroups: QuoteGroup[] = results
        .filter((r): r is PromiseFulfilledResult<QuoteGroup> => r.status === 'fulfilled')
        .map((r) => r.value)
        .filter((g) => g.quotes.length > 0)

      setGroups(quoteGroups)

      // Fetch persisted actions for all quote IDs
      const allQuoteIds = quoteGroups.flatMap((g) => g.quotes.map((q) => q.id))
      if (allQuoteIds.length > 0) {
        try {
          const actionsRes = await api.posts.getActions(accountId, allQuoteIds)
          if (actionsRes.success) setActionsMap(actionsRes.data)
        } catch { /* ignore */ }
      }

      // Fetch last sync time
      try {
        const syncRes = await api.quotes.list({ xAccountId: accountId, limit: 1 })
        if (syncRes.lastSync) setLastSync(syncRes.lastSync)
      } catch { /* ignore */ }
    } catch {
      setError('引用ツイートの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSync = useCallback(async () => {
    if (!selectedAccountId || syncing) return
    setSyncing(true)
    try {
      await api.quotes.sync(selectedAccountId)
      // Reload after sync
      await loadQuotes(selectedAccountId)
    } catch {
      setError('同期に失敗しました')
    } finally {
      setSyncing(false)
    }
  }, [selectedAccountId, syncing, loadQuotes])

  const [fetched, setFetched] = useState(false)
  const handleManualFetch = () => {
    if (selectedAccountId) { setFetched(true); loadQuotes(selectedAccountId) }
  }

  const toggleExpand = (tweetId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.has(tweetId) ? next.delete(tweetId) : next.add(tweetId)
      return next
    })
  }

  const totalQuotes = groups.reduce((sum, g) => sum + g.quotes.length, 0)

  return (
    <div>
      <Header
        title="引用ツイート"
        description="自分の投稿を引用RTした人を確認してアクション"
        action={
          <div className="flex items-center gap-3">
            {lastSync && (
              <span className="text-xs text-gray-400">
                最終同期: {formatDate(lastSync)}
              </span>
            )}
            <button
              onClick={handleSync}
              disabled={syncing || !selectedAccountId}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 transition-colors disabled:opacity-50"
            >
              {syncing ? '同期中...' : '同期'}
            </button>
            <span className="text-xs text-gray-400">
              {totalQuotes}件の引用（{groups.length}投稿）
            </span>
          </div>
        }
      />

      {!fetched && !loading && (
        <div className="mb-4">
          <ApiCostGate onFetch={handleManualFetch} loading={loading} description="投稿履歴 + 各投稿の引用ツイートを取得します（$0.005 × 投稿数）" />
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 p-4 text-red-700 text-sm rounded-lg">{error}</div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse space-y-3">
              <div className="h-3 bg-gray-200 rounded w-48" />
              <div className="h-3 bg-gray-100 rounded w-32" />
            </div>
          ))}
        </div>
      ) : !selectedAccountId ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-400 text-sm">アカウントを選択してください</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-400 text-sm">引用ツイートがありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const expanded = expandedIds.has(group.tweetId)
            const previewText = group.tweetText.length > 100 ? group.tweetText.slice(0, 100) + '…' : group.tweetText
            return (
              <div key={group.tweetId} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                <button
                  onClick={() => toggleExpand(group.tweetId)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 leading-relaxed break-words">{previewText}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs font-medium text-amber-600">{group.quotes.length}件の引用RT</span>
                      <a
                        href={`https://x.com/i/status/${group.tweetId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-blue-400 hover:text-blue-600 hover:underline"
                      >
                        Xで見る ↗
                      </a>
                    </div>
                  </div>
                  <span className="text-gray-400 text-xs shrink-0">{expanded ? '▲' : '▼'}</span>
                </button>
                {expanded && (
                  <div className="border-t border-gray-100 px-5 divide-y divide-gray-50">
                    {group.quotes.map((q) => (
                      <QuoteRow key={q.id} quote={q} xAccountId={selectedAccountId} actions={actionsMap[q.id]} />
                    ))}
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
