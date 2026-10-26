'use client';
import { useEffect, useState } from 'react';
import { API_URL, fetchApi } from '@/lib/api';
import { useCurrentAccountId } from '@/hooks/use-selected-account';
import Header from '@/components/layout/header';
type Reward = {
  label: string;
  type: 'line_message' | 'url' | 'file' | 'coupon_code';
  value: string;
  quota: number | null;
  weight: number;
  consolation: boolean;
  codesText: string;
  unitCost: string;
};
const initialReward = (): Reward => ({
  label: '特典',
  type: 'line_message',
  value: 'ご参加ありがとうございます。',
  quota: 10,
  weight: 1,
  consolation: false,
  codesText: '',
  unitCost: '',
});
export default function CampaignPage() {
  const accountId = useCurrentAccountId(),
    [connections, setConnections] = useState<Array<{ id: string; name: string }>>([]),
    [connectionId, setConnectionId] = useState('');
  const [tier, setTier] = useState('standard'),
    [title, setTitle] = useState(''),
    [slug, setSlug] = useState(''),
    [phrase, setPhrase] = useState(''),
    [post, setPost] = useState(''),
    [ends, setEnds] = useState(''),
    [follow, setFollow] = useState(false),
    [age, setAge] = useState(7),
    [settle, setSettle] = useState(60),
    [budget, setBudget] = useState(10),
    [mode, setMode] = useState('first_come'),
    [rewards, setRewards] = useState<Reward[]>([initialReward()]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [entryUrl, setEntryUrl] = useState('');
  const [postCost, setPostCost] = useState(''),
    [externalCost, setExternalCost] = useState('');
  const [scenarios, setScenarios] = useState<Array<{ id: string; name: string }>>([]),
    [selectedScenarios, setSelectedScenarios] = useState<Record<string, string>>({});
  useEffect(() => {
    fetchApi<{ data: Array<{ id: string; name: string }> }>('/api/line-connections')
      .then((r) => setConnections(r.data))
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    setScenarios([]);
    setSelectedScenarios({});
    if (connectionId)
      fetchApi<{ data: Array<{ id: string; name: string }> }>(
        `/api/line-connections/${connectionId}/proxy/scenarios`,
      )
        .then((r) => setScenarios(Array.isArray(r.data) ? r.data : []))
        .catch(() => {});
  }, [connectionId]);
  function changeTier(value: string) {
    setTier(value);
    setAge(value === 'strict' ? 30 : 7);
    setSettle(value === 'strict' ? 180 : 60);
    setFollow(value === 'strict');
    if (value === 'simple')
      setRewards((old) =>
        old.some((r) => r.quota === null && r.type !== 'coupon_code')
          ? old
          : [...old, { ...initialReward(), label: '参加特典', quota: null, consolation: true }],
      );
  }
  function updateReward(index: number, patch: Partial<Reward>) {
    setRewards((old) => old.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  async function create() {
    setBusy(true);
    setError('');
    setEntryUrl('');
    try {
      const postId = post.match(/\/status\/(\d+)/)?.[1] ?? post.trim();
      const result = await fetchApi<{ data: { entryUrl: string } }>('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'line_first',
          xAccountId: accountId,
          lineConnectionId: connectionId,
          title,
          slug,
          claimPhrase: phrase,
          postId,
          endsAt: new Date(ends).toISOString(),
          tier,
          awardMode: mode,
          requireFollow: follow,
          minAccountAgeDays: age,
          settleSec: settle,
          budgetUsd: budget,
          postCostUsd: postCost === '' ? undefined : Number(postCost),
          externalCostUsd: externalCost === '' ? undefined : Number(externalCost),
          scenarios: selectedScenarios,
          rewards: rewards.map((r) => ({
            ...r,
            unitCost: r.unitCost === '' ? undefined : Number(r.unitCost),
            codes: r.codesText
              .split(/\r?\n/)
              .map((v) => v.trim())
              .filter(Boolean),
          })),
        }),
      });
      setEntryUrl(result.data.entryUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : '作成に失敗しました');
    } finally {
      setBusy(false);
    }
  }
  const inputClass = 'w-full rounded-lg border border-slate-200 bg-white p-3 text-sm';
  return (
    <div>
      <Header
        title="LINE先行キャンペーン"
        description="LINEで合言葉を受け取り、本人のX投稿と照合します。参加者のX ID入力はありません。"
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <section className="rounded-xl border bg-white p-5 space-y-4">
            <h2 className="font-semibold">1. 参加方法</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                ['simple', 'かんたん', 'LINEで参加。Xの投稿は不要'],
                ['standard', '標準', '合言葉を投稿して参加'],
                ['strict', '厳格', 'フォロー・作成日・投稿の再確認'],
              ].map(([value, name, description]) => (
                <label
                  key={value}
                  className={`rounded-lg border p-3 ${tier === value ? 'border-green-600 bg-green-50' : ''}`}
                >
                  <input
                    type="radio"
                    name="tier"
                    checked={tier === value}
                    onChange={() => changeTier(value)}
                  />
                  <strong className="ml-2">{name}</strong>
                  <p className="text-xs mt-2 text-slate-600">{description}</p>
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              厳格では作成30日以上・フォロワー5人以上・フォロー・投稿の再確認と不正防止チェックを使います。Xログインは行いません。公開された投稿の照合であり、アカウント所有権を完全に証明するものではありません。
            </p>
          </section>
          <section className="rounded-xl border bg-white p-5 space-y-3">
            <h2 className="font-semibold">2. 企画と告知投稿</h2>
            <label className="block text-sm">
              企画名
              <input
                required
                maxLength={100}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-sm">
              参加URLの末尾（英小文字・数字・ハイフン）
              <input
                required
                pattern="[a-z0-9-]{2,64}"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-sm">
              合言葉の共通フレーズ（2〜8文字）
              <input
                required
                minLength={2}
                maxLength={8}
                placeholder="春プレ"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-sm">
              作成済みのX告知投稿URL
              <input
                required
                placeholder="https://x.com/.../status/..."
                value={post}
                onChange={(e) => setPost(e.target.value)}
                className={inputClass}
              />
            </label>
            <p className="text-xs text-slate-500">
              この画面はXに投稿しません。告知投稿に参加URLを案内してください。
            </p>
            <label className="block text-sm">
              終了日時（この端末のタイムゾーン）
              <input
                required
                type="datetime-local"
                value={ends}
                onChange={(e) => setEnds(e.target.value)}
                className={inputClass}
              />
            </label>
          </section>
          <section className="rounded-xl border bg-white p-5 space-y-3">
            <h2 className="font-semibold">3. 条件と確定方法</h2>
            <select
              aria-label="確定方法"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className={inputClass}
            >
              <option value="first_come">先着（確認できた投稿を投稿時刻順）</option>
              <option value="lottery">在庫付き抽選</option>
            </select>
            {tier !== 'simple' && (
              <>
                <label className="block">
                  <input
                    type="checkbox"
                    checked={follow}
                    disabled={tier === 'strict'}
                    onChange={(e) => setFollow(e.target.checked)}
                  />{' '}
                  フォローを確認する（追加API利用）
                </label>
                <label className="block text-sm">
                  Xアカウント作成からの最低日数
                  <input
                    type="number"
                    min={tier === 'strict' ? 30 : 0}
                    max={3650}
                    value={age}
                    onChange={(e) => setAge(Number(e.target.value))}
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm">
                  照合後の確定待ち（秒）
                  <input
                    type="number"
                    min={0}
                    max={300}
                    value={settle}
                    onChange={(e) => setSettle(Number(e.target.value))}
                    className={inputClass}
                  />
                </label>
                <p className="text-xs text-slate-500">
                  検索への反映遅延を待ちます。確定後に見つかった古い投稿によって、配布済みの特典は取り消しません。
                </p>
              </>
            )}
            <label className="block text-sm">
              この企画のX API停止目安（USD）
              <input
                type="number"
                min={0}
                step="0.01"
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                className={inputClass}
              />
            </label>
            <p className="text-xs text-slate-500">
              合言葉のない投稿も検索料金の対象になる場合があります。処理中の課金まで含む請求上限の保証ではありません。
            </p>
            <label className="block text-sm">
              告知投稿のAPI費用（USD／手動投稿なら0・不明なら空欄）
              <input
                type="number"
                min={0}
                step="0.01"
                value={postCost}
                onChange={(e) => setPostCost(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-sm">
              広告などの外部費用（USD／使わなければ0）
              <input
                type="number"
                min={0}
                step="0.01"
                value={externalCost}
                onChange={(e) => setExternalCost(e.target.value)}
                className={inputClass}
              />
            </label>
          </section>
          <section className="rounded-xl border bg-white p-5 space-y-4">
            <h2 className="font-semibold">4. 特典</h2>
            {rewards.map((r, i) => (
              <div key={i} className="border rounded-lg p-4 space-y-2">
                <input
                  aria-label={`特典${i + 1}の名前`}
                  required
                  value={r.label}
                  onChange={(e) => updateReward(i, { label: e.target.value })}
                  className={inputClass}
                />
                <select
                  aria-label="特典種類"
                  value={r.type}
                  onChange={(e) => updateReward(i, { type: e.target.value as Reward['type'] })}
                  className={inputClass}
                >
                  <option value="line_message">メッセージ</option>
                  <option value="url">特典URL</option>
                  <option value="file">ファイルURL</option>
                  <option value="coupon_code">個別コード</option>
                </select>
                {r.type === 'coupon_code' ? (
                  <>
                    <textarea
                      required
                      placeholder="1行1コード"
                      aria-label="個別コード一覧"
                      value={r.codesText}
                      onChange={(e) => updateReward(i, { codesText: e.target.value })}
                      className={inputClass}
                    />
                    <label className="text-xs">
                      CSVから読み込む（1列目がコード）
                      <input
                        type="file"
                        accept=".csv,.txt"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const lines = (await file.text())
                            .split(/\r?\n/)
                            .map((line) =>
                              (line.startsWith('"')
                                ? line.match(/^"((?:[^"]|"")*)"/)?.[1]?.replaceAll('""', '"')
                                : line.split(',')[0]
                              )?.trim(),
                            )
                            .filter((v): v is string => !!v && v.toLowerCase() !== 'code');
                          updateReward(i, { codesText: lines.join('\n') });
                        }}
                      />
                    </label>
                  </>
                ) : (
                  <textarea
                    required
                    aria-label="特典内容"
                    value={r.value}
                    onChange={(e) => updateReward(i, { value: e.target.value })}
                    className={inputClass}
                  />
                )}
                <label className="block text-sm">
                  <input
                    type="checkbox"
                    checked={r.quota === null}
                    onChange={(e) => updateReward(i, { quota: e.target.checked ? null : 10 })}
                  />{' '}
                  在庫上限なし
                </label>
                {r.quota !== null && (
                  <label className="block text-sm">
                    在庫
                    <input
                      type="number"
                      min={0}
                      value={r.quota}
                      onChange={(e) => updateReward(i, { quota: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </label>
                )}
                <label className="block text-sm">
                  <input
                    type="checkbox"
                    checked={r.consolation}
                    onChange={(e) => updateReward(i, { consolation: e.target.checked })}
                  />{' '}
                  参加賞として使う
                </label>
                {mode === 'lottery' && (
                  <label className="block text-sm">
                    抽選の重み（参加賞も含めた相対値）
                    <input
                      type="number"
                      min={0}
                      value={r.weight}
                      onChange={(e) => updateReward(i, { weight: Number(e.target.value) })}
                      className={inputClass}
                    />
                  </label>
                )}
                <label className="block text-sm">
                  1件の特典原価（USD・任意）
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={r.unitCost}
                    onChange={(e) => updateReward(i, { unitCost: e.target.value })}
                    className={inputClass}
                  />
                </label>
                {rewards.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRewards((old) => old.filter((_, j) => i !== j))}
                    className="text-sm text-red-700"
                  >
                    この特典を削除
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              disabled={rewards.length >= 10}
              onClick={() =>
                setRewards((old) => [
                  ...old,
                  {
                    ...initialReward(),
                    label: '参加賞',
                    quota: null,
                    consolation: true,
                    weight: 9,
                  },
                ])
              }
              className="text-sm text-green-800"
            >
              ＋ 特典・参加賞を追加
            </button>
          </section>
          <section className="rounded-xl border bg-white p-5 space-y-3">
            <h2 className="font-semibold">5. LINE連携</h2>
            <select
              required
              aria-label="LINE接続"
              value={connectionId}
              onChange={(e) => setConnectionId(e.target.value)}
              className={inputClass}
            >
              <option value="">接続を選択</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500">
              先に設定画面で署名用の連携キーを設定してください。ブラウザにはLINE
              APIキーを返しません。
            </p>
            {[
              ['claimed', '条件クリア時'],
              ['won', '当選時'],
              ['lost', '参加賞・対象外時'],
            ].map(([k, label]) => (
              <label key={k} className="block text-sm">
                {label}のシナリオ
                <select
                  value={selectedScenarios[k] ?? ''}
                  onChange={(e) => setSelectedScenarios((old) => ({ ...old, [k]: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">開始しない</option>
                  {scenarios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </section>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">
              {error}
            </p>
          )}
          {entryUrl && (
            <div role="status" className="rounded-lg bg-green-50 p-4">
              <p>参加リンクを作成しました。</p>
              <a href={entryUrl} className="break-all underline">
                {entryUrl}
              </a>
            </div>
          )}
          <button
            disabled={busy || !accountId}
            className="w-full rounded-xl bg-green-800 p-4 font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'LINE連携を準備しています…' : '参加リンクを作成する'}
          </button>
        </form>
        <aside className="space-y-4 lg:sticky lg:top-6 self-start">
          <div className="rounded-2xl bg-slate-950 text-white p-6">
            <p className="text-xs text-green-200">参加者に見える流れ</p>
            <h2 className="text-xl font-bold mt-3">{title || '企画名'}</h2>
            <ol className="mt-4 space-y-3 text-sm">
              <li>① LINEで参加</li>
              {tier !== 'simple' && <li>② {phrase || '合言葉'}-ABCDE を投稿</li>}
              <li>③ LINEに結果と特典</li>
            </ol>
            <p className="text-xs text-slate-300 mt-5">
              参加者のX ID入力はありません。結果をXへ自動投稿・DMすることもありません。
            </p>
          </div>
          <div className="rounded-xl border bg-white p-5">
            <h3 className="font-semibold">LINEメッセージのイメージ</h3>
            <p className="mt-3 text-sm">
              {tier === 'simple'
                ? '参加すると特典を確認できます。'
                : 'あなただけの合言葉です。ボタンからXを開いて投稿してください。'}
            </p>
            {tier !== 'simple' && (
              <p className="bg-green-50 text-center p-4 mt-3 rounded-lg font-bold">
                {phrase || '合言葉'}-ABCDE
              </p>
            )}
            <p className="text-xs text-slate-500 mt-3">
              期限・条件・在庫は保存した設定で判定します。
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
