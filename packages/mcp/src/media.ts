import { readFile } from 'node:fs/promises';
import { basename, extname, isAbsolute } from 'node:path';

export interface LoadedMedia {
  data: Uint8Array;
  contentType: string;
  filename: string;
}

const EXT_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

// X rejects images over 5MB (GIFs over 15MB); fail fast locally instead of
// spending an upload round-trip that the API will bounce anyway.
const MAX_BYTES = 15 * 1024 * 1024;

// source is either an https URL or an absolute local file path. Relative
// paths are rejected because the MCP server's cwd is the client's, not the
// caller's, so a relative path would resolve somewhere unexpected.
export async function loadImageSource(source: string): Promise<LoadedMedia> {
  if (/^https?:\/\//i.test(source)) {
    if (!source.toLowerCase().startsWith('https://')) {
      throw new Error(`upload_image: URL must be https (got: ${source})`);
    }
    const res = await fetch(source);
    if (!res.ok) {
      throw new Error(`upload_image: fetch ${source} failed with ${res.status}`);
    }
    const contentType = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!contentType.startsWith('image/')) {
      throw new Error(`upload_image: URL did not return an image (content-type: ${contentType || 'unknown'})`);
    }
    const data = new Uint8Array(await res.arrayBuffer());
    if (data.byteLength > MAX_BYTES) {
      throw new Error(`upload_image: image too large (${data.byteLength} bytes, max ${MAX_BYTES})`);
    }
    const urlPath = new URL(source).pathname;
    return { data, contentType, filename: basename(urlPath) || 'image' };
  }

  if (!isAbsolute(source)) {
    throw new Error(`upload_image: local path must be absolute (got: ${source})`);
  }
  const contentType = EXT_TO_MIME[extname(source).toLowerCase()];
  if (!contentType) {
    throw new Error(
      `upload_image: unsupported file extension "${extname(source)}" (supported: ${Object.keys(EXT_TO_MIME).join(', ')})`,
    );
  }
  const data = new Uint8Array(await readFile(source));
  if (data.byteLength > MAX_BYTES) {
    throw new Error(`upload_image: image too large (${data.byteLength} bytes, max ${MAX_BYTES})`);
  }
  return { data, contentType, filename: basename(source) };
}
