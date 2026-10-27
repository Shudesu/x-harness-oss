import type { HttpClient } from '../http.js';
import type { ApiResponse } from '../types.js';
export interface LineFirstCampaignInput {
  xAccountId: string;
  postId: string;
  lineConnectionId: string;
  title: string;
  slug: string;
  claimPhrase: string;
  endsAt: string;
  tier?: 'simple' | 'standard' | 'strict';
  awardMode?: 'first_come' | 'lottery';
  /** @deprecated Use followPolicy. */
  requireFollow?: boolean;
  followPolicy?: 'none' | 'ask' | 'verify_winners';
  likePolicy?: 'none' | 'ask' | 'verify_winners';
  verifyConditionsOptIn?: boolean;
  entryPage?: 'redirect' | 'status';
  messageTemplates?: { won?: string; lost?: string };
  loserFollowup?: {
    enabled: boolean;
    offer: 'coupon' | 'early_notice' | 'both';
    couponRewardIndex?: number;
    couponRewardId?: string;
    label?: string;
  };
  earlyNoticeFromGateIds?: string[];
  confirmEarlyNotice?: boolean;
  minAccountAgeDays?: number;
  settleSec?: number;
  budgetUsd?: number;
  postCostUsd?: number;
  externalCostUsd?: number;
  rewards: Array<{
    label: string;
    type: 'coupon_code' | 'url' | 'line_message' | 'file';
    value: string;
    quota: number | null;
    weight?: number;
    consolation?: boolean;
    codes?: string[];
    unitCost?: number;
  }>;
  scenarios?: { claimed?: string; won?: string; lost?: string };
}
export class CampaignsResource {
  constructor(private readonly http: HttpClient) {}
  async draft(input: {
    xAccountId: string;
    brief: string;
    tier?: 'simple' | 'standard' | 'strict';
    awardMode?: 'first_come' | 'lottery';
    quota?: number;
    rewardHint?: string;
  }) {
    return (await this.http.post<ApiResponse<unknown>>('/api/campaigns/draft', input)).data;
  }
  async create(input: LineFirstCampaignInput) {
    return (
      await this.http.post<
        ApiResponse<{ id: string; slug: string; state: string; entryUrl: string }>
      >('/api/campaigns', { ...input, mode: 'line_first' })
    ).data;
  }
  async digest(gateId: string) {
    return (
      await this.http.get<ApiResponse<unknown>>(
        `/api/campaigns/${encodeURIComponent(gateId)}/digest`,
      )
    ).data;
  }
  async status(gateId: string) {
    return (
      await this.http.get<ApiResponse<unknown>>(
        `/api/campaigns/${encodeURIComponent(gateId)}/status`,
      )
    ).data;
  }
  async funnel(gateId: string) {
    return (
      await this.http.get<ApiResponse<Record<string, unknown>>>(
        `/api/engagement-gates/${encodeURIComponent(gateId)}/funnel`,
      )
    ).data;
  }
}
