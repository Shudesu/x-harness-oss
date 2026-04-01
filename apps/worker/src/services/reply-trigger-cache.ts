import { XClient } from '@x-harness/x-sdk';
import type { XUser, XApiResponse } from '@x-harness/x-sdk';
import type { DbEngagementGate } from '@x-harness/db';

export class EngagementCache {
  private likingUsers = new Map<string, XUser[]>();
  private retweetedBy = new Map<string, XUser[]>();
  private followerIds = new Map<string, Set<string>>();

  async getLikingUsers(xClient: XClient, postId: string): Promise<XUser[]> {
    if (this.likingUsers.has(postId)) return this.likingUsers.get(postId)!;
    const users = await this.fetchAllPages((token) => xClient.getLikingUsers(postId, token));
    this.likingUsers.set(postId, users);
    return users;
  }

  async getRetweetedBy(xClient: XClient, postId: string): Promise<XUser[]> {
    if (this.retweetedBy.has(postId)) return this.retweetedBy.get(postId)!;
    const users = await this.fetchAllPages((token) => xClient.getRetweetedBy(postId, token));
    this.retweetedBy.set(postId, users);
    return users;
  }

  async getFollowerIds(xClient: XClient, userId: string): Promise<Set<string>> {
    if (this.followerIds.has(userId)) return this.followerIds.get(userId)!;
    const users = await this.fetchAllPages((token) => xClient.getFollowers(userId, token), 10);
    const ids = new Set(users.map((u) => u.id));
    this.followerIds.set(userId, ids);
    return ids;
  }

  private async fetchAllPages(
    fetcher: (token?: string) => Promise<XApiResponse<XUser[]>>,
    maxPages = 10,
  ): Promise<XUser[]> {
    const allUsers: XUser[] = [];
    let paginationToken: string | undefined;
    let page = 0;
    do {
      const result = await fetcher(paginationToken);
      if (result.data) allUsers.push(...result.data);
      paginationToken = (result as any).meta?.next_token;
      page++;
    } while (paginationToken && page < maxPages);
    return allUsers;
  }
}

export interface ReplyUser {
  id: string;
  username: string;
  name: string;
  profileImageUrl?: string;
  publicMetrics?: { followers_count?: number; following_count?: number };
}

export async function fetchNewReplies(
  xClient: XClient,
  gate: DbEngagementGate,
  maxPages = 10,
): Promise<{ users: ReplyUser[]; newestId: string | null }> {
  const keyword = gate.reply_keyword ? ` "${gate.reply_keyword}"` : '';
  const query = `conversation_id:${gate.post_id} is:reply${keyword}`;
  const sinceId = gate.last_reply_since_id ?? undefined;

  const seen = new Set<string>();
  const users: ReplyUser[] = [];
  let newestId: string | null = null;
  let paginationToken: string | undefined;
  let page = 0;

  do {
    const result = await xClient.searchRecentTweets(query, sinceId, paginationToken);

    if (!result.data || result.data.length === 0) break;

    const includes = (result as any).includes as { users?: XUser[] } | undefined;
    const userMap = new Map<string, XUser>();
    if (includes?.users) {
      for (const u of includes.users) userMap.set(u.id, u);
    }

    for (const tweet of result.data) {
      if (!newestId || tweet.id > newestId) newestId = tweet.id;
      if (seen.has(tweet.author_id)) continue;
      seen.add(tweet.author_id);

      const u = userMap.get(tweet.author_id);
      users.push({
        id: tweet.author_id,
        username: u?.username ?? '',
        name: u?.name ?? '',
      profileImageUrl: u?.profile_image_url,
        publicMetrics: u?.public_metrics,
      });
    }

    paginationToken = (result as any).meta?.next_token;
    page++;
  } while (paginationToken && page < maxPages);

  return { users, newestId };
}

export async function checkConditions(
  xClient: XClient,
  cache: EngagementCache,
  gate: DbEngagementGate,
  userId: string,
  xAccountUserId: string,
): Promise<{ reply: boolean; like: boolean; repost: boolean; follow: boolean }> {
  const conditions = { reply: true, like: true, repost: true, follow: true };

  if (gate.require_like) {
    const likers = await cache.getLikingUsers(xClient, gate.post_id);
    conditions.like = likers.some((u) => u.id === userId);
  }

  if (gate.require_repost) {
    const retweeters = await cache.getRetweetedBy(xClient, gate.post_id);
    conditions.repost = retweeters.some((u) => u.id === userId);
  }

  if (gate.require_follow) {
    const followerIds = await cache.getFollowerIds(xClient, xAccountUserId);
    conditions.follow = followerIds.has(userId);
  }

  return conditions;
}
