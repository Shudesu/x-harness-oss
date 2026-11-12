import { describe, it, expect } from 'vitest'
import { bucketDrafts, isPastDue, jstDate, jstDayStartIso, scheduleLabel } from './approval-queue'

const NOW = new Date('2026-11-11T06:30:00Z') // 2026-11-11 15:30 JST (Wed)
const d = (id: string, scheduled_at: string) => ({ id, scheduled_at })

describe('jstDate / jstDayStartIso', () => {
  it('uses the JST calendar day', () => {
    expect(jstDate('2026-11-10T15:00:00Z')).toBe('2026-11-11')
    expect(jstDate('2026-11-10T14:59:59Z')).toBe('2026-11-10')
    expect(jstDate('nope')).toBeNull()
    expect(jstDayStartIso(new Date('2026-11-10T16:00:00Z'))).toBe('2026-11-11T00:00:00+09:00')
  })
})

describe('bucketDrafts', () => {
  it('splits into today / later / expired by JST day', () => {
    const b = bucketDrafts([
      d('t21', '2026-11-11T21:00:00+09:00'),
      d('old', '2026-07-13T08:00:00+09:00'),
      d('t12', '2026-11-11T12:00:00+09:00'), // past time but still today
      d('y', '2026-11-10T21:00:00+09:00'),
      d('tm', '2026-11-12T08:00:00+09:00'),
      d('z', '2026-11-10T15:30:00Z'), // 00:30 JST on the 11th
      d('bad', 'not a date'),
    ], NOW)
    expect(b.today.map((x) => x.id)).toEqual(['bad', 'z', 't12', 't21'])
    expect(b.later.map((x) => x.id)).toEqual(['tm'])
    expect(b.expired.map((x) => x.id)).toEqual(['y', 'old'])
  })

  it('expired matches the archive cutoff (scheduled before start of today JST)', () => {
    const cutoff = Date.parse(jstDayStartIso(NOW))
    const all = [d('a', '2026-11-10T23:59:00+09:00'), d('b', '2026-11-11T00:00:00+09:00')]
    const b = bucketDrafts(all, NOW)
    expect(b.expired.every((x) => Date.parse(x.scheduled_at) < cutoff)).toBe(true)
    expect(b.today.every((x) => Date.parse(x.scheduled_at) >= cutoff)).toBe(true)
  })
})

describe('scheduleLabel / isPastDue', () => {
  it('labels today, tomorrow and other days in JST', () => {
    expect(scheduleLabel('2026-11-11T18:00:00+09:00', NOW)).toBe('今日 18:00')
    expect(scheduleLabel('2026-11-12T08:05:00+09:00', NOW)).toBe('明日 08:05')
    expect(scheduleLabel('2026-11-10T21:00:00+09:00', NOW)).toBe('11/10(火) 21:00')
    expect(scheduleLabel('2025-12-31T21:00:00+09:00', NOW)).toBe('2025/12/31(水) 21:00')
    expect(scheduleLabel('', NOW)).toBe('時刻未設定')
  })

  it('knows whether the time has passed', () => {
    expect(isPastDue('2026-11-11T12:00:00+09:00', NOW)).toBe(true)
    expect(isPastDue('2026-11-11T18:00:00+09:00', NOW)).toBe(false)
    expect(isPastDue('x', NOW)).toBe(false)
  })
})
