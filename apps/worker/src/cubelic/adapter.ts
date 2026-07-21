import { Phase1XPublishingAdapter } from '@x-harness/content-os';
import { createCubelicInertDraft } from '@x-harness/db';

export type CubelicXAdapterFactory = (
  db: D1Database,
  xHarnessAccountId: string,
) => Phase1XPublishingAdapter;

export const buildCubelicXAdapter: CubelicXAdapterFactory = (db, xHarnessAccountId) => {
  return new Phase1XPublishingAdapter((input) => createCubelicInertDraft(db, xHarnessAccountId, input));
};
