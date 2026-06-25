//20260614新規追加開始
// next_run_at も他の時刻カラムと同じ JST(+09:00) 形式で揃える。
import { toJstString } from '@x-harness/db';

export type WeeklyScheduleTime = {
  weekday: number | string;
  time: string;
  offset?: number | string | null;
  timezone?: string | null;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
  second: number;
};

function normalizeTimeZone(timezone?: string | null): string {
  if (!timezone) {
    return 'Asia/Tokyo';
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return timezone;
  } catch {
    return 'Asia/Tokyo';
  }
}

function parseHourMinute(time: string): {
  hour: number;
  minute: number;
} {
  const [hourText, minuteText] = time.split(':');

  return {
    hour: Number(hourText),
    minute: Number(minuteText),
  };
}

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: weekdayMap[map.weekday],
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function addDaysToLocalDate(
  local: Pick<ZonedParts, 'year' | 'month' | 'day'>,
  days: number,
): Pick<ZonedParts, 'year' | 'month' | 'day'> {
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day + days));

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function zonedWallTimeToUtc(
  local: Pick<ZonedParts, 'year' | 'month' | 'day' | 'hour' | 'minute'>,
  timeZone: string,
): Date {
  let utc = new Date(
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0),
  );

  for (let i = 0; i < 3; i++) {
    const actual = getZonedParts(utc, timeZone);

    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );

    const expectedAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      0,
    );

    utc = new Date(utc.getTime() + expectedAsUtc - actualAsUtc);
  }

  return utc;
}

function randomOffsetMinutes(offset: number): number {
  if (offset <= 0) {
    return 0;
  }

  return Math.floor(Math.random() * (offset * 2 + 1)) - offset;
}

export function calculateNextWeeklyRunAt(
  schedule: WeeklyScheduleTime,
  fromDate: Date = new Date(),
): string {
  const timeZone = normalizeTimeZone(schedule.timezone);
  const weekday = Number(schedule.weekday);
  const { hour, minute } = parseHourMinute(schedule.time);
  const offset = Math.max(0, Number(schedule.offset ?? 0));
  const offsetMinutes = randomOffsetMinutes(Number.isFinite(offset) ? offset : 0);

  const nowLocal = getZonedParts(fromDate, timeZone);

  let daysUntil = (weekday - nowLocal.weekday + 7) % 7;

  const buildTarget = (days: number): Date => {
    const localDate = addDaysToLocalDate(nowLocal, days);

    const baseUtc = zonedWallTimeToUtc(
      {
        ...localDate,
        hour,
        minute,
      },
      timeZone,
    );

    return new Date(baseUtc.getTime() + offsetMinutes * 60_000);
  };

  let targetUtc = buildTarget(daysUntil);

  if (targetUtc.getTime() <= fromDate.getTime()) {
    targetUtc = buildTarget(daysUntil + 7);
  }

  return toJstString(targetUtc);
}
//20260614新規追加終了