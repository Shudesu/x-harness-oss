'use client';
import { useState, useEffect } from 'react';
import { fetchApi } from '@/lib/api';
export default function CampaignDigestSettings() {
  const [channels, setChannels] = useState<string[]>([]),
    [weekly, setWeekly] = useState(false),
    [webhook, setWebhook] = useState(''),
    [configured, setConfigured] = useState(false),
    [email, setEmail] = useState(''),
    [gateId, setGateId] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [campaigns,setCampaigns]=useState<Array<{id:string;title:string;gateMode:string}>>([]);
  useEffect(()=>{fetchApi<{data:Array<{id:string;title:string;gateMode:string}>}>('/api/engagement-gates').then(r=>setCampaigns(r.data.filter(g=>g.gateMode==='line_first'))).catch(()=>setMessage('キャンペーン一覧を取得できませんでした。'));},[]);
  useEffect(() => {
    fetchApi<{ data: Record<string, string> }>('/api/settings')
      .then(({ data }) => {
        setChannels(JSON.parse(data.digest_channels ?? '[]'));
        setWeekly(data.digest_weekly_enabled === 'true');
        setConfigured(data.digest_slack_webhook === '(set)');
        setEmail(data.digest_email_to ?? '');
      })
      .catch(() => setMessage('通知設定を取得できませんでした。'));
  }, []);
  async function save() {
    setBusy(true);
    try {
      await fetchApi('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          digest_channels: JSON.stringify(channels),
          digest_weekly_enabled: String(weekly),
          digest_email_to: email,
          ...(webhook ? { digest_slack_webhook: webhook } : {}),
        }),
      });
      if (webhook) setConfigured(true);
      setWebhook('');
      setMessage('通知設定を保存しました。');
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function test(channel: string) {
    const target =
      channel === 'line'
        ? 'LINE側で設定した管理者'
        : channel === 'email'
          ? email
          : '保存済みSlack Webhook';
    if (
      !confirm(
        `${target} にテスト通知を1回送ります。保存済みの通知設定で送信します。よろしいですか？`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetchApi<{ data: { status: string; last_error?: string } }>(
        `/api/campaigns/${encodeURIComponent(gateId)}/digest/test`,
        { method: 'POST', body: JSON.stringify({ channel, confirm: true }) },
      );
      const labels:Record<string,string>={sent:'テスト通知を送信しました。',pending:'送信を再試行します。',skipped:'送信されませんでした。通知先と接続設定を確認してください。',dead:'送信できませんでした。通知先と接続状態を確認してください。'};
      setMessage(labels[r.data.status]??'送信状況を確認してください。');
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-xl border bg-white p-5 space-y-3">
      <h2 className="font-semibold">結果の通知</h2>
      <p className="text-sm">終了時に結果・問題・次の一手をお届けします。既定はOFFです。</p>
      <div className="flex gap-4">
        {['line', 'slack', 'email'].map((c) => (
          <label key={c}>
            <input
              type="checkbox"
              checked={channels.includes(c)}
              onChange={(e) =>
                setChannels((old) => (e.target.checked ? [...old, c] : old.filter((x) => x !== c)))
              }
            />
            {c.toUpperCase()}
          </label>
        ))}
      </div>
      <label className="block">
        Slack Webhook {configured ? '（設定済み）' : ''}
        <input
          type="password"
          value={webhook}
          onChange={(e) => setWebhook(e.target.value)}
          placeholder="https://hooks.slack.com/services/..."
          className="border p-2 w-full"
          autoComplete="new-password"
        />
      </label>
      {configured && (
        <button
          type="button"
          disabled={busy}
          className="text-sm underline"
          onClick={async () => {
            try {
              await fetchApi('/api/settings', {
                method: 'PUT',
                body: JSON.stringify({ digest_slack_webhook: '' }),
              });
              setConfigured(false);
              setWebhook('');
            } catch (e) {
              setMessage(String(e));
            }
          }}
        >
          Slack Webhookを削除
        </button>
      )}
      <label className="block">
        メール宛先（最大5件、カンマ区切り）
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border p-2 w-full"
        />
      </label>
      <p className="text-xs">
        メールは事前に配信環境と送信元の設定が必要です。LINEの受信者はLINE側で設定します。
      </p>
      <label className="block">
        <input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} />
        毎週月曜9:00 JSTにも通知
      </label>
      <button type="button" disabled={busy} onClick={save} className="border p-2 rounded">
        通知設定を保存
      </button>
      <p className="text-xs">
        X APIの追加費用はありません。LINEで受け取る場合は受信者1人・1回につき1通を消費します。
      </p>
      <label className="block">
        テスト対象のキャンペーン
        <select value={gateId} onChange={e=>setGateId(e.target.value)} className="border rounded-lg p-3 w-full"><option value="">キャンペーンを選んでください</option>{campaigns.map(g=><option key={g.id} value={g.id}>{g.title||'キャンペーン'}</option>)}</select>
        {!campaigns.length&&<span className="text-xs text-slate-500">キャンペーン作成後にテストできます。</span>}
      </label>
      <div className="flex gap-2">
        {channels.map((c) => (
          <button
            key={c}
            type="button"
            disabled={busy || !gateId}
            onClick={() => test(c)}
            className="border p-2"
          >
            {c.toUpperCase()}へテスト
          </button>
        ))}
      </div>
      <p role="status">{message}</p>
    </section>
  );
}
