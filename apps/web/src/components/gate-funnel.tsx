'use client';
import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
const labels: Record<string, string> = {
  follow: 'フォロー未確認',
  follow_unavailable: 'フォロー情報を取得できません',
  budget: '予算による保留',
  pending_verify: '確認保留',
  awaiting_reply: '未照合（未投稿・非公開・反映待ちを区別できません）',
  provisional: '順位確定待ち',
  impressions: '表示回数',
  view: '参加リンク',
  line_added: 'LINE追加',
  code_issued: '合言葉発行',
  reply_matched: '投稿照合',
  verified: '条件クリア',
  won: '当選',
  lost: '参加賞・枠外',
  line_engaged: 'LINE反応',
  reply_without_code: '合言葉なし',
  account_too_new: '作成日数不足',
  x_already_used: 'Xの重複',
  multiple_codes: '複数の合言葉',
};
type Funnel = {
  budgetUsd: number;
  conditionFailures: Array<{ type: string; count: number }>;
  stages: Array<{ type: string; count: number | null; conversion: number | null }>;
  reasons: Array<{ type: string; count: number }>;
  apiCostUsd: number;
  rewardCostUsd: number | null;
  lineAddCpaUsd: number | null;
  deadLetters: number;
  pending: number;
  costNote: string;
};
export default function GateFunnel({ gateId }: { gateId: string }) {
  const [data, setData] = useState<Funnel | null>(null),
    [error, setError] = useState(''),
    [budget, setBudget] = useState(''),
    [outbox, setOutbox] = useState<
      Array<{ id: string; event: string; last_error: string; canRetry: boolean }>
    >([]);
  const load = () =>
    fetchApi<{ data: Funnel }>(`/api/engagement-gates/${gateId}/funnel`)
      .then((r) => {
        setData(r.data);
        setBudget(String(r.data.budgetUsd));
      })
      .catch((e) => setError(String(e)));
  useEffect(() => {
    void load();
  }, [gateId]);
  return (
    <div className="space-y-3 mt-4">
      {error && (
        <p role="alert" className="text-red-700 text-sm">
          {error}
        </p>
      )}
      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {data.stages.map((s) => (
              <div key={s.type} className="bg-slate-50 p-3 rounded-lg">
                <div className="text-xs text-slate-500">{labels[s.type] ?? s.type}</div>
                <div className="font-bold text-xl">
                  {s.count === null ? '—' : s.count.toLocaleString()}
                </div>
                {s.conversion !== null && (
                  <div className="text-xs">{(s.conversion * 100).toFixed(1)}%</div>
                )}
              </div>
            ))}
          </div>
          <p className="text-sm">
            X API推定 ${data.apiCostUsd.toFixed(3)} ／ LINE追加あたり{' '}
            {data.lineAddCpaUsd === null ? '原価等の情報不足' : `$${data.lineAddCpaUsd.toFixed(3)}`}{' '}
            ／ 確認中 {data.pending}件
          </p>
          <label className="block text-sm">
            この企画のAPI停止目安（USD）
            <input
              aria-label="企画予算"
              type="number"
              min="0"
              step="0.01"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="border rounded p-2 w-28 mx-2"
            />
            <button
              type="button"
              className="underline"
              onClick={async () => {
                try {
                  await fetchApi(`/api/engagement-gates/${gateId}`, {
                    method: 'PUT',
                    body: JSON.stringify({ budgetUsd: Number(budget) }),
                  });
                  await load();
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              更新
            </button>
          </label>
          <p className="text-xs text-slate-500">
            CPAは入力済みの投稿費・外部費用・特典原価が揃った場合に表示します。LINE既読を取得できたと推定しません。
          </p>
          {data.deadLetters > 0 && (
            <div className="bg-red-50 rounded p-3 text-red-800">
              <p>結果通知の要確認が {data.deadLetters}件あります。</p>
              <button
                type="button"
                className="underline text-sm"
                onClick={async () => {
                  try {
                    const r = await fetchApi<{ data: typeof outbox }>(
                      `/api/engagement-gates/${gateId}/outbox`,
                    );
                    setOutbox(r.data);
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                詳細を見る
              </button>
              {outbox.map((o) => (
                <div key={o.id} className="text-sm my-2">
                  {o.event}: {o.last_error}
                  <button
                    type="button"
                    disabled={!o.canRetry}
                    className="ml-3 underline disabled:opacity-50"
                    onClick={async () => {
                      try {
                        await fetchApi(`/api/engagement-gates/${gateId}/outbox/${o.id}/retry`, {
                          method: 'POST',
                        });
                        await load();
                        setOutbox((old) => old.filter((v) => v.id !== o.id));
                      } catch (e) {
                        setError(String(e));
                      }
                    }}
                  >
                    {o.canRetry ? '同じ送信IDで再試行' : '送信結果の個別確認が必要'}
                  </button>
                </div>
              ))}
            </div>
          )}
          <details>
            <summary className="text-sm cursor-pointer">判定理由・未照合の内訳</summary>
            {[...data.reasons, ...data.conditionFailures].map((r, index) => (
              <p key={`${r.type}-${index}`} className="text-xs mt-1">
                {labels[r.type] ?? r.type}: {r.count}
              </p>
            ))}
          </details>
        </>
      )}
    </div>
  );
}
