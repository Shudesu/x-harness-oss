import { describe, it, expect } from 'vitest';

/**
 * Tests for the verify route logic.
 *
 * We test the URL parameter parsing and response logic without spinning up
 * a full Hono server (which would need D1/XClient). Instead we validate
 * the pure logic that the route implements.
 */

describe('verify route logic', () => {
  describe('username parameter handling', () => {
    it('strips @ from username', () => {
      const raw = '@alice';
      const cleaned = raw.replace('@', '').trim();
      expect(cleaned).toBe('alice');
    });

    it('trims whitespace from username', () => {
      const raw = '  bob  ';
      const cleaned = raw.replace('@', '').trim();
      expect(cleaned).toBe('bob');
    });

    it('handles username without @', () => {
      const raw = 'charlie';
      const cleaned = raw.replace('@', '').trim();
      expect(cleaned).toBe('charlie');
    });

    it('empty string after cleaning is falsy', () => {
      const raw = '  @  ';
      const cleaned = raw.replace('@', '').trim();
      expect(cleaned).toBeFalsy();
    });
  });

  describe('eligibility logic', () => {
    function isEligible(
      conditions: { reply: boolean; like: boolean; repost: boolean; follow: boolean },
      gate: { require_like: number; require_repost: number; require_follow: number },
    ): boolean {
      return conditions.reply
        && (!gate.require_like || conditions.like)
        && (!gate.require_repost || conditions.repost)
        && (!gate.require_follow || conditions.follow);
    }

    it('eligible when all conditions met', () => {
      expect(isEligible(
        { reply: true, like: true, repost: true, follow: true },
        { require_like: 1, require_repost: 1, require_follow: 1 },
      )).toBe(true);
    });

    it('not eligible when reply is false', () => {
      expect(isEligible(
        { reply: false, like: true, repost: true, follow: true },
        { require_like: 1, require_repost: 1, require_follow: 1 },
      )).toBe(false);
    });

    it('eligible when non-required conditions are false', () => {
      expect(isEligible(
        { reply: true, like: false, repost: false, follow: false },
        { require_like: 0, require_repost: 0, require_follow: 0 },
      )).toBe(true);
    });

    it('not eligible when required like is missing', () => {
      expect(isEligible(
        { reply: true, like: false, repost: true, follow: true },
        { require_like: 1, require_repost: 0, require_follow: 0 },
      )).toBe(false);
    });

    it('not eligible when required follow is missing', () => {
      expect(isEligible(
        { reply: true, like: true, repost: true, follow: false },
        { require_like: 0, require_repost: 0, require_follow: 1 },
      )).toBe(false);
    });
  });

  describe('response conditions formatting', () => {
    it('nulls out non-required conditions in response', () => {
      const gate = { require_like: 0, require_repost: 1, require_follow: 0 };
      const conditions = { reply: true, like: true, repost: false, follow: true };

      const responseConditions = {
        reply: conditions.reply,
        like: gate.require_like ? conditions.like : null,
        repost: gate.require_repost ? conditions.repost : null,
        follow: gate.require_follow ? conditions.follow : null,
      };

      expect(responseConditions.like).toBeNull();
      expect(responseConditions.repost).toBe(false);
      expect(responseConditions.follow).toBeNull();
    });
  });
});

describe('connection_status follow verification', () => {
  // Mirrors the decision logic in the follow-trigger verify path:
  // a single relationship lookup replaces follower-list crawls.
  function decide(connectionStatus: string[] | undefined) {
    const relationshipKnown = Array.isArray(connectionStatus);
    const isFollower = relationshipKnown ? connectionStatus!.includes('followed_by') : false;
    const needsLegacyCrawl = !isFollower && !relationshipKnown;
    return { relationshipKnown, isFollower, needsLegacyCrawl };
  }

  it('followed_by present -> follower, no crawl', () => {
    expect(decide(['followed_by', 'following'])).toEqual(
      { relationshipKnown: true, isFollower: true, needsLegacyCrawl: false });
  });

  it('relationship known but not a follower -> no crawl (definitive negative)', () => {
    expect(decide(['following'])).toEqual(
      { relationshipKnown: true, isFollower: false, needsLegacyCrawl: false });
  });

  it('empty connection_status is still a definitive negative', () => {
    expect(decide([])).toEqual(
      { relationshipKnown: true, isFollower: false, needsLegacyCrawl: false });
  });

  it('no connection_status (bearer token) -> legacy crawl path', () => {
    expect(decide(undefined)).toEqual(
      { relationshipKnown: false, isFollower: false, needsLegacyCrawl: true });
  });
});
