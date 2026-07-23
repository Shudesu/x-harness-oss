'use client'

import { useState } from 'react'
import { cubelicApi, type CubelicPublicationReconciliationResult } from '@/lib/api'
import { tokyoDateTimeLocalToIso } from '@/lib/cubelic-time'

export default function ReconciliationPanel({ humanKey, enabled }: { humanKey: string; enabled: boolean }) {
  const [jobId, setJobId] = useState('')
  const [outcome, setOutcome] = useState<'not_published' | 'published'>('not_published')
  const [recentPostsChecked, setRecentPostsChecked] = useState(10)
  const [confirmedNoPostId, setConfirmedNoPostId] = useState(false)
  const [confirmedNoPrefix, setConfirmedNoPrefix] = useState(false)
  const [postId, setPostId] = useState('')
  const [publishedAt, setPublishedAt] = useState('')
  const [result, setResult] = useState<CubelicPublicationReconciliationResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!enabled) return null

  const complete = Boolean(
    humanKey
    && jobId
    && (
      outcome === 'published'
        ? postId && publishedAt
        : recentPostsChecked >= 10 && confirmedNoPostId && confirmedNoPrefix
    ),
  )

  const submit = async () => {
    if (!complete) return
    const description = outcome === 'published'
      ? 'このjobを投稿済みとして確定します。Xへの再送信は行いません。'
      : 'このjobを未投稿として失敗確定し、新しいretry identityを発行します。'
    if (!window.confirm(`${description}\njob_id=${jobId}\nよろしいですか？`)) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const response = outcome === 'published'
        ? await cubelicApi.publications.reconcile(jobId, {
          outcome,
          postId,
          publishedAt: tokyoDateTimeLocalToIso(publishedAt),
        }, humanKey)
        : await cubelicApi.publications.reconcile(jobId, {
          outcome,
          evidence: {
            recentPostsChecked,
            postIdMatchFound: false,
            fixedTextPrefixMatchFound: false,
          },
        }, humanKey)
      setResult(response.data)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '投稿結果の照合に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-violet-200 bg-violet-50 p-5">
      <h2 className="font-bold text-violet-950">結果不明の投稿を照合</h2>
      <p className="mt-1 text-sm text-violet-800">
        インシデント記録のjob IDを使用します。D1緊急停止中だけ実行でき、Xへの書き込みは行いません。
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-xs font-semibold text-violet-900">
          Publication job ID
          <input value={jobId} onChange={(event) => setJobId(event.target.value.trim())} placeholder="pub_..." className="mt-1 block w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm" />
        </label>
        <label className="text-xs font-semibold text-violet-900">
          読み取り確認の結果
          <select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)} className="mt-1 block w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm">
            <option value="not_published">該当投稿なし</option>
            <option value="published">投稿済み</option>
          </select>
        </label>
      </div>
      {outcome === 'not_published' ? (
        <div className="mt-3 grid gap-2 text-sm text-violet-950 md:grid-cols-3">
          <label className="text-xs font-semibold">
            確認した直近投稿数
            <input type="number" min={10} step={1} value={recentPostsChecked} onChange={(event) => setRecentPostsChecked(Number(event.target.value))} className="mt-1 block w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm" />
          </label>
          <label className="self-end pb-2"><input type="checkbox" checked={confirmedNoPostId} onChange={(event) => setConfirmedNoPostId(event.target.checked)} className="mr-2" />post ID一致なしを確認</label>
          <label className="self-end pb-2"><input type="checkbox" checked={confirmedNoPrefix} onChange={(event) => setConfirmedNoPrefix(event.target.checked)} className="mr-2" />固定文先頭一致なしを確認</label>
        </div>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-semibold text-violet-900">
            X post ID
            <input inputMode="numeric" value={postId} onChange={(event) => setPostId(event.target.value.trim())} className="mt-1 block w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-semibold text-violet-900">
            投稿日時（Asia/Tokyo）
            <input type="datetime-local" value={publishedAt} onChange={(event) => setPublishedAt(event.target.value)} className="mt-1 block w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm" />
          </label>
        </div>
      )}
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {result && (
        <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm text-violet-900">
          照合完了: job={result.jobId} / outcome={result.outcome} / status={result.status}
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <button disabled={!complete || busy} onClick={() => void submit()} className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-bold text-white disabled:bg-gray-300">{busy ? '照合中…' : '人間確認済みとして照合'}</button>
      </div>
    </section>
  )
}
