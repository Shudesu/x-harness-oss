import { describe, expect, it } from 'vitest';
import { eventFixture, mediaFixture, setlistFixture } from '../../../../packages/content-os/src/test-fixtures.js';
import { parseEvent, parseMedia, parseMemberMaster, parseSetlist, parseSongMaster } from './validation.js';

describe('CUBΣLIC API contract parsing', () => {
  it('rejects unknown root and nested fields', () => {
    expect(() => parseEvent({ ...eventFixture, unexpected: true })).toThrow(/unknown fields/);
    expect(() => parseEvent({
      ...eventFixture,
      filming_policy: { ...eventFixture.filming_policy, guessed_by_agent: true },
    })).toThrow(/unknown fields/);
    expect(() => parseMedia({
      ...mediaFixture,
      rights: { ...mediaFixture.rights, assumed: true },
    })).toThrow(/unknown fields/);
  });

  it('rejects an unknown setlist version and extra song metadata', () => {
    expect(() => parseSetlist({ ...setlistFixture, schema_version: 'unknown' })).toThrow(/Unsupported/);
    expect(() => parseSetlist({
      ...setlistFixture,
      songs: [{ ...setlistFixture.songs[0], performer_guess: 'unknown' }],
    })).toThrow(/unknown fields/);
  });

  it('rejects confirmed filming evidence without a human operator', () => {
    expect(() => parseEvent({
      ...eventFixture,
      filming_policy: { ...eventFixture.filming_policy, confirmed_by: null },
    })).toThrow(/human_operator/);
  });

  it('keeps canonical master contracts versioned and unique', () => {
    expect(() => parseSongMaster({
      schema_version: 'cubelic.song-master.v1',
      generated_at: '2026-07-21T18:00:00+09:00',
      songs: [
        { song_id: 'song_1', title: 'A', aliases: [], active: true },
        { song_id: 'song_1', title: 'B', aliases: [], active: true },
      ],
    })).toThrow(/Duplicate song_id/);
    expect(() => parseMemberMaster({
      schema_version: 'unknown', generated_at: '2026-07-21T18:00:00+09:00', members: [],
    })).toThrow(/Unsupported member master/);
  });
});
