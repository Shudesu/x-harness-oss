import { describe, it, expect, vi } from 'vitest';
import { importArticleImages, collectMarkdownImageUrls, isHarnessImageUrl, imageExtension } from '../article-images.js';

const WORKER = 'https://xh.example.workers.dev';

function fakeBucket() {
  const store = new Map<string, { data: ArrayBuffer; type?: string }>();
  return {
    store,
    put: vi.fn(async (key: string, data: ArrayBuffer, opts?: any) => { store.set(key, { data, type: opts?.httpMetadata?.contentType }); }),
  } as any;
}

function imgResponse(type = 'image/png', bytes = 8) {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': type } });
}

describe('importArticleImages', () => {
  it('copies cover and body images into R2 and rewrites the URLs', async () => {
    const bucket = fakeBucket();
    const drive = (id: string) => `https://drive.google.com/uc?export=download&id=${id}`;
    const bodyMd = `intro\n\n![one](${drive('a')})\n\n![two](${drive('b')})\n\n![again](${drive('a')})\n\n\`\`\`\n![code](${drive('a')})\n\`\`\``;
    const fetchImpl = vi.fn(async () => imgResponse()) as any;
    const r = await importArticleImages({ imageUrl: drive('cover'), bodyMd }, { workerUrl: WORKER, bucket, fetchImpl });

    expect(r.failed).toEqual([]);
    expect(r.imported).toHaveLength(3); // cover, a, b — a deduped
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(r.imageUrl).toMatch(new RegExp(`^${WORKER}/api/growth/img/[0-9a-f-]+\\.png$`));
    expect(r.bodyMd!.split('```')[0]).not.toContain('drive.google.com');
    expect(r.bodyMd!.match(/\/api\/growth\/img\//g)).toHaveLength(3);
    expect(r.bodyMd).toContain(`![code](${drive('a')})`); // fenced example untouched
    expect([...bucket.store.keys()].every((k: string) => k.startsWith('growth/'))).toBe(true);
    expect([...bucket.store.values()][0].type).toBe('image/png');
  });

  it('keeps harness URLs untouched and does not fetch them', async () => {
    const bucket = fakeBucket();
    const own = `${WORKER}/api/growth/img/abc.png`;
    const fetchImpl = vi.fn() as any;
    const r = await importArticleImages({ imageUrl: own, bodyMd: `![x](${own})` }, { workerUrl: WORKER, bucket, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.imageUrl).toBe(own);
    expect(r.imported).toEqual([]);
  });

  it('reports failures and keeps the original URL (never blocks the save)', async () => {
    const bucket = fakeBucket();
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('html') ? new Response('<html>', { headers: { 'content-type': 'text/html' } })
        : url.includes('404') ? new Response('', { status: 404 })
        : imgResponse('image/svg+xml')) as any;
    const body = '![a](https://e.com/html)\n\n![b](https://e.com/404)\n\n![c](https://e.com/x.svg)\n\n![d](http://e.com/plain.png)';
    const r = await importArticleImages({ bodyMd: body }, { workerUrl: WORKER, bucket, fetchImpl });
    expect(r.imported).toEqual([]);
    expect(r.failed.map((f) => f.url).sort()).toEqual(['http://e.com/plain.png', 'https://e.com/404', 'https://e.com/html', 'https://e.com/x.svg']);
    expect(r.bodyMd).toBe(body);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it('stops reading a body without Content-Length once it passes the limit', async () => {
    let pulls = 0;
    const stream = new ReadableStream({ pull(c) { pulls++; c.enqueue(new Uint8Array(4 * 1024 * 1024)); } });
    const fetchImpl = vi.fn(async () => new Response(stream, { headers: { 'content-type': 'image/png' } })) as any;
    const r = await importArticleImages({ imageUrl: 'https://e.com/endless.png' }, { workerUrl: WORKER, bucket: fakeBucket(), fetchImpl });
    expect(r.failed[0].error).toMatch(/大きすぎ/);
    expect(pulls).toBeLessThan(10);
  });

  it('rejects oversized images', async () => {
    const bucket = fakeBucket();
    const fetchImpl = vi.fn(async () => new Response('', { headers: { 'content-type': 'image/png', 'content-length': String(20 * 1024 * 1024) } })) as any;
    const r = await importArticleImages({ imageUrl: 'https://e.com/big.png' }, { workerUrl: WORKER, bucket, fetchImpl });
    expect(r.failed[0].error).toMatch(/大きすぎ/);
    expect(r.imageUrl).toBe('https://e.com/big.png');
  });

  it('is a no-op without a bucket or WORKER_URL and leaves undefined fields undefined', async () => {
    const r = await importArticleImages({ bodyMd: '![a](https://e.com/a.png)' }, {});
    expect(r).toEqual({ imageUrl: undefined, bodyMd: '![a](https://e.com/a.png)', imported: [], failed: [] });
    const r2 = await importArticleImages({ imageUrl: undefined, bodyMd: undefined }, { workerUrl: WORKER, bucket: fakeBucket(), fetchImpl: vi.fn() as any });
    expect(r2.imageUrl).toBeUndefined();
    expect(r2.bodyMd).toBeUndefined();
  });

  it('stores jpeg with a .jpg name and normalised type', async () => {
    const bucket = fakeBucket();
    const r = await importArticleImages({ imageUrl: 'https://e.com/p' }, { workerUrl: WORKER, bucket, fetchImpl: vi.fn(async () => imgResponse('image/jpeg; charset=binary')) as any });
    expect(r.imageUrl).toMatch(/\.jpg$/);
    expect([...bucket.store.values()][0].type).toBe('image/jpeg');
  });
});

describe('importArticleImages limits', () => {
  it('passes an abort deadline and reports timeouts as failures', async () => {
    const bucket = fakeBucket();
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    }) as any;
    const r = await importArticleImages({ imageUrl: 'https://slow.example/a.png' }, { workerUrl: WORKER, bucket, fetchImpl });
    expect(r.failed).toEqual([{ url: 'https://slow.example/a.png', error: '時間内に取得できませんでした' }]);
  });

  it('downloads at most 3 images at a time', async () => {
    let inFlight = 0; let peak = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return imgResponse();
    }) as any;
    const body = Array.from({ length: 8 }, (_, i) => `![${i}](https://e.com/${i}.png)`).join('\n\n');
    const r = await importArticleImages({ bodyMd: body }, { workerUrl: WORKER, bucket: fakeBucket(), fetchImpl });
    expect(r.imported).toHaveLength(8);
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe('helpers', () => {
  it('collects only standalone images (what X renders), not inline or fenced ones', () => {
    expect(collectMarkdownImageUrls('![a](https://e.com/1.png)\n\nx ![b](https://e.com/2.png) y\n\n```\n![c](https://e.com/3.png)\n```')).toEqual(['https://e.com/1.png']);
  });
  it('recognises harness URLs', () => {
    expect(isHarnessImageUrl(`${WORKER}/api/growth/img/a.png`, `${WORKER}/`)).toBe(true);
    expect(isHarnessImageUrl('https://other.dev/api/growth/img/a.png', WORKER)).toBe(false);
  });
  it('maps raster types only', () => {
    expect(imageExtension('image/webp')).toBe('webp');
    expect(imageExtension('image/svg+xml')).toBeNull();
    expect(imageExtension('application/binary')).toBeNull();
  });
});

describe('importArticleImages host policy', () => {
  it('refuses private hosts and redirects into them, follows public redirects', async () => {
    const bucket = fakeBucket();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://public.example/redirect-private.png') return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/a.png' } });
      if (url === 'https://public.example/redirect-ok.png') return new Response(null, { status: 302, headers: { location: '/final.png' } });
      return imgResponse();
    }) as any;
    const body = '![a](https://10.0.0.5/a.png)\n\n![b](https://public.example/redirect-private.png)\n\n![c](https://public.example/redirect-ok.png "caption")';
    const r = await importArticleImages({ bodyMd: body }, { workerUrl: WORKER, bucket, fetchImpl });
    expect(r.failed.map((f) => f.url)).toEqual(['https://10.0.0.5/a.png', 'https://public.example/redirect-private.png']);
    expect(r.imported).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalledWith('https://10.0.0.5/a.png', expect.anything());
    expect(fetchImpl).not.toHaveBeenCalledWith('https://127.0.0.1/a.png', expect.anything());
    expect(fetchImpl).toHaveBeenCalledWith('https://public.example/final.png', expect.anything());
    // titled image is rewritten too, title kept
    expect(r.bodyMd).toContain(`](${r.imported[0].to} "caption")`);
  });
});

describe('importArticleImages fences', () => {
  it('leaves ~~~ fenced examples untouched', async () => {
    const fetchImpl = vi.fn(async () => imgResponse()) as any;
    const url = 'https://public.example/a.png';
    const body = `![a](${url})\n\n~~~\n![a](${url})\n~~~`;
    const r = await importArticleImages({ bodyMd: body }, { workerUrl: WORKER, bucket: fakeBucket(), fetchImpl });
    expect(r.imported).toHaveLength(1);
    expect(r.bodyMd).toContain(`~~~\n![a](${url})\n~~~`);
    expect(r.bodyMd?.startsWith(`![a](${r.imported[0].to})`)).toBe(true);
  });
});
