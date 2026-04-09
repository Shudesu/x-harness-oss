'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import type { DmConversation, DmMessage } from '@/lib/api'
import Header from '@/components/layout/header'
import ApiCostGate from '@/components/api-cost-gate'
import { useCurrentAccountId } from '@/hooks/use-selected-account'

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function truncate(text: string, len: number) {
  return text.length > len ? text.slice(0, len) + '…' : text
}

export default function MessagesPage() {
  // Account from sidebar
  const selectedAccountId = useCurrentAccountId()

  // Conversations
  const [conversations, setConversations] = useState<DmConversation[]>([])
  const [convsLoading, setConvsLoading] = useState(false)
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null)

  // Messages
  const [messages, setMessages] = useState<DmMessage[]>([])
  const [msgsLoading, setMsgsLoading] = useState(false)
  const [msgsCursor, setMsgsCursor] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)

  // Send
  const [sendText, setSendText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  // New DM modal
  const [newDmOpen, setNewDmOpen] = useState(false)
  const [newDmRecipient, setNewDmRecipient] = useState('')
  const [newDmText, setNewDmText] = useState('')
  const [newDmSending, setNewDmSending] = useState(false)
  const [newDmError, setNewDmError] = useState('')

  // Search & pagination
  const [searchQuery, setSearchQuery] = useState('')
  const VISIBLE_LIMIT = 20
  const [visibleCount, setVisibleCount] = useState(VISIBLE_LIMIT)

  // Mobile: 'list' | 'chat'
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list')

  // Toast
  const [toast, setToast] = useState('')

  const bottomRef = useRef<HTMLDivElement>(null)

  // Load conversations
  const loadConversations = useCallback(async (accountId: string) => {
    if (!accountId) return
    setConvsLoading(true)
    try {
      const res = await api.dm.conversations(accountId)
      if (res.success) setConversations(res.data)
    } catch {
      setConversations([])
    } finally {
      setConvsLoading(false)
    }
  }, [])

  // Load messages
  const loadMessages = useCallback(async (convId: string, accountId: string) => {
    if (!convId || !accountId) return
    setMsgsLoading(true)
    setMsgsCursor(null)
    try {
      const res = await api.dm.messages(convId, accountId)
      if (res.success) {
        setMessages(res.data.messages)
        setMsgsCursor(res.data.nextCursor ?? null)
      }
    } catch {
      setMessages([])
    } finally {
      setMsgsLoading(false)
    }
  }, [])

  // Load older messages
  const loadOlderMessages = useCallback(async () => {
    if (!selectedConvId || !selectedAccountId || !msgsCursor) return
    setLoadingOlder(true)
    try {
      const res = await api.dm.messages(selectedConvId, selectedAccountId, msgsCursor)
      if (res.success) {
        // Older messages come in reverse chronological, reversed by API to chronological
        // Prepend them before current messages
        setMessages((prev) => [...res.data.messages, ...prev])
        setMsgsCursor(res.data.nextCursor ?? null)
      }
    } catch {
      // silently fail
    } finally {
      setLoadingOlder(false)
    }
  }, [selectedConvId, selectedAccountId, msgsCursor])

  const [fetched, setFetched] = useState(false)
  const handleManualFetch = () => {
    if (selectedAccountId) {
      setFetched(true)
      setSelectedConvId(null)
      setMessages([])
      loadConversations(selectedAccountId)
    }
  }

  useEffect(() => {
    if (selectedConvId && selectedAccountId) {
      loadMessages(selectedConvId, selectedAccountId)
    }
  }, [selectedConvId, selectedAccountId, loadMessages])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSelectConv = (convId: string) => {
    setSelectedConvId(convId)
    setMobileView('chat')
    setSendText('')
    setSendError('')
    setMsgsCursor(null)
  }

  const handleSend = async () => {
    if (!sendText.trim() || !selectedConvId || !selectedAccountId) return
    const conv = conversations.find((c) => c.conversationId === selectedConvId)
    if (!conv) return
    setSending(true)
    setSendError('')
    try {
      const res = await api.dm.send({
        xAccountId: selectedAccountId,
        participantId: conv.participantId,
        text: sendText.trim(),
      })
      if (res.success) {
        setSendText('')
        setMessages((prev) => [...prev, res.data])
        loadConversations(selectedAccountId)
      } else {
        setSendError('送信に失敗しました')
      }
    } catch {
      setSendError('送信に失敗しました')
    } finally {
      setSending(false)
    }
  }

  const handleNewDmSend = async () => {
    if (!newDmRecipient.trim() || !newDmText.trim() || !selectedAccountId) return
    setNewDmSending(true)
    setNewDmError('')
    try {
      let participantId = newDmRecipient.trim()
      // If input looks like a @username, resolve to numeric ID first
      if (participantId.startsWith('@') || !/^\d+$/.test(participantId)) {
        const username = participantId.replace(/^@/, '')
        const lookupRes = await api.users.lookup(username)
        if (!lookupRes.success || !lookupRes.data?.id) {
          setNewDmError(`ユーザー @${username} が見つかりません`)
          setNewDmSending(false)
          return
        }
        participantId = lookupRes.data.id
      }
      const res = await api.dm.send({
        xAccountId: selectedAccountId,
        participantId,
        text: newDmText.trim(),
      })
      if (res.success) {
        setNewDmOpen(false)
        setNewDmRecipient('')
        setNewDmText('')
        setToast('DMを送信しました')
        setTimeout(() => setToast(''), 3000)
        loadConversations(selectedAccountId)
      } else {
        setNewDmError('送信に失敗しました')
      }
    } catch {
      setNewDmError('送信に失敗しました')
    } finally {
      setNewDmSending(false)
    }
  }

  const selectedConv = conversations.find((c) => c.conversationId === selectedConvId)

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 64px)', overflow: 'hidden' }}>
      <Header title="DM管理" description="ダイレクトメッセージの送受信" />

      {!fetched && !convsLoading && (
        <div className="mb-3">
          <ApiCostGate onFetch={handleManualFetch} loading={convsLoading} description="DM 会話一覧を X API から取得します（$0.005/回）" />
        </div>
      )}

      {/* E2E notice */}
      {fetched && (
        <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-700">
          暗号化された会話（E2E暗号化DM）はX APIから取得できません。通常のDMのみ表示されます。
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-600 text-white text-sm px-4 py-3 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {/* New DM modal */}
      {newDmOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">新規DM送信</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">宛先 (userId または @username)</label>
                <input
                  type="text"
                  value={newDmRecipient}
                  onChange={(e) => setNewDmRecipient(e.target.value)}
                  placeholder="例: 1234567890"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">メッセージ</label>
                <textarea
                  value={newDmText}
                  onChange={(e) => setNewDmText(e.target.value)}
                  placeholder="メッセージを入力..."
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              {newDmError && <p className="text-xs text-red-600">{newDmError}</p>}
              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={() => { setNewDmOpen(false); setNewDmRecipient(''); setNewDmText(''); setNewDmError('') }}
                  className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleNewDmSend}
                  disabled={newDmSending || !newDmRecipient.trim() || !newDmText.trim()}
                  className="text-sm bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-50 transition-colors"
                >
                  {newDmSending ? '送信中...' : '送信'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2-pane layout */}
      <div className="flex flex-1 gap-4 min-h-0 overflow-hidden">

        {/* Left pane: conversation list */}
        <div className={`
          bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col
          w-full md:w-80 md:flex-shrink-0
          ${mobileView === 'chat' ? 'hidden md:flex' : 'flex'}
        `}>
          {/* Left pane header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-800">会話一覧</span>
            <button
              onClick={() => setNewDmOpen(true)}
              disabled={!selectedAccountId}
              className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-40 transition-colors"
            >
              新規DM
            </button>
          </div>

          {/* Search */}
          {conversations.length > 0 && (
            <div className="px-3 py-2 border-b border-gray-100">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(VISIBLE_LIMIT) }}
                placeholder="名前で検索..."
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-gray-50"
              />
            </div>
          )}

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
            {convsLoading ? (
              <div className="space-y-0 divide-y divide-gray-50">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="px-4 py-3 animate-pulse">
                    <div className="h-3 bg-gray-200 rounded w-32 mb-2" />
                    <div className="h-3 bg-gray-100 rounded w-48" />
                  </div>
                ))}
              </div>
            ) : !selectedAccountId ? (
              <div className="flex items-center justify-center h-32">
                <p className="text-xs text-gray-400">アカウントを選択してください</p>
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <p className="text-xs text-gray-400">会話がありません</p>
              </div>
            ) : (
              (() => {
                const filtered = conversations.filter((conv) => {
                  if (!searchQuery) return true
                  const q = searchQuery.toLowerCase()
                  return (conv.participantDisplayName?.toLowerCase().includes(q)) ||
                    (conv.participantUsername?.toLowerCase().includes(q)) ||
                    (conv.lastMessage?.toLowerCase().includes(q))
                })
                const visible = filtered.slice(0, visibleCount)
                return (
                  <>
                    {visible.map((conv) => (
                <button
                  key={conv.conversationId}
                  onClick={() => handleSelectConv(conv.conversationId)}
                  className={`
                    w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center gap-3
                    ${selectedConvId === conv.conversationId ? 'bg-blue-50 border-l-2 border-blue-500' : ''}
                  `}
                >
                  {conv.participantProfileImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={conv.participantProfileImageUrl}
                      alt={conv.participantUsername ?? ''}
                      className="w-10 h-10 rounded-full shrink-0 bg-gray-100"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full shrink-0 bg-gray-200 flex items-center justify-center text-gray-400 text-sm font-bold">
                      {(conv.participantDisplayName ?? conv.participantUsername ?? '?')[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {conv.participantDisplayName ?? conv.participantUsername ?? conv.participantId}
                      </span>
                      <span className="text-xs text-gray-400 shrink-0 ml-2">
                        {formatTime(conv.lastMessageAt)}
                      </span>
                    </div>
                    {conv.participantUsername && conv.participantDisplayName && (
                      <p className="text-xs text-gray-400 mb-0.5">@{conv.participantUsername}</p>
                    )}
                    <p className="text-xs text-gray-500 truncate">
                      {truncate(conv.lastMessage, 30)}
                    </p>
                  </div>
                </button>
                    ))}
                    {filtered.length > visibleCount && (
                      <button
                        onClick={() => setVisibleCount((v) => v + VISIBLE_LIMIT)}
                        className="w-full py-3 text-xs text-blue-500 hover:text-blue-700 font-medium hover:bg-gray-50 transition-colors"
                      >
                        さらに表示（残り{filtered.length - visibleCount}件）
                      </button>
                    )}
                    {filtered.length === 0 && searchQuery && (
                      <div className="flex items-center justify-center h-20">
                        <p className="text-xs text-gray-400">「{searchQuery}」に一致する会話がありません</p>
                      </div>
                    )}
                  </>
                )
              })()
            )}
          </div>
        </div>

        {/* Right pane: messages */}
        <div className={`
          bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col flex-1 min-w-0
          ${mobileView === 'list' ? 'hidden md:flex' : 'flex'}
        `}>
          {/* Right pane header */}
          {selectedConv && (
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
              {/* Mobile back button */}
              <button
                onClick={() => setMobileView('list')}
                className="md:hidden text-blue-500 text-sm font-medium mr-1"
              >
                ← 戻る
              </button>
              {selectedConv.participantProfileImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selectedConv.participantProfileImageUrl} alt="" className="w-7 h-7 rounded-full bg-gray-100" />
              )}
              <span className="text-sm font-semibold text-gray-800">
                {selectedConv.participantDisplayName ?? selectedConv.participantUsername ?? selectedConv.participantId}
              </span>
              {selectedConv.participantUsername && (
                <span className="text-xs text-gray-400">@{selectedConv.participantUsername}</span>
              )}
            </div>
          )}

          {/* Message area */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {!selectedConvId ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-gray-400">会話を選択してください</p>
              </div>
            ) : msgsLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                    <div className="h-10 bg-gray-100 rounded-2xl animate-pulse w-48" />
                  </div>
                ))}
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-gray-400">メッセージがありません</p>
              </div>
            ) : (
              <>
              {msgsCursor && (
                <div className="text-center py-2">
                  <button
                    onClick={loadOlderMessages}
                    disabled={loadingOlder}
                    className="text-xs text-blue-500 hover:text-blue-700 font-medium disabled:opacity-50"
                  >
                    {loadingOlder ? '読み込み中...' : '過去のメッセージを読み込む'}
                  </button>
                </div>
              )}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.isMe ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`
                    max-w-[75%] px-4 py-2.5 rounded-2xl text-sm
                    ${msg.isMe
                      ? 'bg-blue-500 text-white rounded-br-sm'
                      : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                    }
                  `}>
                    <p className="break-words">{msg.text}</p>
                    <p className={`text-xs mt-1 ${msg.isMe ? 'text-blue-100' : 'text-gray-400'}`}>
                      {formatTime(msg.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
              </>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Send bar */}
          {selectedConvId && (
            <div className="border-t border-gray-100 px-4 py-3">
              {sendError && <p className="text-xs text-red-600 mb-2">{sendError}</p>}
              <div className="flex items-end gap-2">
                <textarea
                  value={sendText}
                  onChange={(e) => setSendText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder="メッセージを入力... (Enter で送信)"
                  rows={1}
                  className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  style={{ maxHeight: '120px', overflowY: 'auto' }}
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !sendText.trim()}
                  className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50 transition-colors shrink-0"
                >
                  {sending ? '...' : '送信'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
