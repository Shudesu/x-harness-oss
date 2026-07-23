'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import {
  cubelicApi,
  type CubelicDraft,
  type CubelicPublicationReconciliationResult,
  type CubelicSystemStatus,
} from '@/lib/api'
import { tokyoDateTimeLocalToIso } from '@/lib/cubelic-time'

function badgeClass(status: CubelicDraft['approval_status']): string {
  if (status === 'pending_review') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (status === 'handed_off') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'rejected') return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-gray-50 text-gray-700 border-gray-200'
}

function DraftCard({ draft, humanKey, status, refresh }: { draft: CubelicDraft; humanKey: string; status: CubelicSystemStatus | null; refresh: () => Promise<void> }) {
  const [text, setText] = useState(draft.text)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const editable = draft.approval_status === 'pending_review' || draft.approval_status === 'needs_revision'
  const approvable = draft.approval_status === 'pending_review' && draft.quality_score >= 80
  const publishable = (draft.approval_status === 'approved' || draft.approval_status === 'handed_off')
    && status?.publishingEnabled === true
  const schedulable = (draft.approval_status === 'approved' || draft.approval_status === 'handed_off')
    && status?.schedulingEnabled === true

  const act = async (name: string, operation: () => Promise<unknown>) => {
    setBusy(name)
    setError('')
    try {
      await operation()
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作に失敗しました')
    } finally {
      setBusy(null)
    }
  }

  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass(draft.approval_status)}`}>{draft.approval_status}</span>
            <span className="text-xs font-medium text-gray-500">{draft.category} · {draft.target_stage} · variant {draft.variant.toUpperCase()}</span>
          </div>
          <p className="text-xs text-gray-400">{draft.draft_id}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-gray-50 px-3 py-2"><b className="block text-base text-gray-900">{draft.quality_score}</b>品質</div>
          <div className="rounded-lg bg-gray-50 px-3 py-2"><b className="block text-base text-gray-900">{draft.freshness_score}</b>速報性</div>
          <div className="rounded-lg bg-gray-50 px-3 py-2"><b className="block text-sm text-gray-900">{draft.rights_gate}</b>権利</div>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold text-gray-600">投稿本文（人間が確認・編集）</label>
        <textarea
          value={text}
          disabled={!editable}
          onChange={(event) => setText(event.target.value)}
          rows={7}
          className="w-full rounded-xl border border-gray-300 px-3 py-3 text-sm leading-6 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-gray-50"
        />
        <div className="mt-1 flex justify-between text-xs text-gray-400"><span>テンプレート {draft.template_id}@{draft.template_version}</span><span>{Array.from(text).length}文字・保存時にX weighted判定</span></div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl bg-amber-50 p-3">
          <p className="text-xs font-bold text-amber-800">人間の確認項目</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-900">{draft.human_review_required.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-xs font-bold text-slate-700">リスク・参照先</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-700">{draft.risks.map((item) => <li key={item}>{item}</li>)}</ul>
          <a className="mt-2 block truncate text-xs text-blue-600 hover:underline" href={draft.destination_url} target="_blank" rel="noreferrer">{draft.destination_url}</a>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {editable && (
        <div className="flex flex-wrap justify-end gap-2">
          <button disabled={Boolean(busy) || text === draft.text} onClick={() => act('save', () => cubelicApi.drafts.update(draft.draft_id, text))} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-40">{busy === 'save' ? '保存中…' : '本文を保存'}</button>
          <button disabled={Boolean(busy) || !humanKey} onClick={() => act('reject', () => cubelicApi.drafts.reject(draft.draft_id, humanKey))} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-40">{busy === 'reject' ? '却下中…' : '却下'}</button>
          <button disabled={Boolean(busy) || !humanKey || !approvable || text !== draft.text} onClick={() => act('approve', () => cubelicApi.drafts.approve(draft.draft_id, humanKey))} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-300">{busy === 'approve' ? '承認中…' : '承認して下書き連携'}</button>
        </div>
      )}
      {(publishable || schedulable) && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-bold text-rose-900">X公開操作</p>
          <p className="mt-1 text-xs text-rose-800">本文・権利・リンクを再確認してください。即時投稿は取り消せません。</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            {schedulable && (
              <>
                <label className="text-xs font-semibold text-rose-900">
                  予約日時（Asia/Tokyo）
                  <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className="mt-1 block rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm" />
                </label>
                <p className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs text-rose-900">
                  承認済みポリシー: <b>{draft.category}:{draft.template_id}</b>
                </p>
                <button
                  disabled={Boolean(busy) || !humanKey || !scheduledAt}
                  onClick={() => {
                    if (window.confirm(`この投稿を${scheduledAt}（Asia/Tokyo）に予約します。よろしいですか？`)) {
                      void act('schedule', () => cubelicApi.drafts.schedule(
                        draft.draft_id,
                        humanKey,
                        tokyoDateTimeLocalToIso(scheduledAt),
                        draft.template_id,
                      ))
                    }
                  }}
                  className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-bold text-rose-800 disabled:opacity-40"
                >{busy === 'schedule' ? '予約中…' : '予約を確定'}</button>
              </>
            )}
            {publishable && (
              <button
                disabled={Boolean(busy) || !humanKey}
                onClick={() => {
                  if (window.confirm('この内容を今すぐXへ投稿します。よろしいですか？')) {
                    void act('publish', () => cubelicApi.drafts.publish(draft.draft_id, humanKey))
                  }
                }}
                className="ml-auto rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold text-white disabled:bg-gray-300"
              >{busy === 'publish' ? '投稿中…' : '今すぐXへ投稿'}</button>
            )}
          </div>
        </div>
      )}
    </article>
  )
}

function ManualDraftForm({ humanKey, enabled, refresh }: { humanKey: string; enabled: boolean; refresh: () => Promise<void> }) {
  const [text, setText] = useState('')
  const [destinationUrl, setDestinationUrl] = useState('')
  const [category, setCategory] = useState<'event_notice' | 'event_reminder' | 'youtube_notice'>('event_notice')
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [privacyReviewCompleted, setPrivacyReviewCompleted] = useState(false)
  const [linkValidated, setLinkValidated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!enabled) return null

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await cubelicApi.manualDrafts.create({
        text,
        category,
        destinationUrl,
        rightsConfirmed,
        privacyReviewCompleted,
        linkValidated,
      }, humanKey)
      setText('')
      setDestinationUrl('')
      setRightsConfirmed(false)
      setPrivacyReviewCompleted(false)
      setLinkValidated(false)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '手入力下書きの作成に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const complete = Boolean(
    humanKey && text && destinationUrl
    && rightsConfirmed && privacyReviewCompleted && linkValidated,
  )

  return (
    <section className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
      <h2 className="font-bold text-emerald-950">ファイルを使わず投稿候補を作成</h2>
      <p className="mt-1 text-sm text-emerald-800">人間が入力内容・権利・プライバシー・リンクを証明した記録を監査ログへ残します。</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-xs font-semibold text-emerald-900">
          投稿カテゴリ
          <select value={category} onChange={(event) => setCategory(event.target.value as typeof category)} className="mt-1 block w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm">
            <option value="event_notice">ライブ予定</option>
            <option value="event_reminder">ライブリマインド</option>
            <option value="youtube_notice">YouTube公開通知</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-emerald-900">
          HTTPSリンク
          <input type="url" value={destinationUrl} onChange={(event) => setDestinationUrl(event.target.value)} placeholder="https://..." className="mt-1 block w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm" />
        </label>
      </div>
      <label className="mt-3 block text-xs font-semibold text-emerald-900">
        投稿本文
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} className="mt-1 block w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm leading-6" />
      </label>
      <div className="mt-3 grid gap-2 text-sm text-emerald-950 md:grid-cols-3">
        <label><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} className="mr-2" />公開権利を確認した</label>
        <label><input type="checkbox" checked={privacyReviewCompleted} onChange={(event) => setPrivacyReviewCompleted(event.target.checked)} className="mr-2" />プライバシー確認済み</label>
        <label><input type="checkbox" checked={linkValidated} onChange={(event) => setLinkValidated(event.target.checked)} className="mr-2" />リンク先を確認した</label>
      </div>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex justify-end">
        <button disabled={!complete || busy} onClick={() => void submit()} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:bg-gray-300">{busy ? '作成中…' : '人間証明付き下書きを作成'}</button>
      </div>
    </section>
  )
}

function ReconciliationPanel({ humanKey, enabled }: { humanKey: string; enabled: boolean }) {
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

export default function CubelicApprovalPage() {
  const [drafts, setDrafts] = useState<CubelicDraft[]>([])
  const [status, setStatus] = useState<CubelicSystemStatus | null>(null)
  const [humanKey, setHumanKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [systemBusy, setSystemBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [draftResponse, statusResponse] = await Promise.all([cubelicApi.drafts.list(), cubelicApi.system.status()])
      setDrafts(draftResponse.data)
      setStatus(statusResponse.data)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const toggleStop = async () => {
    if (!status || !humanKey) return
    if (status.emergencyStop && !window.confirm(
      'D1緊急停止を解除します。承認済みの投稿・予約が実行可能になります。運用を再開しますか？',
    )) return
    setSystemBusy(true)
    try {
      if (status.emergencyStop) await cubelicApi.system.resume(humanKey)
      else await cubelicApi.system.stop(humanKey)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '緊急停止操作に失敗しました')
    } finally {
      setSystemBusy(false)
    }
  }

  return (
    <main>
      <Header title="CUBΣLIC 投稿運用" description="権利・品質・文面を人間が確認し、安全境界を通してX Harnessへ渡します。" />
      <section className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-bold text-blue-950">{status?.phase3Enabled ? 'Phase 3 限定公開モード' : 'Phase 1 セーフモード'}</p>
            <p className="mt-1 text-sm text-blue-800">{status?.phase3Enabled ? '人間承認済みの即時投稿と、許可済みテンプレートの予約だけを利用できます。' : '即時投稿・予約投稿・削除・DM・自動返信・自動反応は無効です。'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="password" autoComplete="off" value={humanKey} onChange={(event) => setHumanKey(event.target.value)} placeholder="人間承認キー（保存されません）" className="w-64 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm" />
            <button disabled={!humanKey || systemBusy || status?.environmentStop || status?.emergencyStopValid === false} onClick={toggleStop} className={`rounded-lg px-4 py-2 text-sm font-bold text-white disabled:bg-gray-300 ${status?.emergencyStop ? 'bg-emerald-600' : 'bg-red-600'}`}>{systemBusy ? '処理中…' : status?.emergencyStop ? '運用を再開' : '緊急停止'}</button>
          </div>
        </div>
        {status && <p className="mt-3 text-xs text-blue-700">environment_stop={String(status.environmentStop)} / emergency_stop={String(status.emergencyStop)} / emergency_stop_valid={String(status.emergencyStopValid)} / operation_window_active={String(status.operationWindow?.active === true)} / publish={String(status.publishingEnabled)} / schedule={String(status.schedulingEnabled)}</p>}
        {status?.emergencyStopValid === false && (
          <p className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm font-bold text-red-800">
            D1緊急停止状態が欠落または不正です。運用を再開せず、管理者がD1状態を修復してください。
          </p>
        )}
      </section>

      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <ReconciliationPanel
        humanKey={humanKey}
        enabled={status?.phase3Enabled === true && status?.emergencyStop === true && status?.emergencyStopValid === true}
      />
      <ManualDraftForm humanKey={humanKey} enabled={status?.phase3Enabled === true && status?.emergencyStop === false} refresh={refresh} />
      {loading ? <p className="text-sm text-gray-500">読み込み中…</p> : drafts.length === 0 ? <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">下書きはまだありません。</p> : (
        <div className="space-y-4">{drafts.map((draft) => <DraftCard key={`${draft.draft_id}:${draft.updated_at}`} draft={draft} humanKey={humanKey} status={status} refresh={refresh} />)}</div>
      )}
    </main>
  )
}
