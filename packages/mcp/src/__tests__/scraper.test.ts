import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: execFileMock }));

import { runTwitterCli, ScrapeError, scrapeUserPosts, scrapeSearch, scrapeUser, scrapePost, extractTweetId } from '../scraper.js';

type ExecCb = (err: (Error & { code?: string; killed?: boolean }) | null, stdout: string, stderr: string) => void;

function mockExecResult(err: (Error & { code?: string; killed?: boolean }) | null, stdout = '', stderr = '') {
  execFileMock.mockImplementation((_bin: string, _args: string[], _opts: unknown, cb: ExecCb) => {
    cb(err, stdout, stderr);
  });
}

describe('runTwitterCli', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    delete process.env.TWITTER_BIN;
  });

  it('parses JSON stdout on success', async () => {
    mockExecResult(null, JSON.stringify([{ id: '1', text: 'hi' }]));
    const result = await runTwitterCli(['feed']);
    expect(result).toEqual([{ id: '1', text: 'hi' }]);
    // --json is always appended, array args, no shell
    expect(execFileMock).toHaveBeenCalledWith(
      'twitter',
      ['feed', '--json'],
      expect.objectContaining({ timeout: 60_000 }),
      expect.any(Function),
    );
  });

  it('puts positional args after a -- separator (Click: options before --)', async () => {
    mockExecResult(null, '[]');
    await runTwitterCli(['search', '--type', 'top'], ['-is:retweet claude']);
    expect(execFileMock.mock.calls[0][1]).toEqual(['search', '--type', 'top', '--json', '--', '-is:retweet claude']);
  });

  it('unwraps the {ok, schema_version, data} envelope', async () => {
    mockExecResult(null, JSON.stringify({ ok: true, schema_version: '1', data: [{ id: '9' }] }));
    const result = await runTwitterCli(['feed']);
    expect(result).toEqual([{ id: '9' }]);
  });

  it('throws ScrapeError when the envelope says ok:false (soft failure with exit 0)', async () => {
    mockExecResult(null, JSON.stringify({ ok: false, error: 'Rate limit exceeded' }));
    await expect(runTwitterCli(['feed'])).rejects.toThrow(/Rate limit exceeded/);
  });

  it('respects TWITTER_BIN', async () => {
    process.env.TWITTER_BIN = '/opt/venv/bin/twitter';
    mockExecResult(null, '[]');
    await runTwitterCli(['feed']);
    expect(execFileMock.mock.calls[0][0]).toBe('/opt/venv/bin/twitter');
  });

  it('maps ENOENT to install instructions', async () => {
    const err = Object.assign(new Error('spawn twitter ENOENT'), { code: 'ENOENT' });
    mockExecResult(err);
    await expect(runTwitterCli(['feed'])).rejects.toThrow(/uv tool install twitter-cli/);
  });

  it('maps auth failures to cookie re-setup instructions', async () => {
    mockExecResult(new Error('exit 1'), '', 'HTTP 401: Could not authenticate you');
    await expect(runTwitterCli(['feed'])).rejects.toThrow(/TWITTER_AUTH_TOKEN/);
  });

  it('does not misread "author" in stderr as an auth failure', async () => {
    mockExecResult(new Error('exit 1'), '', 'could not resolve author for tweet 123');
    await expect(runTwitterCli(['feed'])).rejects.toThrow(/twitter-cli 実行エラー/);
  });

  it('maps maxBuffer overflow to a limit hint (not a timeout)', async () => {
    const err = Object.assign(new Error('maxBuffer exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true });
    mockExecResult(err);
    await expect(runTwitterCli(['feed'])).rejects.toThrow(/limit を小さく/);
  });

  it('maps timeout (killed) to a timeout message', async () => {
    const err = Object.assign(new Error('killed'), { killed: true });
    mockExecResult(err);
    await expect(runTwitterCli(['feed'])).rejects.toThrow(/タイムアウト/);
  });

  it('throws ScrapeError on non-JSON stdout', async () => {
    mockExecResult(null, 'not json at all');
    await expect(runTwitterCli(['feed'])).rejects.toBeInstanceOf(ScrapeError);
  });
});

