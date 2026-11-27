import { afterEach, describe, expect, it, vi } from 'vitest';
import { XClient } from '../client.js';

// Cloudflare Workers の fetch は redirect:'error' を受け付けず
// 「Invalid redirect value, must be one of "follow" or "manual"」で例外を投げる。
// 本番の /api/media/upload が 500 になった原因の回帰テスト。
function workersLikeFetch(res: () => Response) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.redirect === 'error') {
      throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
    }
    return res();
  });
}

describe('fetchRaw / uploadMedia redirect handling', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uploadMedia does not pass redirect:"error" (Workers rejects it)', async () => {
    const fetchMock = workersLikeFetch(() => new Response(JSON.stringify({ data: { id: 'm1' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const id = await new XClient('token').uploadMedia(new Uint8Array([1, 2, 3]).buffer, 'image/png');
    expect(id).toBe('m1');
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init.redirect).toBe('manual');
  });

  it('still refuses to follow redirects (auth header must not leak)', async () => {
    const fetchMock = workersLikeFetch(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new XClient('token').fetchRaw('https://api.x.com/2/media/upload', { method: 'POST' })).rejects.toThrow(/redirect/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats an opaque redirect response as a refused redirect', async () => {
    const opaque = { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn(async () => opaque));
    await expect(new XClient('token').fetchRaw('https://api.x.com/2/media/upload', { method: 'POST' })).rejects.toThrow(/redirect/i);
  });
});
