import {CampaignsResource} from './resources/campaigns.js';
import { HttpClient } from './http.js';
import { EngagementGatesResource } from './resources/engagement-gates.js';
import { FollowersResource } from './resources/followers.js';
import { TagsResource } from './resources/tags.js';
import { PostsResource } from './resources/posts.js';
import { UsersResource } from './resources/users.js';
import type { XHarnessConfig } from './types.js';

export class XHarness {
  readonly engagementGates: EngagementGatesResource;
  readonly followers: FollowersResource;
  readonly tags: TagsResource;
  readonly posts: PostsResource;
  readonly campaigns: CampaignsResource;
  readonly users: UsersResource;

  constructor(config: XHarnessConfig) {
    const http = new HttpClient({
      baseUrl: config.apiUrl.replace(/\/$/, ''),
      apiKey: config.apiKey,
      timeout: config.timeout ?? 30_000,
    });

    this.engagementGates = new EngagementGatesResource(http);
    this.followers = new FollowersResource(http);
    this.tags = new TagsResource(http);
    this.posts = new PostsResource(http);
    this.campaigns = new CampaignsResource(http);
    this.users = new UsersResource(http);
  }
}
