import * as p from "@clack/prompts";
import type { SetupState } from "../lib/config.js";

export async function lineHarnessIntegration(
  state: SetupState,
): Promise<void> {
  const doIntegrate = await p.confirm({
    message:
      "LINE Harness と連携しますか？（X 特典受け取りフォームを自動作成）",
    initialValue: false,
  });

  if (!doIntegrate || p.isCancel(doIntegrate)) return;

  const lineUrl = await p.text({
    message: "LINE Harness Worker URL",
    placeholder: "https://your-line-harness.workers.dev",
    validate: (v) =>
      v.startsWith("https://") ? undefined : "https:// で始めてください",
  });
  if (p.isCancel(lineUrl)) return;

  const lineApiKey = await p.text({
    message: "LINE Harness API Key",
    placeholder: "lh_...",
  });
  if (p.isCancel(lineApiKey)) return;

  // Create sample form via LINE Harness API
  try {
    const res = await fetch(`${lineUrl}/api/forms`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lineApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "X 特典受け取りフォーム",
        description: "X キャンペーンの特典を受け取るフォーム",
        fields: [
          {
            name: "x_username",
            label: "X アカウント ID（@ なし）",
            type: "text",
            required: true,
          },
        ],
        onSubmitWebhookUrl: `${state.workerUrl}/api/engagement-gates/{gate_id}/verify?username={x_username}`,
        onSubmitWebhookHeaders: JSON.stringify({
          Authorization: `Bearer ${state.apiKey}`,
        }),
        onSubmitWebhookFailMessage:
          "条件を満たしていません。フォロー・いいね・リポスト・リプライの条件を確認してください。",
        onSubmitMessageType: "text",
        onSubmitMessageContent:
          "おめでとうございます！全条件クリアしました！",
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as { data: { id: string } };
      p.note(
        [
          `フォーム作成完了！`,
          `フォーム ID: ${data.data.id}`,
          "",
          "Engagement Gate 作成時にこの gate_id を URL に設定してください。",
        ].join("\n"),
        "LINE Harness 連携",
      );
    } else {
      p.log.warn("フォーム作成に失敗しました。手動で作成してください。");
    }
  } catch {
    p.log.warn("LINE Harness に接続できませんでした。手動で連携してください。");
  }

  state.lineHarnessUrl = lineUrl as string;
  state.lineHarnessApiKey = lineApiKey as string;

  // Register the connection in X Harness D1 so the admin dashboard
  // (campaign / engagement-gate pages) can find it. Without this, the
  // CLI-collected credentials only live in the local setup state file
  // and the dashboard's /api/line-connections listing comes back empty.
  try {
    const lineHostname = new URL(lineUrl as string).hostname;
    const connRes = await fetch(`${state.workerUrl}/api/line-connections`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${state.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: lineHostname,
        workerUrl: lineUrl,
        apiKey: lineApiKey,
      }),
    });
    if (connRes.ok) {
      p.log.success("ダッシュボードに LINE Harness 連携を登録しました");
    } else {
      p.log.warn(
        "LINE Harness 連携情報の登録に失敗しました。ダッシュボードから手動登録してください。",
      );
    }
  } catch {
    p.log.warn(
      "LINE Harness 連携情報の登録に失敗しました。ダッシュボードから手動登録してください。",
    );
  }
}
