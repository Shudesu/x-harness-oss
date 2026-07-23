import { describe, expect, it } from 'vitest';
import { resolveCorsOrigin } from './cors.js';

describe('CUBΣLIC CORS allowlist', () => {
  it('allows only exact configured origins', () => {
    const configured = 'https://admin.example.test, https://staging.example.test';
    expect(resolveCorsOrigin('https://admin.example.test', configured)).toBe('https://admin.example.test');
    expect(resolveCorsOrigin('https://evil.example.test', configured)).toBeNull();
    expect(resolveCorsOrigin('https://admin.example.test.evil.test', configured)).toBeNull();
  });

  it('fails closed for missing configuration and wildcards', () => {
    expect(resolveCorsOrigin('https://admin.example.test', undefined)).toBeNull();
    expect(resolveCorsOrigin('https://admin.example.test', '*')).toBeNull();
  });
});
