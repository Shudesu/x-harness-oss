'use client';
import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
type Spend = {
  pressure?: { ratio: number; factor: number };
  byCampaign?: Array<{ gateId: string; title: string; costUsd: number }>;
  priceNote?: string;
  spent: number;
  budget: number;
  projected: number;
  breakdown: Array<{ source: string; feature: string; endpoint: string; cost_usd: number }>;
};
export default function SpendPanel() {
  const [data, setData] = useState<Spend | null>(null);
  const [reauth, setReauth] = useState(false);
  useEffect(() => {
    fetchApi<{ data: Array<{ needsReauth?: boolean }> }>('/api/x-accounts')
      .then((r) => setReauth(r.data.some((a) => a.needsReauth)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    fetchApi<{ data: Spend }>('/api/usage/spend')
      .then((r) => setData(r.data))
      .catch(() => {});
  }, []);
  if (!data) return null;
  return (
    <section className="rounded-xl border bg-white p-5 mb-5">
      <>
        {reauth && (
          <p role="alert" className="text-red-700">
            Xアカウントの再接続が必要です。設定画面から接続してください。
          </p>
        )}
      </>
      <h2 className="font-semibold">今月のX API推定支出</h2>
      <p>
        ${data.spent.toFixed(2)} / 予算 ${data.budget.toFixed(2)} · 月末推定 $
        {data.projected.toFixed(2)}
      </p>
      {data.spent >= data.budget * 0.8 && (
        <p role="alert" className="text-red-700">
          {data.spent >= data.budget
            ? '予算に到達したためAPI処理を停止しています。'
            : '予算の80%に達しました。'}
        </p>
      )}
      <p className="text-xs text-gray-600">
        取得リソース数による保守的推定です。同日重複・割引・実請求との照合前です。実績のない節約額は表示しません。
      </p>
      {data.pressure && data.pressure.factor > 1 && data.pressure.ratio < 1 && (
        <p>
          予算の{Math.round(data.pressure.ratio * 100)}%に達したため、確認間隔を
          {data.pressure.factor}倍にしています。
        </p>
      )}
      {data.byCampaign?.slice(0, 3).map((g) => (
        <p key={g.gateId}>
          {g.title ?? 'キャンペーン'}: ${g.costUsd.toFixed(3)}
        </p>
      ))}
      <p className="text-xs">{data.priceNote}</p>
      <details>
        <summary>機能別内訳</summary>
        {data.breakdown.map((r, i) => (
          <p key={i}>
            {r.source} / {r.feature} / {r.endpoint}: ${r.cost_usd.toFixed(3)}
          </p>
        ))}
      </details>
    </section>
  );
}
