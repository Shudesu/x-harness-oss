import { XClient, XApiRateLimitError } from '@x-harness/x-sdk';
import { claimScheduledPost, getDueScheduledPosts, updateScheduledPostStatus } from '@x-harness/db';
import { checkTextLength } from './post-length.js';

export async function processScheduledPosts(db: D1Database, xClient: XClient, xAccountId?: string): Promise<void> {
  const allDuePosts = await getDueScheduledPosts(db);
  const duePosts = xAccountId ? allDuePosts.filter((p) => p.x_account_id === xAccountId) : allDuePosts;

  for (const post of duePosts) {
    if (!await claimScheduledPost(db, post.id)) continue;
    let sent = false;
    try {
      // Rows created before the schedule-time check (or before a plan change)
      // may still be over the limit: fail them with a reason instead of
      // letting X reject or the reader see a cut-off post.
      const length = await checkTextLength(db, xClient, post.x_account_id, post.text);
      if (!length.ok) {
        console.error(`Scheduled post ${post.id} not sent: ${length.error}`);
        // Known-unsent: release the claim so the requeue endpoint doesn't
        // treat it as an ambiguous send needing confirmNotPosted.
        await db.prepare('DELETE FROM scheduled_post_claims WHERE post_id = ?').bind(post.id).run();
        await updateScheduledPostStatus(db, post.id, 'failed');
        continue;
      }
      const tweet = await xClient.createTweet({
        text: post.text,
        media: post.media_ids ? { media_ids: JSON.parse(post.media_ids) } : undefined,
        quote_tweet_id: post.quote_tweet_id ?? undefined,
      });
      sent = true;
      await updateScheduledPostStatus(db, post.id, 'posted', tweet.id);
    } catch (err) {
      if (err instanceof XApiRateLimitError || (err instanceof Error && err.name === 'BudgetExceededError')) {
        await db.prepare('DELETE FROM scheduled_post_claims WHERE post_id = ?').bind(post.id).run();
        // Transient rate limit — leave post as 'scheduled' so the next cron run retries
        console.error(`Rate limited while posting scheduled ${post.id}, will retry next run`);
        return;
      }
      console.error(`Failed to post scheduled ${post.id}:`, err);
      // Ambiguous network errors and successful sends with failed DB updates retain
      // the claim: an operator must reconcile before any retry (X has no idempotency key).
      if (!sent) await updateScheduledPostStatus(db, post.id, 'failed');
    }
  }
}
