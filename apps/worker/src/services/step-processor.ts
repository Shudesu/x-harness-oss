import { XClient, XApiRateLimitError } from '@x-harness/x-sdk';
import { getDueEnrollments, getStepMessages, advanceEnrollment, getStepSequenceById } from '@x-harness/db';
import type { DbStepEnrollment } from '@x-harness/db';
import { varyTemplate } from './stealth.js';

export async function processStepSequences(db: D1Database, buildXClient: (accountId: string) => Promise<XClient | null>): Promise<void> {
  const dueEnrollments = await getDueEnrollments(db);
  for (const enrollment of dueEnrollments) {
    try {
      await processOneEnrollment(db, enrollment, buildXClient);
    } catch (err) {
      if (err instanceof XApiRateLimitError) {
        console.error('Rate limited — stopping step sequence processing');
        return;
      }
      console.error(`Error processing enrollment ${enrollment.id}:`, err);
    }
  }
}

async function processOneEnrollment(
  db: D1Database,
  enrollment: DbStepEnrollment,
  buildXClient: (accountId: string) => Promise<XClient | null>,
): Promise<void> {
  const sequence = await getStepSequenceById(db, enrollment.sequence_id);
  if (!sequence || !sequence.is_active) {
    await advanceEnrollment(db, enrollment.id, enrollment.current_step, null, 'cancelled');
    return;
  }

  const messages = await getStepMessages(db, enrollment.sequence_id);
  const nextStep = messages.find((m) => m.step_order === enrollment.current_step + 1);

  if (!nextStep) {
    await advanceEnrollment(db, enrollment.id, enrollment.current_step, null, 'completed');
    return;
  }

  // Skip steps with condition tags for now
  if (nextStep.condition_tag) {
    const followingStep = messages.find((m) => m.step_order === nextStep.step_order + 1);
    if (followingStep) {
      const nextRunAt = new Date(Date.now() + followingStep.delay_minutes * 60 * 1000).toISOString();
      await advanceEnrollment(db, enrollment.id, nextStep.step_order, nextRunAt, 'active');
    } else {
      await advanceEnrollment(db, enrollment.id, nextStep.step_order, null, 'completed');
    }
    return;
  }

  const xClient = await buildXClient(sequence.x_account_id);
  if (!xClient) {
    console.error(`No XClient for account ${sequence.x_account_id}, skipping enrollment ${enrollment.id}`);
    return;
  }

  // Guard against null username — skip mention delivery to avoid posting "@null"
  if (nextStep.action_type !== 'dm' && !enrollment.x_username) {
    console.error(`Enrollment ${enrollment.id} has no username, cannot send mention`);
    return;
  }

  let text = varyTemplate(nextStep.template.replaceAll('{username}', enrollment.x_username ?? ''));
  if (nextStep.link) text = text.replaceAll('{link}', nextStep.link);

  if (nextStep.action_type === 'dm') {
    await xClient.sendDm(enrollment.x_user_id, text);
  } else {
    await xClient.createTweet({ text: `@${enrollment.x_username} ${text}` });
  }

  const followingStep = messages.find((m) => m.step_order === nextStep.step_order + 1);
  if (followingStep) {
    const nextRunAt = new Date(Date.now() + followingStep.delay_minutes * 60 * 1000).toISOString();
    await advanceEnrollment(db, enrollment.id, nextStep.step_order, nextRunAt, 'active');
  } else {
    await advanceEnrollment(db, enrollment.id, nextStep.step_order, null, 'completed');
  }
}
