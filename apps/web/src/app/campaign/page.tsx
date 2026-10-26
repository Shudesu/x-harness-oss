'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { api, API_URL, fetchApi, getApiKey } from '@/lib/api'
import type { XAccount } from '@/lib/api'
import Header from '@/components/layout/header'
import { useCurrentAccountId } from '@/hooks/use-selected-account'

// ─── 定数 ───

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const ALLOWED_VIDEO_TYPES = ['video/mp4']
const MAX_IMAGES = 4

type Step = 1 | 2 | 3 | 4

interface MediaFile {
  file: File
  previewUrl: string
  type: 'image' | 'video'
}

// ─── テンプレート ───

const TEMPLATES = [
  {
    label: 'いいね+リプ+リポスト',
    text: '🎁 特典プレゼント！\n\n① このポストにいいね\n② リプライ\n③ リポスト\n\n3つ全部やったら👇のリンクから特典GET！\n{link}',
  },
  {
    label: 'フォロー+いいね',
    text: '🎁 フォロー＆いいねで特典GET！\n\n① このアカウントをフォロー\n② このポストにいいね\n\n👇 LINE登録で受け取り\n{link}',
  },
  {
    label: 'リプライのみ',
    text: '💬 リプライで特典プレゼント！\n\nこのポストにリプライするだけで\n特典をお届けします🎁\n\n👇 受け取りはこちら\n{link}',
  },
]

// ─── 文字カウンター ───

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

// ─── ステップインジケーター ───

