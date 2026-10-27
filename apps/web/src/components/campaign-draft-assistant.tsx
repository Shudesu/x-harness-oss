'use client';
import { useState } from 'react';
import { fetchApi } from '@/lib/api';
export type Draft = {
  title: string;
  slug: string;
  claimPhrase: string;
  announcementText: string;
  winnerMessage: string;
  loserMessage: string;
  endsAt: string;
  rewards: Array<{
    label: string;
    type: 'coupon_code' | 'url' | 'file' | 'line_message';
    quota: number | null;
    consolation: boolean;
  }>;
  notes: string[];
};
const labels: Record<keyof Draft, string> = {
  title: '企画名',
  slug: 'URL末尾',
  claimPhrase: '合言葉',
  announcementText: '告知文',
  winnerMessage: '当選時の文面',
  loserMessage: '枠外の文面',
  endsAt: '終了日時',
  rewards: '特典候補',
  notes: '補足',
};
export default function CampaignDraftAssistant({
  accountId,
  tier,
  awardMode,
  entryUrl,
  onApply,
}: {
  accountId: string | null | undefined;
  tier: string;
  awardMode: string;
  entryUrl: string;
  onApply: (draft: Partial<Draft>) => void;
}) {
  const [brief, setBrief] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<{
      draft: Draft;
      validation: { ok: boolean; errors: Array<{ field: string; code: string }> };
      generated: boolean;
      reason?: string;
    } | null>(null),
    [selected, setSelected] = useState<Record<string, boolean>>({});
  async function generate() {
    setBusy(true);
    setError('');
    try {
      const { data } = await fetchApi<{ data: NonNullable<typeof result> }>(
        '/api/campaigns/draft',
        { method: 'POST', body: JSON.stringify({ xAccountId: accountId, brief, tier, awardMode }) },
      );
      setResult(data);
      setSelected(Object.fromEntries(Object.keys(data.draft).map((k) => [k, true])));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-xl border bg-green-50 p-5 space-y-3">
      <h2 className="font-semibold">1行で説明して下書きを作る</h2>
      <textarea
        maxLength={500}
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        placeholder="春の新作、先着30名にクーポン、1週間"
        className="border rounded p-3 w-full"
      />
      <button
        type="button"
        disabled={busy || !brief.trim() || !accountId}
        onClick={generate}
        className="border rounded p-2"
      >
        {busy ? '下書きを準備中…' : '下書きを作る'}
      </button>
      <p className="text-xs">
        保存・Xへの投稿は行いません。告知文はご自身で投稿し、そのURLを下の欄に貼ってください。
      </p>
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          <p>{result.reason}</p>
          {(Object.keys(labels) as Array<keyof Draft>).map((key) => (
            <div key={key} className="bg-white border rounded p-3">
              <label>
                <input
                  type="checkbox"
                  checked={!!selected[key]}
                  onChange={(e) => setSelected((old) => ({ ...old, [key]: e.target.checked }))}
                />{' '}
                {labels[key]}を反映
              </label>
              <pre className="whitespace-pre-wrap text-sm mt-2">
                {key === 'announcementText'
                  ? result.draft[key].replaceAll('{entryUrl}', entryUrl || '{entryUrl}')
                  : typeof result.draft[key] === 'string'
                    ? result.draft[key]
                    : JSON.stringify(result.draft[key], null, 2)}
              </pre>
              {result.validation.errors
                .filter((e) => e.field === key)
                .map((e, i) => (
                  <p className="text-red-700 text-sm" key={i}>
                    {e.code}
                  </p>
                ))}
            </div>
          ))}
          {result.validation.errors
            .filter((e) => !(e.field in labels))
            .map((e, i) => (
              <p className="text-red-700" key={i}>
                {e.code}
              </p>
            ))}
          <button
            type="button"
            onClick={() =>
              onApply(Object.fromEntries(Object.entries(result.draft).filter(([k]) => selected[k])))
            }
            className="rounded bg-green-800 text-white p-3"
          >
            フォームに反映（保存しません）
          </button>
          <button
            type="button"
            className="border p-3 ml-2"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  result.draft.announcementText.replaceAll('{entryUrl}', entryUrl || '{entryUrl}'),
                );
                setError('告知文をコピーしました。参加URLと合言葉をご確認ください。');
              } catch {
                setError('告知文を選択してコピーしてください。');
              }
            }}
          >
            告知文をコピー
          </button>
          {Date.parse(result.draft.endsAt) > Date.now() + 72 * 3600000 && (
            <p className="text-xs">
              合言葉の有効期限は発行から最大72時間です。終了まで72時間を超える場合、参加者が再発行することがあります。
            </p>
          )}
        </>
      )}
    </section>
  );
}
