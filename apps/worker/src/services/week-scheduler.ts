//202606新規追加開始
//20260614修正開始
import { calculateNextWeeklyRunAt } from './week-schedule-time.js';
//20260614修正終了

export async function processWeeklySchedules(
  db: D1Database
): Promise<void> {
  type ScheduledWeek = {
    id: string;
    x_account_id: string;
    weekday: number;
    time: string;
    offset: number;
    timezone: string;
    text: string;
    enabled: number;
    next_run_at: string | null;
    last_posted_at: string | null;
  };

  const weeks = await db.prepare(`
    SELECT *
    FROM scheduled_weeks
    WHERE enabled = 1
  `)
  .all<ScheduledWeek>();

  console.log('[week-scheduler] count:', weeks.results.length);

  for (const week of weeks.results) {
    const nowUTC = new Date();
    const now = nowUTC.toISOString();

    console.log('[week-scheduler:start]', {
      id: week.id,
      weekday: week.weekday,
      time: week.time,
      offset: week.offset,
      timezone: week.timezone,
      next_run_at: week.next_run_at,
      last_posted_at: week.last_posted_at,
      now_utc: now,
    });

    // ===============================
    // ① next_run_at が null の場合は初回日時を作成
    // ===============================
    if (!week.next_run_at) {
      const firstNextRunAt = calculateNextWeeklyRunAt(week, nowUTC);

      await db.prepare(`
        UPDATE scheduled_weeks
        SET
          next_run_at = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .bind(
        firstNextRunAt,
        now,
        week.id
      )
      .run();

      console.log('[week-scheduler:init next_run_at]', {
        id: week.id,
        next_run_at: firstNextRunAt,
      });

      continue;
    }

    // ===============================
    // ② next_run_at が未来ならスキップ
    // ===============================
    const nextRunAtDate = new Date(week.next_run_at);

    console.log('[week-scheduler:check next_run_at]', {
      id: week.id,
      next_run_at: week.next_run_at,
      now_utc: now,
    });

    if (nextRunAtDate.getTime() > nowUTC.getTime()) {
      console.log('[week-scheduler:skip] next_run_at is future', {
        id: week.id,
      });
      continue;
    }

    // ===============================
    // ③ 次回実行日時を計算
    // ===============================

    //20260614修正開始
    const nextRunAt = calculateNextWeeklyRunAt(
    {
      weekday: week.weekday,
      time: week.time,
      offset: week.offset,
      timezone: week.timezone,
    },
    nowUTC,
);
    //20260614修正終了

    // ===============================
    // ④ 先に scheduled_weeks を更新する
    // 同じ next_run_at のデータだけ更新することで重複処理を防ぐ
    // ===============================
    const updateResult = await db.prepare(`
      UPDATE scheduled_weeks
      SET
        last_posted_at = ?,
        next_run_at = ?,
        updated_at = ?
      WHERE
        id = ?
        AND enabled = 1
        AND next_run_at = ?
    `)
    .bind(
      now,
      nextRunAt,
      now,
      week.id,
      week.next_run_at
    )
    .run();

    if (updateResult.meta.changes === 0) {
      console.log('[week-scheduler:skip] already processed', {
        id: week.id,
      });
      continue;
    }

    console.log('[week-scheduler:matched]', {
      id: week.id,
    });

    // ===============================
    // ⑤ scheduled_posts 作成
    // ===============================
    await db.prepare(`
      INSERT INTO scheduled_posts (
        id,
        x_account_id,
        text,
        scheduled_at,
        status,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      crypto.randomUUID(),
      week.x_account_id,
      week.text,
      now,
      'scheduled',
      now,
      now
    )
    .run();

    console.log('[week-scheduler:inserted]', {
      id: week.id,
      last_posted_at: now,
      next_run_at: nextRunAt,
    });
  }
}
//202606新規追加終了