'use client'

import { useState, useEffect } from 'react'
import { fetchApi } from '@/lib/api'
import {useCurrentAccountId} from '@/hooks/use-selected-account'
import AiPanel from '@/components/ai-panel'
import Header from '@/components/layout/header'

interface LineConnection {
  id: string
  name: string
  worker_url: string
  api_key?: string
  created_at: string
}

export default function SettingsPage() {
  const accountId=useCurrentAccountId()
  const [dailyDigest,setDailyDigest]=useState(false)
  const [ignoreBudget,setIgnoreBudget]=useState(false)
  const [xBudget,setXBudget]=useState('50')
  const [aiBudget,setAiBudget]=useState('5')
  const [aiModel,setAiModel]=useState('grok-4.3')
  const [budgetError,setBudgetError]=useState('')
  const [connections, setConnections] = useState<LineConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [autoEnabled, setAutoEnabled] = useState(false)
  const [autoLoading, setAutoLoading] = useState(true)
  const [autoSaving, setAutoSaving] = useState(false)

  // New connection form
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      const res = await fetchApi<{ success: boolean; data: LineConnection[] }>('/api/line-connections')
      if (res.success) setConnections(res.data)
    } catch { /* ignore */ }
    setLoading(false)
  }

  const loadSettings = async () => {
    try {
      const res = await fetchApi<{ success: boolean; data: Record<string, string> }>('/api/settings')
      if (res.success) {
        setAutoEnabled(res.data.auto_features_enabled === 'true')
        setXBudget(res.data.x_monthly_budget_usd ?? '50')
        setDailyDigest(res.data.ai_digest_enabled==='true')
        setIgnoreBudget(res.data.scheduled_posts_ignore_budget==='true')
        setAiBudget(res.data.xai_monthly_budget_usd ?? '5')
        setAiModel(res.data.xai_model ?? 'grok-4.3')
      }
    } catch { /* ignore */ }
    setAutoLoading(false)
  }

  const toggleAuto = async () => {
    const newValue = !autoEnabled
    if (newValue && !confirm(
      '⚠️ 自動機能を有効にすると X API 使用料が発生します。\n\n' +
      '・ゲートの取得リソース数に応じた課金\n' +
      '・予約投稿はこの設定と独立して実行\n' +
      '・ステップシーケンスの自動実行\n\n' +
      '設定した予算までAPIを利用します。有効にしますか？'
    )) return
    setAutoSaving(true)
    try {
      await fetchApi('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ auto_features_enabled: String(newValue) }),
      })
      setAutoEnabled(newValue)
    } catch { /* ignore */ }
    setAutoSaving(false)
  }

  useEffect(() => { load(); loadSettings() }, [])

  const handleAdd = async () => {
    if (!name || !url || !apiKey) return
    setSaving(true)
    try {
      await fetchApi('/api/line-connections', {
        method: 'POST',
        body: JSON.stringify({ name, workerUrl: url.replace(/\/$/, ''), apiKey }),
      })
      setName('')
      setUrl('')
      setApiKey('')
      await load()
    } catch { /* ignore */ }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('削除しますか？')) return
    await fetchApi(`/api/line-connections/${id}`, { method: 'DELETE' })
    await load()
  }

  const [testResults, setTestResults] = useState<Record<string, string>>({})
  const handleTest = async (conn: LineConnection) => {
    setTestResults(prev => ({ ...prev, [conn.id]: '...' }))
    try {
      const res = await fetchApi<{success:boolean}>(`/api/line-connections/${conn.id}/proxy/friends?limit=1`)
      setTestResults(prev => ({
        ...prev,
        [conn.id]: res.success ? '✅ 接続OK' : '❌ 接続失敗',
      }))
    } catch (err) {
      setTestResults(prev => ({ ...prev, [conn.id]: `❌ ${err}` }))
    }
  }

  return (
    <div>
      <Header title="設定" description="自動機能・L Harness 接続の管理" />

      <div className="max-w-2xl space-y-6">
        <section className="bg-white border rounded p-5 space-y-3"><h2>API予算とAI設定</h2><label className="block"><input type="checkbox" checked={dailyDigest} onChange={async e=>{const value=e.target.checked;try{await fetchApi('/api/settings',{method:'PUT',body:JSON.stringify({ai_digest_enabled:String(value)})});setDailyDigest(value)}catch(err){setBudgetError(err instanceof Error?err.message:'保存失敗')}}}/>毎朝8時にダイジェストを生成</label><label className="block"><input type="checkbox" checked={ignoreBudget} onChange={async e=>{const value=e.target.checked;try{await fetchApi('/api/settings',{method:'PUT',body:JSON.stringify({scheduled_posts_ignore_budget:String(value)})});setIgnoreBudget(value)}catch(err){setBudgetError(err instanceof Error?err.message:'保存失敗')}}}/>予算到達後も明示的に予約した投稿を実行</label><label className="block">X 月予算（USD）<input type="number" min="0" value={xBudget} onChange={e=>setXBudget(e.target.value)} className="border p-2"/></label><label className="block">AI 月予算（USD）<input type="number" min="0" value={aiBudget} onChange={e=>setAiBudget(e.target.value)} className="border p-2"/></label><label className="block">モデル<select value={aiModel} onChange={e=>setAiModel(e.target.value)}><option>grok-4.3</option><option>grok-4.7</option></select></label><button onClick={async()=>{try{await fetchApi('/api/settings',{method:'PUT',body:JSON.stringify({x_monthly_budget_usd:xBudget,xai_monthly_budget_usd:aiBudget,xai_model:aiModel})});setBudgetError('保存しました')}catch(e){setBudgetError(e instanceof Error?e.message:'保存失敗')}}} className="border px-3 py-2">予算・モデルを保存</button><p role="status">{budgetError}</p><p>Grokは任意です。サーバーで XAI_API_KEY を設定すると有効になります。自動ダイジェストは ai_digest_enabled 設定で有効化できます。</p></section>
        <section className="border rounded bg-white p-5"><h2>フォロワー同期</h2><p>通常更新は直近エンゲージャーのプロフィールを更新します。新規フォロワーの全件発見は全件同期を使用してください。</p><button className="border p-2" onClick={async()=>{try{await fetchApi(`/api/x-accounts/${accountId}/followers/sync`,{method:'POST',body:'{}'});setBudgetError('更新候補を同期しました')}catch(e){setBudgetError(e instanceof Error?e.message:'同期失敗')}}}>更新候補のみ同期</button><button className="border p-2" onClick={async()=>{try{const stats=await fetchApi<{data:{current:{followersCount:number}|null}}>(`/api/x-accounts/${accountId}/stats`);const n=stats.data.current?.followersCount;const message=n===undefined?'フォロワー数が未取得です。全件同期は取得人数に応じて課金されます。':'全件同期は最大目安 $'+(n*.01).toFixed(2)+'（'+n+'人 × $0.01、保存済み人数による推定）です。';if(!confirm(message+' 続行しますか？'))return;await fetchApi(`/api/x-accounts/${accountId}/followers/sync?full=1`,{method:'POST',body:JSON.stringify({confirmFull:true})});setBudgetError('全件同期しました')}catch(e){setBudgetError(e instanceof Error?e.message:'同期失敗')}}}>全件同期（料金を確認）</button></section>
        <section className="border rounded bg-white p-5"><h2>X OAuth 2.0 接続</h2><p>サーバーでOAuthクライアントを設定後、Xの認可画面で接続します。</p><button className="border rounded px-3 py-2" onClick={async()=>{try{const r=await fetchApi<{data:{authorizationUrl:string}}>('/api/x/oauth/start',{method:'POST'});window.location.assign(r.data.authorizationUrl)}catch(e){setBudgetError(e instanceof Error?e.message:'接続開始失敗')}}}>Xを接続・再接続</button></section>
        <AiPanel />
        {/* 自動機能トグル */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">自動機能</h2>
              <p className="text-xs text-gray-500 mt-1">
                エンゲージメントゲート・ステップシーケンスの自動実行
              </p>
            </div>
            {autoLoading ? (
              <div className="w-12 h-6 bg-gray-200 rounded-full animate-pulse" />
            ) : (
              <button
                onClick={toggleAuto}
                disabled={autoSaving}
                className={`relative w-12 h-6 rounded-full transition-colors ${autoEnabled ? 'bg-green-500' : 'bg-gray-300'} ${autoSaving ? 'opacity-50' : ''}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${autoEnabled ? 'translate-x-6' : ''}`} />
              </button>
            )}
          </div>
          {!autoEnabled && !autoLoading && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs text-amber-700">
                <strong>オフ</strong> — cron ジョブは停止中です。ゲートのポーリング・予約投稿・ステップシーケンスは実行されません。
                API 使用料は発生しません。
              </p>
            </div>
          )}
          {autoEnabled && !autoLoading && (
            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-xs text-green-700">
                <strong>オン</strong> — 5分ごとに自動実行されます。取得リソース数と送信内容に応じたX API料金が発生します。予算と機能別内訳はダッシュボードで確認できます。
              </p>
            </div>
          )}
        </div>

        {/* 登録済み一覧 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">L Harness 接続先</h2>

          {loading ? (
            <p className="text-sm text-gray-400">読み込み中...</p>
          ) : connections.length === 0 ? (
            <p className="text-sm text-gray-400">接続先が未登録です</p>
          ) : (
            <div className="space-y-3">
              {connections.map((conn) => (
                <div key={conn.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{conn.name}</p>
                    <p className="text-xs text-gray-400">{conn.worker_url}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {testResults[conn.id] && (
                      <span className="text-xs">{testResults[conn.id]}</span>
                    )}
                    <button
                      onClick={() => handleTest(conn)}
                      className="px-2 py-1 text-xs text-gray-500 bg-white border border-gray-200 rounded hover:bg-gray-50"
                    >
                      テスト
                    </button>
                    <button
                      onClick={() => handleDelete(conn.id)}
                      className="px-2 py-1 text-xs text-red-500 bg-white border border-red-200 rounded hover:bg-red-50"
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 新規追加 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">接続先を追加</h2>
          <div className="space-y-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="名前（例: 本番、テスト環境）"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Worker URL（例: https://line-crm-worker.workers.dev）"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="API Key（lh_xxxxxxxx）"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleAdd}
              disabled={saving || !name || !url || !apiKey}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? '追加中...' : '追加'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
