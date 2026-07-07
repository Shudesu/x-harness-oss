'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import type { NewsStory } from '@/lib/api'
import Header from '@/components/layout/header'
import { useCurrentAccountId } from '@/hooks/use-selected-account'

export default function NewsPage() {
  const router = useRouter()
  const selectedAccountId = useCurrentAccountId()
  const [query, setQuery] = useState('')
  const [stories, setStories] = useState<NewsStory[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')

  const search = async () => {
    if (!query.trim()) return
    setSearching(true)
    setError('')
    try {
      const res = await api.news.search({
        query: query.trim(),
        maxResults: 10,
        xAccountId: selectedAccountId || undefined,
      })
      setStories(res.data)
      setSearched(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ニュース検索に失敗しました')
    } finally {
      setSearching(false)
    }
  }

  const draftFromStory = (story: NewsStory) => {
    const parts: string[] = []
    if (story.hook) parts.push(`> ${story.hook}`)
    if (story.summary) parts.push(story.summary)
    sessionStorage.setItem('xh_article_prefill', JSON.stringify({
      title: story.name ?? '',
      body: parts.join('\n\n'),
    }))
    router.push('/articles')
  }

  return (
    <div>
      <Header
        title="ニュース"
        description="X上のブレイキングニュースを検索して記事ネタを収集（検索1回 $0.005）"
      />

      {/* 検索バー */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className="flex gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // isComposing: don't fire on the Enter that confirms Japanese IME conversion
              if (e.key === 'Enter' && !searching && !e.nativeEvent.isComposing) search()
            }}
            placeholder="トピックを入力（例: AI, 生成AI, スタートアップ）"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={search}
            disabled={searching || !query.trim()}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-40 transition-opacity shrink-0"
            style={{ backgroundColor: '#1D9BF0' }}
          >
            {searching ? '検索中…' : '検索'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800">{error}</div>
      )}

      {/* 結果 */}
      {searched && stories.length === 0 && !error && (
        <p className="text-sm text-gray-400 py-10 text-center">該当するニュースが見つかりませんでした</p>
      )}

      <div className="space-y-4">
        {stories.map((story, i) => {
          const posts = story.cluster_posts_results ?? []
          return (
            <div key={story.id ?? i} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  {story.category && (
                    <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-600 mb-1.5">
                      {story.category}
                    </span>
                  )}
                  <h2 className="text-base font-bold text-gray-900">{story.name ?? '（無題）'}</h2>
                  {story.hook && <p className="mt-1 text-sm font-medium text-gray-600">{story.hook}</p>}
                </div>
                <button
                  onClick={() => draftFromStory(story)}
                  className="shrink-0 px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-gray-900 hover:bg-gray-700 transition-colors"
                >
                  記事の下書きへ
                </button>
              </div>

              {story.summary && (
                <p className="mt-3 text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{story.summary}</p>
              )}

              {posts.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 mb-1.5">関連ポスト（{posts.length}件）</p>
                  <div className="flex flex-wrap gap-2">
                    {posts.slice(0, 10).map((p) => (
                      <a
                        key={p.post_id}
                        href={`https://x.com/i/status/${p.post_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {p.post_id.slice(-6)}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
