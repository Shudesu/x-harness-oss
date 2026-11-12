'use client'

// 記事タブ: left = list with cover thumbnails and X連携 status, right = the
// selected article rendered like the published X article, with preview /
// edit / side-by-side modes and the next action for its state.
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@cloudflare/kumo/components/button'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Surface } from '@cloudflare/kumo/components/surface'
import ArticleReadingView from '@/components/articles/reading-view'
import { articleImageUrls, isExternalImage } from '@/lib/article-markdown'
import { API_URL } from '@/lib/api'
import { ConfirmDialog } from './confirm-dialog'
import type { ArticleDraft } from './shared'

export interface ArticleActions {
  save: (id: string, patch: { title: string; bodyMd: string; imageUrl: string }) => Promise<string>
  importImages: (id: string) => Promise<string>
  createXDraft: (id: string) => Promise<void>
  publish: (id: string) => Promise<void>
  discard: (id: string) => Promise<void>
}

type Stage = 'draft' | 'creating' | 'x_draft' | 'published'
export function articleStage(a: Pick<ArticleDraft, 'status' | 'x_article_draft_id'>): Stage {
  if (a.status === 'published') return 'published'
  if (a.x_article_draft_id?.startsWith('creating:')) {
    // A claim older than 10 minutes belongs to a crashed request: offer a retry.
    const at = Date.parse(a.x_article_draft_id.slice('creating:'.length))
    return !Number.isNaN(at) && Date.now() - at >= 10 * 60_000 ? 'draft' : 'creating'
  }
  return a.x_article_draft_id ? 'x_draft' : 'draft'
}

const STAGE_LABEL: Record<Stage, { label: string; variant: 'secondary' | 'info' | 'success' }> = {
  draft: { label: 'X下書き 未作成', variant: 'secondary' },
  creating: { label: 'X下書き 作成中', variant: 'info' },
  x_draft: { label: 'X下書き 作成済み', variant: 'info' },
  published: { label: 'Xで公開済み', variant: 'success' },
}

export function StageBadge({ article }: { article: ArticleDraft }) {
  const s = STAGE_LABEL[articleStage(article)]
  return <Badge variant={s.variant}>{s.label}</Badge>
}

