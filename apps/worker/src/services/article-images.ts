// Keep every article image on the harness itself.
//
// Article pipelines often hand us third-party image URLs (Google Drive
// `uc?export=download` links, other workers' R2 buckets…). Those are fragile:
// Drive download links do not render in a browser <img>, and any external
// host can disappear. On save we fetch each external image once, store it in
// the GROWTH_IMAGES R2 bucket, and rewrite the article to the harness-served
// URL (/api/growth/img/<uuid>.<ext>). A failed fetch never blocks the save —
// the original URL is kept and reported back so the UI can show it.
import { collectInlineImageUrls } from '../routes/articles.js';

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
// A stalled host must not hold the article save hostage: the deadline covers
// headers and body. Downloads run a few at a time so aggregate buffering
// stays far below the Worker's 128MB memory limit.
export const IMAGE_FETCH_TIMEOUT_MS = 20_000;
const IMPORT_CONCURRENCY = 3;

// SVG is excluded on purpose: it is served publicly from the worker origin and
// could carry script. Everything here is a raster format X also accepts.
const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export function imageExtension(contentType: string): string | null {
  return EXT_BY_TYPE[contentType.split(';')[0].trim().toLowerCase()] ?? null;
}

export function harnessImagePrefix(workerUrl: string): string {
  return `${workerUrl.replace(/\/$/, '')}/api/growth/img/`;
}

export function isHarnessImageUrl(url: string, workerUrl: string): boolean {
  return url.startsWith(harnessImagePrefix(workerUrl));
}

/** Store raw image bytes in R2 and return the public harness URL. */
export async function storeHarnessImage(
  bucket: R2Bucket,
  workerUrl: string,
  data: ArrayBuffer,
  contentType: string,
): Promise<string> {
  const ext = imageExtension(contentType);
  if (!ext) throw new Error(`Unsupported image type: ${contentType}`);
  const name = `${crypto.randomUUID()}.${ext}`;
  await bucket.put(`growth/${name}`, data, {
    httpMetadata: { contentType: contentType.split(';')[0].trim().toLowerCase().replace('image/jpg', 'image/jpeg') },
  });
  return `${harnessImagePrefix(workerUrl)}${name}`;
}

/**
 * Image URLs the X converter turns into media: standalone `![alt](url)`
 * paragraphs outside ``` fences (same grammar as collectInlineImageUrls), so
 * code examples are never fetched or rewritten.
 */
export function collectMarkdownImageUrls(bodyMd: string): string[] {
  return collectInlineImageUrls(bodyMd);
}

// Rewrite `](from)` → `](to)` only outside code fences.
function replaceOutsideFences(body: string, mapping: Map<string, string>): string {
  // ``` and ~~~ fences (both recognised by the X converter) are left untouched.
  return body.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g).map((part, i) => {
    if (i % 2 === 1) return part;
    let out = part;
    for (const [from, to] of mapping) {
      // `](url)` and the titled form `](url "title")`.
      out = out.split(`](${from})`).join(`](${to})`).split(`](${from} `).join(`](${to} `);
    }
    return out;
  }).join('');
}

export interface ImageImportResult {
  imageUrl: string | undefined;
  bodyMd: string | undefined;
  imported: Array<{ from: string; to: string }>;
  failed: Array<{ url: string; error: string }>;
}

export interface ImageImportOptions {
  workerUrl?: string;
  bucket?: R2Bucket;
  fetchImpl?: typeof fetch;
}

const MAX_REDIRECTS = 3;

// Same host policy as the X article media loader: public https hosts only.
function assertImportableUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('URLが正しくありません'); }
  if (u.protocol !== 'https:') throw new Error('https のURLのみ取り込めます');
  const host = u.hostname.toLowerCase();
  if (
    u.username || u.password || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host.endsWith('.internal') || /^(0\.|127\.|10\.|192\.168\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(host)
    || /^\d+$/.test(host)
  ) {
    throw new Error('このホストの画像は取り込めません');
  }
  return u;
}

async function fetchImage(url: string, fetchImpl: typeof fetch): Promise<{ data: ArrayBuffer; contentType: string }> {
  // Follow redirects by hand so every hop is checked against the host policy.
  let current = assertImportableUrl(url);
  let res: Response | undefined;
  for (let hop = 0; ; hop++) {
    res = await fetchImpl(current.toString(), { redirect: 'manual', signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS) });
    if (res.status < 300 || res.status >= 400) break;
    const location = res.headers.get('location');
    if (!location) break;
    if (hop >= MAX_REDIRECTS) throw new Error('リダイレクトが多すぎます');
    current = assertImportableUrl(new URL(location, current).toString());
  }
  if (!res.ok) throw new Error(`取得に失敗しました (HTTP ${res.status})`);
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!imageExtension(contentType)) throw new Error(`画像ではありません (${contentType || '種類不明'})`);
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_IMAGE_BYTES) throw new Error('画像が大きすぎます (15MBまで)');
  // Read with a running limit: a missing/false Content-Length must not let a
  // huge body be buffered whole.
  const reader = res.body?.getReader();
  if (!reader) throw new Error('画像が空です');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('画像が大きすぎます (15MBまで)');
    }
    chunks.push(value);
  }
  if (total === 0) throw new Error('画像が空です');
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const ch of chunks) { bytes.set(ch, off); off += ch.byteLength; }
  const data = bytes.buffer;
  return { data, contentType };
}

/**
 * Copy the cover + every external markdown image into harness storage and
 * rewrite the URLs. Fields passed as undefined are left untouched (PATCH
 * semantics). Without a bucket/WORKER_URL this is a no-op.
 */
export async function importArticleImages(
  fields: { imageUrl?: string; bodyMd?: string },
  opts: ImageImportOptions,
): Promise<ImageImportResult> {
  const result: ImageImportResult = { imageUrl: fields.imageUrl, bodyMd: fields.bodyMd, imported: [], failed: [] };
  const { workerUrl, bucket } = opts;
  if (!workerUrl || !bucket) return result;
  const fetchImpl = opts.fetchImpl ?? fetch;

  const candidates = new Set<string>();
  if (fields.imageUrl && /^https?:\/\//.test(fields.imageUrl)) candidates.add(fields.imageUrl);
  if (fields.bodyMd) for (const u of collectMarkdownImageUrls(fields.bodyMd)) candidates.add(u);
  const external = [...candidates].filter((u) => !isHarnessImageUrl(u, workerUrl));
  if (external.length === 0) return result;

  const mapping = new Map<string, string>();
  const queue = [...external];
  const worker = async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      try {
        const { data, contentType } = await fetchImage(url, fetchImpl);
        mapping.set(url, await storeHarnessImage(bucket, workerUrl, data, contentType));
      } catch (err) {
        const msg = err instanceof Error ? (err.name === 'TimeoutError' ? '時間内に取得できませんでした' : err.message) : String(err);
        result.failed.push({ url, error: msg });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(IMPORT_CONCURRENCY, external.length) }, worker));

  for (const [from, to] of mapping) result.imported.push({ from, to });
  if (result.imageUrl && mapping.has(result.imageUrl)) result.imageUrl = mapping.get(result.imageUrl);
  if (result.bodyMd !== undefined) {
    result.bodyMd = replaceOutsideFences(result.bodyMd, mapping);
  }
  return result;
}
