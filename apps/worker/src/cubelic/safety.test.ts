import { describe, expect, it } from 'vitest';
import { isCubelicSafeMode, isLegacyXWriteBlocked, isPublishingGloballyDisabled } from './safety.js';
import type { Env } from '../index.js';

function env(overrides: Partial<Env['Bindings']> = {}): Env['Bindings'] {
  return {
    CUBELIC_SAFE_MODE: 'true',
    GLOBAL_PUBLISHING_DISABLED: 'false',
    ...overrides,
  } as Env['Bindings'];
}

describe('CUBΣLIC centralized X write boundary', () => {
  it('fails safe when CUBELIC_SAFE_MODE is absent or true', () => {
    expect(isCubelicSafeMode(env({ CUBELIC_SAFE_MODE: undefined }))).toBe(true);
    expect(isLegacyXWriteBlocked('POST', '/api/posts', env())).toBe(true);
    expect(isLegacyXWriteBlocked('POST', '/api/dm/send', env())).toBe(true);
    expect(isLegacyXWriteBlocked('GET', '/api/posts', env())).toBe(false);
    expect(isLegacyXWriteBlocked('POST', '/api/cubelic/events', env())).toBe(false);
  });

  it('keeps the environment emergency stop effective when safe mode is disabled', () => {
    const stopped = env({ CUBELIC_SAFE_MODE: 'false', GLOBAL_PUBLISHING_DISABLED: 'true' });
    expect(isPublishingGloballyDisabled(stopped)).toBe(true);
    expect(isLegacyXWriteBlocked('POST', '/api/posts/schedule', stopped)).toBe(true);
  });

  it('cannot reopen legacy writes through environment variables in Phase 1', () => {
    const explicitlyEnabled = env({ CUBELIC_SAFE_MODE: 'false', GLOBAL_PUBLISHING_DISABLED: 'false' });
    expect(isCubelicSafeMode(explicitlyEnabled)).toBe(true);
    expect(isLegacyXWriteBlocked('POST', '/api/posts', explicitlyEnabled)).toBe(true);
    expect(isLegacyXWriteBlocked('POST', '/api/dm/send', explicitlyEnabled)).toBe(true);
  });
});
