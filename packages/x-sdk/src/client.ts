import type { XUser, XTweet, XApiResponse, CreateTweetParams, XClientConfig, XTweetSearchResult } from './types.js';
import { buildOAuth1Header } from './oauth1.js';
import type { OAuth1Config } from './oauth1.js';

export class XClient {
  private readonly config: XClientConfig;
  private readonly baseUrl = 'https://api.x.com/2';

  constructor(config: XClientConfig | string) {
    // Backwards compatible: string = bearer token
    this.config = typeof config === 'string' ? { type: 'bearer', token: config } : config;
  }

  async createTweet(params: CreateTweetParams): Promise<{ id: string; text: string }> {
    const res = await this.post<{ data: { id: string; text: string } }>('/tweets', params);
    return res.data;
  }

  async deleteTweet(tweetId: string): Promise<void> {
    await this.request('DELETE', `/tweets/${tweetId}`);
  }

  async hideTweet(tweetId: string): Promise<void> {
    await this.request('PUT', `/tweets/${tweetId}/hidden`, { hidden: true });
  }

  async getLikingUsers(tweetId: string, paginationToken?: string): Promise<XApiResponse<XUser[]>> {
    const params = new URLSearchParams({ 'user.fields': 'profile_image_url,public_metrics' });
    if (paginationToken) params.set('pagination_token', paginationToken);
    return this.get<XApiResponse<XUser[]>>(`/tweets/${tweetId}/liking_users?${params}`);
  }

  async getRetweetedBy(tweetId: string, paginationToken?: string): Promise<XApiResponse<XUser[]>> {
    const params = new URLSearchParams({ 'user.fields': 'profile_image_url,public_metrics' });
    if (paginationToken) params.set('pagination_token', paginationToken);
    return this.get<XApiResponse<XUser[]>>(`/tweets/${tweetId}/retweeted_by?${params}`);
  }

  async searchRecentTweets(query: string): Promise<XApiResponse<XTweetSearchResult[]>> {
    const params = new URLSearchParams({
      query,
      'tweet.fields': 'author_id,created_at,in_reply_to_user_id',
      'user.fields': 'profile_image_url,public_metrics',
      expansions: 'author_id',
      max_results: '100',
    });
    return this.get<XApiResponse<XTweetSearchResult[]>>(`/tweets/search/recent?${params}`);
  }

  async getMe(): Promise<XUser> {
    const res = await this.get<{ data: XUser }>('/users/me?user.fields=profile_image_url,public_metrics');
    return res.data;
  }

  async getUserById(userId: string): Promise<XUser> {
    const res = await this.get<{ data: XUser }>(`/users/${userId}?user.fields=profile_image_url,public_metrics`);
    return res.data;
  }

  async getUserByUsername(username: string): Promise<XUser> {
    const res = await this.get<{ data: XUser }>(`/users/by/username/${username}?user.fields=profile_image_url,public_metrics`);
    return res.data;
  }

  async getFollowers(userId: string, paginationToken?: string): Promise<XApiResponse<XUser[]>> {
    const params = new URLSearchParams({ max_results: '1000', 'user.fields': 'profile_image_url,public_metrics' });
    if (paginationToken) params.set('pagination_token', paginationToken);
    return this.get<XApiResponse<XUser[]>>(`/users/${userId}/followers?${params}`);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.type === 'oauth1') {
      headers['Authorization'] = await buildOAuth1Header(method, url, this.config as OAuth1Config);
    } else {
      headers['Authorization'] = `Bearer ${this.config.token}`;
    }

    const options: RequestInit = { method, headers };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);

    if (res.status === 429) {
      const resetAt = res.headers.get('x-rate-limit-reset');
      throw new XApiRateLimitError(resetAt ? Number(resetAt) : undefined);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new XApiError(`X API ${method} ${path} failed: ${res.status} ${text}`, res.status);
    }

    return res.json() as Promise<T>;
  }
}

export class XApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'XApiError';
  }
}

export class XApiRateLimitError extends XApiError {
  constructor(public readonly resetAtEpoch?: number) {
    super('Rate limited by X API', 429);
    this.name = 'XApiRateLimitError';
  }
}
