import type { XUser, XTweet, XApiResponse, CreateTweetParams, XClientConfig, XTweetSearchResult, XTweetWithMetrics, CreateTweetFullParams, XDmEvent, XDmMessage, XList } from './types.js';
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

  async getTweet(tweetId: string): Promise<XTweetWithMetrics> {
    const params = new URLSearchParams({ 'tweet.fields': 'author_id,created_at,public_metrics' });
    const res = await this.get<{ data: XTweetWithMetrics }>(`/tweets/${tweetId}?${params}`);
    return res.data;
  }

  async getTweets(tweetIds: string[]): Promise<XTweetWithMetrics[]> {
    const params = new URLSearchParams({ ids: tweetIds.join(','), 'tweet.fields': 'author_id,created_at,public_metrics' });
    const res = await this.get<{ data: XTweetWithMetrics[] }>(`/tweets?${params}`);
    return res.data;
  }

  async getQuoteTweets(tweetId: string, paginationToken?: string): Promise<XApiResponse<XTweetSearchResult[]>> {
    const params = new URLSearchParams({ 'tweet.fields': 'author_id,created_at', 'user.fields': 'profile_image_url,public_metrics', expansions: 'author_id', max_results: '100' });
    if (paginationToken) params.set('pagination_token', paginationToken);
    return this.get<XApiResponse<XTweetSearchResult[]>>(`/tweets/${tweetId}/quote_tweets?${params}`);
  }

  async getUserTweets(userId: string, paginationToken?: string): Promise<XApiResponse<XTweetWithMetrics[]>> {
    const params = new URLSearchParams({ 'tweet.fields': 'author_id,created_at,public_metrics', max_results: '100' });
    if (paginationToken) params.set('pagination_token', paginationToken);
    return this.get<XApiResponse<XTweetWithMetrics[]>>(`/users/${userId}/tweets?${params}`);
  }

  async getUserMentions(userId: string, paginationToken?: string): Promise<XApiResponse<XTweetWithMetrics[]>> {
    const params = new URLSearchParams({ 'tweet.fields': 'author_id,created_at,public_metrics', max_results: '100' });
    if (paginationToken) params.set('pagination_token', paginationToken);
    return this.get<XApiResponse<XTweetWithMetrics[]>>(`/users/${userId}/mentions?${params}`);
  }

  async createTweetFull(params: CreateTweetFullParams): Promise<{ id: string; text: string }> {
    const res = await this.post<{ data: { id: string; text: string } }>('/tweets', params);
    return res.data;
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

  async searchRecentTweets(query: string, sinceId?: string, paginationToken?: string): Promise<XApiResponse<XTweetSearchResult[]>> {
    const params = new URLSearchParams({
      query,
      'tweet.fields': 'author_id,created_at,in_reply_to_user_id',
      'user.fields': 'profile_image_url,public_metrics',
      expansions: 'author_id',
      max_results: '100',
    });
    if (sinceId) params.set('since_id', sinceId);
    if (paginationToken) params.set('next_token', paginationToken);
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

  async likeTweet(userId: string, tweetId: string): Promise<void> {
    await this.post(`/users/${userId}/likes`, { tweet_id: tweetId });
  }

  async unlikeTweet(userId: string, tweetId: string): Promise<void> {
    await this.request('DELETE', `/users/${userId}/likes/${tweetId}`);
  }

  async getLikedTweets(userId: string, paginationToken?: string): Promise<XApiResponse<XTweetWithMetrics[]>> {
    const params = new URLSearchParams({ 'tweet.fields': 'author_id,created_at,public_metrics', max_results: '100' });
    if (paginationToken) params.set('pagination_token', paginationToken);
    return this.get<XApiResponse<XTweetWithMetrics[]>>(`/users/${userId}/liked_tweets?${params}`);
  }

  async retweet(userId: string, tweetId: string): Promise<void> {
    await this.post(`/users/${userId}/retweets`, { tweet_id: tweetId });
  }

  async unretweet(userId: string, tweetId: string): Promise<void> {
    await this.request('DELETE', `/users/${userId}/retweets/${tweetId}`);
  }

  async getFollowing(userId: string, paginationToken?: string): Promise<XApiResponse<XUser[]>> {
    const params = new URLSearchParams({ max_results: '1000', 'user.fields': 'profile_image_url,public_metrics' });
    if (paginationToken) params.set('pagination_token', paginationToken);
    return this.get<XApiResponse<XUser[]>>(`/users/${userId}/following?${params}`);
  }

  async follow(userId: string, targetUserId: string): Promise<void> {
    await this.post(`/users/${userId}/following`, { target_user_id: targetUserId });
  }

  async unfollow(userId: string, targetUserId: string): Promise<void> {
    await this.request('DELETE', `/users/${userId}/following/${targetUserId}`);
  }

  async searchUsers(query: string): Promise<XApiResponse<XUser[]>> {
    const params = new URLSearchParams({ query, 'user.fields': 'profile_image_url,public_metrics', max_results: '100' });
    return this.get<XApiResponse<XUser[]>>(`/users/search?${params}`);
  }

  async sendDm(participantId: string, text: string): Promise<XDmMessage> {
    const res = await this.post<{ data: XDmMessage }>(`/dm_conversations/with/${participantId}/messages`, { text });
    return res.data;
  }

  async sendDmToConversation(conversationId: string, text: string): Promise<XDmMessage> {
    const res = await this.post<{ data: XDmMessage }>(`/dm_conversations/${conversationId}/messages`, { text });
    return res.data;
  }

  async createDmConversation(participantIds: string[], text: string): Promise<XDmMessage> {
    const res = await this.post<{ data: XDmMessage }>('/dm_conversations', { conversation_type: 'Group', participant_ids: participantIds, message: { text } });
    return res.data;
  }

  async getDmEvents(conversationId?: string, paginationToken?: string): Promise<XApiResponse<XDmEvent[]>> {
    const params = new URLSearchParams({ max_results: '100', 'dm_event.fields': 'sender_id,created_at,dm_conversation_id' });
    if (paginationToken) params.set('pagination_token', paginationToken);
    if (conversationId) {
      return this.get<XApiResponse<XDmEvent[]>>(`/dm_conversations/${conversationId}/dm_events?${params}`);
    }
    return this.get<XApiResponse<XDmEvent[]>>(`/dm_events?${params}`);
  }

  async getBookmarks(userId: string, paginationToken?: string): Promise<XApiResponse<XTweetWithMetrics[]>> {
    const params = new URLSearchParams({ 'tweet.fields': 'author_id,created_at,public_metrics', max_results: '100' });
    if (paginationToken) params.set('pagination_token', paginationToken);
    return this.get<XApiResponse<XTweetWithMetrics[]>>(`/users/${userId}/bookmarks?${params}`);
  }

  async bookmark(userId: string, tweetId: string): Promise<void> {
    await this.post(`/users/${userId}/bookmarks`, { tweet_id: tweetId });
  }

  async removeBookmark(userId: string, tweetId: string): Promise<void> {
    await this.request('DELETE', `/users/${userId}/bookmarks/${tweetId}`);
  }

  async createList(name: string, description?: string): Promise<XList> {
    const res = await this.post<{ data: XList }>('/lists', { name, description });
    return res.data;
  }

  async deleteList(listId: string): Promise<void> {
    await this.request('DELETE', `/lists/${listId}`);
  }

  async getList(listId: string): Promise<XList> {
    const res = await this.get<{ data: XList }>(`/lists/${listId}?list.fields=owner_id,follower_count,member_count,created_at`);
    return res.data;
  }

  async addListMember(listId: string, userId: string): Promise<void> {
    await this.post(`/lists/${listId}/members`, { user_id: userId });
  }

  async removeListMember(listId: string, userId: string): Promise<void> {
    await this.request('DELETE', `/lists/${listId}/members/${userId}`);
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
