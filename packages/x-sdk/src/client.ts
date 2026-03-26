import type { XUser, XTweet, XApiResponse, CreateTweetParams } from './types.js';

export class XClient {
  private readonly accessToken: string;
  private readonly baseUrl = 'https://api.x.com/2';

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async createTweet(params: CreateTweetParams): Promise<{ id: string; text: string }> {
    const res = await this.post<{ data: { id: string; text: string } }>('/tweets', params);
    return res.data;
  }

  async deleteTweet(tweetId: string): Promise<void> {
    await this.request('DELETE', `/tweets/${tweetId}`);
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
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
    };

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
