import type { DbEngagementGate } from '@x-harness/db';
export interface ClaimGate extends DbEngagementGate {
  gate_mode: 'legacy' | 'line_first';
  slug: string;
  title: string;
  hero_image_url: string | null;
  ends_at: string;
  tier: 'simple' | 'standard' | 'strict';
  line_connection_id: string;
  reply_hashtag: string | null;
  claim_phrase: string;
  award_mode: 'first_come' | 'lottery';
  settle_sec: number;
  min_account_age_days: number;
  min_followers: number;
  brand_username: string;
  budget_usd: number;
  tracked_link_ref: string | null;
  gate_state: 'draft' | 'active' | 'failed' | 'ended';
  last_claim_at: number | null;
  last_code_check_at: number | null;
  last_overlap_at: number | null;
  scan_start_at: string | null;
  campaign_post_cost_usd: number | null;
  campaign_external_cost_usd: number | null;
  scan_cursor: string | null;
  scan_newest_id: string | null;
  scan_mode: string | null;
  pause_reason: string | null;
}
export interface GateParticipant {
  id: string;
  gate_id: string;
  line_friend_id: string;
  status: string;
  x_user_id: string | null;
  x_username: string | null;
  outcome: string | null;
  reward_id: string | null;
  rank: number | null;
  remaining: number | null;
  missing: string;
  retry_at: number | null;
  verify_attempts: number;
  verified_at: number | null;
  finalized_at: number | null;
  created_at: number;
  updated_at: number;
}
export interface ClaimCode {
  id: string;
  participant_id: string;
  gate_id: string;
  code: string;
  status: string;
  x_user_id: string | null;
  x_username: string | null;
  reply_tweet_id: string | null;
  reply_created_at: number | null;
  author_json: string | null;
  matched_at: number | null;
  issued_at: number;
  expires_at: number;
  reject_reason: string | null;
}
export interface GateReward {
  id: string;
  gate_id: string;
  tier: number;
  label: string;
  type: 'coupon_code' | 'url' | 'line_message' | 'file';
  value_template: string;
  quota: number | null;
  issued: number;
  weight: number;
  is_consolation: number;
  unit_cost: number | null;
}
export interface ClaimPost {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  conversation_id?: string;
  referenced_tweets?: Array<{ type: string; id: string }>;
  entities?: {
    urls?: Array<{ url?: string; expanded_url?: string }>;
    mentions?: Array<{ username: string }>;
  };
}
export interface ClaimAuthor {
  id: string;
  username: string;
  created_at?: string;
  protected?: boolean;
  public_metrics?: { followers_count?: number };
}
export interface GateLineConnection {
  id: string;
  worker_url: string;
  api_key: string;
  integration_secret: string | null;
  line_account_id: string | null;
}
