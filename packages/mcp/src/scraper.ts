import { execFile } from 'node:child_process';

const TIMEOUT_MS = 60_000;
const MAX_BUFFER = 20 * 1024 * 1024;

export class ScrapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScrapeError';
  }
}

type ExecErr = (Error & { code?: string | number | null; killed?: boolean }) | null;

function friendlyError(err: NonNullable<ExecErr>, stderr: string): ScrapeError {
  if (err.code === 'ENOENT') {
    return new ScrapeError(
      'twitter-cli が見つかりません。`uv tool install twitter-cli` または `pipx install twitter-cli` でインストールしてください。venv 等にある場合は環境変数 TWITTER_BIN でフルパスを指定できます。',
    );
  }
  if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return new ScrapeError('twitter-cli の出力が大きすぎます(20MB超)。limit を小さくして再試行してください。');
  }
  if (err.killed) {
    return new ScrapeError(
      'twitter-cli がタイムアウトしました(60秒)。ネットワークまたは X 側のレート制限の可能性があります。時間をおいて再試行してください。',
    );
  }
  const detail = (stderr || err.message || '').slice(0, 300);
  if (/\b(401|403|unauthorized|forbidden|ct0|cookie|auth[_-]?token|login)\b/i.test(detail)) {
    return new ScrapeError(
      `X の Cookie 認証に失敗しました。x.com にログインしたブラウザの Cookie から auth_token と ct0 を取り直し、環境変数 TWITTER_AUTH_TOKEN / TWITTER_CT0 を更新してください(収集専用のサブアカウント推奨)。詳細: ${detail}`,
    );
  }
  return new ScrapeError(`twitter-cli 実行エラー: ${detail}`);
}

// twitter-cli --json wraps everything in `{ok, schema_version, data}`.
// Surface soft failures (ok:false with exit code 0) and hand back `data`.
function unwrapEnvelope(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'ok' in payload) {
    const env = payload as { ok: unknown; data?: unknown; error?: unknown };
    if (env.ok === false) {
      throw new ScrapeError(`twitter-cli エラー: ${String(env.error ?? 'unknown error').slice(0, 300)}`);
    }
    return env.data ?? payload;
  }
  return payload;
}

function cleanHandle(handle: string): string {
  return handle.trim().replace(/^@/, '');
}

// Normalize list payloads — older twitter-cli versions returned bare arrays
// or `{results:[...]}`-style wrappers instead of the `{ok,data}` envelope.
function toArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const key of ['results', 'posts', 'tweets', 'data']) {
      const v = (payload as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v;
    }
  }
  return payload == null ? [] : [payload];
}

export async function scrapeUserPosts(params: { handle: string; limit?: number }): Promise<unknown[]> {
  const args = ['user-posts'];
  if (params.limit != null) args.push('--max', String(params.limit));
  const result = toArray(await runTwitterCli(args, [cleanHandle(params.handle)]));
  return params.limit != null ? result.slice(0, params.limit) : result;
}

export async function scrapeSearch(params: {
  query: string;
  type?: 'top' | 'latest' | 'videos';
  lang?: string;
  minLikes?: number;
  limit?: number;
}): Promise<unknown[]> {
  const args = ['search', '--type', params.type ?? 'top'];
  if (params.lang) args.push('--lang', params.lang);
  if (params.minLikes != null) args.push('--min-likes', String(params.minLikes));
  if (params.limit != null) args.push('--max', String(params.limit));
  const result = toArray(await runTwitterCli(args, [params.query]));
  return params.limit != null ? result.slice(0, params.limit) : result;
}

export async function scrapeUser(params: { handle: string }): Promise<unknown> {
  const result = await runTwitterCli(['user'], [cleanHandle(params.handle)]);
  const list = toArray(result);
  return list.length === 1 ? list[0] : result;
}

export interface ScrapedPost {
  id: string;
  author: string | null;
  authorName: string | null;
  text: string;
  likes: number | null;
  views: number | null;
  lang: string | null;
  url: string | null;
  videoUrl: string | null;
  embedUrl: string | null;
}

export function extractTweetId(urlOrId: string): string {
  const trimmed = urlOrId.trim();
  const m = trimmed.match(/status(?:es)?\/(\d+)/);
  if (m) return m[1];
  if (/^\d+$/.test(trimmed)) return trimmed;
  throw new ScrapeError(`ツイート URL または ID を解釈できません: ${urlOrId}`);
}

export async function scrapePost(urlOrId: string): Promise<ScrapedPost> {
  const id = extractTweetId(urlOrId);
  let res: { ok: boolean; status: number; json(): Promise<unknown> };
  try {
    res = await fetch(`https://api.fxtwitter.com/status/${id}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new ScrapeError('fxtwitter API がタイムアウトしました(60秒)。時間をおいて再試行してください。');
    }
    throw new ScrapeError(`fxtwitter API に接続できません: ${String(err?.message ?? err).slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new ScrapeError(res.status === 404 ? `ポストが見つかりません: ${id}` : `fxtwitter API エラー: HTTP ${res.status}`);
  }
  let data: { tweet?: Record<string, any> };
  try {
    data = (await res.json()) as { tweet?: Record<string, any> };
  } catch {
    throw new ScrapeError('fxtwitter API の応答を JSON として解釈できません。時間をおいて再試行してください。');
  }
  const tweet = data.tweet;
  if (!tweet) throw new ScrapeError(`ポストが見つかりません: ${id}`);
  const author: string | null = tweet.author?.screen_name ?? null;
  const videos: Array<{ url?: string }> = tweet.media?.videos ?? [];
  const hasVideo = videos.length > 0;
  return {
    id,
    author,
    authorName: tweet.author?.name ?? null,
    text: tweet.text ?? '',
    likes: tweet.likes ?? null,
    views: tweet.views ?? null,
    lang: tweet.lang ?? null,
    url: tweet.url ?? null,
    videoUrl: hasVideo ? (videos[0].url ?? null) : null,
    embedUrl: hasVideo && author ? `https://x.com/${author}/status/${id}/video/1` : null,
  };
}

// Run twitter-cli. `positional` args go after a `--` separator so values that
// start with '-' (X search operators like `-is:retweet`) are never parsed as
// CLI options. twitter-cli is Click-based: options must come BEFORE `--`,
// which is why --json is inserted here and not appended at the end.
export function runTwitterCli(args: string[], positional: string[] = []): Promise<unknown> {
  const bin = process.env.TWITTER_BIN ?? 'twitter';
  const argv = [...args, '--json', ...(positional.length ? ['--', ...positional] : [])];
  return new Promise((resolve, reject) => {
    execFile(bin, argv, { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER }, (err, stdout, stderr) => {
      if (err) return reject(friendlyError(err, String(stderr ?? '')));
      try {
        resolve(unwrapEnvelope(JSON.parse(String(stdout))));
      } catch (parseErr) {
        if (parseErr instanceof ScrapeError) return reject(parseErr);
        reject(new ScrapeError(`twitter-cli の出力を JSON として解釈できません: ${String(stdout).slice(0, 200)}`));
      }
    });
  });
}
