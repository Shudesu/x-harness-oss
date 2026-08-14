import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadImageSource } from '../media.js';
import { postToolDefs } from '../tools/posts.js';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadImageSource', () => {
  it('reads an absolute local png path with the right mime and filename', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-media-'));
    const path = join(dir, 'cover.png');
    await writeFile(path, PNG_BYTES);
    const media = await loadImageSource(path);
    expect(media.contentType).toBe('image/png');
    expect(media.filename).toBe('cover.png');
    expect(media.data.byteLength).toBe(PNG_BYTES.byteLength);
  });

  it('rejects relative paths', async () => {
    await expect(loadImageSource('images/cover.png')).rejects.toThrow(/absolute/);
  });

  it('rejects unsupported extensions', async () => {
    await expect(loadImageSource('/tmp/cover.tiff')).rejects.toThrow(/unsupported file extension/);
  });

  it('rejects plain-http URLs', async () => {
    await expect(loadImageSource('http://example.com/a.png')).rejects.toThrow(/https/);
  });

  it('fetches https URLs and takes the mime from content-type', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(PNG_BYTES, {
      status: 200,
      headers: { 'content-type': 'image/png; charset=binary' },
    })));
    const media = await loadImageSource('https://example.com/img/cover.png');
    expect(media.contentType).toBe('image/png');
    expect(media.filename).toBe('cover.png');
  });

  it('rejects https responses that are not images', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })));
    await expect(loadImageSource('https://example.com/page')).rejects.toThrow(/did not return an image/);
  });
});

describe('upload_image tool def', () => {
  it('is registered with xAccountId and source required', () => {
    const def = postToolDefs.find((t) => t.name === 'upload_image')!;
    expect(def).toBeDefined();
    expect(def.inputSchema.required).toEqual(['xAccountId', 'source']);
    expect(def.description).toContain('coverMediaId');
    expect(def.description).toContain('24時間');
  });
});
