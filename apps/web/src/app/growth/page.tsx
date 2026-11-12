'use client'
import AiPanel from '@/components/ai-panel'

// グロース画面: AIが毎朝用意する「投稿案」「記事」「ネタ候補」を確認して、
// Xに出すものを決める場所。投稿案は「今日の案」を上に大きく出し、予定日を
// 過ぎた古い案は「期限切れ」に折りたたむ（まとめてアーカイブ＝削除しない）。
import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'
import type { ApiResponse } from '@/lib/api'
import Header from '@/components/layout/header'
import { Tabs } from '@cloudflare/kumo/components/tabs'
import { Surface } from '@cloudflare/kumo/components/surface'
import { ProcessedRow, EdahaView } from '@/components/growth/draft-cards'
import { QueueCard } from '@/components/growth/queue-card'
import { ExpiredSection, ArchivedNote } from '@/components/growth/expired-section'
import { SourceCard } from '@/components/growth/source-card'
import { ArticlesPanel, articleStage, type ArticleActions } from '@/components/growth/articles-panel'
import type { ArticleDraft, GrowthDraft, SourceCandidate } from '@/components/growth/shared'
import { bucketDrafts, jstDate, jstDayStartIso } from '@/lib/approval-queue'

type Tab = 'posts' | 'articles' | 'sources' | 'edaha' | 'processed'
const TABS: Tab[] = ['posts', 'articles', 'sources', 'edaha', 'processed']

// Derive xAccountId from pending drafts (first one wins) or fall back to env.
function deriveXAccountId(pending: GrowthDraft[]): string {
  return pending[0]?.x_account_id ?? process.env.NEXT_PUBLIC_X_ACCOUNT_ID ?? ''
}

function Empty({ children }: { children: React.ReactNode }) {
  return <Surface className="rounded-xl px-6 py-14 text-center text-sm leading-7 text-kumo-subtle">{children}</Surface>
}

function Skeleton({ h = 'h-48', n = 3 }: { h?: string; n?: number }) {
  return <div className="space-y-4">{[...Array(n)].map((_, i) => <div key={i} className={`${h} animate-pulse rounded-xl bg-kumo-tint`} />)}</div>
}

