import { XClient, XApiRateLimitError } from '@x-harness/x-sdk';
import type { XUser, XApiResponse } from '@x-harness/x-sdk';
import {
  getEngagementGates, getDeliveredUserIds, createDelivery, updateDeliveryStatus,
  upsertFollower,
} from '@x-harness/db';
import type { DbEngagementGate } from '@x-harness/db';
import { addJitter, varyTemplate, checkRateLimit, incrementRateLimit } from './stealth.js';

export async function processEngagementGates(db: D1Database, xClient: XClient, xAccountId?: string): Promise<void> {
  const allGates = await getEngagementGates(db, { activeOnly: true });
  const gates = xAccountId ? allGates.filter((g) => g.x_account_id === xAccountId) : allGates;

  for (const gate of gates) {
    try {
      await processOneGate(db, xClient, gate);
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
  // DM delivery is Phase 2 — skip silently to avoid leaking private content as a public mention
  if (gate.action_type !== 'mention_post') return;

  let engagedUsers;
  if (gate.trigger_type === 'like') {
    engagedUsers = await xClient.getLikingUsers(gate.post_id);
  } else if (gate.trigger_type === 'repost') {
    engagedUsers = await xClient.getRetweetedBy(gate.post_id);
  } else if (gate.trigger_type === 'reply') {
    engagedUsers = await getReplyUsers(xClient, gate);
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
      // Apply stealth variation before URL substitution to avoid corrupting links
      let text = varyTemplate(gate.template.replace('{username}', user.username));
      if (gate.link) {
        // Build link with one-time token for X-LINE account linking
        const personalizedLink = appendRef(gate.link, `xh:${delivery.token}`);
        text = text.replace('{link}', personalizedLink);
      }

      const tweet = await xClient.createTweet({
        text: `@${user.username} ${text}`,
        reply: { in_reply_to_tweet_id: gate.post_id },
      });
      // Hide the reply so it only appears in the recipient's notifications (secret reply)
      await xClient.hideTweet(tweet.id).catch(() => {});
      await updateDeliveryStatus(db, delivery.id, 'delivered', tweet.id);
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
