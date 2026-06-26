export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787';

export function getApiKey(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('xh_api_key') || '';
}

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasNextPage: boolean;
}

export interface EngagementGate {
  id: string;
  xAccountId: string;
  postId: string;
  triggerType: string;
  actionType: string;
  template: string;
  link: string | null;
  isActive: boolean;
  lineHarnessUrl: string | null;
  lineHarnessTag: string | null;
  lineHarnessScenarioId: string | null;
  requireLike: boolean;
  requireRepost: boolean;
  requireFollow: boolean;
  replyKeyword: string | null;
  pollingStrategy: string;
  estimatedCost: string;
  createdAt: string;
  updatedAt: string;
}

export interface Delivery {
  id: string;
  gateId: string;
  xUserId: string;
  xUsername: string | null;
  deliveredPostId: string | null;
  status: string;
  createdAt: string;
}

export interface Follower {
  id: string;
  xAccountId: string;
  xUserId: string;
  username: string | null;
  displayName: string | null;
  profileImageUrl: string | null;
  followerCount: number | null;
  followingCount: number | null;
  isFollowing: boolean;
  isFollowed: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  tags?: Tag[];
}

export interface Tag {
  id: string;
  xAccountId: string;
  name: string;
  color: string | null;
  createdAt: string;
}

export interface ScheduledPost {
  id: string;
  xAccountId: string;
  text: string;
  mediaIds: string[] | null;
  scheduledAt: string;
  status: string;
  postedTweetId: string | null;
  createdAt: string;
}



export interface XAccount {
  id: string;
  xUserId: string;
  username: string;
  displayName: string | null;
  // 0618追加開始
  profileImageUrl: string | null;
  // 0618追加終了
  isActive: boolean;
  createdAt: string;
}

export interface AccountSubscription {
  subscriptionType: string;
  verifiedType: string;
  charLimit: number;
}

export interface StaffMember {
  id: string;
  name: string;
  role: 'admin' | 'editor' | 'viewer';
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TweetHistory {
  id: string;
  text: string;
  created_at: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    impression_count: number;
  };
  referenced_tweets?: Array<{ type: string; id: string }>;
}

export interface MentionReply {
  id: string;
  text: string;
  authorId: string;
  authorUsername: string | null;
  authorDisplayName: string | null;
  authorProfileImageUrl: string | null;
  inReplyToTweetId: string | null;
  parentTweetText: string | null;
  parentTweetAuthor: string | null;
  createdAt: string;
  publicMetrics?: Record<string, number>;
  isOwnReply?: boolean;
}

export interface DmConversation {
  conversationId: string; participantId: string; lastMessage: string;
  lastMessageAt: string; senderId: string;
  participantUsername: string | null; participantDisplayName: string | null;
  participantProfileImageUrl: string | null;
}

export interface DmMessage {
  id: string; text: string; senderId: string; isMe: boolean; createdAt: string;
}

export interface UsageSummary {
  totalRequests: number; totalCost: number;
  byEndpoint: Array<{ endpoint: string; count: number }>;
}

export interface FollowerSnapshot {
  followersCount: number;
  followingCount: number;
  tweetCount: number;
  recordedAt: string;
}

export interface AccountStats {
  current: FollowerSnapshot | null;
  history: FollowerSnapshot[];
  growth: { days7: number | null; days30: number | null };
}

export interface DailyUsage { date: string; count: number; }

export interface GateUsage {
  id: string; postId: string; triggerType: string;
  apiCallsTotal: number; estimatedCost: number;
}

