import { XClient } from '@x-harness/x-sdk';
import { upsertFollower } from '@x-harness/db';

export async function syncFollowers(db: D1Database, xClient: XClient, xAccountId: string, opts: {full?:boolean} = {}): Promise<void> {
  const me = await xClient.getMe();
  if(!opts.full) {
    // Candidate-driven refresh has no list-order assumption. Full discovery is explicit.
    const rows=(await db.prepare(`SELECT DISTINCT e.user_id FROM engager_cache e JOIN engagement_gates g ON g.id=e.gate_id WHERE g.x_account_id=? AND e.first_seen_at>? LIMIT 1000`).bind(xAccountId,Date.now()-86400000).all<{user_id:string}>()).results;
    const candidates=await xClient.getUsersByIds(rows.map(r=>r.user_id));
    for(const user of candidates)await upsertFollower(db,{xAccountId,xUserId:user.id,username:user.username,displayName:user.name,profileImageUrl:user.profile_image_url,followerCount:user.public_metrics?.followers_count,followingCount:user.public_metrics?.following_count});
    return;
  }
  let paginationToken: string | undefined;

  do {
    const response = await xClient.getFollowers(me.id, paginationToken);
    if (!response.data) break;

    for (const user of response.data) {
      await upsertFollower(db, {
        xAccountId,
        xUserId: user.id,
        username: user.username,
        displayName: user.name,
        profileImageUrl: user.profile_image_url,
        followerCount: user.public_metrics?.followers_count,
        followingCount: user.public_metrics?.following_count,
      });
    }

    paginationToken = response.meta?.next_token;
  } while (paginationToken);
}
