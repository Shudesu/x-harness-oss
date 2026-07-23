import { describe, expect, it } from 'vitest';
import { evaluateProductionSafety } from './lib/verify-production-safety.mjs';

const stoppedStatus = {
  safeMode: true,
  phase3Enabled: true,
  environmentStop: false,
  emergencyStop: true,
  emergencyStopValid: true,
  operationWindow: null,
  publishingEnabled: false,
  schedulingEnabled: false,
};

describe('production safety verifier', () => {
  it('accepts the reviewed Phase 3 runtime only while the exact D1 stop is active', () => {
    expect(evaluateProductionSafety(stoppedStatus)).toEqual([]);
  });

  it('reports an invalid stop row and every exposed publication capability', () => {
    expect(evaluateProductionSafety({
      ...stoppedStatus,
      safeMode: false,
      emergencyStopValid: false,
      publishingEnabled: true,
      schedulingEnabled: true,
    })).toEqual([
      'CUBΣLIC safe mode is not active',
      'D1 emergency-stop state is missing or invalid',
      'immediate publishing is enabled',
      'scheduling is enabled',
    ]);
  });

  it('reports an active operation window during the expected stopped state', () => {
    expect(evaluateProductionSafety({
      ...stoppedStatus,
      operationWindow: {
        eventId: 'evt_unexpected',
        expiresAt: '2026-07-23T10:00:00.000Z',
        active: true,
      },
    })).toEqual(['an operation window is active']);
  });
});
