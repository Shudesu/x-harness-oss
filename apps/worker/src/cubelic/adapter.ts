import {
  Phase1XPublishingAdapter,
  Phase3XPublishingAdapter,
  PublicationPolicyError,
  type ContentCategory,
} from '@x-harness/content-os';
import {
  completeCubelicPublicationJob,
  appendCubelicAudit,
  claimCubelicPublicationJob,
  checkCubelicPublicationRate,
  createCubelicInertDraft,
  createCubelicPublicationJob,
  failCubelicPublicationJob,
  expireCubelicOperationWindowAndStop,
  getCubelicDraft,
  getCubelicEmergencyStop,
  getCubelicOperationWindow,
  getCubelicPublicationJobByIdempotencyKey,
  getXAccountById,
  incrementApiUsage,
  listDueCubelicPublicationJobs,
} from '@x-harness/db';
import { XClient } from '@x-harness/x-sdk';
import type { Env } from '../index.js';
import { isPhase3PublicationEnabled, isStagingFakeDelivery } from './safety.js';

export type CubelicXAdapterFactory = (
  db: D1Database,
  xHarnessAccountId: string,
) => Phase1XPublishingAdapter;

export const buildCubelicXAdapter: CubelicXAdapterFactory = (db, xHarnessAccountId) => {
  return new Phase1XPublishingAdapter((input) => createCubelicInertDraft(db, xHarnessAccountId, input));
};

export async function isCubelicPublicationStopped(db: D1Database, at = Date.now()): Promise<boolean> {
  const operationWindow = await getCubelicOperationWindow(db, at);
  if (operationWindow) {
    if (!operationWindow.active) await expireCubelicOperationWindowAndStop(db, at);
    return true;
  }
  return getCubelicEmergencyStop(db);
}

export type CubelicPhase3AdapterFactory = (
  env: Env['Bindings'],
  operatorId: string,
) => Phase3XPublishingAdapter;

function buildXClient(account: {
  consumer_key: string | null;
  consumer_secret: string | null;
  access_token: string;
  access_token_secret: string | null;
}): XClient {
  return account.consumer_key && account.consumer_secret && account.access_token_secret
    ? new XClient({
        type: 'oauth1',
        consumerKey: account.consumer_key,
        consumerSecret: account.consumer_secret,
        accessToken: account.access_token,
        accessTokenSecret: account.access_token_secret,
      })
    : new XClient(account.access_token);
}

function schedulePolicies(value: string | undefined): Array<{ category: ContentCategory; templateId: string }> {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
    const [category, templateId, ...rest] = item.split(':');
    if (!category || !templateId || rest.length > 0) {
      throw new PublicationPolicyError('schedule_policy_invalid', 'Scheduling policy must be category:template_id');
    }
    return { category: category as ContentCategory, templateId };
  });
}

function isOperationWindowPublicationLockError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('operation window blocks publication');
}

