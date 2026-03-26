// API response envelope — same pattern as LINE Harness
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

// Engagement Gate types
export type TriggerType = 'like' | 'repost' | 'reply' | 'follow';
export type ActionType = 'mention_post' | 'dm';
export type DeliveryStatus = 'delivered' | 'failed' | 'pending';
export type PostStatus = 'scheduled' | 'posted' | 'failed';

export interface EngagementGate {
  id: string;
  xAccountId: string;
  postId: string;
  triggerType: TriggerType;
  actionType: ActionType;
  template: string;
  link: string | null;
  isActive: boolean;
  lineHarnessUrl: string | null;
  lineHarnessApiKey: string | null;
  lineHarnessTag: string | null;
  lineHarnessScenarioId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EngagementGateDelivery {
  id: string;
  gateId: string;
  xUserId: string;
  xUsername: string | null;
  deliveredPostId: string | null;
  status: DeliveryStatus;
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
  userId: string | null;
  metadata: Record<string, unknown>;
  firstSeenAt: string;
  unfollowedAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  status: PostStatus;
  postedTweetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string | null;
  phone: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface XAccount {
  id: string;
  xUserId: string;
  username: string;
  displayName: string | null;
  accessToken: string;
  refreshToken: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
