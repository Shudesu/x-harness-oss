import type { RejectReason } from './types.js';

export class ContentPolicyError extends Error {
  readonly code: string;
  readonly rejectReasons: RejectReason[];

  constructor(code: string, message: string, rejectReasons: RejectReason[] = []) {
    super(message);
    this.name = 'ContentPolicyError';
    this.code = code;
    this.rejectReasons = rejectReasons;
  }
}

export class Phase1OperationDisabledError extends Error {
  readonly code = 'phase1_operation_disabled';

  constructor(operation: string) {
    super(`${operation} is disabled in Phase 1`);
    this.name = 'Phase1OperationDisabledError';
  }
}
