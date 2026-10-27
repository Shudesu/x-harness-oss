export function validMessageTemplates(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (!!value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.entries(value).every(
        ([key, text]) =>
          ['won', 'lost'].includes(key) &&
          typeof text === 'string' &&
          text.length <= 500 &&
          !text.replace(/\{(title|rank|remaining|reward)\}/g, '').match(/[{}]/),
      ))
  );
}
export function campaignDisplay(input: {
  title: string;
  awardMode: string;
  outcome: string;
  rank: number;
  remaining: number | null;
  reward: string | null;
  templates?: string | null;
}) {
  const { title, awardMode, outcome, rank, remaining, reward } = input;
  let message =
    outcome === 'won'
      ? awardMode === 'first_come'
        ? `先着 #${rank} で当選！${remaining === null ? '' : ` 残り ${remaining} 名`}`
        : `当選しました！（確定 #${rank}）`
      : reward
        ? awardMode === 'first_come'
          ? `#${rank} 番目でした。先着枠は終了 → 参加賞をお送りします`
          : '今回は抽選の対象外でした。参加賞をお送りします。'
        : 'ご参加ありがとうございました。今回は枠が終了しました。';
  const templates = input.templates ? JSON.parse(input.templates) : null;
  if (validMessageTemplates(templates) && templates?.[outcome]) {
    const values: Record<string, string> = {
      title,
      rank: String(rank),
      remaining: remaining === null ? '上限なし' : String(remaining),
      reward: reward ?? '',
    };
    message = templates[outcome].replace(
      /\{(title|rank|remaining|reward)\}/g,
      (_: string, key: string) => values[key],
    );
  }
  return {
    rankLabel:
      outcome === 'won' || reward
        ? `${awardMode === 'first_come' ? '確定順位' : '確定順'} #${rank}`
        : '',
    remainingLabel: remaining === null ? '上限なし' : `残り ${remaining} 名`,
    message,
  };
}
