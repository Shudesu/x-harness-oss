'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { cubelicApi, type CubelicDraft, type CubelicSystemStatus } from '@/lib/api'

function badgeClass(status: CubelicDraft['approval_status']): string {
  if (status === 'pending_review') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (status === 'handed_off') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'rejected') return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-gray-50 text-gray-700 border-gray-200'
}

function DraftCard({ draft, humanKey, refresh }: { draft: CubelicDraft; humanKey: string; refresh: () => Promise<void> }) {
  const [text, setText] = useState(draft.text)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const editable = draft.approval_status === 'pending_review' || draft.approval_status === 'needs_revision'
  const approvable = draft.approval_status === 'pending_review' && draft.quality_score >= 80

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
    </article>
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
      <Header title="CUBΣLIC 下書き承認" description="権利・品質・文面を人間が確認し、X Harness の inert draft inbox へ渡します。Xへの投稿は行いません。" />
      <section className="mb-6 rounded-2xl border border-blue-200 bg-blue-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-bold text-blue-950">Phase 1 セーフモード</p>
            <p className="mt-1 text-sm text-blue-800">即時投稿・予約投稿・削除・DM・自動返信・自動反応は無効です。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="password" autoComplete="off" value={humanKey} onChange={(event) => setHumanKey(event.target.value)} placeholder="人間承認キー（保存されません）" className="w-64 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm" />
            <button disabled={!humanKey || systemBusy || status?.environmentStop} onClick={toggleStop} className={`rounded-lg px-4 py-2 text-sm font-bold text-white disabled:bg-gray-300 ${status?.emergencyStop ? 'bg-emerald-600' : 'bg-red-600'}`}>{systemBusy ? '処理中…' : status?.emergencyStop ? '下書き運用を再開' : '下書き運用を緊急停止'}</button>
          </div>
        </div>
        {status && <p className="mt-3 text-xs text-blue-700">environment_stop={String(status.environmentStop)} / emergency_stop={String(status.emergencyStop)} / operation_window_active={String(status.operationWindow?.active === true)} / publish=false / schedule=false</p>}
      </section>

      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading ? <p className="text-sm text-gray-500">読み込み中…</p> : drafts.length === 0 ? <p className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">下書きはまだありません。</p> : (
        <div className="space-y-4">{drafts.map((draft) => <DraftCard key={`${draft.draft_id}:${draft.updated_at}`} draft={draft} humanKey={humanKey} refresh={refresh} />)}</div>
      )}
    </main>
  )
}
