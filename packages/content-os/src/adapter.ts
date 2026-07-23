import { Phase1OperationDisabledError, PublicationPolicyError } from './errors.js';
import type {
  ContentCategory,
  PostMetrics,
  PublishInput,
  PublishResult,
  ScheduleInput,
  ScheduleResult,
  XDraftInput,
  XDraftResult,
  XPublishingAdapter,
} from './types.js';

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

  async schedulePost(_input?: ScheduleInput): Promise<never> {
    throw new Phase1OperationDisabledError('schedulePost');
  }

  async publishPost(_input?: PublishInput): Promise<never> {
    throw new Phase1OperationDisabledError('publishPost');
  }

  async deletePost(): Promise<never> {
    throw new Phase1OperationDisabledError('deletePost');
  }

  getMetrics(postId: string): Promise<PostMetrics> {
    return this.readMetrics(postId);
  }
}

export interface PublicationRateDecision {
  allowed: boolean;
  reason?: string;
}

export interface Phase3XPublishingAdapterOptions {
  enabled: boolean;
  allowedSchedulePolicies?: Array<{ category: ContentCategory; templateId: string }>;
  isEmergencyStopped: () => Promise<boolean>;
  checkRateLimit: (
    input: ScheduleInput | PublishInput,
    operation: 'schedule' | 'publish',
  ) => Promise<PublicationRateDecision>;
  scheduleWriter: (input: ScheduleInput) => Promise<ScheduleResult>;
  publishWriter: (input: PublishInput) => Promise<PublishResult>;
  readMetrics?: MetricsReader;
  now?: () => Date;
}

export class Phase3XPublishingAdapter implements XPublishingAdapter {
  private readonly allowedScheduleCategories: Set<ContentCategory>;
  private readonly allowedScheduleTemplateIds: Set<string>;
  private readonly allowedSchedulePolicies: Set<string>;
  private readonly now: () => Date;

  constructor(private readonly options: Phase3XPublishingAdapterOptions) {
    this.allowedScheduleCategories = new Set((options.allowedSchedulePolicies ?? []).map((policy) => policy.category));
    this.allowedScheduleTemplateIds = new Set((options.allowedSchedulePolicies ?? []).map((policy) => policy.templateId));
    this.allowedSchedulePolicies = new Set(
      (options.allowedSchedulePolicies ?? []).map((policy) => `${policy.category}:${policy.templateId}`),
    );
    this.now = options.now ?? (() => new Date());
  }

  async createDraft(_input: XDraftInput): Promise<XDraftResult> {
    throw new PublicationPolicyError(
      'phase3_draft_writer_not_configured',
      'Phase 3 publication adapter does not accept unreviewed draft creation',
    );
  }

  async schedulePost(input: ScheduleInput): Promise<ScheduleResult> {
    await this.assertOperational(input, 'schedule');
    if (input.authorization.kind !== 'preapproved_template') {
      throw new PublicationPolicyError(
        'preapproved_template_required',
        'Automatic scheduling requires a pre-approved template policy',
      );
    }
    if (!this.allowedScheduleCategories.has(input.category)) {
      throw new PublicationPolicyError('schedule_category_not_allowed', 'Category is not allowlisted for scheduling');
    }
    if (!this.allowedScheduleTemplateIds.has(input.templateId)) {
      throw new PublicationPolicyError('schedule_template_not_allowed', 'Template is not allowlisted for scheduling');
    }
    if (input.authorization.policyId !== input.templateId) {
      throw new PublicationPolicyError(
        'schedule_policy_mismatch',
        'The pre-approved policy id must equal the reviewed template id',
      );
    }
    if (!this.allowedSchedulePolicies.has(`${input.category}:${input.templateId}`)) {
      throw new PublicationPolicyError(
        'schedule_policy_not_allowed',
        'The category and template pair is not an approved scheduling policy',
      );
    }
    if (input.mediaAssetIds.length > 0) {
      throw new PublicationPolicyError(
        'media_delivery_not_configured',
        'Scheduled media delivery requires the reviewed upload boundary',
      );
    }
    const scheduledAt = new Date(input.scheduledAt);
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= this.now().getTime()) {
      throw new PublicationPolicyError('scheduled_time_invalid', 'Scheduled time must be a valid future timestamp');
    }
    return this.options.scheduleWriter(input);
  }

  async publishPost(input: PublishInput): Promise<PublishResult> {
    await this.assertOperational(input, 'publish');
    if (input.authorization.kind !== 'human_individual') {
      throw new PublicationPolicyError(
        'human_publication_required',
        'Immediate publication requires individual human authorization',
      );
    }
    if (input.authorization.operatorId !== input.approvedBy) {
      throw new PublicationPolicyError(
        'publication_operator_mismatch',
        'The publishing operator must match the individual draft approver',
      );
    }
    return this.options.publishWriter(input);
  }

  async deletePost(): Promise<never> {
    throw new PublicationPolicyError('human_delete_only', 'Post deletion remains a separate human-only operation');
  }

  getMetrics(postId: string): Promise<PostMetrics> {
    return (this.options.readMetrics ?? (async () => emptyMetrics()))(postId);
  }

  private async assertOperational(
    input: ScheduleInput | PublishInput,
    operation: 'schedule' | 'publish',
  ): Promise<void> {
    if (!this.options.enabled) {
      throw new PublicationPolicyError('phase3_operation_disabled', 'Phase 3 publication capability is disabled');
    }
    if (await this.options.isEmergencyStopped()) {
      throw new PublicationPolicyError('emergency_stop_active', 'Emergency stop is active');
    }
    if (input.approvalStatus !== 'approved' || !input.approvedBy || !input.approvedAt) {
      throw new PublicationPolicyError('human_approval_required', 'An approved draft is required');
    }
    if (input.rightsGate !== 'passed' && input.rightsGate !== 'not_applicable') {
      throw new PublicationPolicyError('rights_gate_failed', 'Rights gate has not passed');
    }
    if (input.privacyReviewCompleted !== true) {
      throw new PublicationPolicyError('privacy_review_required', 'Privacy review is required');
    }
    if (input.linkValidated !== true) {
      throw new PublicationPolicyError('link_validation_required', 'Link validation is required');
    }
    const rate = await this.options.checkRateLimit(input, operation);
    if (!rate.allowed) {
      throw new PublicationPolicyError(
        'publication_rate_limited',
        `Publication rate policy rejected the operation${rate.reason ? `: ${rate.reason}` : ''}`,
      );
    }
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
