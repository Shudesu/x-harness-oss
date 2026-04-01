const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787';

function getApiKey(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('xh_api_key') || '';
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
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
  isActive: boolean;
  createdAt: string;
}

export const api = {
  health: () => fetchApi<ApiResponse<{ status: string }>>('/api/health'),

  engagementGates: {
    list: () => fetchApi<ApiResponse<EngagementGate[]>>('/api/engagement-gates'),
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
    list: (params?: { limit?: number; offset?: number; tagId?: string }) => {
      const qs = new URLSearchParams();
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.offset) qs.set('offset', String(params.offset));
      if (params?.tagId) qs.set('tagId', params.tagId);
      return fetchApi<ApiResponse<PaginatedData<Follower>>>(`/api/followers?${qs}`);
    },
    get: (id: string) => fetchApi<ApiResponse<Follower>>(`/api/followers/${id}`),
    addTag: (id: string, tagId: string) =>
      fetchApi<ApiResponse<void>>(`/api/followers/${id}/tags`, { method: 'POST', body: JSON.stringify({ tagId }) }),
    removeTag: (id: string, tagId: string) =>
      fetchApi<ApiResponse<void>>(`/api/followers/${id}/tags/${tagId}`, { method: 'DELETE' }),
  },

  tags: {
    list: () => fetchApi<ApiResponse<Tag[]>>('/api/tags'),
    create: (xAccountId: string, name: string, color?: string) =>
      fetchApi<ApiResponse<Tag>>('/api/tags', { method: 'POST', body: JSON.stringify({ xAccountId, name, color }) }),
    update: (id: string, data: { name?: string; color?: string }) =>
      fetchApi<ApiResponse<Tag>>(`/api/tags/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => fetchApi<ApiResponse<void>>(`/api/tags/${id}`, { method: 'DELETE' }),
  },

  posts: {
    schedule: (data: { xAccountId: string; text: string; scheduledAt: string }) =>
      fetchApi<ApiResponse<ScheduledPost>>('/api/posts/schedule', { method: 'POST', body: JSON.stringify(data) }),
    listScheduled: () => fetchApi<ApiResponse<ScheduledPost[]>>('/api/posts/scheduled'),
    cancel: (id: string) => fetchApi<ApiResponse<void>>(`/api/posts/scheduled/${id}`, { method: 'DELETE' }),
  },

  accounts: {
    list: () => fetchApi<ApiResponse<XAccount[]>>('/api/x-accounts'),
    create: (data: { xUserId: string; username: string; accessToken: string; refreshToken?: string }) =>
      fetchApi<ApiResponse<XAccount>>('/api/x-accounts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { accessToken?: string; isActive?: boolean }) =>
      fetchApi<ApiResponse<void>>(`/api/x-accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  },
};
