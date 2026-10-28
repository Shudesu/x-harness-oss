'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/header';
import { fetchApi, API_URL } from '@/lib/api';
import GateFunnel from '@/components/gate-funnel';
import ExternalSource from '@/components/external-source';
type Gate = {
  id: string;
  postId: string;
  title?: string;
  slug?: string;
  gateMode?: string;
  tier?: string;
  isActive: boolean;
  canResume?: boolean;
  gateState?: string;
  pauseReason?: string;
};
export default function Gates() {
  const [gates, setGates] = useState<Gate[]>([]),
    [error, setError] = useState(''),
    [expanded, setExpanded] = useState<string | null>(null);
  const load = () =>
    fetchApi<{ data: Gate[] }>('/api/engagement-gates')
      .then((r) => setGates(r.data))
      .catch((e) => setError(String(e)));
  useEffect(() => {
    void load();
  }, []);
  return (
    <div>
      <Header
        title="キャンペーン・ゲート"
        description="参加からLINEの結果通知までを確認できます。"
      />
      <Link
        href="/campaign"
        className="inline-block bg-green-800 text-white rounded-lg px-5 py-3 mb-5"
      >
        LINE先行キャンペーンを作成
      </Link>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="space-y-4">
        {gates.map((g) => (
          <section key={g.id} className="bg-white border rounded-xl p-5">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <h2 className="font-semibold">{g.title || `投稿 ${g.postId}`}</h2>
                <p className="text-xs text-slate-500">
                  {g.gateMode === 'line_first'
                    ? `${g.tier} / ${g.gateState}`
                    : '旧方式：LINE先行への切り替え対象'}
                </p>
              </div>
              <div className="flex gap-3 text-sm">
                {g.gateMode === 'line_first' && (
                  <button
                    onClick={() => setExpanded(expanded === g.id ? null : g.id)}
                    className="underline"
                  >
                    ファネル
                  </button>
                )}
                <button
                  onClick={async () => {
                    try {
                      await fetchApi(`/api/engagement-gates/${g.id}`, {
                        method: 'PUT',
                        body: JSON.stringify({ isActive: !g.isActive }),
                      });
                      await load();
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                  disabled={!g.isActive && !g.canResume}
                  className="underline disabled:opacity-40"
                >
                  {g.isActive ? '一時停止' : '再開'}
                </button>
                <button
                  className="text-red-700"
                  onClick={async () => {
                    if (
                      !confirm(
                        '受付を終了して一覧からアーカイブします。参加・配布履歴は保持します。',
                      )
                    )
                      return;
                    try {
                      await fetchApi(`/api/engagement-gates/${g.id}`, { method: 'DELETE' });
                      await load();
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  アーカイブ
                </button>
              </div>
            </div>
            {g.slug && (
              <a
                href={`${API_URL}/c/${g.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block mt-3 text-sm text-blue-700 underline break-all"
              >
                {API_URL}/c/{g.slug}
              </a>
            )}
            {g.pauseReason && (
              <p className="text-amber-800 text-sm mt-3">
                {g.pauseReason === 'legacy_delivery_requires_migration'
                  ? '公開トークンや参加者から始めていない接触を含む旧式配布は停止しています。新しい参加リンクを作成してください。'
                  : g.pauseReason}
              </p>
            )}
            {g.gateMode === 'line_first' && <ExternalSource gateId={g.id} active={g.isActive} />}
            {expanded === g.id && <GateFunnel gateId={g.id} />}
          </section>
        ))}
      </div>
    </div>
  );
}
