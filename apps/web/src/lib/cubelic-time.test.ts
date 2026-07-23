import { describe, expect, it } from 'vitest';
import { tokyoDateTimeLocalToIso } from './cubelic-time';

describe('tokyoDateTimeLocalToIso', () => {
  it('interprets an operator datetime as Asia/Tokyo regardless of browser timezone', () => {
    expect(tokyoDateTimeLocalToIso('2026-07-23T18:30')).toBe('2026-07-23T09:30:00.000Z');
  });

  it.each([
    '2026-02-29T12:00',
    '2026-04-31T12:00',
    '2026-07-23T24:00',
    '2026/07/23 12:00',
  ])('rejects invalid operator time %s', (value) => {
    expect(() => tokyoDateTimeLocalToIso(value)).toThrow(/Asia\/Tokyo/);
  });
});
