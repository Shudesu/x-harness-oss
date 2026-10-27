'use client';
import { useEffect, useState } from 'react';
import { fetchApi, API_URL } from '@/lib/api';
export default function LineGateConnection() {
  const [connections, setConnections] = useState<Array<{ id: string; name: string }>>([]),
    [id, setId] = useState(''),
    [secret, setSecret] = useState(''),
    [account, setAccount] = useState(''),
    [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]),
    [status, setStatus] = useState('');
  useEffect(() => {
    fetchApi<{ data: Array<{ id: string; name: string }> }>('/api/line-connections')
      .then((r) => setConnections(r.data))
      .catch(() => {});
  }, []);
  useEffect(() => {
    setAccounts([]);
    setAccount('');
    if (id)
      fetchApi<{ data: Array<{ id: string; name: string }> }>(
        `/api/line-connections/${id}/proxy/line-accounts`,
      )
        .then((r) => setAccounts(Array.isArray(r.data) ? r.data : []))
        .catch(() =>
          setStatus('LINE側のアカウント一覧を取得できません。接続設定を確認してください。'),
        );
  }, [id]);
  return (
    <section className="rounded-xl border bg-white p-5 space-y-3">
      <h2 className="font-semibold">LINE先行キャンペーンの連携</h2>
      <p className="text-sm">
        両サーバーで同じ連携キーを使います。LINE側の設定が済んでからキャンペーンを作成してください。
      </p>
      <select
        aria-label="署名連携する接続"
        className="border p-2 rounded w-full"
        value={id}
        onChange={(e) => setId(e.target.value)}
      >
        <option value="">接続を選択</option>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        aria-label="LINEアカウント"
        className="border p-2 rounded w-full"
        value={account}
        onChange={(e) => setAccount(e.target.value)}
      >
        <option value="">単一アカウントなら自動選択</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <input
        type="password"
        autoComplete="new-password"
        aria-label="連携キー"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        placeholder="32文字以上の連携キー"
        className="border p-2 rounded w-full"
      />
      <button
        type="button"
        className="border rounded p-2"
        onClick={() =>
          setSecret(
            Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
              n.toString(16).padStart(2, '0'),
            ).join(''),
          )
        }
      >
        新しいキーを生成
      </button>
      <button
        type="button"
        className="border rounded p-2 ml-2"
        disabled={!secret}
        onClick={() => void navigator.clipboard.writeText(secret)}
      >
        キーをコピー
      </button>
      <p className="text-xs text-slate-500">
        既存キーを変更する場合はLINE側も同時に更新してください。保存後、サーバーからキーを再表示することはできません。
      </p>
      <button
        type="button"
        disabled={!id || secret.length < 32}
        className="bg-green-800 text-white rounded p-3 disabled:opacity-50"
        onClick={async () => {
          try {
            await fetchApi(`/api/line-connections/${id}/integration`, {
              method: 'PUT',
              body: JSON.stringify({
                integrationSecret: secret,
                lineAccountId: account || undefined,
              }),
            });
            setSecret('');
            setStatus('保存しました。LINE側に同じキー・接続ID・X URLを設定してください。');
          } catch (e) {
            setStatus(e instanceof Error ? e.message : '保存失敗');
          }
        }}
      >
        X側の設定を保存
      </button>
      {id && (
        <div className="text-xs break-all space-y-1">
          <p>LINE側 X_HARNESS_URL: {API_URL}</p>
          <p>LINE側 X_HARNESS_CONNECTION_ID: {id}</p>
          <p>LINE側 X_HARNESS_GATE_SECRET: コピーした連携キー</p>
        </div>
      )}
      <p role="status" className="text-sm">
        {status}
      </p>
    </section>
  );
}