function StepCard({ n, title, count, unit, hint, active, onClick }: { n: number; title: string; count: number | null; unit: string; hint: string; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={active}
    className={`group flex min-w-0 flex-col gap-1 rounded-xl border p-3 text-left sm:p-4 transition-colors focus-visible:outline focus-visible:outline-2 ${active ? 'border-kumo-brand bg-kumo-tint' : 'border-kumo-line bg-kumo-base hover:bg-kumo-tint'}`}>
    <span className="text-[11px] font-medium leading-4 text-kumo-subtle sm:text-xs">{n}. {title}</span>
    <span className="text-xl font-bold tabular-nums text-kumo-default sm:text-2xl">{count ?? '–'}<span className="ml-1 text-sm font-medium text-kumo-subtle">{unit}</span></span>
    <span className="hidden text-xs leading-5 text-kumo-subtle sm:block">{hint}</span>
  </button>
}

export default function GrowthPage() {
  const [tab, setTabState] = useState<Tab>('posts')
  const [initialArticleId, setInitialArticleId] = useState<string | null>(null)
  const [pending, setPending] = useState<GrowthDraft[]>([])
  const [scheduled, setScheduled] = useState<GrowthDraft[]>([])
  const [processed, setProcessed] = useState<GrowthDraft[]>([])
  const [sources, setSources] = useState<SourceCandidate[] | null>(null)
  const [articles, setArticles] = useState<ArticleDraft[]>([])
  const [articlesLoaded, setArticlesLoaded] = useState(false)
  const [archivedCount, setArchivedCount] = useState(0)
  // 「今日」の基準。1分ごとに進め、日付をまたいだら並びも変わる。
  const [now, setNow] = useState(() => new Date())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  // ?tab=articles&article=<id> deep-links straight into an article.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const t = q.get('tab') as Tab | null
    if (t && TABS.includes(t)) setTabState(t)
    setInitialArticleId(q.get('article'))
  }, [])
  const setTab = (t: Tab) => {
    setTabState(t)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', t)
    url.searchParams.delete('article')
    window.history.replaceState(null, '', url)
  }

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  const loadDrafts = useCallback(async () => {
    try {
      const [pendingRes, scheduledRes, rejectedRes, archivedRes] = await Promise.all([
        fetchApi<ApiResponse<GrowthDraft[]>>('/api/growth/drafts?status=pending'),
        fetchApi<ApiResponse<GrowthDraft[]>>('/api/growth/drafts?status=scheduled'),
        fetchApi<ApiResponse<GrowthDraft[]>>('/api/growth/drafts?status=rejected'),
        // 件数だけ使う。古い Worker では空配列が返る。
        fetchApi<ApiResponse<GrowthDraft[]>>('/api/growth/drafts?status=archived').catch(() => null),
      ])
      setPending(pendingRes.data ?? [])
      setArchivedCount(archivedRes?.data?.length ?? 0)
      setScheduled(scheduledRes.data ?? [])
      setProcessed([...(scheduledRes.data ?? []), ...(rejectedRes.data ?? [])]
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
        .slice(0, 30))
    } catch (err) {
      setError(err instanceof Error ? err.message : '投稿案の取得に失敗しました')
    }
  }, [])

  const loadSources = useCallback(async () => {
    try {
      const res = await fetchApi<ApiResponse<SourceCandidate[]>>('/api/growth/sources?status=new')
      setSources(res.data ?? [])
    } catch (err) {
      setSources([])
      setError(err instanceof Error ? err.message : 'ソース候補の取得に失敗しました')
    }
  }, [])

  const loadArticles = useCallback(async () => {
    try {
      const [draftRes, publishedRes] = await Promise.all([
        fetchApi<ApiResponse<ArticleDraft[]>>('/api/growth/articles?status=draft'),
        fetchApi<ApiResponse<ArticleDraft[]>>('/api/growth/articles?status=published'),
      ])
      setArticles([...(draftRes.data ?? []), ...(publishedRes.data ?? [])])
    } catch (err) {
      setError(err instanceof Error ? err.message : '記事の取得に失敗しました')
    } finally {
      setArticlesLoaded(true)
    }
  }, [])

  useEffect(() => {
    Promise.all([loadDrafts(), loadArticles(), loadSources()]).finally(() => setLoading(false))
  }, [loadDrafts, loadArticles, loadSources])

  // ── 投稿案 ──
  const handleSave = async (id: string, text: string, scheduledAt: string) => {
    await fetchApi<ApiResponse<GrowthDraft>>(`/api/growth/drafts/${id}`, { method: 'PATCH', body: JSON.stringify({ text, scheduledAt }) })
    setPending((prev) => prev.map((d) => (d.id === id ? { ...d, text, scheduled_at: scheduledAt } : d)))
  }
  const handleApprove = async (id: string) => {
    await fetchApi<ApiResponse<GrowthDraft>>(`/api/growth/drafts/${id}/approve`, { method: 'POST' })
    showToast('OKしました。予約投稿に入りました')
    await loadDrafts()
  }
  const handleReject = async (id: string) => {
    await fetchApi<ApiResponse<GrowthDraft>>(`/api/growth/drafts/${id}/reject`, { method: 'POST' })
    showToast('捨てました（「処理済み」タブに残ります）')
    await loadDrafts()
  }
  // 期限切れをまとめてアーカイブ（削除しない・元に戻せる）。境目は画面と同じ「今日0時（日本時間）」。
  const handleArchiveExpired = async () => {
    const res = await fetchApi<ApiResponse<{ count: number }>>('/api/growth/drafts/archive-expired', { method: 'POST', body: JSON.stringify({ before: jstDayStartIso(new Date()) }) })
    showToast(`${res.data.count}件をアーカイブしました（元に戻せます）`)
    await loadDrafts()
  }
  const handleRestoreArchived = async () => {
    const res = await fetchApi<ApiResponse<{ count: number }>>('/api/growth/drafts/unarchive', { method: 'POST', body: JSON.stringify({ all: true }) })
    showToast(`${res.data.count}件を元に戻しました`)
    await loadDrafts()
  }

  // ── ソース候補 ──
  const handleToDraft = async (id: string, text: string, scheduledAt: string) => {
    const xAccountId = deriveXAccountId(pending)
    if (!xAccountId) {
      showToast('Xアカウントが特定できません（承認待ちポストが空のため）')
      return
    }
    await fetchApi<ApiResponse<unknown>>(`/api/growth/sources/${id}/to-draft`, { method: 'POST', body: JSON.stringify({ xAccountId, text, scheduledAt }) })
    setSources((prev) => (prev ?? []).filter((s) => s.id !== id))
    showToast('承認待ちポストに追加しました')
    await loadDrafts()
  }
  const handleDismiss = async (id: string) => {
    await fetchApi<ApiResponse<unknown>>(`/api/growth/sources/${id}/dismiss`, { method: 'POST' })
    setSources((prev) => (prev ?? []).filter((s) => s.id !== id))
    showToast('却下しました')
  }

  // ── 記事 ──
  const replaceArticle = (a: ArticleDraft) => setArticles((prev) => prev.map((x) => (x.id === a.id ? a : x)))
  const importMessage = (r?: { imported: number; failed: Array<{ url: string; error: string }> }) => {
    if (!r) return ''
    const parts = []
    if (r.imported) parts.push(`画像 ${r.imported} 枚をハーネスに保存しました`)
    if (r.failed.length) parts.push(`${r.failed.length} 枚は取り込めませんでした（${r.failed[0].error}）`)
    return parts.join('。')
  }
  type ImportRes = ApiResponse<ArticleDraft> & { imageImport?: { imported: number; failed: Array<{ url: string; error: string }> } }
  const articleActions: ArticleActions = {
    save: async (id, patch) => {
      const res = await fetchApi<ImportRes>(`/api/growth/articles/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      replaceArticle(res.data)
      return ['保存しました', importMessage(res.imageImport)].filter(Boolean).join('。')
    },
    importImages: async (id) => {
      const res = await fetchApi<ImportRes>(`/api/growth/articles/${id}/import-images`, { method: 'POST', body: '{}' })
      replaceArticle(res.data)
      return importMessage(res.imageImport) || '取り込む画像はありませんでした'
    },
    createXDraft: async (id) => {
      const res = await fetchApi<ApiResponse<{ x_article_draft_id: string; warnings?: string[] }>>(`/api/growth/articles/${id}/x-draft`, { method: 'POST', body: '{}' })
      await loadArticles()
      const warnings = res.data.warnings ?? []
      showToast(
        warnings.length
          ? `Xの記事下書きを作りました（まだ公開されていません）。注意: ${warnings.join(' / ')}`
          : 'Xの記事下書きを作りました（まだ公開されていません）',
      )
    },
    publish: async (id) => {
      const res = await fetchApi<ApiResponse<{ article_id: string; post_id: string; warnings?: string[] }>>(`/api/growth/articles/${id}/publish`, { method: 'POST', body: '{}' })
      await loadArticles()
      const warnings = res.data.warnings ?? []
      showToast(
        warnings.length
          ? `Xで公開しました（ポストID: ${res.data.post_id}）。注意: ${warnings.join(' / ')}`
          : `Xで公開しました（ポストID: ${res.data.post_id}）`,
      )
    },
    discard: async (id) => {
      await fetchApi<ApiResponse<unknown>>(`/api/growth/articles/${id}/discard`, { method: 'POST' })
      setArticles((prev) => prev.filter((a) => a.id !== id))
      showToast('記事を破棄しました')
    },
  }

  const queue = bucketDrafts(pending, now)
  const todayLabel = (() => { const [, m, d] = (jstDate(now) ?? '').split('-'); return m ? `${Number(m)}月${Number(d)}日` : '' })()
  const xAccountId = deriveXAccountId(pending)
  const draftArticles = articles.filter((a) => a.status === 'draft')
  const articlesNeedingDraft = draftArticles.filter((a) => articleStage(a) === 'draft').length
  const edahaDrafts = [...pending, ...scheduled].filter((d) => d.quote_tweet_id)
  const pillars = articles.filter((a) => a.status === 'published')

  const TAB_ITEMS: { id: Tab; label: string; count?: number }[] = [
    { id: 'posts', label: '今日の投稿案', count: queue.today.length + queue.later.length },
    { id: 'articles', label: '記事', count: draftArticles.length },
    { id: 'sources', label: 'ソース候補', count: sources?.length },
    { id: 'edaha', label: '記事への動画引用', count: edahaDrafts.filter((d) => d.status === 'pending').length },
    { id: 'processed', label: '処理済み' },
  ]

  return (
    <div className="text-kumo-default">
      <AiPanel />
      <Header
        title="投稿・記事の承認"
        description="毎朝AIが作った投稿案。OKしたものだけ予約投稿されます（記事・ソース候補も、決めるまでXには出ません）。"
      />

      {toast && <div role="status" className="fixed bottom-6 right-6 z-50 rounded-xl bg-kumo-contrast px-5 py-3 text-sm font-medium text-kumo-inverse shadow-lg">{toast}</div>}

      {/* 3つの仕事と件数 */}
      <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
        <StepCard n={1} title="今日の投稿案" count={loading ? null : queue.today.length + queue.later.length} unit="件" active={tab === 'posts'} onClick={() => setTab('posts')}
          hint={queue.expired.length > 0 ? `「OKして予約」したものだけ投稿されます。期限切れ ${queue.expired.length}件は下にまとめています。` : '「OKして予約」したものだけ投稿されます。'} />
        <StepCard n={2} title="記事の下書き" count={articlesLoaded ? draftArticles.length : null} unit="本" active={tab === 'articles'} onClick={() => setTab('articles')}
          hint={articlesLoaded ? `X下書き未作成 ${articlesNeedingDraft} 本。表紙と画像を確認して「Xの下書きを作る」。` : '記事を読み込み中…'} />
        <StepCard n={3} title="ソース候補" count={sources ? sources.length : null} unit="件" active={tab === 'sources'} onClick={() => setTab('sources')}
          hint="引用したい海外ポストを「承認待ちポストに追加」。不要なら却下。" />
      </div>

      {error && <div role="alert" className="mb-4 rounded-lg bg-kumo-danger-tint px-4 py-3 text-sm text-kumo-danger">{error}</div>}

      <div className="space-y-4">
        <div className="overflow-x-auto">
          <Tabs
            variant="underline"
            value={tab}
            onValueChange={(v) => setTab(v as Tab)}
            tabs={TAB_ITEMS.map((t) => ({
              value: t.id,
              label: (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  {t.label}
                  {t.count != null && t.count > 0 && <span className="rounded-full bg-kumo-tint px-1.5 text-[11px] font-semibold tabular-nums text-kumo-subtle">{t.count}</span>}
                </span>
              ),
            }))}
          />
        </div>

        {tab === 'posts' && (
          loading ? <Skeleton /> : (
            <div className="max-w-3xl space-y-6">
              <section className="space-y-4" aria-labelledby="today-heading">
                <div>
                  <h2 id="today-heading" className="text-xl font-bold text-kumo-default">今日の案{todayLabel && <span className="ml-2 text-base font-medium text-kumo-subtle">{todayLabel}</span>}</h2>
                  <p className="mt-1 text-sm leading-6 text-kumo-subtle">毎朝AIが作った投稿案です。「OKして予約」したものだけ、書いてある時刻に投稿されます。文面や時刻を変えたいときは「直す」、使わないものは「捨てる」。</p>
                </div>
                {queue.today.length === 0
                  ? <Empty>今日の案はまだありません。毎朝7時ごろにAIが新しい案を用意します。</Empty>
                  : queue.today.map((draft) => <QueueCard key={draft.id} draft={draft} now={now} onApprove={handleApprove} onReject={handleReject} onSaved={handleSave} />)}
              </section>

              {queue.later.length > 0 && (
                <section className="space-y-4" aria-labelledby="later-heading">
                  <h2 id="later-heading" className="text-base font-semibold text-kumo-default">明日以降の案 <span className="text-sm font-normal text-kumo-subtle">{queue.later.length}件</span></h2>
                  {queue.later.map((draft) => <QueueCard key={draft.id} draft={draft} now={now} onApprove={handleApprove} onReject={handleReject} onSaved={handleSave} />)}
                </section>
              )}

              <ExpiredSection drafts={queue.expired} now={now} onArchive={handleArchiveExpired} onApprove={handleApprove} onReject={handleReject} onSaved={handleSave} />
              <ArchivedNote count={archivedCount} onRestore={handleRestoreArchived} />
            </div>
          )
        )}

        {tab === 'articles' && (
          <ArticlesPanel articles={articles} loading={!articlesLoaded} actions={articleActions} initialId={initialArticleId} />
        )}

        {tab === 'sources' && (
          sources === null ? <Skeleton h="h-64" /> : sources.length === 0 ? <Empty>新しいソース候補はありません。毎朝、海外で伸びている動画やポストを自動で集めます。</Empty> : (
            <div className="space-y-4">
              <p className="text-sm text-kumo-subtle">海外で伸びているポストです。引用したいものは文面を整えて「承認待ちポストに追加」。まだXには出ません。</p>
              {sources.map((candidate) => (
                <SourceCard key={candidate.id} candidate={candidate} xAccountId={xAccountId} onToDraft={handleToDraft} onDismiss={handleDismiss} />
              ))}
            </div>
          )
        )}

        {tab === 'edaha' && (
          loading || !articlesLoaded ? <Skeleton /> : (
            <div className="max-w-3xl space-y-4">
              <p className="text-sm text-kumo-subtle">公開済みの記事を、海外の動画付きで引用するポスト案です（社内では「枝葉」と呼んでいます）。記事ごとにまとめて表示します。</p>
              <EdahaView
                pillars={pillars}
                drafts={edahaDrafts}
                onApprove={handleApprove}
                onReject={handleReject}
                onSaved={handleSave}
              />
            </div>
          )
        )}

        {tab === 'processed' && (
          processed.length === 0 ? <Empty>まだ処理済みのポストはありません。</Empty> : (
            <Surface className="max-w-3xl rounded-xl px-5 py-1">
              <p className="border-b border-kumo-line py-3 text-xs text-kumo-subtle">最近承認・却下したポスト（新しい順に30件）</p>
              {processed.map((draft) => <ProcessedRow key={draft.id} draft={draft} />)}
            </Surface>
          )
        )}
      </div>
    </div>
  )
}