export const buildCubelicPhase3XAdapter: CubelicPhase3AdapterFactory = (env, operatorId) => {
  const now = () => new Date();
  const accountId = env.X_HARNESS_ACCOUNT_ID;
  if (!accountId || accountId === 'SET_AFTER_ACCOUNT_SETUP') {
    throw new PublicationPolicyError('x_harness_account_not_configured', 'X Harness account mapping is not configured');
  }

  return new Phase3XPublishingAdapter({
    enabled: isPhase3PublicationEnabled(env),
    allowedSchedulePolicies: schedulePolicies(env.CUBELIC_PHASE3_SCHEDULE_POLICIES),
    isEmergencyStopped: () => isCubelicPublicationStopped(env.DB),
    checkRateLimit: (input, operation) => checkCubelicPublicationRate(env.DB, {
      effectiveAt: operation === 'schedule' && 'scheduledAt' in input
        ? input.scheduledAt
        : now().toISOString(),
    }),
    scheduleWriter: async (input) => {
      let job: Awaited<ReturnType<typeof createCubelicPublicationJob>>;
      try {
        job = await createCubelicPublicationJob(env.DB, {
          draftId: input.draftId,
          operation: 'schedule',
          authorizationKind: input.authorization.kind,
          policyId: input.authorization.policyId,
          authorizedBy: input.approvedBy,
          authorizedAt: input.authorization.approvedAt,
          scheduledAt: input.scheduledAt,
          idempotencyKey: `${input.idempotencyKey}:schedule:${input.scheduledAt}`,
        }, {
          actor: 'human',
          action: 'publication.scheduled',
          entityType: 'publication_job',
          entityId: input.draftId,
          before: {},
          after: {
            draftId: input.draftId,
            category: input.category,
            templateId: input.templateId,
            scheduledAt: input.scheduledAt,
            policyId: input.authorization.policyId,
          },
          correlationId: `publication:${input.idempotencyKey}`,
        });
      } catch (error) {
        if (isOperationWindowPublicationLockError(error)) {
          throw new PublicationPolicyError('emergency_stop_active', 'Content ingestion operation window blocks X scheduling');
        }
        throw error;
      }
      return { jobId: job.jobId, status: 'scheduled', scheduledAt: input.scheduledAt };
    },
    publishWriter: async (input) => {
      if (input.mediaAssetIds.length > 0) {
        throw new PublicationPolicyError(
          'media_delivery_not_configured',
          'CUBΣLIC media assets must be uploaded to X through the reviewed media delivery boundary',
        );
      }
      const idempotencyKey = `${input.idempotencyKey}:publish`;
      const existing = await getCubelicPublicationJobByIdempotencyKey(env.DB, idempotencyKey);
      if (existing?.status === 'published' && existing.postId && existing.publishedAt) {
        return { postId: existing.postId, status: 'published', publishedAt: existing.publishedAt };
      }
      if (existing) {
        throw new PublicationPolicyError(
          'publication_outcome_unknown',
          'A previous publication attempt exists and requires human reconciliation',
        );
      }
      if (!isStagingFakeDelivery(env) && !(await getXAccountById(env.DB, accountId))) {
        throw new PublicationPolicyError('x_account_not_found', 'Configured X account was not found');
      }
      let job: Awaited<ReturnType<typeof createCubelicPublicationJob>>;
      try {
        job = await createCubelicPublicationJob(env.DB, {
          draftId: input.draftId,
          operation: 'publish',
          authorizationKind: 'human_individual',
          authorizedBy: operatorId,
          authorizedAt: input.authorization.kind === 'human_individual'
            ? input.authorization.authorizedAt
            : input.approvedAt,
          idempotencyKey,
        }, {
          actor: 'human',
          action: 'publication.started',
          entityType: 'publication_job',
          entityId: input.draftId,
          before: {},
          after: { draftId: input.draftId, category: input.category },
          correlationId: `publication:${input.idempotencyKey}`,
        });
      } catch (error) {
        if (isOperationWindowPublicationLockError(error)) {
          throw new PublicationPolicyError('emergency_stop_active', 'Content ingestion operation window blocks X publication');
        }
        throw error;
      }
      try {
        const tweet = await deliverTextForRuntime(env, accountId, input.text);
        const publishedAt = now().toISOString();
        await completeCubelicPublicationJob(env.DB, {
          jobId: job.jobId,
          postId: tweet.postId,
          publishedAt,
        }, {
          actor: 'human',
          action: 'publication.completed',
          entityType: 'publication_job',
          entityId: job.jobId,
          before: { status: 'publishing' },
          after: { status: 'published', postId: tweet.postId, publishedAt },
          correlationId: `publication:${input.idempotencyKey}`,
        });
        return { postId: tweet.postId, status: 'published', publishedAt };
      } catch {
        await appendCubelicAudit(env.DB, {
          actor: 'human',
          action: 'publication.outcome_unknown',
          entityType: 'publication_job',
          entityId: job.jobId,
          before: { status: 'publishing' },
          after: { status: 'publishing', reconciliationRequired: true },
          correlationId: `publication:${input.idempotencyKey}`,
        });
        throw new PublicationPolicyError(
          'publication_outcome_unknown',
          'X publication outcome is unknown and requires human reconciliation',
        );
      }
    },
  });
};

