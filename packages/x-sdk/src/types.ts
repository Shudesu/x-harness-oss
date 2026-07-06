export interface XUser {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
  public_metrics?: {
    followers_count: number;
    following_count: number;
    tweet_count: number;
  };
  subscription_type?: 'Basic' | 'Premium' | 'PremiumPlus' | 'None';
  verified_type?: 'blue' | 'government' | 'business' | 'none';
}

export interface XTweet {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
}

export interface XApiResponse<T> {
  data: T;
  meta?: {
    result_count?: number;
    next_token?: string;
  };
}

export interface XApiError {
  title: string;
  detail: string;
  type: string;
  status: number;
}

export interface CreateTweetParams {
  text: string;
  media?: { media_ids: string[] };
  reply?: { in_reply_to_tweet_id: string };
  quote_tweet_id?: string;
  // Paid promotion disclosure (X API 2026-06-03)
  paid_partnership?: boolean;
}

// ─── Articles API (X API 2026-06-11) ───

// DraftJS-style content blocks accepted by POST /2/articles/draft.
// The docs example shows only text/type; the remaining fields are the
// standard DraftJS raw shape (safe superset).
export interface ArticleContentBlock {
  text: string;
  type: string; // 'unstyled' | 'header-one' | 'header-two' | 'unordered-list-item' | 'ordered-list-item' | 'blockquote' | ...
  key?: string;
  depth?: number;
  inlineStyleRanges?: unknown[];
  entityRanges?: unknown[];
  data?: Record<string, unknown>;
}

export interface ArticleContentState {
  blocks: ArticleContentBlock[];
  entities: unknown[];
}

export interface CreateArticleDraftParams {
  title: string;
  content_state: ArticleContentState;
  cover_media?: { media_id: string };
}

// ─── News API ───

export interface XNewsStory {
  id: string;
  name?: string;
  category?: string;
  summary?: string;
  hook?: string;
  contexts?: unknown;
  cluster_posts_results?: unknown;
  last_updated_at_ms?: number;
}

export type XClientConfig =
  | { type: 'bearer'; token: string }
  | { type: 'oauth1'; consumerKey: string; consumerSecret: string; accessToken: string; accessTokenSecret: string };

export interface XTweetSearchResult {
  id: string;
  text: string;
  author_id: string;
  created_at?: string;
  in_reply_to_user_id?: string;
}

export interface XTweetWithMetrics {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: {
    retweet_count: number;
    reply_count: number;
    like_count: number;
    quote_count: number;
    impression_count: number;
  };
}

export interface CreateTweetFullParams {
  text: string;
  media?: { media_ids: string[] };
  reply?: { in_reply_to_tweet_id: string };
  quote_tweet_id?: string;
  reply_settings?: 'mentionedUsers' | 'following';
  direct_message_deep_link?: string;
  nullcast?: boolean;
  for_super_followers_only?: boolean;
  poll?: { options: string[]; duration_minutes: number };
  // Paid promotion disclosure (X API 2026-06-03)
  paid_partnership?: boolean;
}

export interface XDmEvent {
  id: string;
  event_type: string;
  text?: string;
  sender_id?: string;
  dm_conversation_id?: string;
  created_at?: string;
}

export interface XDmMessage {
  dm_conversation_id: string;
  dm_event_id: string;
}

export interface XList {
  id: string;
  name: string;
  description?: string;
  owner_id?: string;
  follower_count?: number;
  member_count?: number;
  created_at?: string;
}
