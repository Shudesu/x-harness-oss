'use client';
import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import { useCurrentAccountId } from '@/hooks/use-selected-account';
import CampaignDraftAssistant from '@/components/campaign-draft-assistant';
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
  const [followPolicy, setFollowPolicy] = useState('none'),
    [likePolicy, setLikePolicy] = useState('none'),
    [verifyOptIn, setVerifyOptIn] = useState(false);
  const [entryPage, setEntryPage] = useState('redirect'),
    [wonMessage, setWonMessage] = useState(''),
    [lostMessage, setLostMessage] = useState('');
  const [followupEnabled, setFollowupEnabled] = useState(false),
    [followupOffer, setFollowupOffer] = useState('early_notice'),
    [followupReward, setFollowupReward] = useState(''),
    [followupLabel, setFollowupLabel] = useState('');
  const [previousCampaigns,setPreviousCampaigns]=useState<Array<{id:string;title:string;gateMode:string;lineConnectionId:string}>>([]);
  const [sourceGates, setSourceGates] = useState(''),
    [noticeCount, setNoticeCount] = useState<number | null>(null),
    [noticeConfirmed, setNoticeConfirmed] = useState(false);
  const [expectedReplies, setExpectedReplies] = useState(100),
    [estimate, setEstimate] = useState<{ low: number; high: number } | null>(null),
    [budgetEdited, setBudgetEdited] = useState(false);
  useEffect(() => {
    setNoticeConfirmed(false);
    setNoticeCount(null);
  }, [sourceGates, accountId, connectionId]);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      const quota = rewards.some((r) => !r.consolation && r.quota === null)
        ? 'unlimited'
        : String(rewards.filter((r) => !r.consolation).reduce((n, r) => n + (r.quota ?? 0), 0));
      fetchApi<{ data: { low: number; high: number } }>(
        `/api/campaigns/estimate?${new URLSearchParams({ tier, expectedReplies: String(expectedReplies), quota, verifyFollow: String(follow), awardMode: mode, days: '7' })}`,
      )
        .then(({ data }) => {
          if (current) {
            setEstimate(data);
            if (!budgetEdited) setBudget(Math.ceil(data.high * 200) / 100);
          }
        })
        .catch(() => {
          if (current) setEstimate(null);
        });
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [tier, expectedReplies, rewards, follow, mode, budgetEdited]);
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
  useEffect(()=>{
    setSourceGates('');setPreviousCampaigns([]);let current=true;
    if(accountId&&connectionId)fetchApi<{data:Array<{id:string;title:string;gateMode:string;lineConnectionId:string}>}>(`/api/engagement-gates?xAccountId=${encodeURIComponent(accountId)}`).then(r=>{if(current)setPreviousCampaigns(r.data.filter(g=>g.gateMode==='line_first'&&g.lineConnectionId===connectionId));}).catch(()=>{});
    return()=>{current=false;};
  },[accountId,connectionId]);
  function changeTier(value: string) {
    setTier(value);
    setAge(value === 'strict' ? 30 : 7);
    setSettle(value === 'strict' ? 180 : 60);
    setFollow(value === 'strict');
    setFollowPolicy(value === 'strict' ? 'verify_winners' : 'none');
    setLikePolicy('none');
    setVerifyOptIn(false);
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
          followPolicy,
          likePolicy,
          verifyConditionsOptIn: verifyOptIn,
          minAccountAgeDays: age,
          settleSec: settle,
          budgetUsd: budget,
          postCostUsd: postCost === '' ? undefined : Number(postCost),
          externalCostUsd: externalCost === '' ? undefined : Number(externalCost),
          entryPage,
          messageTemplates: {
            ...(wonMessage ? { won: wonMessage } : {}),
            ...(lostMessage ? { lost: lostMessage } : {}),
          },
          loserFollowup: {
            enabled: followupEnabled,
            offer: followupOffer,
            ...(followupReward !== '' ? { couponRewardIndex: Number(followupReward) } : {}),
            ...(followupLabel ? { label: followupLabel } : {}),
          },
          earlyNoticeFromGateIds: sourceGates
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
          confirmEarlyNotice: noticeConfirmed,
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
        title="XからLINEへ、キャンペーンを作る"
        description="企画を準備し、LINEで参加を受け付け、結果と特典を案内します。参加者のX ID入力は不要です。"
      />
      <section aria-label="作成の準備" className="mb-6 rounded-2xl border border-green-200 bg-green-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold tracking-widest text-green-800">START HERE</p><h2 className="mt-1 font-semibold text-slate-900">まずは、企画・告知投稿・LINE接続を用意。</h2><p className="mt-2 text-sm leading-6 text-slate-600">LINE連携前でも企画の下書きを作れます。保存時には、作成済みのX告知投稿URLとLINE接続が必要です。</p></div><a href="/settings" className="min-h-11 rounded-lg border border-green-300 bg-white px-4 py-3 text-sm font-medium text-green-900">接続設定を開く ↗</a></div>
        <ol className="mt-4 grid gap-2 sm:grid-cols-4">{[
          ['企画と終了日時',!!title&&!!slug&&!!phrase&&!!ends],['Xの告知投稿',!!post],['LINE接続',!!connectionId],['特典の内容',rewards.every(r=>!!r.label&&!!(r.type==='coupon_code'?r.codesText:r.value))],
        ].map(([label,ready],i)=><li key={String(label)} className="rounded-xl bg-white p-3 text-sm"><span className={ready?'text-green-800':'text-slate-500'}>{ready?'✓':String(i+1).padStart(2,'0')}</span><span className="ml-2 font-medium">{label}</span><span className="mt-1 block text-xs text-slate-500">{ready?'入力済み':'これから入力'}</span></li>)}</ol>
      </section>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <CampaignDraftAssistant
            accountId={accountId}
            tier={tier}
            awardMode={mode}
            entryUrl={entryUrl}
            onApply={(d) => {
              if (d.title !== undefined) setTitle(d.title);
              if (d.slug !== undefined) setSlug(d.slug);
              if (d.claimPhrase !== undefined) setPhrase(d.claimPhrase);
              if (d.winnerMessage !== undefined) setWonMessage(d.winnerMessage);
              if (d.loserMessage !== undefined) setLostMessage(d.loserMessage);
              if (d.endsAt) {
                const date = new Date(d.endsAt);
                setEnds(
                  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
                    .toISOString()
                    .slice(0, 16),
                );
              }
              if (d.rewards)
                setRewards(
                  d.rewards.map((r) => ({
                    ...initialReward(),
                    ...r,
                    value: r.type === 'line_message' ? '特典の内容を入力してください' : '',
                  })),
                );
            }}
          />
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
          <details className="rounded-xl border bg-white p-5" open={tier==='strict'}>
            <summary className="cursor-pointer font-semibold min-h-11">3. 先着・抽選と費用の設定</summary><div className="space-y-3 pt-3">
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
                {(['follow', 'like'] as const).map((kind) => (
                  <fieldset key={kind} className="space-y-2">
                    <legend>{kind === 'follow' ? 'フォロー' : 'いいね'}</legend>
                    {[
                      ['none', 'なし'],
                      ['ask', 'お願いする'],
                      ['verify_winners', '当選候補だけ確認する'],
                    ].map(([value, label]) => (
                      <label className="block" key={value}>
                        <input
                          type="radio"
                          name={kind + 'Policy'}
                          checked={(kind === 'follow' ? followPolicy : likePolicy) === value}
                          onChange={() => {
                            if (value === 'verify_winners' && tier !== 'strict') {
                              if (
                                !confirm(
                                  '応募条件としてのフォロー・いいねはXのガイドライン上リスクがあります。追加API費用も発生します。確認を有効にしますか？',
                                )
                              )
                                return;
                              setVerifyOptIn(true);
                            }
                            if (kind === 'follow') {
                              setFollowPolicy(value);
                              setFollow(value === 'verify_winners');
                            } else setLikePolicy(value);
                          }}
                        />
                        {label}
                      </label>
                    ))}
                  </fieldset>
                ))}
                <p className="text-xs">
                  いいね確認は最大100人までです。取得範囲の上限やページ残りがある場合、確認できない人を失格にしません。条件を確認できず繰り上げになると、後から条件を満たしても枠が残らない場合があります。
                </p>
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
              想定返信数
              <input
                type="number"
                min={0}
                max={1000000}
                value={expectedReplies}
                onChange={(e) => setExpectedReplies(Number(e.target.value))}
                className={inputClass}
              />
            </label>
            {(mode === 'lottery' || rewards.some((r) => !r.consolation && r.quota === null)) && (
              <p className="text-amber-800 text-sm">
                抽選・在庫上限なしでは全参加者が条件確認の対象です。追加費用が増える場合があります。
              </p>
            )}
            {estimate && (
              <p className="text-sm">
                この条件の見込み ${estimate.low.toFixed(2)}〜${estimate.high.toFixed(2)}
                （単価・重複係数は要確認）。
              </p>
            )}
            <label className="block text-sm">
              この企画のX API停止目安（USD）
              <input
                type="number"
                min={0}
                step="0.01"
                value={budget}
                onChange={(e) => {
                  setBudgetEdited(true);
                  setBudget(Number(e.target.value));
                }}
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
          </div></details>
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
            <label className="block">
              <input
                type="checkbox"
                checked={entryPage === 'status'}
                onChange={(e) => setEntryPage(e.target.checked ? 'status' : 'redirect')}
              />
              残り枠を示す中間ページを使う
            </label>
            <p className="text-xs">中間ページを使うと、参加までのタップが1回増えます。</p>
            <label className="block">
              当選時の文面
              <textarea
                maxLength={500}
                value={wonMessage}
                onChange={(e) => setWonMessage(e.target.value)}
                placeholder="先着 #{rank} で当選！ 残り {remaining} 名"
                className={inputClass}
              />
            </label>
            <label className="block">
              枠外・参加賞の文面
              <textarea
                maxLength={500}
                value={lostMessage}
                onChange={(e) => setLostMessage(e.target.value)}
                className={inputClass}
              />
            </label>
            <p className="text-xs">
              空欄は標準文面。使える差し込み: {'{title} {rank} {remaining} {reward}'}
            </p>
            <label className="block">
              <input
                type="checkbox"
                checked={followupEnabled}
                onChange={(e) => setFollowupEnabled(e.target.checked)}
              />
              ハズレた方へのフォロー（本人が選んだ場合のみ）
            </label>
            {followupEnabled && (
              <div className="space-y-2">
                <select
                  aria-label="フォローの内容"
                  value={followupOffer}
                  onChange={(e) => setFollowupOffer(e.target.value)}
                  className={inputClass}
                >
                  <option value="early_notice">次回のLINE先行案内</option>
                  <option value="coupon">参加賞クーポン</option>
                  <option value="both">クーポンと次回のLINE先行案内</option>
                </select>
                {followupOffer !== 'early_notice' && (
                  <label className="block">
                    オプトイン専用の参加賞
                    <select
                      required
                      value={followupReward}
                      onChange={(e) => setFollowupReward(e.target.value)}
                      className={inputClass}
                    >
                      <option value="">選択してください</option>
                      {rewards.map((r, i) =>
                        r.consolation && ['url', 'coupon_code'].includes(r.type) ? (
                          <option key={i} value={i}>
                            {r.label}
                          </option>
                        ) : null,
                      )}
                    </select>
                    <p className="text-xs">
                      選んだ特典は、通常の参加賞には配布せずオプトイン後に割り当てます。
                    </p>
                  </label>
                )}
                <label className="block">
                  ボタンの文言
                  <input
                    maxLength={40}
                    value={followupLabel}
                    onChange={(e) => setFollowupLabel(e.target.value)}
                    className={inputClass}
                  />
                </label>
              </div>
            )}
            <p className="text-xs">
              結果通知は1人1通（結果確認からreplyで届いた場合は課金対象外※）。先行案内は同意した人数×送信回数です。
            </p>
            <fieldset className="rounded-xl border border-slate-200 p-4"><legend className="px-1 text-sm font-medium">以前の参加者に先行案内を用意する（任意）</legend><p className="mb-3 text-xs leading-5 text-slate-500">同じLINE接続を使う過去の企画から選びます。次回案内に同意した方だけが対象です。最大5件。</p>{previousCampaigns.length?previousCampaigns.map(g=><label key={g.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={sourceGates.split(',').includes(g.id)} disabled={!sourceGates.split(',').includes(g.id)&&sourceGates.split(',').filter(Boolean).length>=5} onChange={e=>setSourceGates(old=>{const ids=old.split(',').filter(Boolean);return (e.target.checked?[...ids,g.id]:ids.filter(id=>id!==g.id)).join(',');})}/>{g.title||'キャンペーン'}</label>):<p className="text-sm text-slate-500">LINE接続を選ぶと、利用できる過去の企画が表示されます。</p>}</fieldset>
            {sourceGates && (
              <button
                type="button"
                className="border p-2"
                onClick={async () => {
                  try {
                    const r = await fetchApi<{ data: { estimatedPush: number } }>(
                      '/api/campaigns/early-notice/estimate',
                      {
                        method: 'POST',
                        body: JSON.stringify({
                          sourceGateIds: sourceGates
                            .split(',')
                            .map((x) => x.trim())
                            .filter(Boolean),
                          xAccountId: accountId,
                          lineConnectionId: connectionId,
                        }),
                      },
                    );
                    setNoticeCount(r.data.estimatedPush);
                    setNoticeConfirmed(
                      confirm(
                        `対象 約${r.data.estimatedPush}人＝LINE約${r.data.estimatedPush}通。作成後にLINE側へ先行案内の下書きを用意します。配信にはLINE側で承認が必要です。下書きを用意しますか？`,
                      ),
                    );
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                先行案内の対象を確認
              </button>
            )}
            {noticeCount !== null && (
              <p>
                対象 約{noticeCount}人・{noticeConfirmed ? '下書き作成を確認済み' : '未確認'}
              </p>
            )}

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
            disabled={busy || !accountId || (!!sourceGates && !noticeConfirmed)}
            className="w-full rounded-xl bg-green-800 p-4 font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'LINE連携を準備しています…' : '参加リンクを作成する'}
          </button>
        </form>
        <aside className="space-y-4 lg:sticky lg:top-6 self-start">
          <section className="rounded-xl border bg-white p-5"><h2 className="font-semibold">今回の設定</h2><dl className="mt-3 space-y-3 text-sm">{[['参加方法',tier==='simple'?'LINEで参加':tier==='strict'?'合言葉＋厳格な条件確認':'合言葉をXに投稿'],['特典の決め方',mode==='lottery'?'抽選':'先着'],['X APIの停止目安',`$${budget.toFixed(2)}`],['希望者へのフォロー',followupEnabled?'有効（本人の同意後）':'利用しない']].map(([label,value])=><div key={label} className="flex justify-between gap-4"><dt className="text-slate-500">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl><p className="mt-4 text-xs leading-5 text-slate-500">この画面からXへ自動投稿はしません。先行案内はLINE側の下書きとして準備します。</p></section>

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
              {wonMessage ||
                (mode === 'lottery' ? '当選しました！（確定 #1）' : '先着 #1 で当選！ 残り M 名')}
              <br />
              {lostMessage || 'ご参加ありがとうございました。'}
              <br />
              期限・条件・在庫は保存した設定で判定します。
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