function fmt(ts: string) {
  const d = new Date(ts)
  return isNaN(d.getTime()) ? ts : d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function Thumb({ src }: { src: string | null }) {
  const [badSrc, setBadSrc] = useState<string | null>(null)
  const bad = badSrc === src
  if (!src || bad) {
    return <span className="flex aspect-[5/2] w-28 shrink-0 items-center justify-center rounded-md border border-dashed border-kumo-line bg-kumo-tint text-[10px] text-kumo-subtle">{src ? '表示不可' : '表紙なし'}</span>
  }
  return <img src={src} alt="" loading="lazy" onError={() => setBadSrc(src)} className="aspect-[5/2] w-28 shrink-0 rounded-md border border-kumo-line bg-kumo-tint object-cover" />
}

const FILTERS: Array<{ id: 'all' | Stage; label: string }> = [
  { id: 'all', label: 'すべて' },
  { id: 'draft', label: '未作成' },
  { id: 'x_draft', label: 'X下書きあり' },
  { id: 'published', label: '公開済み' },
]

export function ArticlesPanel({ articles, loading, actions, initialId }: {
  articles: ArticleDraft[]
  loading: boolean
  actions: ArticleActions
  initialId?: string | null
}) {
  const [filter, setFilter] = useState<'all' | Stage>('all')
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null)
  const visible = useMemo(
    () => articles.filter((a) => filter === 'all' || articleStage(a) === filter),
    [articles, filter],
  )
  const [dirty, setDirty] = useState(false)
  useEffect(() => { if (initialId) setSelectedId(initialId) }, [initialId])
  useEffect(() => {
    if (articles.length === 0) return // still loading: keep a deep-linked id
    if (!selectedId || !articles.some((a) => a.id === selectedId)) setSelectedId(visible[0]?.id ?? articles[0]?.id ?? null)
  }, [articles, visible, selectedId])
  const select = (id: string) => {
    if (id === selectedId) return
    if (dirty && !window.confirm('保存していない変更があります。破棄して別の記事を開きますか？')) return
    setDirty(false)
    setSelectedId(id)
  }
  const selected = articles.find((a) => a.id === selectedId) ?? null

  if (loading && articles.length === 0) {
    return <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="h-96 animate-pulse rounded-xl bg-kumo-tint" /><div className="h-[32rem] animate-pulse rounded-xl bg-kumo-tint" />
    </div>
  }
  if (articles.length === 0) {
    return <Surface className="rounded-xl p-10 text-center text-sm text-kumo-subtle">記事はまだありません。毎朝の自動生成か「記事」メニューから作成できます。</Surface>
  }

  return <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
    <Surface className="min-w-0 overflow-hidden rounded-xl">
      <div className="flex flex-wrap gap-1 border-b border-kumo-line p-2" role="group" aria-label="記事の状態で絞り込む">
        {FILTERS.map((f) => {
          const n = f.id === 'all' ? articles.length : articles.filter((a) => articleStage(a) === f.id).length
          return <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 ${filter === f.id ? 'bg-kumo-brand text-white' : 'text-kumo-subtle hover:bg-kumo-tint'}`}>
            {f.label} <span className="tabular-nums">{n}</span>
          </button>
        })}
      </div>
      <ul className="max-h-[38vh] divide-y divide-kumo-line overflow-y-auto lg:max-h-[calc(100vh-300px)]">
        {visible.length === 0 && <li className="p-4 text-sm text-kumo-subtle">この状態の記事はありません。</li>}
        {visible.map((a) => {
          const imgs = articleImageUrls(a.body_md).length
          return <li key={a.id}>
            <button type="button" onClick={() => select(a.id)} aria-current={a.id === selectedId ? 'true' : undefined}
              className={`flex w-full gap-3 p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 ${a.id === selectedId ? 'bg-kumo-tint' : 'hover:bg-kumo-tint'}`}>
              <Thumb src={a.image_url} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm font-semibold leading-5 text-kumo-default">{a.title}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-kumo-subtle">
                  <StageBadge article={a} />
                  <span>画像 {imgs + (a.image_url ? 1 : 0)}枚</span>
                  <span>{fmt(a.created_at)}</span>
                </span>
              </span>
            </button>
          </li>
        })}
      </ul>
    </Surface>
    {selected ? <ArticleDetail key={selected.id} article={selected} actions={actions} onDirtyChange={setDirty} /> : <Surface className="rounded-xl p-10 text-center text-sm text-kumo-subtle">左の一覧から記事を選んでください。</Surface>}
  </div>
}

const field = 'w-full rounded-lg border border-kumo-line bg-kumo-base p-3 text-sm text-kumo-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2'

function ArticleDetail({ article, actions, onDirtyChange }: { article: ArticleDraft; actions: ArticleActions; onDirtyChange: (dirty: boolean) => void }) {
  const stage = articleStage(article)
  const editable = stage === 'draft'
  const [mode, setMode] = useState<'preview' | 'edit' | 'split'>('preview')
  const [form, setForm] = useState({ title: article.title, bodyMd: article.body_md, imageUrl: article.image_url ?? '' })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<null | 'xdraft' | 'publish' | 'discard'>(null)
  const dirty = form.title !== article.title || form.bodyMd !== article.body_md || form.imageUrl !== (article.image_url ?? '')
  // The server may rewrite image URLs on save/import — adopt the saved version.
  useEffect(() => {
    setForm({ title: article.title, bodyMd: article.body_md, imageUrl: article.image_url ?? '' })
  }, [article.title, article.body_md, article.image_url])
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const bodyImages = articleImageUrls(article.body_md)
  const external = [article.image_url, ...bodyImages].filter((u): u is string => Boolean(u) && isExternalImage(u as string, API_URL))
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true); setError(''); setMessage('')
    try { const m = await fn(); if (m) setMessage(m) }
    catch (e) { setError(e instanceof Error ? e.message : '処理に失敗しました') }
    finally { setBusy(false) }
  }

  const preview = <ArticleReadingView title={form.title} body={form.bodyMd} cover={form.imageUrl || null} note={false} />
  const editor = <div className="space-y-4">
    <label className="block space-y-1.5"><span className="text-xs font-medium text-kumo-subtle">タイトル</span>
      <input className={`${field} text-base font-semibold`} value={form.title} disabled={!editable || busy} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
    <label className="block space-y-1.5"><span className="text-xs font-medium text-kumo-subtle">表紙画像のURL（外部URLは保存時にハーネスへ取り込みます）</span>
      <input className={field} type="url" value={form.imageUrl} disabled={!editable || busy} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://…" /></label>
    <label className="block space-y-1.5"><span className="text-xs font-medium text-kumo-subtle">本文（Markdown・画像は ![説明](URL) で1行に置く）</span>
      <textarea className={`${field} min-h-[56vh] resize-y font-mono !leading-7`} value={form.bodyMd} disabled={!editable || busy} onChange={(e) => setForm({ ...form, bodyMd: e.target.value })} /></label>
  </div>

  return <Surface className="min-w-0 overflow-hidden rounded-xl">
    {/* 状態と次の操作 */}
    <div className="space-y-3 border-b border-kumo-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StageBadge article={article} />
          {article.theme && <Badge variant="secondary">{article.theme}</Badge>}
          <span className="text-xs text-kumo-subtle">作成 {fmt(article.created_at)}</span>
        </div>
        <div className="flex rounded-lg border border-kumo-line p-0.5" role="group" aria-label="表示の切り替え">
          {([['preview', '記事の見た目'], ['split', '並べて編集'], ['edit', '編集のみ']] as const).map(([id, label]) =>
            <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${mode === id ? 'bg-kumo-brand text-white' : 'text-kumo-subtle hover:bg-kumo-tint'} ${id === 'split' ? 'hidden xl:inline-block' : ''}`}>{label}</button>)}
        </div>
      </div>

      <div className="rounded-lg bg-kumo-tint p-3 text-sm leading-6">
        {stage === 'draft' && <p><b>次にやること：</b>内容と画像を確認して「Xの下書きを作る」。X側の下書きは作成後にXの画面で最終確認できます。作成後はここでは本文を変えられません。</p>}
        {stage === 'creating' && <p><b>Xの下書きを作成中です。</b>しばらくしてから画面を再読み込みしてください。</p>}
        {stage === 'x_draft' && <p><b>X下書き作成済み</b>（ID <code className="font-mono text-xs">{article.x_article_draft_id}</code>）。Xの記事エディタで最終確認してから公開してください。ここから公開することもできます。</p>}
        {stage === 'published' && <p><b>Xで公開済み。</b>{article.published_article_id && <a className="ml-1 text-kumo-link underline" href={`https://x.com/i/status/${encodeURIComponent(article.published_article_id)}`} target="_blank" rel="noopener noreferrer">公開された記事を見る ↗</a>}</p>}
      </div>

      {external.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-kumo-warning-tint p-3 text-sm text-kumo-warning">
        <span>外部サイトの画像が {external.length} 枚あります（ブラウザで表示できない場合があります）。</span>
        {editable && <Button size="sm" disabled={busy || dirty} onClick={() => run(() => actions.importImages(article.id))}>画像をハーネスに取り込む</Button>}
      </div>}

      <div className="flex flex-wrap items-center gap-2">
        {editable && (mode !== 'preview') && <Button variant="primary" disabled={busy || !dirty || !form.title.trim() || !form.bodyMd.trim()} onClick={() => run(() => actions.save(article.id, form))}>{busy ? '保存中…' : '保存'}</Button>}
        {editable && <Button variant={mode === 'preview' ? 'primary' : 'secondary'} disabled={busy || dirty} onClick={() => setDialog('xdraft')}>Xの下書きを作る</Button>}
        {(stage === 'draft' || stage === 'x_draft') && <Button variant="secondary" disabled={busy || dirty} onClick={() => setDialog('publish')}>Xで公開…</Button>}
        {stage !== 'published' && <Button variant="ghost" disabled={busy} onClick={() => setDialog('discard')}>破棄</Button>}
        {dirty && <span className="text-xs text-kumo-warning">未保存の変更があります</span>}
      </div>
      {message && <p role="status" className="text-sm text-kumo-success">{message}</p>}
      {error && <p role="alert" className="text-sm text-kumo-danger">{error}</p>}
    </div>

    <div className={mode === 'split' ? 'grid xl:grid-cols-2' : ''}>
      {(mode === 'edit' || mode === 'split') && <div className="min-w-0 border-kumo-line p-5 xl:border-r">{editor}</div>}
      {(mode === 'preview' || mode === 'split') && <div className={`min-w-0 px-5 py-6 sm:px-10 ${mode === 'split' ? 'max-h-[80vh] overflow-y-auto' : ''}`}>
        <div className="mx-auto max-w-[680px]">{preview}</div>
      </div>}
    </div>

    <ConfirmDialog open={dialog === 'xdraft'} onOpenChange={(o) => !o && setDialog(null)} title="Xの下書きを作りますか？"
      confirmLabel="Xの下書きを作る"
      description={<>表紙と本文の画像 {bodyImages.length + (article.image_url ? 1 : 0)} 枚をXにアップロードし、Xの記事下書きを作ります。<b>公開はされません。</b>Xの下書き作成は24時間に10件までで、作成後はこの画面で本文を変えられません。</>}
      onConfirm={async () => { await actions.createXDraft(article.id) }} />
    <ConfirmDialog open={dialog === 'publish'} onOpenChange={(o) => !o && setDialog(null)} title="Xで記事を公開しますか？" danger
      confirmLabel="公開する"
      description={<>「{article.title}」を <b>Xアカウントで今すぐ一般公開</b>します。公開すると取り消せません。{stage === 'draft' ? 'X下書きがまだないので、先に下書きを作ってから公開します。' : '作成済みのX下書きを公開します。'}</>}
      onConfirm={async () => { await actions.publish(article.id) }} />
    <ConfirmDialog open={dialog === 'discard'} onOpenChange={(o) => !o && setDialog(null)} title="この記事を破棄しますか？" danger
      confirmLabel="破棄する"
      description="一覧から外れます（データは残ります）。Xに作成済みの下書きは削除されません。"
      onConfirm={async () => { await actions.discard(article.id) }} />
  </Surface>
}