function StepIndicator({ current }: { current: Step }) {
  const steps = [
    { n: 1 as Step, label: '投稿内容' },
    { n: 2 as Step, label: '条件設定' },
    { n: 3 as Step, label: 'LINE連携' },
    { n: 4 as Step, label: 'プレビュー' },
  ]
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center flex-1">
          <div className="flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                s.n < current
                  ? 'bg-green-500 text-white'
                  : s.n === current
                  ? 'text-white'
                  : 'bg-gray-200 text-gray-500'
              }`}
              style={s.n === current ? { backgroundColor: '#1D9BF0' } : {}}
            >
              {s.n < current ? '✓' : s.n}
            </div>
            <p className={`text-xs mt-1 font-medium ${s.n === current ? 'text-blue-600' : s.n < current ? 'text-green-600' : 'text-gray-400'}`}>
              {s.label}
            </p>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-0.5 mx-2 mb-5 ${s.n < current ? 'bg-green-400' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── 成功画面 ───

interface SuccessResult {
  tweetId: string
  tweetUrl: string
  gateId: string
  campaignLink: string
}

function SuccessScreen({ result, onReset }: { result: SuccessResult; onReset: () => void }) {
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedTweet, setCopiedTweet] = useState(false)

  const copyLink = async () => {
    await navigator.clipboard.writeText(result.campaignLink)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2000)
  }

  const copyTweet = async () => {
    await navigator.clipboard.writeText(result.tweetUrl)
    setCopiedTweet(true)
    setTimeout(() => setCopiedTweet(false), 2000)
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">キャンペーン作成完了</h2>
        <p className="text-sm text-gray-500">投稿とエンゲージメントゲートを設定しました</p>
      </div>

      <div className="space-y-4">
        {/* ツイートリンク */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">投稿リンク</p>
          <div className="flex items-center justify-between gap-2">
            <a
              href={result.tweetUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-blue-600 hover:underline font-mono truncate"
            >
              {result.tweetUrl}
            </a>
            <button
              onClick={copyTweet}
              className="shrink-0 px-2.5 py-1 text-xs font-medium text-white rounded-md hover:opacity-90 transition-opacity"
              style={{ backgroundColor: '#1D9BF0' }}
            >
              {copiedTweet ? '済み' : 'コピー'}
            </button>
          </div>
        </div>

        {/* ゲートID */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">ゲートID</p>
          <p className="text-sm font-mono text-gray-700">{result.gateId}</p>
        </div>

        {/* キャンペーンリンク */}
        {result.campaignLink && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-2">キャンペーンリンク</p>
            <div className="bg-white border border-blue-200 rounded-md p-3 mb-3">
              <p className="text-xs font-mono text-gray-700 break-all">{result.campaignLink}</p>
            </div>
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-gray-500">
                別の投稿にキャンペーンリンクを貼る場合はこちらをコピー
              </p>
              <button
                onClick={copyLink}
                className="shrink-0 px-3 py-1.5 text-xs font-medium text-white rounded-md hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#1D9BF0' }}
              >
                {copiedLink ? 'コピー済み' : 'コピー'}
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <a
            href={result.tweetUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#1D9BF0' }}
          >
            Xで確認
          </a>
          <button
            onClick={onReset}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            新しいキャンペーンを作成
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── メインページ ───

export default function CampaignPage() {
  const [step, setStep] = useState<Step>(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<SuccessResult | null>(null)

  // アカウント (sidebar selection)
  const selectedAccountId = useCurrentAccountId()
  const [accounts, setAccounts] = useState<XAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [charLimit, setCharLimit] = useState(280)
  const [subscriptionType, setSubscriptionType] = useState('')

  // Step 1: 投稿内容 — accountId is derived from sidebar
  const accountId = selectedAccountId
  const [text, setText] = useState('')
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Step 2: 条件設定
  const [requireLike, setRequireLike] = useState(false)
  const [requireRepost, setRequireRepost] = useState(false)
  const [requireFollow, setRequireFollow] = useState(false)
  const [replyKeyword, setReplyKeyword] = useState('')

  // Step 3: LINE連携
  const [lineConnections, setLineConnections] = useState<Array<{ id: string; name: string; worker_url: string }>>([])
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [lineUrl, setLineUrl] = useState('')
  const [lineApiKey, setLineApiKey] = useState('')
  const [lineLoading, setLineLoading] = useState(false)
  const lineEnabled = !!selectedConnectionId
  const lineConfigured = lineUrl.trim().length > 0 && lineApiKey.trim().length > 0
  const [rewardTemplates, setRewardTemplates] = useState<Array<{ id: string; name: string; messageType: string; messageContent: string }>>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [selectedIntroTemplateId, setSelectedIntroTemplateId] = useState('')
  const [templateLoading, setTemplateLoading] = useState(false)
  const [pools, setPools] = useState<Array<{ id: string; slug: string; name: string }>>([])
  const [selectedPoolSlug, setSelectedPoolSlug] = useState('')
  const [poolsLoading, setPoolsLoading] = useState(false)
  const [lineForms, setLineForms] = useState<Array<{ id: string; name: string }>>([])
  const [selectedFormId, setSelectedFormId] = useState('')
  const [formsLoading, setFormsLoading] = useState(false)

  // Load LINE connections from DB + resolve selected connection's credentials
  const loadLineConfig = useCallback(async () => {
    setLineLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: Array<{ id: string; name: string; worker_url: string }> }>('/api/line-connections')
      if (res.success) {
        setLineConnections(res.data)
        // Auto-select first if only one
        if (res.data.length === 1 && !selectedConnectionId) setSelectedConnectionId(res.data[0].id)
      }
    } catch { /* silent */ }
    finally { setLineLoading(false) }
  }, [])

  // Resolve credentials when connection is selected
  useEffect(() => {
    if (!selectedConnectionId) {
      setLineUrl('')
      setLineApiKey('')
      return
    }
    const resolve = async () => {
      try {
        const res = await fetchApi<{ success: boolean; data: { worker_url: string; hasApiKey: boolean } }>(`/api/line-connections/${selectedConnectionId}`)
        if (res.success) {
          setLineUrl(res.data.worker_url)
          setLineApiKey(res.data.hasApiKey ? 'configured' : '')
        }
      } catch { /* silent */ }
    }
    resolve()
  }, [selectedConnectionId])

  const loadSubscription = useCallback(async (id: string) => {
    if (!id) return
    try {
      const res = await api.accounts.subscription(id)
      if (res.success) {
        setCharLimit(res.data.charLimit)
        setSubscriptionType(res.data.subscriptionType)
      }
    } catch {
      setCharLimit(280)
      setSubscriptionType('')
    }
  }, [])

  useEffect(() => {
    const load = async () => {
      setAccountsLoading(true)
      try {
        const res = await api.accounts.list()
        if (res.success) {
          setAccounts(res.data)
        }
      } catch {
        // silently fail
      } finally {
        setAccountsLoading(false)
      }
    }
    load()
    loadLineConfig()
  }, [loadLineConfig])

  useEffect(() => {
    if (selectedAccountId) loadSubscription(selectedAccountId)
  }, [selectedAccountId, loadSubscription])

  useEffect(() => {
    if (!lineEnabled || !lineConfigured) {
      setRewardTemplates([])
      setSelectedTemplateId('')
      setSelectedIntroTemplateId('')
      return
    }
    // 接続が変わった瞬間に stale な選択 ID を即座にクリアする。
    // フェッチ完了を待つと、その間に submit された場合に古い接続のテンプレ ID が
    // 新しい接続の API へ送られる race condition が発生する。
    setRewardTemplates([])
    setSelectedTemplateId('')
    setSelectedIntroTemplateId('')
    let cancelled = false
    const controller = new AbortController()
    const lhUrl = lineUrl.replace(/\/$/, '')
    const lhKey = sessionStorage.getItem('xh_session') || ''
    setTemplateLoading(true)
    fetch(`${API_URL}/api/line-connections/${selectedConnectionId}/proxy/message-templates`, {
      headers: { Authorization: `Bearer ${lhKey}` },
      signal: controller.signal,
    })
      .then(r => r.json())
      .then((json: { success: boolean; data?: Array<{ id: string; name: string; messageType: string; messageContent: string }> }) => {
        if (cancelled) return
        const list = json.data ?? []
        setRewardTemplates(list)
      })
      .catch((err) => {
        if (!cancelled && err.name !== 'AbortError') {
          setRewardTemplates([])
          setSelectedTemplateId('')
          setSelectedIntroTemplateId('')
        }
      })
      .finally(() => { if (!cancelled) setTemplateLoading(false) })
    return () => { cancelled = true; controller.abort() }
  }, [lineEnabled, lineUrl, lineApiKey, lineConfigured])

  useEffect(() => {
    if (!lineEnabled || !lineConfigured) {
      setPools([])
      setSelectedPoolSlug('')
      return
    }
    let cancelled = false
    const controller = new AbortController()
    const lhUrl = lineUrl.replace(/\/$/, '')
    const lhKey = sessionStorage.getItem('xh_session') || ''
    setPoolsLoading(true)
    fetch(`${API_URL}/api/line-connections/${selectedConnectionId}/proxy/traffic-pools`, {
      headers: { Authorization: `Bearer ${lhKey}` },
      signal: controller.signal,
    })
      .then(r => r.json())
      .then((json: { success: boolean; data?: Array<{ id: string; slug: string; name: string }> }) => {
        if (!cancelled) {
          const poolList = json.data ?? []
          setPools(poolList)
          // Auto-select main on first load; preserve existing valid selections
          setSelectedPoolSlug(prev => {
            if (prev && poolList.find(p => p.slug === prev)) return prev
            const mainPool = poolList.find(p => p.slug === 'main')
            return mainPool ? mainPool.slug : ''
          })
        }
      })
      .catch((err) => { if (!cancelled && err.name !== 'AbortError') setPools([]) })
      .finally(() => { if (!cancelled) setPoolsLoading(false) })
    return () => { cancelled = true; controller.abort() }
  }, [lineEnabled, lineUrl, lineApiKey, lineConfigured])

  // Fetch LINE Harness forms
  useEffect(() => {
    if (!lineEnabled || !lineConfigured) {
      setLineForms([])
      setSelectedFormId('')
      return
    }
    let cancelled = false
    const controller = new AbortController()
    const lhUrl = lineUrl.replace(/\/$/, '')
    const lhKey = sessionStorage.getItem('xh_session') || ''
    setFormsLoading(true)
    fetch(`${API_URL}/api/line-connections/${selectedConnectionId}/proxy/forms`, {
      headers: { Authorization: `Bearer ${lhKey}` },
      signal: controller.signal,
    })
      .then(r => r.json())
      .then((json: { success: boolean; data?: { items?: Array<{ id: string; name: string }> } }) => {
        if (!cancelled) setLineForms(Array.isArray(json.data) ? json.data : json.data?.items ?? [])
      })
      .catch((err) => { if (!cancelled && err.name !== 'AbortError') setLineForms([]) })
      .finally(() => { if (!cancelled) setFormsLoading(false) })
    return () => { cancelled = true; controller.abort() }
  }, [lineEnabled, lineUrl, lineApiKey, lineConfigured])

  // メディア処理
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

      if (isVideo) {
        mediaFiles.forEach((m) => URL.revokeObjectURL(m.previewUrl))
        setMediaFiles([{ file, previewUrl: URL.createObjectURL(file), type: 'video' }])
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }

      newMedia.push({ file, previewUrl: URL.createObjectURL(file), type: 'image' })
    }

    setMediaFiles((prev) => {
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

  const canAddMedia =
    mediaFiles.length === 0 ||
    (mediaFiles[0]?.type === 'image' && mediaFiles.length < MAX_IMAGES)

  // バリデーション
  const step1Valid = !!accountId && text.trim().length > 0 && text.length <= charLimit

  // ─── 送信 ───

  const handleSubmit = async () => {
    if (!step1Valid) return
    setSubmitting(true)
    setError('')

    try {
      // 1. メディアアップロード
      let mediaIds: string[] = []
      if (mediaFiles.length > 0) {
        setUploading(true)
        for (const m of mediaFiles) {
          const res = await api.media.upload(m.file, accountId)
          if (res.success) mediaIds.push(res.data.mediaId)
        }
        setUploading(false)
      }

      // 2. LINE連携フロー（ブラウザ → LINE Harness API直接）
      //    CF Workers 同一アカウント間 fetch が 404 になるため、ブラウザ経由
      //    順序: ゲート作成(API) → LINE フォーム作成(ブラウザ) → リンク生成 → ツイート投稿(API)
      let campaignLink = ''
      const xWorkerUrl = API_URL

      if (lineEnabled && lineConfigured) {
        // a. ゲートだけ先に作成（inactive、仮postId）
        const prepRes = await fetch(`${xWorkerUrl}/api/engagement-gates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('xh_session')}` },
          body: JSON.stringify({
            xAccountId: accountId,
            postId: `pending-${Date.now()}`,
            triggerType: 'repost',
            actionType: 'verify_only',
            template: '',
            pollingStrategy: 'manual',
            requireLike,
            requireRepost,
            requireFollow,
            replyKeyword: replyKeyword.trim() || undefined,
          }),
        })
        const prepJson = await prepRes.json() as { success: boolean; data: { id: string } }
        if (!prepJson.success) { setError('ゲート作成に失敗しました'); setSubmitting(false); return }
        const gateId = prepJson.data.id

        // ゲートを無効化
        await api.engagementGates.update(gateId, { isActive: false } as Record<string, unknown>)

        try {
          const lhUrl = lineUrl.replace(/\/$/, '')
          const lhHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('xh_session') || ''}` }

          // b. LINE Harness でタグ作成（直接呼び出し）
          const tagRes = await fetch(`${API_URL}/api/line-connections/${selectedConnectionId}/proxy/tags`, {
            method: 'POST', headers: lhHeaders,
            body: JSON.stringify({ name: `x-gate-${gateId.slice(0, 8)}` }),
          })
          const tagJson = await tagRes.json() as { success: boolean; data: { id: string } }
          const lineTagId = tagJson.data?.id || ''

          // c. フォーム: 既存選択 or 自動生成
          let formId = selectedFormId
          if (!formId) {
            // 自動生成
            const formRes = await fetch(`${API_URL}/api/line-connections/${selectedConnectionId}/proxy/forms`, {
              method: 'POST', headers: lhHeaders,
              body: JSON.stringify({
                name: `${new Date().toISOString().slice(0, 10)} ${text.slice(0, 20).replace(/\n/g, ' ')}...`,
                fields: [{ name: 'x_username', label: 'X ID（@なし）', type: 'text', required: true }],
                onSubmitTagId: lineTagId,
                onSubmitWebhookUrl: `${xWorkerUrl}/api/engagement-gates/${gateId}/verify?username={x_username}`,
                saveToMetadata: true,
                ...((() => {
                  const t = rewardTemplates.find(r => r.id === selectedTemplateId)
                  return t ? { onSubmitMessageType: t.messageType, onSubmitMessageContent: t.messageContent } : {}
                })()),
              }),
            })
            const formJson = await formRes.json() as { success: boolean; data: { id: string } }
            formId = formJson.data?.id || ''
          }

          // c'. tracked_link 作成（intro/reward template_id を渡すことで line-harness 側で解決できる）
          // 失敗してもキャンペーン作成自体は止めず、ランダム ref にフォールバックする
          // （古い LINE Harness で /api/tracked-links が無い、ネットワークエラー、非 JSON レスポンス等のケースに備える）
          let ref = `campaign-${Date.now().toString(36)}`
          try {
            const trackedLinkRes = await fetch(`${API_URL}/api/line-connections/${selectedConnectionId}/proxy/tracked-links`, {
              method: 'POST',
              headers: lhHeaders,
              body: JSON.stringify({
                name: `${new Date().toISOString().slice(0, 10)} X Campaign`,
                originalUrl: `${lhUrl}/auth/line`,
                introTemplateId: selectedIntroTemplateId || null,
                rewardTemplateId: selectedTemplateId || null,
              }),
            })
            const trackedLinkJson = await trackedLinkRes.json() as { success: boolean; data: { id: string } }
            if (trackedLinkJson.success && trackedLinkJson.data?.id) {
              ref = trackedLinkJson.data.id
            } else {
              console.warn('tracked_link 作成失敗、ランダム ref にフォールバック', trackedLinkJson)
            }
          } catch (err) {
            console.warn('tracked_link API 呼び出しエラー、ランダム ref にフォールバック', err)
          }

          const linkParams = new URLSearchParams()
          linkParams.set('form', formId)
          linkParams.set('gate', gateId)
          linkParams.set('xh', xWorkerUrl)
          if (selectedPoolSlug) linkParams.set('pool', selectedPoolSlug)
          campaignLink = `${lhUrl}/r/${ref}?${linkParams.toString()}`

          // d. ゲートにLINE metadata更新
          await api.engagementGates.update(gateId, {
            lineHarnessUrl: lhUrl,
            lineHarnessTag: lineTagId,
          } as Record<string, unknown>)
        } catch {
          // LINE連携失敗 — ゲートは作ったがリンクなし
        }

        // e. {link} 置換してツイート投稿（リンクなしなら {link} プレースホルダーを除去）
        const finalText = campaignLink ? text.trim().replace(/\{link\}/g, campaignLink) : text.trim().replace(/\{link\}/g, '').replace(/\n{2,}/g, '\n').trim()
        const tweetRes = await api.posts.create({
          xAccountId: accountId,
          text: finalText,
          ...(mediaIds.length > 0 ? { mediaIds } : {}),
        })

        if (!tweetRes.success) {
          // ツイート失敗 → ゲート削除
          await api.engagementGates.delete(gateId).catch(() => {})
          setError('ツイート投稿に失敗しました')
          setSubmitting(false)
          return
        }

        const tweetId = (tweetRes.data as unknown as Record<string, unknown>).id as string
        const tweetUrl = `https://x.com/${accounts.find(a => a.id === accountId)?.username}/status/${tweetId}`

        // f. ゲートに実postId設定 + 有効化 + キャンペーンリンク保存
        await api.engagementGates.update(gateId, {
          postId: tweetId,
          isActive: true,
          ...(campaignLink ? { link: campaignLink } : {}),
        } as Record<string, unknown>)

        setResult({ tweetId, tweetUrl, gateId, campaignLink })
      } else {
        // LINE連携なし
        const campaignRes = await api.campaigns.create({
          xAccountId: accountId,
          text: text.trim(),
          ...(mediaIds.length > 0 ? { mediaIds } : {}),
          requireLike,
          requireRepost,
          requireFollow,
          replyKeyword: replyKeyword.trim() || null,
        })
        if (!campaignRes.success) { setError('キャンペーン作成に失敗しました'); setSubmitting(false); return }
        setResult({ ...campaignRes.data, campaignLink: '' })
      }
    } catch (err: any) {
      setError(err?.message || '作成中にエラーが発生しました')
    } finally {
      setSubmitting(false)
      setUploading(false)
    }
  }

  const handleReset = () => {
    setResult(null)
    setStep(1)
    setText('')
    setMediaFiles([])
    setRequireLike(false)
    setRequireRepost(false)
    setRequireFollow(false)
    setReplyKeyword('')
    setSelectedConnectionId('')
    setSelectedIntroTemplateId('')
    setError('')
  }

  // ─── レンダリング ───

  if (result) {
    return (
      <div>
        <Header title="キャンペーン作成" description="投稿・条件・LINE連携をまとめて設定" />
        <SuccessScreen result={result} onReset={handleReset} />
      </div>
    )
  }

  return (
    <div>
      <Header title="キャンペーン作成" description="投稿・条件・LINE連携をまとめて設定" />

      <div className="max-w-lg">
        <StepIndicator current={step} />

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* ─── Step 1: 投稿内容 ─── */}
        {step === 1 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-5">
            <h2 className="text-sm font-semibold text-gray-800">投稿内容</h2>

            {/* Xアカウント (sidebar selection) */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Xアカウント
              </label>
              {accountsLoading ? (
                <div className="h-9 bg-gray-100 rounded-lg animate-pulse" />
              ) : (
                <p className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700">
                  @{accounts.find((a) => a.id === accountId)?.username || '---'}
                  <span className="text-xs text-gray-400 ml-2">(サイドバーで変更)</span>
                </p>
              )}
            </div>

            {/* テキスト入力 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-gray-600">
                  テキスト <span className="text-red-500">*</span>
                </label>
                {subscriptionType && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                    {subscriptionType}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                <span className="text-xs text-gray-400 self-center">テンプレート:</span>
                {TEMPLATES.map((t, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setText(t.text)}
                    className="text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-full transition-colors"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"🎁 特典プレゼント！\n\nいいね＋リプ＋リポストして\nLINE登録で特典GET！\n\n👇 {link}"}
                rows={5}
                maxLength={charLimit}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    const el = document.querySelector('textarea') as HTMLTextAreaElement | null
                    if (el) {
                      const start = el.selectionStart
                      const end = el.selectionEnd
                      const newText = text.slice(0, start) + '{link}' + text.slice(end)
                      setText(newText)
                      setTimeout(() => { el.selectionStart = el.selectionEnd = start + 6; el.focus() }, 0)
                    } else {
                      setText(text + '{link}')
                    }
                  }}
                  className="text-xs text-blue-500 hover:text-blue-700 bg-blue-50 px-2 py-1 rounded"
                >
                  + {'{link}'} を挿入
                </button>
                <CharCounter length={text.length} limit={charLimit} />
              </div>
            </div>

            {/* メディア添付 */}
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
                  <span className="text-xs text-gray-400">({mediaFiles.length}/{MAX_IMAGES})</span>
                </button>
              )}

              {mediaFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {mediaFiles.map((m, idx) => (
                    <div key={idx} className="relative group">
                      {m.type === 'image' ? (
                        <img src={m.previewUrl} alt="" className="w-20 h-20 object-cover rounded-lg border border-gray-200" />
                      ) : (
                        <video src={m.previewUrl} className="w-20 h-20 object-cover rounded-lg border border-gray-200" />
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
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setStep(2)}
                disabled={!step1Valid}
                className="px-6 py-2.5 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#1D9BF0' }}
              >
                次へ →
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 2: 条件設定 ─── */}
        {step === 2 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-5">
            <h2 className="text-sm font-semibold text-gray-800">条件設定</h2>
            <p className="text-xs text-gray-500">リポストに加えて追加で必須にするエンゲージメントを設定します</p>

            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-lg border border-blue-200 bg-blue-50">
                <input
                  type="checkbox"
                  checked={true}
                  disabled
                  className="rounded border-gray-300 w-4 h-4"
                />
                <div>
                  <p className="text-sm font-medium text-gray-800">リポスト必須</p>
                  <p className="text-xs text-gray-400">投稿のリポストは常に必須です（スパムフィルタの影響を受けません）</p>
                </div>
              </div>

              <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={requireLike}
                  onChange={(e) => setRequireLike(e.target.checked)}
                  className="rounded border-gray-300 w-4 h-4"
                />
                <div>
                  <p className="text-sm font-medium text-gray-800">いいね必須</p>
                  <p className="text-xs text-gray-400">投稿にいいねしていることを確認</p>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={requireFollow}
                  onChange={(e) => setRequireFollow(e.target.checked)}
                  className="rounded border-gray-300 w-4 h-4"
                />
                <div>
                  <p className="text-sm font-medium text-gray-800">フォロー必須</p>
                  <p className="text-xs text-gray-400">アカウントをフォローしていることを確認</p>
                </div>
              </label>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                ← 戻る
              </button>
              <button
                onClick={() => setStep(3)}
                className="px-6 py-2.5 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#1D9BF0' }}
              >
                次へ →
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 3: LINE連携 ─── */}
        {step === 3 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-5">
            <h2 className="text-sm font-semibold text-gray-800">LINE Harness 連携</h2>

            {/* 接続先選択 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">接続先</label>
              {lineLoading ? (
                <p className="text-xs text-gray-400">読み込み中...</p>
              ) : lineConnections.length === 0 ? (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <p className="text-xs text-yellow-700">接続先が未登録です。<a href="/settings" className="underline font-medium">設定ページ</a>で追加してください。</p>
                </div>
              ) : (
                <select
                  value={selectedConnectionId}
                  onChange={(e) => setSelectedConnectionId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">LINE連携なし</option>
                  {lineConnections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}（{c.worker_url}）
                    </option>
                  ))}
                </select>
              )}
            </div>

            {lineEnabled && lineConfigured && (
              <div className="space-y-3">
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-xs text-green-700">✅ {lineConnections.find(c => c.id === selectedConnectionId)?.name} に接続中</p>
                </div>

                {/* Pool 選択 */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Traffic Pool（アカウント分散）</label>
                  {poolsLoading ? (
                    <p className="text-xs text-gray-400">Pool 読み込み中...</p>
                  ) : pools.length === 0 ? (
                    <p className="text-xs text-gray-400">Pool が未登録です</p>
                  ) : (
                    <select
                      value={selectedPoolSlug}
                      onChange={(e) => setSelectedPoolSlug(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Pool なし（デフォルトアカウント）</option>
                      {pools.map((p) => (
                        <option key={p.id} value={p.slug}>{p.name}（{p.slug}）</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* フォーム選択 */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">受け取りフォーム</label>
                  {formsLoading ? (
                    <p className="text-xs text-gray-400">フォーム読み込み中...</p>
                  ) : lineForms.length === 0 ? (
                    <p className="text-xs text-gray-400">フォームが未登録です</p>
                  ) : (
                    <select
                      value={selectedFormId}
                      onChange={(e) => setSelectedFormId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">自動生成（X ID入力のみ）</option>
                      {lineForms.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* 流入時メッセージ（任意） */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    流入時メッセージ（任意）
                  </label>
                  <p className="text-[10px] text-gray-400 mb-1">
                    友だち追加直後に届く push メッセージ。テンプレ内ボタン URL に <code>{`{formUrl}`}</code> を入れると送信時に実フォーム URL に置換されます。
                  </p>
                  {templateLoading ? (
                    <p className="text-xs text-gray-400">テンプレート読み込み中...</p>
                  ) : rewardTemplates.length === 0 ? (
                    <p className="text-xs text-gray-400">テンプレートが未登録です</p>
                  ) : (
                    <select
                      value={selectedIntroTemplateId}
                      onChange={(e) => setSelectedIntroTemplateId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">デフォルト（既定の Flex メッセージ）</option>
                      {rewardTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}（{t.messageType}）
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* 特典メッセージ */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">特典メッセージ（任意）</label>
                  {templateLoading ? (
                    <p className="text-xs text-gray-400">テンプレート読み込み中...</p>
                  ) : rewardTemplates.length === 0 ? (
                    <p className="text-xs text-gray-400">テンプレートが未登録です</p>
                  ) : (
                    <select
                      value={selectedTemplateId}
                      onChange={(e) => setSelectedTemplateId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">なし（デフォルト診断結果のみ）</option>
                      {rewardTemplates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}（{t.messageType}）</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                ← 戻る
              </button>
              <button
                onClick={() => setStep(4)}
                className="px-6 py-2.5 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#1D9BF0' }}
              >
                プレビュー →
              </button>
            </div>
          </div>
        )}

        {/* ─── Step 4: プレビュー ─── */}
        {step === 4 && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">投稿プレビュー</h3>
              <div className="bg-gray-900 text-white rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center text-xs">@</div>
                  <div>
                    <p className="text-sm font-bold">{accounts.find(a => a.id === accountId)?.displayName || accounts.find(a => a.id === accountId)?.username || '...'}</p>
                    <p className="text-xs text-gray-400">@{accounts.find(a => a.id === accountId)?.username || '...'}</p>
                  </div>
                </div>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                  {lineEnabled
                    ? text.replace(/\{link\}/g, `https://line-harness.../r/campaign-xxxx?form=auto`)
                    : text}
                </p>
                {mediaFiles.length > 0 && (
                  <div className="flex gap-2 pt-1">
                    {mediaFiles.map((m, i) => (
                      <div key={i} className="w-20 h-20 rounded-lg overflow-hidden bg-gray-800">
                        {m.type === 'video'
                          ? <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">🎬 動画</div>
                          : <img src={m.previewUrl} alt="" className="w-full h-full object-cover" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">条件</h3>
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 text-xs font-medium bg-blue-50 text-blue-700 rounded-full">リポスト必須</span>
                {requireLike && <span className="px-3 py-1 text-xs font-medium bg-red-50 text-red-700 rounded-full">いいね必須</span>}
                {requireRepost && <span className="px-3 py-1 text-xs font-medium bg-green-50 text-green-700 rounded-full">リポスト必須</span>}
                {requireFollow && <span className="px-3 py-1 text-xs font-medium bg-purple-50 text-purple-700 rounded-full">フォロー必須</span>}
                {replyKeyword && <span className="px-3 py-1 text-xs font-medium bg-yellow-50 text-yellow-700 rounded-full">キーワード: {replyKeyword}</span>}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">LINE連携</h3>
              {lineEnabled ? (
                <div>
                  <p className="text-sm text-green-600">✅ ON — フォーム自動作成、{'{link}'} をリンクに置換</p>
                  {selectedTemplateId && (() => {
                    const t = rewardTemplates.find(r => r.id === selectedTemplateId)
                    return t ? <p className="text-xs text-green-600 mt-1">特典: {t.name}（{t.messageType}）</p> : null
                  })()}
                  {selectedPoolSlug && <p className="text-xs text-green-600 mt-1">Pool: {selectedPoolSlug}</p>}
                </div>
              ) : (
                <p className="text-sm text-gray-400">OFF</p>
              )}
            </div>

            {lineEnabled && !text.includes('{link}') && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <p className="text-sm text-yellow-700">⚠️ テキストに <code className="bg-yellow-100 px-1 rounded font-mono">{'{link}'}</code> が含まれていません。リンクは投稿に含まれません。</p>
              </div>
            )}

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setStep(3)}
                className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                ← 戻る
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || uploading}
                className="px-6 py-2.5 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity hover:opacity-90 flex items-center gap-2"
                style={{ backgroundColor: '#1D9BF0' }}
              >
                {(submitting || uploading) && (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                {uploading ? 'アップロード中...' : submitting ? '作成中...' : 'キャンペーン作成'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
