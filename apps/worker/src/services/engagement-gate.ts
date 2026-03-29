import { XClient, XApiRateLimitError } from '@x-harness/x-sdk';
import type { XUser, XApiResponse } from '@x-harness/x-sdk';
import {
  getEngagementGates, getDeliveredUserIds, createDelivery, updateDeliveryStatus,
  upsertFollower, updateEngagementGate,
} from '@x-harness/db';
import type { DbEngagementGate } from '@x-harness/db';
import { addJitter, varyTemplate, checkRateLimit, incrementRateLimit } from './stealth.js';
import { shouldPollNow, isExpired, calculateNextPollAt } from './polling-scheduler.js';

/**
 * @param forceRun - When true, bypasses shouldPollNow() for manual/debug triggers.
 *                   Allows operators to force-run gates regardless of next_poll_at.
 */
export async function processEngagementGates(db: D1Database, xClient: XClient, xAccountId?: string, forceRun = false): Promise<void> {
  const allGates = await getEngagementGates(db, { activeOnly: true });
  const gates = xAccountId ? allGates.filter((g) => g.x_account_id === xAccountId) : allGates;

  for (const gate of gates) {
    try {
      // Check expiry first
      if (isExpired(gate)) {
        await updateEngagementGate(db, gate.id, { isActive: false });
        console.log(`Gate ${gate.id} expired — deactivated`);
        continue;
      }

      // Skip if not due for polling yet (unless forced by manual trigger)
      if (!forceRun && !shouldPollNow(gate)) continue;

      // Calculate and persist next_poll_at before attempting the poll,
      // so that transient errors do not cause the gate to retry every cron cycle.
      const nextPollAt = calculateNextPollAt(gate);
      await db
        .prepare('UPDATE engagement_gates SET next_poll_at = ?, updated_at = ? WHERE id = ?')
        .bind(nextPollAt, new Date().toISOString(), gate.id)
        .run();

      await processOneGate(db, xClient, gate);

      // Increment API call counter only on successful poll
      await db
        .prepare('UPDATE engagement_gates SET api_calls_total = api_calls_total + 1, updated_at = ? WHERE id = ?')
        .bind(new Date().toISOString(), gate.id)
        .run();
    } catch (err) {
      if (err instanceof XApiRateLimitError) {
        console.error('Rate limited — stopping engagement gate processing');
        return;
      }
      console.error(`Error processing gate ${gate.id}:`, err);
    }
  }
}

async function processOneGate(
  db: D1Database,
  xClient: XClient,
  gate: DbEngagementGate,
): Promise<void> {
  if (gate.action_type !== 'mention_post' && gate.action_type !== 'dm') return;

  let engagedUsers;
  if (gate.trigger_type === 'like') {
    engagedUsers = await xClient.getLikingUsers(gate.post_id);
  } else if (gate.trigger_type === 'repost') {
    engagedUsers = await xClient.getRetweetedBy(gate.post_id);
  } else if (gate.trigger_type === 'reply') {
    engagedUsers = await getReplyUsers(xClient, gate);
  } else if (gate.trigger_type === 'follow') {
    // gate.post_id holds the x_user_id of the account to check followers for
    engagedUsers = await xClient.getFollowers(gate.post_id);
  } else if (gate.trigger_type === 'quote') {
    engagedUsers = await getQuoteUsers(xClient, gate);
  } else {
    return;
  }

  if (!engagedUsers.data || engagedUsers.data.length === 0) return;

  const deliveredIds = await getDeliveredUserIds(db, gate.id);
  const newUsers = engagedUsers.data.filter((u) => !deliveredIds.has(u.id));

  for (const user of newUsers) {
    if (!checkRateLimit(gate.x_account_id)) {
      console.log(`Rate limit reached for account ${gate.x_account_id}, pausing`);
      return;
    }

    await addJitter(30_000, 180_000);

    // Create pending delivery first to get the token
    const delivery = await createDelivery(db, gate.id, user.id, user.username, null, 'pending');

    try {
      // Lottery check
      if (gate.lottery_enabled) {
        const won = Math.random() * 100 < gate.lottery_rate;
        if (!won) {
          if (gate.lottery_lose_template) {
            const loseText = varyTemplate(gate.lottery_lose_template.replace('{username}', user.username));
            await xClient.createTweet({ text: `@${user.username} ${loseText}` });
          }
          await updateDeliveryStatus(db, delivery.id, 'delivered');
          incrementRateLimit(gate.x_account_id);
          continue;
        }
      }

      const winTemplate = (gate.lottery_enabled && gate.lottery_win_template) ? gate.lottery_win_template : gate.template;
      let text = varyTemplate(winTemplate.replace('{username}', user.username));
      if (gate.link) {
        // Build link with one-time token for X-LINE account linking
        const personalizedLink = appendRef(gate.link, `xh:${delivery.token}`);
        text = text.replace('{link}', personalizedLink);
      }

      let tweetId: string;
      if (gate.action_type === 'dm') {
        await xClient.sendDm(user.id, text);
        tweetId = 'dm';
      } else {
        const tweet = await xClient.createTweet({ text: `@${user.username} ${text}` });
        tweetId = tweet.id;
      }
      await updateDeliveryStatus(db, delivery.id, 'delivered', tweetId);
      incrementRateLimit(gate.x_account_id);

      await upsertFollower(db, {
        xAccountId: gate.x_account_id,
        xUserId: user.id,
        username: user.username,
        displayName: user.name,
        profileImageUrl: user.profile_image_url,
        followerCount: user.public_metrics?.followers_count,
        followingCount: user.public_metrics?.following_count,
      });

      if (gate.line_harness_url && gate.line_harness_api_key) {
        triggerLineHarness(gate.line_harness_url, gate.line_harness_api_key, gate.line_harness_tag, gate.line_harness_scenario_id, user.username).catch(() => {});
      }
    } catch (err) {
      if (err instanceof XApiRateLimitError) {
        // Mark pending delivery as failed before re-throwing to prevent permanent suppression
        await updateDeliveryStatus(db, delivery.id, 'failed').catch(() => {});
        throw err;
      }
      console.error(`Failed to deliver to @${user.username}:`, err);
      await updateDeliveryStatus(db, delivery.id, 'failed');
    }
  }
}

