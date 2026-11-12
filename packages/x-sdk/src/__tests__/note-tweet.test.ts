import { afterEach, describe, expect, it, vi } from 'vitest';
import { XClient, withFullText } from '../client.js';

describe('withFullText', () => {
  it('uses note_tweet.text for long posts', () => {
    expect(withFullText({ id: '1', text: '途中まで…', note_tweet: { text: '全文' } }).text).toBe('全文');
  });
  it('keeps text for normal posts', () => {
    expect(withFullText({ id: '1', text: '短文' }).text).toBe('短文');
    expect(withFullText({ id: '1', text: '短文', note_tweet: {} }).text).toBe('短文');
  });
});

describe('getUserTweets', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for note_tweet and returns the full body of long posts', async () => {
    const full = 'あ'.repeat(300);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: '1', text: `${full.slice(0, 139)}…`, note_tweet: { text: full } },
        { id: '2', text: '短文' },
      ],
      meta: { next_token: 'n' },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await new XClient('token').getUserTweets('42', 20);
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get('tweet.fields')).toContain('note_tweet');
    expect(res.data.map((t) => t.text)).toEqual([full, '短文']);
    expect(res.meta?.next_token).toBe('n');
  });
});
