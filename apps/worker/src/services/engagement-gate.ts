import { XClient, XApiRateLimitError } from '@x-harness/x-sdk';
import type { XUser, XApiResponse } from '@x-harness/x-sdk';
import {
  getEngagementGates, getDeliveredUserIds, createDelivery, updateDeliveryStatus,
  upsertFollower, updateEngagementGate, updateGateSinceId,
} from '@x-harness/db';
import type { DbEngagementGate } from '@x-harness/db';
import { addJitter, varyTemplate, checkRateLimit, incrementRateLimit } from './stealth.js';
import { shouldPollNow, isExpired, calculateNextPollAt } from './polling-scheduler.js';
import { EngagementCache, fetchNewReplies, checkConditions } from './reply-trigger-cache.js';

/**
 * @param forceRun - When true, bypasses shouldPollNow() for manual/debug triggers.
 *                   Allows operators to force-run gates regardless of next_poll_at.
 */
export async function processEngagementGates(
  db: D1Database, xClient: XClient, xAccountId?: string, forceRun = false,
  cache?: EngagementCache,
): Promise<void> {
  const sharedCache = cache ?? new EngagementCache();
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

      // Claim the gate immediately so concurrent cron ticks or manual triggers
      // see a future next_poll_at and skip it while this run is in progress.
      // Manual gates skip claiming — they don't auto-schedule.
      if (gate.polling_strategy !== 'manual') {
        const claimNextPollAt = calculateNextPollAt(gate);
        await db
          .prepare('UPDATE engagement_gates SET next_poll_at = ?, updated_at = ? WHERE id = ?')
          .bind(claimNextPollAt, new Date().toISOString(), gate.id)
          .run();
      }

      let pollSucceeded = false;
      try {
        await processOneGate(db, xClient, gate, sharedCache);
        pollSucceeded = true;
      } catch (pollErr) {
        if (pollErr instanceof XApiRateLimitError) {
          throw pollErr; // Re-throw to stop all gate processing
        }
        console.error(`Error processing gate ${gate.id}:`, pollErr);
      } finally {
        // Manual gates should keep next_poll_at null after force-run
        const nextPollAt = gate.polling_strategy === 'manual' ? null : calculateNextPollAt(gate);
        const now = new Date().toISOString();
        if (pollSucceeded) {
          await db
            .prepare('UPDATE engagement_gates SET next_poll_at = ?, api_calls_total = api_calls_total + 1, updated_at = ? WHERE id = ?')
            .bind(nextPollAt, now, gate.id)
            .run();
        } else {
          await db
            .prepare('UPDATE engagement_gates SET next_poll_at = ?, updated_at = ? WHERE id = ?')
            .bind(nextPollAt, now, gate.id)
            .run();
        }
      }
    } catch (err) {
      if (err instanceof XApiRateLimitError) {
        console.error('Rate limited — stopping engagement gate processing');
        return;
      }
      console.error(`Unexpected error for gate ${gate.id}:`, err);
    }
  }
}

async function processOneGate(
  db: D1Database,
  xClient: XClient,
  gate: DbEngagementGate,
  cache: EngagementCache,
): Promise<void> {
  // Reply-trigger mode: reply is the trigger, like/repost/follow are verification conditions
  if (gate.trigger_type === 'reply' && (gate.require_like || gate.require_repost || gate.require_follow)) {
    await processReplyTriggerGate(db, xClient, gate, cache);
    return;
  }

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

async function processReplyTriggerGate(
  db: D1Database, xClient: XClient, gate: DbEngagementGate, cache: EngagementCache,
): Promise<void> {
  const { users: replyUsers, newestId } = await fetchNewReplies(xClient, gate);
  if (replyUsers.length === 0) return;

  const deliveredIds = await getDeliveredUserIds(db, gate.id);

  const xAccount = await db
    .prepare('SELECT x_user_id FROM x_accounts WHERE id = ?')
    .bind(gate.x_account_id)
    .first<{ x_user_id: string }>();
  const xAccountUserId = xAccount?.x_user_id ?? '';

  for (const user of replyUsers) {
    if (deliveredIds.has(user.id)) continue;

    const conditions = await checkConditions(xClient, cache, gate, user.id, xAccountUserId);
    const allMet = conditions.like && conditions.repost && conditions.follow;
    if (!allMet) continue;

    if (!checkRateLimit(gate.x_account_id)) {
      console.log(`Rate limit reached for account ${gate.x_account_id}, pausing`);
      return;
    }

    await addJitter(30_000, 180_000);

    const delivery = await createDelivery(db, gate.id, user.id, user.username, null, 'pending');

    try {
      const winTemplate = (gate.lottery_enabled && gate.lottery_win_template) ? gate.lottery_win_template : gate.template;
      let text = varyTemplate(winTemplate.replace('{username}', user.username));
      if (gate.link) {
        const personalizedLink = appendRef(gate.link, `xh:${delivery.token}`);
        text = text.replace('{link}', personalizedLink);
      }

      if (gate.action_type === 'dm') {
        await xClient.sendDm(user.id, text);
      } else {
        await xClient.createTweet({ text: `@${user.username} ${text}` });
      }
      await updateDeliveryStatus(db, delivery.id, 'delivered');
      incrementRateLimit(gate.x_account_id);

      await upsertFollower(db, {
        xAccountId: gate.x_account_id,
        xUserId: user.id,
        username: user.username,
        displayName: user.name,
        profileImageUrl: user.profileImageUrl,
        followerCount: user.publicMetrics?.followers_count,
        followingCount: user.publicMetrics?.following_count,
      });

      if (gate.line_harness_url && gate.line_harness_api_key) {
        triggerLineHarness(gate.line_harness_url, gate.line_harness_api_key, gate.line_harness_tag, gate.line_harness_scenario_id, user.username).catch(() => {});
      }
    } catch (err) {
      if (err instanceof XApiRateLimitError) {
        await updateDeliveryStatus(db, delivery.id, 'failed').catch(() => {});
        throw err;
      }
      console.error(`Failed to deliver to @${user.username}:`, err);
      await updateDeliveryStatus(db, delivery.id, 'failed');
    }
  }

  // Advance since_id AFTER all deliveries — if advanced earlier and
  // the loop bailed on rate limit or error, those replies would be permanently skipped.
  if (newestId) {
    await updateGateSinceId(db, gate.id, newestId);
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