async function getReplyUsers(
  xClient: XClient,
  gate: DbEngagementGate,
): Promise<XApiResponse<XUser[]>> {
  // Search for replies to this conversation only (is:reply excludes the root tweet itself)
  const result = await xClient.searchRecentTweets(`conversation_id:${gate.post_id} is:reply`);

  if (!result.data || result.data.length === 0) {
    return { data: [] };
  }

  // Extract unique authors from replies, build XUser-compatible objects from expansions
  const includes = (result as any).includes as { users?: XUser[] } | undefined;
  const userMap = new Map<string, XUser>();
  if (includes?.users) {
    for (const u of includes.users) {
      userMap.set(u.id, u);
    }
  }

  // Deduplicate by author_id, skip the original post author (gate owner)
  const seen = new Set<string>();
  const users: XUser[] = [];
  for (const tweet of result.data) {
    if (seen.has(tweet.author_id)) continue;
    seen.add(tweet.author_id);

    const userFromIncludes = userMap.get(tweet.author_id);
    if (userFromIncludes) {
      users.push(userFromIncludes);
    } else {
      // Fallback: minimal user object (username will be empty, but ID is sufficient for dedup)
      users.push({ id: tweet.author_id, name: '', username: '' });
    }
  }

  return { data: users };
}

async function getQuoteUsers(
  xClient: XClient,
  gate: DbEngagementGate,
): Promise<XApiResponse<XUser[]>> {
  const result = await xClient.getQuoteTweets(gate.post_id);
  if (!result.data || result.data.length === 0) return { data: [] };
  const includes = (result as any).includes as { users?: XUser[] } | undefined;
  const userMap = new Map<string, XUser>();
  if (includes?.users) {
    for (const u of includes.users) userMap.set(u.id, u);
  }
  const seen = new Set<string>();
  const users: XUser[] = [];
  for (const tweet of result.data) {
    if (seen.has(tweet.author_id)) continue;
    seen.add(tweet.author_id);
    const userFromIncludes = userMap.get(tweet.author_id);
    users.push(userFromIncludes ?? { id: tweet.author_id, name: '', username: '' });
  }
  return { data: users };
}

function appendRef(link: string, ref: string): string {
  try {
    const url = new URL(link);
    url.searchParams.set('ref', ref);
    return url.toString();
  } catch {
    // If link isn't a valid URL, append manually
    const sep = link.includes('?') ? '&' : '?';
    return `${link}${sep}ref=${encodeURIComponent(ref)}`;
  }
}

async function triggerLineHarness(
  apiUrl: string, apiKey: string, tag: string | null, scenarioId: string | null, xUsername: string,
): Promise<void> {
  if (tag) {
    await fetch(`${apiUrl}/api/friends/tag-by-metadata`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadataKey: 'x_username', metadataValue: xUsername, tagName: tag }),
    });
  }
}
