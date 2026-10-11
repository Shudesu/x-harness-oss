'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@cloudflare/kumo/components/button'
import { Surface } from '@cloudflare/kumo/components/surface'
import { Badge } from '@cloudflare/kumo/components/badge'
import { fetchApi, type ApiResponse } from '@/lib/api'
import Header from '@/components/layout/header'
import { useCurrentAccountId } from '@/hooks/use-selected-account'
import ArticleReadingView from '@/components/articles/reading-view'

interface Article {
  id: string; x_account_id: string; title: string; body_md: string
  image_url: string | null; status: string; x_article_draft_id: string | null
  published_article_id: string | null; updated_at: string
}
const empty = { title: '', bodyMd: '', imageUrl: '' }
const field = 'w-full rounded-lg border border-kumo-line bg-kumo-base p-3 text-sm text-kumo-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2'

export default function ArticlesPage() {
  const accountId = useCurrentAccountId()
  return <><Header title="記事スタジオ" description="自動生成した記事も手書きの記事も、ここで保存・編集・公開できます。" />
    {accountId ? <Studio key={accountId} accountId={accountId} /> : <Surface className="p-6">Xアカウントを選択してください。</Surface>}
  </>
}

function Studio({ accountId }: { accountId: string }) {
  const [articles, setArticles] = useState<Article[]>([])
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState<Article | null>(null)
  const [filter, setFilter] = useState('draft')
  const [view, setView] = useState<'edit' | 'read'>('edit')
  const [focused, setFocused] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [ready, setReady] = useState(false)
  const lock = useRef(false)
  const storageKey = `xh_article_editor:${accountId}`
  const dirty = editing ? form.title !== editing.title || form.bodyMd !== editing.body_md || form.imageUrl !== (editing.image_url ?? '') : Boolean(form.title || form.bodyMd || form.imageUrl)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<ApiResponse<Article[]>>(`/api/growth/articles?xAccountId=${encodeURIComponent(accountId)}`)
      setArticles(res.data.filter(a => a.x_account_id === accountId))
    } catch (e) { setError(e instanceof Error ? e.message : '記事を読み込めませんでした') }
    finally { setLoading(false) }
  }, [accountId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const value = JSON.parse(saved)
        if (typeof value.title === 'string' && typeof value.bodyMd === 'string' && typeof value.imageUrl === 'string') {
          setForm({ title: value.title, bodyMd: value.bodyMd, imageUrl: value.imageUrl })
          if (value.editing?.id && value.editing.x_account_id === accountId) setEditing(value.editing)
          setMessage('入力途中の原稿を復元しました。内容を確認して保存してください。')
        }
      }
      const prefill = sessionStorage.getItem('xh_article_prefill')
      if (!saved && prefill) {
        const value = JSON.parse(prefill)
        setForm({ title: value.title ?? '', bodyMd: value.body ?? '', imageUrl: '' })
        sessionStorage.removeItem('xh_article_prefill')
      }
    } catch { setError('入力途中の原稿を復元できませんでした。ブラウザの保存設定を確認してください。') }
    setReady(true)
  }, [storageKey, accountId])
  useEffect(() => {
    if (!ready) return
    try { localStorage.setItem(storageKey, JSON.stringify({ ...form, editing })) }
    catch { setError('ブラウザへの一時保存ができません。画面を閉じる前に下書きを保存してください。') }
  }, [form, editing, ready, storageKey])
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const run = async (action: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setMessage('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : '処理に失敗しました') }
    finally { lock.current = false; setBusy(false) }
  }
  const select = (article: Article | null) => {
    if (dirty && !window.confirm('未保存の変更があります。別の原稿に切り替えますか？')) return
    setEditing(article)
    setForm(article ? { title: article.title, bodyMd: article.body_md, imageUrl: article.image_url ?? '' } : empty)
    setError(''); setMessage('')
  }
  const save = () => run(async () => {
    const path = editing ? `/api/growth/articles/${editing.id}` : '/api/growth/articles'
    const res = await fetchApi<ApiResponse<Article>>(path, {
      method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ ...form, title: form.title.trim(), xAccountId: accountId }),
    })
    setEditing(res.data)
    setForm({ title: res.data.title, bodyMd: res.data.body_md, imageUrl: res.data.image_url ?? '' })
    try { localStorage.removeItem(storageKey) } catch { /* remote save succeeded */ }
    setMessage('下書きを保存しました。別の端末からも続けられます。')
    await load()
  })
  const publish = (article: Article) => {
    if (!window.confirm(`「${article.title}」をXに公開しますか？保存済みの本文を公開します。`)) return
    void run(async () => {
      const res = await fetchApi<ApiResponse<{ post_id: string }>>(`/api/growth/articles/${article.id}/publish`, { method: 'POST', body: '{}' })
      if (editing?.id === article.id) setEditing({ ...article, status: 'published', published_article_id: res.data.post_id })
      setMessage('Xに公開しました。公開済みの記事から確認できます。')
      await load()
    })
  }
  const visible = [...articles].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).filter(a => (!filter || a.status === filter) && `${a.title} ${a.body_md}`.toLowerCase().includes(search.toLowerCase()))
  const readonly = Boolean(editing && (editing.status !== 'draft' || editing.x_article_draft_id))
  return <div className="space-y-5 text-kumo-default">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-kumo-subtle">原稿を選ぶ → 編集する → 保存して公開</p>
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/growth" className="text-sm underline underline-offset-4">自動生成の素材・承認</Link>
        <Link href="/articles/legacy" className="text-sm text-kumo-subtle underline underline-offset-4">以前のX下書き</Link>
        <Button disabled={busy} onClick={() => { select(null); setView('edit') }}>＋ 新しい記事</Button>
      </div>
    </div>
    {error && <p role="alert" className="rounded-lg border border-kumo-line bg-kumo-base p-3 text-sm text-kumo-danger">{error}</p>}
    {message && <p role="status" className="rounded-lg border border-kumo-line bg-kumo-base p-3 text-sm text-kumo-success">{message}</p>}
    <div className={`grid min-w-0 items-start gap-5 ${focused ? '' : 'lg:grid-cols-[320px_minmax(0,1fr)]'}`}>
      {!focused && <Surface className="min-w-0 overflow-hidden rounded-xl">
        <div className="space-y-4 border-b border-kumo-line p-4">
          <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">記事一覧 <span className="ml-1 text-sm font-normal text-kumo-subtle">{articles.length}</span></h2><Button disabled={busy || loading} onClick={() => void load()}>更新</Button></div>
          <input className={field} aria-label="記事を検索" placeholder="タイトル・本文を検索" value={search} onChange={e => setSearch(e.target.value)} />
          <div className="flex gap-1" aria-label="記事の状態">{[['draft', '下書き'], ['published', '公開済み'], ['', 'すべて']].map(([value, label]) =>
            <button key={value} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value} className={`flex-1 rounded-lg px-2 py-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 ${filter === value ? 'bg-kumo-brand text-white' : 'text-kumo-subtle hover:bg-kumo-tint'}`}>
              {label} <span className="tabular-nums">{articles.filter(a => !value || a.status === value).length}</span>
            </button>)}</div>
        </div>
        <div className="max-h-[40vh] overflow-y-auto p-2 lg:max-h-[calc(100vh-340px)]">
          {loading ? <p role="status" className="p-4 text-sm text-kumo-subtle">読み込んでいます…</p> : visible.length === 0 ? <p className="p-4 text-sm leading-7 text-kumo-subtle">{search ? '検索に一致する記事がありません。' : '記事はまだありません。「新しい記事」から原稿を作成できます。'}</p> : <ul className="space-y-1">{visible.map(a => <li key={a.id}>
            <button disabled={busy} onClick={() => select(a)} className={`w-full rounded-lg border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 ${editing?.id === a.id ? 'border-kumo-brand bg-kumo-tint' : 'border-transparent hover:bg-kumo-tint'}`} aria-current={editing?.id === a.id ? 'true' : undefined}>
              <span className="mb-2 block text-xs text-kumo-subtle">{a.status === 'published' ? '公開済み' : a.x_article_draft_id ? 'X下書き作成済み' : a.status === 'draft' ? '下書き' : a.status} · {a.updated_at.slice(0, 16).replace('T', ' ')}</span>
              <span className="line-clamp-2 block break-words text-sm font-semibold leading-6">{a.title}</span>
              <span className="mt-2 line-clamp-2 block break-words text-xs leading-5 text-kumo-subtle">{a.body_md.replace(/[#*>`]/g, '').slice(0, 120)}</span>
              <span className="mt-3 block text-xs tabular-nums text-kumo-subtle">{[...a.body_md].length.toLocaleString()}文字{editing?.id === a.id ? ' · 選択中' : ''}</span>
            </button>
          </li>)}</ul>}
        </div>
      </Surface>}
      <Surface className="min-w-0 overflow-hidden rounded-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-kumo-line px-5 py-4">
          <div className="flex items-center gap-3"><h2 className="text-sm font-semibold">{editing ? '記事の原稿' : '新しい原稿'}</h2><Badge variant="neutral">{dirty ? '未保存の変更あり' : editing ? '保存済み' : '未作成'}</Badge></div>
          <div className="flex items-center gap-2">
            <Button aria-pressed={view === 'edit'} onClick={() => setView('edit')}>編集</Button>
            <Button aria-pressed={view === 'read'} onClick={() => setView('read')}>読む</Button>
            <Button aria-pressed={focused} onClick={() => setFocused(!focused)}>{focused ? '一覧を表示' : '執筆に集中'}</Button>
          </div>
        </div>
        <div className="mx-auto max-w-3xl space-y-6 px-5 py-7 sm:px-9">
          {readonly && <p className="rounded-lg bg-kumo-tint p-3 text-sm leading-6 text-kumo-subtle">X下書き作成後・公開後の本文は変更できません。本文をコピーして新しい記事を作成できます。</p>}
          {view === 'read' ? <ArticleReadingView title={form.title} body={form.bodyMd} /> : <>
            <label className="block space-y-2"><span className="text-xs font-medium text-kumo-subtle">タイトル</span><input className={`${field} !text-xl font-semibold sm:!text-2xl`} placeholder="伝えたいことを、一文で。" value={form.title} disabled={busy || readonly} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label className="block space-y-2"><span className="text-xs font-medium text-kumo-subtle">本文 · Markdown</span><textarea className={`${field} min-h-[52vh] resize-y !text-base !leading-8`} rows={18} value={form.bodyMd} disabled={busy || readonly} onChange={e => setForm({ ...form, bodyMd: e.target.value })} placeholder="## 見出し&#10;&#10;本文を入力してください。" /></label>
            <details className="rounded-lg border border-kumo-line p-3"><summary className="cursor-pointer text-sm text-kumo-subtle">カバー画像{form.imageUrl ? ' · 設定済み' : ' · 任意'}</summary><label className="mt-3 block space-y-2"><span className="text-xs text-kumo-subtle">画像URL</span><input className={field} type="url" placeholder="https://…" value={form.imageUrl} disabled={busy || readonly} onChange={e => setForm({ ...form, imageUrl: e.target.value })} /></label></details>
          </>}
        </div>
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-4 border-t border-kumo-line bg-kumo-base px-5 py-4">
          <p className="text-xs leading-5 text-kumo-subtle">{[...form.bodyMd].length.toLocaleString()}文字 · 約{Math.max(1, Math.ceil([...form.bodyMd].length / 600))}分で読了<br />{dirty ? '公開前に下書きを保存してください。' : '下書きの保存ではXに公開されません。'}</p>
          <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={busy || readonly || !form.title.trim() || !form.bodyMd.trim() || Boolean(editing && !dirty)} onClick={() => void save()}>{busy ? '処理中…' : '下書きを保存'}</Button>
            {editing?.status === 'draft' && <Button disabled={busy || dirty} onClick={() => publish(editing)}>Xに公開</Button>}
            {editing?.published_article_id && <a className="self-center text-sm underline" href={`https://x.com/i/status/${encodeURIComponent(editing.published_article_id)}`} target="_blank" rel="noopener noreferrer">公開記事を見る ↗</a>}
          </div>
        </div>
      </Surface>
    </div>
  </div>
}