describe('scrape high-level functions', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    delete process.env.TWITTER_BIN;
  });

  it('scrapeUserPosts builds args and slices to limit', async () => {
    const posts = Array.from({ length: 30 }, (_, i) => ({ id: String(i) }));
    mockExecResult(null, JSON.stringify({ ok: true, data: posts }));
    const result = await scrapeUserPosts({ handle: 'ai_shunoda', limit: 5 });
    expect(result).toHaveLength(5);
    expect(execFileMock.mock.calls[0][1]).toEqual(['user-posts', '--max', '5', '--json', '--', 'ai_shunoda']);
  });

  it('scrapeUserPosts strips a leading @ even with surrounding whitespace', async () => {
    mockExecResult(null, '[]');
    await scrapeUserPosts({ handle: ' @someone ' });
    expect(execFileMock.mock.calls[0][1]).toEqual(['user-posts', '--json', '--', 'someone']);
  });

  it('scrapeUserPosts honors limit: 0 (not treated as "no limit")', async () => {
    mockExecResult(null, JSON.stringify([{ id: '1' }]));
    const result = await scrapeUserPosts({ handle: 'a', limit: 0 });
    expect(result).toEqual([]);
    expect(execFileMock.mock.calls[0][1]).toContain('--max');
  });

  it('scrapeSearch builds full flag set with query after --', async () => {
    mockExecResult(null, '[]');
    await scrapeSearch({ query: 'claude code', type: 'videos', lang: 'en', minLikes: 1000, limit: 20 });
    expect(execFileMock.mock.calls[0][1]).toEqual([
      'search',
      '--type', 'videos',
      '--lang', 'en',
      '--min-likes', '1000',
      '--max', '20',
      '--json',
      '--', 'claude code',
    ]);
  });

  it('scrapeSearch defaults type to top and omits absent flags', async () => {
    mockExecResult(null, '[]');
    await scrapeSearch({ query: 'ai' });
    expect(execFileMock.mock.calls[0][1]).toEqual(['search', '--type', 'top', '--json', '--', 'ai']);
  });

  it('scrapeSearch unwraps legacy object payloads that hold the list', async () => {
    mockExecResult(null, JSON.stringify({ results: [{ id: '1' }] }));
    const result = await scrapeSearch({ query: 'ai' });
    expect(result).toEqual([{ id: '1' }]);
  });

  it('scrapeUser unwraps a single-element data array to the profile object', async () => {
    mockExecResult(null, JSON.stringify({ ok: true, data: [{ screenName: 'someone', followers: 10 }] }));
    const result = await scrapeUser({ handle: 'someone' });
    expect(result).toEqual({ screenName: 'someone', followers: 10 });
    expect(execFileMock.mock.calls[0][1]).toEqual(['user', '--json', '--', 'someone']);
  });
});

describe('scrapePost (fxtwitter)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  function mockFx(tweet: unknown, ok = true, status = 200) {
    fetchMock.mockResolvedValue({ ok, status, json: async () => ({ code: status, tweet }) });
  }

  it('extractTweetId handles URLs and bare ids', () => {
    expect(extractTweetId('https://x.com/foo/status/123456/video/1')).toBe('123456');
    expect(extractTweetId('https://twitter.com/foo/statuses/789')).toBe('789');
    expect(extractTweetId(' 42 ')).toBe('42');
    expect(() => extractTweetId('not-a-tweet')).toThrow(ScrapeError);
  });

  it('returns embedUrl when the post has video', async () => {
    mockFx({
      author: { screen_name: 'creator', name: 'Creator' },
      text: 'watch this',
      likes: 5000, views: 100000, lang: 'en',
      url: 'https://x.com/creator/status/111',
      media: { videos: [{ url: 'https://video.twimg.com/v.mp4' }] },
    });
    const post = await scrapePost('https://x.com/creator/status/111');
    expect(post.embedUrl).toBe('https://x.com/creator/status/111/video/1');
    expect(post.videoUrl).toBe('https://video.twimg.com/v.mp4');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.fxtwitter.com/status/111');
    // fetch must carry an abort signal so a hung fxtwitter can't wedge the tool call
    expect(fetchMock.mock.calls[0][1]?.signal).toBeDefined();
  });

  it('embedUrl is null when no video', async () => {
    mockFx({ author: { screen_name: 'a', name: 'A' }, text: 't', likes: 1, views: 2, lang: 'ja', url: 'u', media: null });
    const post = await scrapePost('111');
    expect(post.embedUrl).toBeNull();
    expect(post.videoUrl).toBeNull();
  });

  it('throws friendly error on 404', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    await expect(scrapePost('999')).rejects.toThrow(/見つかりません|fxtwitter/);
  });

  it('maps fetch timeout/abort to ScrapeError', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
    await expect(scrapePost('111')).rejects.toThrow(/タイムアウト/);
  });

  it('maps non-JSON body to ScrapeError instead of a raw SyntaxError', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    await expect(scrapePost('111')).rejects.toThrow(ScrapeError);
  });
});
