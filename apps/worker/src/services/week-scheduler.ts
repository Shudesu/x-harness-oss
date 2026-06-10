//202606新規追加開始
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

    console.log('[week-scheduler:start]', {
      id: week.id,
      weekday: week.weekday,
      time: week.time,
      offset: week.offset,
      timezone: week.timezone,
      last_posted_at: week.last_posted_at,
      now_utc: new Date().toISOString(),
    });

    // ===============================
    // ① 重複投稿防止（今日1回）
    // ===============================
    const nowUTC = new Date();
    const today = nowUTC.toISOString().slice(0, 10);

    if (
      week.last_posted_at &&
      week.last_posted_at.startsWith(today)
    ) {
      console.log('[week-scheduler:skip] already posted today');
      continue;
    }

    // ===============================
    // ② timezone変換（ここが本体）
    // ===============================
    const tz = week.timezone || 'Asia/Tokyo';

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(new Date());

    const map: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') {
        map[p.type] = p.value;
      }
    }

    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

    const currentWeekday = weekdayMap[map.weekday];
    const currentHour = Number(map.hour);
    const currentMinute = Number(map.minute);

    console.log('[week-scheduler:now]', {
      currentWeekday,
      currentHour,
      currentMinute,
    });

    // ===============================
    // ③ 曜日チェック
    // ===============================
    if (week.weekday !== currentWeekday) {
      console.log('[week-scheduler:skip] weekday mismatch');
      continue;
    }

    // ===============================
    // ④ 時刻チェック（±offset）
    // ===============================
    const [hour, minute] = week.time.split(':').map(Number);

    const currentTotal = currentHour * 60 + currentMinute;
    const targetTotal = hour * 60 + minute;

    const offset = week.offset ?? 5;
    const diff = Math.abs(currentTotal - targetTotal);

    console.log('[week-scheduler:check time]', {
      db: week.time,
      current: `${currentHour}:${currentMinute}`,
      diff,
      offset,
    });

    if (diff > offset) {
      continue;
    }

    console.log('[week-scheduler:matched]', { id: week.id });

    // ===============================
    // ⑤ scheduled_posts作成
    // ===============================
    const now = new Date().toISOString();

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

    // ===============================
    // ⑥ last_posted_at更新
    // ===============================
    await db.prepare(`
      UPDATE scheduled_weeks
      SET last_posted_at = ?
      WHERE id = ?
    `)
    .bind(now, week.id)
    .run();

    console.log('[week-scheduler:inserted]');
  }
}
//202606新規追加終了