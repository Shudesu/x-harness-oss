import { Phase1OperationDisabledError } from './errors.js';
import type { PostMetrics, XDraftInput, XDraftResult, XPublishingAdapter } from './types.js';

export type DraftWriter = (input: XDraftInput) => Promise<XDraftResult>;
export type MetricsReader = (postId: string) => Promise<PostMetrics>;

export class Phase1XPublishingAdapter implements XPublishingAdapter {
  constructor(
    private readonly writeDraft: DraftWriter,
    private readonly readMetrics: MetricsReader = async () => emptyMetrics(),
  ) {}

  createDraft(input: XDraftInput): Promise<XDraftResult> {
    return this.writeDraft(input);
  }

  async schedulePost(): Promise<never> {
    throw new Phase1OperationDisabledError('schedulePost');
  }

  async publishPost(): Promise<never> {
    throw new Phase1OperationDisabledError('publishPost');
  }

  async deletePost(): Promise<never> {
    throw new Phase1OperationDisabledError('deletePost');
  }

  getMetrics(postId: string): Promise<PostMetrics> {
    return this.readMetrics(postId);
  }
}

export function emptyMetrics(): PostMetrics {
  return {
    impressions: null,
    video_views: null,
    video_completion_rate: null,
    likes: null,
    reposts: null,
    quotes: null,
    replies: null,
    profile_visits: null,
    follows_attributed: null,
    link_clicks: null,
    qualified_visits: null,
    youtube_clicks: null,
    spotify_clicks: null,
    ticket_clicks: null,
  };
}