export async function processDueCubelicPublications(
  env: Env['Bindings'],
  at = new Date(),
  deliverText: (
    env: Env['Bindings'],
    accountId: string,
    text: string,
  ) => Promise<{ postId: string }> = deliverTextForRuntime,
): Promise<void> {
  if (
    !isPhase3PublicationEnabled(env)
    || env.GLOBAL_PUBLISHING_DISABLED !== 'false'
    || await isCubelicPublicationStopped(env.DB, at.getTime())
  ) return;
  const accountId = env.X_HARNESS_ACCOUNT_ID;
  if (!accountId || accountId === 'SET_AFTER_ACCOUNT_SETUP') return;
  let allowedPolicies: Set<string>;
  try {
    const parsedPolicies = schedulePolicies(env.CUBELIC_PHASE3_SCHEDULE_POLICIES);
    if (parsedPolicies.length === 0) return;
    allowedPolicies = new Set(parsedPolicies.map(({ category, templateId }) => `${category}:${templateId}`));
  } catch {
    return;
  }
  const due = await listDueCubelicPublicationJobs(env.DB, at.toISOString());
  for (const job of due) {
    const correlationId = `publication:${job.idempotencyKey}`;
    const currentDraft = await getCubelicDraft(env.DB, job.draftId);
    if (
      !currentDraft
      || !job.policyId
      || job.policyId !== currentDraft.template_id
      || !allowedPolicies.has(`${currentDraft.category}:${currentDraft.template_id}`)
    ) continue;
    let claimed;
    try {
      claimed = await claimCubelicPublicationJob(env.DB, job.jobId, {
        actor: 'system',
        action: 'publication.claimed',
        entityType: 'publication_job',
        entityId: job.jobId,
        before: { status: 'scheduled' },
        after: { status: 'publishing' },
        correlationId,
      }, at.toISOString());
    } catch (error) {
      if (isOperationWindowPublicationLockError(error)) return;
      throw error;
    }
    if (!claimed) continue;
    let draft;
    try {
      if (await isCubelicPublicationStopped(env.DB)) {
        throw new PublicationPolicyError('emergency_stop_active', 'Emergency stop became active');
      }
      draft = await getCubelicDraft(env.DB, job.draftId);
      if (!draft || !['approved', 'handed_off'].includes(draft.approval_status)) {
        throw new PublicationPolicyError('human_approval_required', 'Approved draft is no longer available');
      }
      if (draft.media_asset_ids.length > 0) {
        throw new PublicationPolicyError(
          'media_delivery_not_configured',
          'Scheduled media delivery requires the reviewed upload boundary',
        );
      }
    } catch (error) {
      if (!(await isCubelicPublicationStopped(env.DB))) {
        await failCubelicPublicationJob(env.DB, {
          jobId: job.jobId,
          failureCode: error instanceof PublicationPolicyError ? error.code : 'publication_validation_failed',
        }, {
          actor: 'system',
          action: 'publication.failed',
          entityType: 'publication_job',
          entityId: job.jobId,
          before: { status: 'publishing' },
          after: {
            status: 'failed',
            failureCode: error instanceof PublicationPolicyError ? error.code : 'publication_validation_failed',
          },
          correlationId,
        });
      }
      continue;
    }

    try {
      const delivered = await deliverText(env, accountId, draft.text);
      const publishedAt = new Date().toISOString();
      await completeCubelicPublicationJob(env.DB, {
        jobId: job.jobId,
        postId: delivered.postId,
        publishedAt,
      }, {
        actor: 'system',
        action: 'publication.completed',
        entityType: 'publication_job',
        entityId: job.jobId,
        before: { status: 'publishing' },
        after: { status: 'published', postId: delivered.postId, publishedAt },
        correlationId,
      });
    } catch (error) {
      await appendCubelicAudit(env.DB, {
        actor: 'system',
        action: 'publication.outcome_unknown',
        entityType: 'publication_job',
        entityId: job.jobId,
        before: { status: 'publishing' },
        after: { status: 'publishing', reconciliationRequired: true },
        correlationId,
      });
      console.error('cubelic_scheduled_publication_outcome_unknown', {
        job_id: job.jobId,
        error_code: 'publication_outcome_unknown',
        error_type: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
}

async function deliverTextForRuntime(
  env: Env['Bindings'],
  accountId: string,
  text: string,
): Promise<{ postId: string }> {
  if (isStagingFakeDelivery(env)) {
    return { postId: `staging_fake_${crypto.randomUUID()}` };
  }
  return deliverTextToX(env, accountId, text);
}

async function deliverTextToX(
  env: Env['Bindings'],
  accountId: string,
  text: string,
): Promise<{ postId: string }> {
  const account = await getXAccountById(env.DB, accountId);
  if (!account) throw new PublicationPolicyError('x_account_not_found', 'Configured X account was not found');
  const tweet = await buildXClient(account).createTweet({ text });
  await incrementApiUsage(env.DB, account.id, 'create_tweet');
  return { postId: tweet.id };
}
