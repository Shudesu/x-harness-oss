import { isValidCalendarDateTime } from '@x-harness/content-os/datetime';

export function tokyoDateTimeLocalToIso(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error('Asia/Tokyoの有効な日時を入力してください');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '00'] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (!isValidCalendarDateTime({ year, month, day, hour, minute, second })) {
    throw new Error('Asia/Tokyoの有効な日時を入力してください');
  }
  const instant = Date.parse(
    `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}+09:00`,
  );
  if (Number.isNaN(instant)) throw new Error('Asia/Tokyoの有効な日時を入力してください');
  return new Date(instant).toISOString();
}