export const api = {
  health: () => fetchApi<ApiResponse<{ status: string }>>('/api/health'),

  engagementGates: {
    list: (params?: { xAccountId?: string }) => {
      const qs = new URLSearchParams();
      if (params?.xAccountId) qs.set('xAccountId', params.xAccountId);
      const query = qs.toString();
      return fetchApi<ApiResponse<EngagementGate[]>>(`/api/engagement-gates${query ? `?${query}` : ''}`);
    },
    get: (id: string) => fetchApi<ApiResponse<EngagementGate>>(`/api/engagement-gates/${id}`),
    create: (data: Partial<EngagementGate>) =>
      fetchApi<ApiResponse<EngagementGate>>('/api/engagement-gates', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<EngagementGate>) =>
      fetchApi<ApiResponse<EngagementGate>>(`/api/engagement-gates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => fetchApi<ApiResponse<void>>(`/api/engagement-gates/${id}`, { method: 'DELETE' }),
    deliveries: (id: string, limit = 50, offset = 0) =>
      fetchApi<ApiResponse<Delivery[]>>(`/api/engagement-gates/${id}/deliveries?limit=${limit}&offset=${offset}`),
  },

  followers: {
    list: (params?: { limit?: number; offset?: number; tagId?: string; xAccountId?: string }) => {
      const qs = new URLSearchParams();
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.offset) qs.set('offset', String(params.offset));
      if (params?.tagId) qs.set('tagId', params.tagId);
      if (params?.xAccountId) qs.set('xAccountId', params.xAccountId);
      return fetchApi<ApiResponse<PaginatedData<Follower>>>(`/api/followers?${qs}`);
    },
    get: (id: string) => fetchApi<ApiResponse<Follower>>(`/api/followers/${id}`),
    addTag: (id: string, tagId: string) =>
      fetchApi<ApiResponse<void>>(`/api/followers/${id}/tags`, { method: 'POST', body: JSON.stringify({ tagId }) }),
    removeTag: (id: string, tagId: string) =>
      fetchApi<ApiResponse<void>>(`/api/followers/${id}/tags/${tagId}`, { method: 'DELETE' }),
  },

  //0625修正開始
  // tags: {
  //   list: () => fetchApi<ApiResponse<Tag[]>>('/api/tags'),
  //   create: (xAccountId: string, name: string, color?: string) =>
  //     fetchApi<ApiResponse<Tag>>('/api/tags', { method: 'POST', body: JSON.stringify({ xAccountId, name, color }) }),
  //   update: (id: string, data: { name?: string; color?: string }) =>
  //     fetchApi<ApiResponse<Tag>>(`/api/tags/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  //   delete: (id: string) => fetchApi<ApiResponse<void>>(`/api/tags/${id}`, { method: 'DELETE' }),
  // },
    tags: {
      list: (params?: { xAccountId?: string }) => {
        const searchParams = new URLSearchParams();

        if (params?.xAccountId) {
          searchParams.set('xAccountId', params.xAccountId);
        }

        const query = searchParams.toString();

        return fetchApi<ApiResponse<Tag[]>>(`/api/tags${query ? `?${query}` : ''}`);
      },
      create: (xAccountId: string, name: string, color?: string) =>
        fetchApi<ApiResponse<Tag>>('/api/tags', { method: 'POST', body: JSON.stringify({ xAccountId, name, color }) }),
      update: (id: string, data: { name?: string; color?: string }) =>
        fetchApi<ApiResponse<Tag>>(`/api/tags/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
      delete: (id: string) => fetchApi<ApiResponse<void>>(`/api/tags/${id}`, { method: 'DELETE' }),
    },
  //0625修正完了
    
  staff: {
    list: () => fetchApi<ApiResponse<StaffMember[]>>('/api/staff'),
    me: () => fetchApi<ApiResponse<StaffMember>>('/api/staff/me'),
    create: (data: { name: string; role: 'admin' | 'editor' | 'viewer' }) =>
      fetchApi<ApiResponse<StaffMember & { plainApiKey: string }>>('/api/staff', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Pick<StaffMember, 'name' | 'role' | 'isActive'>>) =>
      fetchApi<ApiResponse<StaffMember>>(`/api/staff/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => fetchApi<ApiResponse<void>>(`/api/staff/${id}`, { method: 'DELETE' }),
  },

  posts: {
    schedule: (data: { xAccountId: string; text: string; scheduledAt: string }) =>
      fetchApi<ApiResponse<ScheduledPost>>('/api/posts/schedule', { method: 'POST', body: JSON.stringify(data) }),
    listScheduled: () => fetchApi<ApiResponse<ScheduledPost[]>>('/api/posts/scheduled'),
    cancel: (id: string) => fetchApi<ApiResponse<void>>(`/api/posts/scheduled/${id}`, { method: 'DELETE' }),
    create: (data: { xAccountId: string; text: string; quoteTweetId?: string; mediaIds?: string[] }) =>
      fetchApi<ApiResponse<TweetHistory>>('/api/posts', { method: 'POST', body: JSON.stringify(data) }),
    delete: (tweetId: string, xAccountId: string) =>
      fetchApi<ApiResponse<void>>(`/api/posts/${tweetId}?xAccountId=${encodeURIComponent(xAccountId)}`, { method: 'DELETE' }),
    thread: (data: { xAccountId: string; texts: string[]; mediaIds?: string[] }) =>
      fetchApi<ApiResponse<TweetHistory[]>>('/api/posts/thread', { method: 'POST', body: JSON.stringify(data) }),
    history: (params?: { xAccountId?: string; limit?: number; cursor?: string }) => {
      const qs = new URLSearchParams();
      if (params?.xAccountId) qs.set('xAccountId', params.xAccountId);
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.cursor) qs.set('cursor', params.cursor);
      return fetchApi<ApiResponse<{ items: TweetHistory[]; nextCursor?: string }>>(`/api/posts/history?${qs}`);
    },
    mentions: (params?: { xAccountId?: string; sinceId?: string }) => {
      const qs = new URLSearchParams();
      if (params?.xAccountId) qs.set('xAccountId', params.xAccountId);
      if (params?.sinceId) qs.set('sinceId', params.sinceId);
      return fetchApi<ApiResponse<MentionReply[]>>(`/api/posts/mentions?${qs}`);
    },
    reply: (tweetId: string, data: { xAccountId: string; text: string }) =>
      fetchApi<ApiResponse<TweetHistory>>(`/api/posts/${tweetId}/reply`, { method: 'POST', body: JSON.stringify(data) }),
    like: (tweetId: string, xAccountId: string) =>
      fetchApi<ApiResponse<void>>(`/api/posts/${tweetId}/like`, { method: 'POST', body: JSON.stringify({ xAccountId }) }),
    retweet: (tweetId: string, xAccountId: string) =>
      fetchApi<ApiResponse<void>>(`/api/posts/${tweetId}/retweet`, { method: 'POST', body: JSON.stringify({ xAccountId }) }),
    getActions: (xAccountId: string, tweetIds: string[]) =>
      fetchApi<ApiResponse<Record<string, string[]>>>('/api/posts/actions', { method: 'POST', body: JSON.stringify({ xAccountId, tweetIds }) }),
    quotes: (tweetId: string, xAccountId: string) =>
      fetchApi<ApiResponse<MentionReply[]>>(`/api/posts/${tweetId}/quotes?xAccountId=${xAccountId}`),
  },




  quotes: {
    list: (params: { xAccountId: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams({ xAccountId: params.xAccountId });
      if (params.limit) qs.set('limit', String(params.limit));
      if (params.offset) qs.set('offset', String(params.offset));
      return fetchApi<ApiResponse<MentionReply[]> & { lastSync: string | null }>(`/api/quotes?${qs}`);
    },
    sync: (xAccountId: string) =>
      fetchApi<ApiResponse<{ tweetsChecked: number; quotesSaved: number }>>('/api/quotes/sync', {
        method: 'POST',
        body: JSON.stringify({ xAccountId }),
      }),
  },

  accounts: {
    list: () => fetchApi<ApiResponse<XAccount[]>>('/api/x-accounts'),
    create: (data: { xUserId: string; username: string; accessToken: string; refreshToken?: string }) =>
      fetchApi<ApiResponse<XAccount>>('/api/x-accounts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { accessToken?: string; isActive?: boolean }) =>
      fetchApi<ApiResponse<void>>(`/api/x-accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    // 0618追加開始
  refreshProfile: (id: string) =>
    fetchApi<ApiResponse<XAccount>>(
      `/api/x-accounts/${id}/refresh-profile`,
      { method: 'POST' },
    ),
  // 0618追加終了
    subscription: (id: string) =>
      fetchApi<ApiResponse<AccountSubscription>>(`/api/x-accounts/${id}/subscription`),
    stats: (id: string) =>
      fetchApi<ApiResponse<AccountStats>>(`/api/x-accounts/${id}/stats`),
  },

  media: {
    upload: async (file: File, xAccountId: string): Promise<ApiResponse<{ mediaId: string }>> => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('xAccountId', xAccountId);
      const category = file.type.startsWith('video/') ? 'tweet_video' : 'tweet_image';
      formData.append('mediaCategory', category);
      const res = await fetch(`${API_URL}/api/media/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getApiKey()}` },
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `Media upload failed: HTTP ${res.status}`);
      }
      return res.json() as Promise<ApiResponse<{ mediaId: string }>>;
    },
  },

  dm: {
    conversations: (xAccountId?: string) => {
      const qs = new URLSearchParams();
      if (xAccountId) qs.set('xAccountId', xAccountId);
      return fetchApi<ApiResponse<DmConversation[]>>(`/api/dm/conversations?${qs}`);
    },
    messages: (conversationId: string, xAccountId?: string, cursor?: string) => {
      const qs = new URLSearchParams();
      if (xAccountId) qs.set('xAccountId', xAccountId);
      if (cursor) qs.set('cursor', cursor);
      return fetchApi<ApiResponse<{ messages: DmMessage[]; myUserId: string; nextCursor?: string }>>(`/api/dm/conversations/${conversationId}/messages?${qs}`);
    },
    send: (data: { xAccountId: string; participantId: string; text: string }) =>
      fetchApi<ApiResponse<DmMessage>>('/api/dm/send', { method: 'POST', body: JSON.stringify(data) }),
  },

  users: {
    lookup: async (username: string): Promise<ApiResponse<{ id: string; username: string } | null>> => {
      const res = await fetchApi<ApiResponse<Array<{ id: string; username: string }>>>(`/api/users/search?q=${encodeURIComponent(username)}&limit=1`);
      if (res.success && res.data.length > 0) {
        return { success: true, data: res.data[0] };
      }
      return { success: false, data: null, error: 'User not found' };
    },
  },

  campaigns: {
    create: (data: {
      xAccountId: string;
      text: string;
      mediaIds?: string[];
      requireLike?: boolean;
      requireRepost?: boolean;
      requireFollow?: boolean;
      replyKeyword?: string | null;
      lineIntegration?: boolean;
    }) =>
      fetchApi<ApiResponse<{
        tweetId: string;
        tweetUrl: string;
        gateId: string;
        campaignLink?: string;
        lineFormId?: string;
        lineTagId?: string;
      }>>('/api/campaigns', { method: 'POST', body: JSON.stringify(data) }),
  },

  usage: {
    summary: (params?: { xAccountId?: string; startDate?: string; endDate?: string }) => {
      const qs = new URLSearchParams();
      if (params?.xAccountId) qs.set('xAccountId', params.xAccountId);
      if (params?.startDate) qs.set('startDate', params.startDate);
      if (params?.endDate) qs.set('endDate', params.endDate);
      return fetchApi<ApiResponse<UsageSummary>>(`/api/usage?${qs}`);
    },
    daily: (params?: { xAccountId?: string; days?: number }) => {
      const qs = new URLSearchParams();
      if (params?.xAccountId) qs.set('xAccountId', params.xAccountId);
      if (params?.days) qs.set('days', String(params.days));
      return fetchApi<ApiResponse<DailyUsage[]>>(`/api/usage/daily?${qs}`);
    },
    byGate: () => fetchApi<ApiResponse<GateUsage[]>>('/api/usage/by-gate'),
  },
};
