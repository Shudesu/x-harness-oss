'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import type { MentionReply } from '@/lib/api'
import Header from '@/components/layout/header'
import ApiCostGate from '@/components/api-cost-gate'
import { useCurrentAccountId } from '@/hooks/use-selected-account'

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

interface ReplyGroup {
  inReplyToTweetId: string | null
  replies: MentionReply[]
}

interface ReplyRowProps {
  reply: MentionReply
  xAccountId: string
  onSuccess: (id: string) => void
  actions?: string[]
}

function ReplyRow({ reply, xAccountId, onSuccess, actions }: ReplyRowProps) {
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(actions?.includes('reply') ?? false)
  const [liked, setLiked] = useState(actions?.includes('like') ?? false)
  const [liking, setLiking] = useState(false)
  const [retweeted, setRetweeted] = useState(actions?.includes('repost') ?? false)
  const [retweeting, setRetweeting] = useState(false)

  const handleLike = async () => {
    if (liked || liking || !xAccountId) return
    setLiking(true)
    try {
      const res = await api.posts.like(reply.id, xAccountId)
      if (res.success) setLiked(true)
    } catch { /* ignore duplicate like errors */ setLiked(true) }
    finally { setLiking(false) }
  }

  const handleRetweet = async () => {
    if (retweeted || retweeting || !xAccountId) return
    setRetweeting(true)
    try {
      const res = await api.posts.retweet(reply.id, xAccountId)
      if (res.success) setRetweeted(true)
    } catch { /* ignore duplicate retweet errors */ setRetweeted(true) }
    finally { setRetweeting(false) }
  }

  const handleSend = async () => {
    if (!replyText.trim() || !xAccountId) return
    setSending(true)
    setError('')
    try {
      const res = await api.posts.reply(reply.id, { xAccountId, text: replyText.trim() })
      if (res.success) {
        setSent(true)
        setReplyOpen(false)
        setReplyText('')
        onSuccess(reply.id)
      } else {
        setError('送信に失敗しました')
      }
    } catch {
      setError('送信に失敗しました')
    } finally {
      setSending(false)
    }
  }

  const isOwn = reply.isOwnReply === true

  return (
    <div className={`flex items-start gap-3 py-3 ${isOwn ? 'bg-blue-50/50 rounded-lg px-3 -mx-3' : ''}`}>
      {/* Avatar */}
      {reply.authorProfileImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={reply.authorProfileImageUrl}
          alt={reply.authorUsername ?? 'user'}
          className="w-9 h-9 rounded-full shrink-0 bg-gray-100"
        />
      ) : (
        <div className="w-9 h-9 rounded-full shrink-0 bg-gray-200 flex items-center justify-center text-gray-400 text-xs font-bold">
          {(reply.authorDisplayName ?? reply.authorUsername ?? '?')[0].toUpperCase()}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-gray-900">
            {reply.authorDisplayName ?? reply.authorUsername ?? reply.authorId}
          </span>
          {isOwn && (
            <span className="text-[10px] font-bold bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">自分</span>
          )}
          {reply.authorUsername && (
            <span className="text-xs text-gray-400">@{reply.authorUsername}</span>
          )}
          <span className="text-xs text-gray-400 ml-auto shrink-0">{formatDate(reply.createdAt)}</span>
        </div>
        <p className="text-sm text-gray-700 mb-2 break-words">{reply.text}</p>

        {/* Quick engagement actions — hidden for own replies */}
        {!isOwn && <div className="flex items-center gap-2 mb-2">
          <button
            onClick={handleLike}
            disabled={liked || liking}
            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border transition-all ${
              liked
                ? 'bg-pink-50 border-pink-200 text-pink-600'
                : 'border-gray-200 text-gray-500 hover:border-pink-200 hover:text-pink-500 hover:bg-pink-50'
            } disabled:cursor-default`}
          >
            {liking ? (
              <span className="w-3.5 h-3.5 border-2 border-pink-300 border-t-transparent rounded-full animate-spin" />
            ) : liked ? (
              <span>&#10084;</span>
            ) : (
              <span>&#9825;</span>
            )}
            {liked ? '済' : 'いいね'}
          </button>

          <button
            onClick={handleRetweet}
            disabled={retweeted || retweeting}
            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border transition-all ${
              retweeted
                ? 'bg-green-50 border-green-200 text-green-600'
                : 'border-gray-200 text-gray-500 hover:border-green-200 hover:text-green-500 hover:bg-green-50'
            } disabled:cursor-default`}
          >
            {retweeting ? (
              <span className="w-3.5 h-3.5 border-2 border-green-300 border-t-transparent rounded-full animate-spin" />
            ) : (
              <span className={retweeted ? 'font-bold' : ''}>&#8635;</span>
            )}
            {retweeted ? '済' : 'リポスト'}
          </button>

          {sent ? (
            <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border bg-blue-50 border-blue-200 text-blue-600">
              &#9993; 返信済み
            </span>
          ) : (
            <button
              onClick={() => setReplyOpen(!replyOpen)}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-md border border-gray-200 text-gray-500 hover:border-blue-200 hover:text-blue-500 hover:bg-blue-50 transition-all"
            >
              &#128172; 返信
            </button>
          )}
        </div>}

        {!isOwn && replyOpen && !sent && (
          <div className="space-y-2">
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="返信を入力..."
              rows={2}
              maxLength={280}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <p className="text-xs text-gray-400 text-right">{replyText.length}/280</p>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={handleSend}
                disabled={sending || !replyText.trim()}
                className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50 transition-colors"
              >
                {sending ? '送信中...' : '送信'}
              </button>
              <button
                onClick={() => { setReplyOpen(false); setReplyText(''); setError('') }}
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg font-medium transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface GroupCardProps {
  group: ReplyGroup
  xAccountId: string
  onReplySuccess: (id: string) => void
  actionsMap: Record<string, string[]>
}

function GroupCard({ group, xAccountId, onReplySuccess, actionsMap }: GroupCardProps) {
  const [expanded, setExpanded] = useState(false)
  const tweetId = group.inReplyToTweetId
  const firstReply = group.replies[0]
  const parentText = firstReply?.parentTweetText
  const parentAuthor = firstReply?.parentTweetAuthor
  const previewText = parentText
    ? parentText.length > 100 ? parentText.slice(0, 100) + '…' : parentText
    : null

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left gap-3"
      >
        <div className="flex-1 min-w-0">
          {previewText ? (
            <>
              {parentAuthor && (
                <p className="text-xs text-blue-500 font-medium mb-1">@{parentAuthor} の投稿</p>
              )}
              <p className="text-sm text-gray-800 leading-relaxed break-words">{previewText}</p>
            </>
          ) : (
            <p className="text-xs font-mono text-gray-400">{tweetId ?? '(不明な投稿)'}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            <span className="text-xs text-gray-400">{group.replies.length}件のリプライ</span>
            {tweetId && (
              <a
                href={`https://x.com/i/status/${tweetId}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-xs text-blue-400 hover:text-blue-600 hover:underline"
              >
                Xで見る ↗
              </a>
            )}
          </div>
        </div>
        <span className="text-gray-400 text-xs shrink-0">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-5 divide-y divide-gray-50">
          {group.replies.map((reply) => (
            <ReplyRow
              key={reply.id}
              reply={reply}
              xAccountId={xAccountId}
              onSuccess={onReplySuccess}
              actions={actionsMap[reply.id]}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function RepliesPage() {
  const selectedAccountId = useCurrentAccountId()

  const [mentions, setMentions] = useState<MentionReply[]>([])
  const [actionsMap, setActionsMap] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  const loadMentions = useCallback(async (accountId: string) => {
    if (!accountId) return
    setLoading(true)
    setError('')
    try {
      const res = await api.posts.mentions({ xAccountId: accountId })
      if (res.success) {
        setMentions(res.data)
        // Fetch persisted actions for all mention IDs
        const ids = res.data.map((m) => m.id)
        if (ids.length > 0) {
          try {
            const actionsRes = await api.posts.getActions(accountId, ids)
            if (actionsRes.success) setActionsMap(actionsRes.data)
          } catch { /* ignore actions fetch failure */ }
        }
      } else {
        setError(res.error ?? 'リプライの読み込みに失敗しました')
      }
    } catch {
      setError('リプライの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  const [fetched, setFetched] = useState(false)
  const handleManualFetch = () => {
    if (selectedAccountId) { setFetched(true); loadMentions(selectedAccountId) }
  }

  const handleReplySuccess = (id: string) => {
    setToast(`リプライを送信しました (ID: ${id.slice(-8)})`)
    setTimeout(() => setToast(''), 3000)
  }

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  // Group by inReplyToTweetId
  const grouped: ReplyGroup[] = Object.values(
    mentions.reduce<Record<string, ReplyGroup>>((acc, m) => {
      const key = m.inReplyToTweetId ?? '__unknown__'
      if (!acc[key]) acc[key] = { inReplyToTweetId: m.inReplyToTweetId, replies: [] }
      acc[key].replies.push(m)
      return acc
    }, {})
  )

  return (
    <div>
      <Header title="リプライ管理" description="受信リプライの確認と返信" />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-600 text-white text-sm px-4 py-3 rounded-lg shadow-lg transition-all">
          {toast}
        </div>
      )}

      {!fetched && !loading && (
        <div className="mb-4">
          <ApiCostGate onFetch={handleManualFetch} loading={loading} description="メンション・リプライを X API から検索します（$0.005 × 2回）" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 p-4 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Mentions grouped */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse space-y-3">
              <div className="h-3 bg-gray-200 rounded w-40" />
              <div className="h-3 bg-gray-100 rounded w-20" />
            </div>
          ))}
        </div>
      ) : !selectedAccountId ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-400 text-sm">アカウントを選択してください</p>
        </div>
      ) : grouped.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-400 text-sm">リプライがありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map((group) => (
            <GroupCard
              key={group.inReplyToTweetId ?? '__unknown__'}
              group={group}
              xAccountId={selectedAccountId}
              onReplySuccess={handleReplySuccess}
              actionsMap={actionsMap}
            />
          ))}
        </div>
      )}

    </div>
  )
}
