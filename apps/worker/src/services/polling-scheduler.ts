import type { DbEngagementGate } from '@x-harness/db';

/**
 * Hot window phases:
 *   0-6h after creation  → poll every 5 min
 *   6-24h                → poll every 15 min
 *   24-72h               → poll every 30 min
 *   >72h                 → expired (auto-deactivate)
 *
 * Constant: always 15 min, until expires_at.
 * Manual: never scheduled (next_poll_at stays null).
 */

const HOT_WINDOW_PHASES = [
  { maxAgeMs: 6 * 60 * 60_000, intervalMs: 5 * 60_000, label: '0-6h' },
  { maxAgeMs: 24 * 60 * 60_000, intervalMs: 15 * 60_000, label: '6-24h' },
  { maxAgeMs: 72 * 60 * 60_000, intervalMs: 30 * 60_000, label: '24-72h' },
];

const CONSTANT_INTERVAL_MS = 15 * 60_000;

export function shouldPollNow(gate: DbEngagementGate): boolean {
  if (!gate.is_active) return false;
  if (gate.polling_strategy === 'manual') return false;
  if (!gate.next_poll_at) return true; // First run — no next_poll_at yet
  return new Date(gate.next_poll_at).getTime() <= Date.now();
}

export function isExpired(gate: DbEngagementGate): boolean {
  // Only expire if expires_at is explicitly set. Gates without expires_at
  // (e.g. pre-migration gates or constant with no expiry) never auto-expire.
  if (gate.expires_at) {
    return new Date(gate.expires_at).getTime() <= Date.now();
  }
  return false;
}

/**
 * Derive hot_window age from expires_at (not created_at) so that
 * strategy switches get a fresh 72h window.
 */
function getHotWindowAgeMs(gate: DbEngagementGate): number {
  if (gate.expires_at) {
    // Derive window start from expires_at so strategy switches get a fresh window
    const totalWindowMs = HOT_WINDOW_PHASES[HOT_WINDOW_PHASES.length - 1].maxAgeMs;
    const expiresAtMs = new Date(gate.expires_at).getTime();
    const startedAtMs = expiresAtMs - totalWindowMs;
    return Date.now() - startedAtMs;
  }
  // Legacy gates (pre-migration) have no expires_at — fall back to created_at
  return Date.now() - new Date(gate.created_at).getTime();
}

export function getPhaseLabel(gate: DbEngagementGate): string {
  if (gate.polling_strategy === 'constant') return 'active';
  if (gate.polling_strategy === 'manual') return 'manual';
  const ageMs = getHotWindowAgeMs(gate);
  for (const phase of HOT_WINDOW_PHASES) {
    if (ageMs <= phase.maxAgeMs) return phase.label;
  }
  return 'expired';
}

export function calculateNextPollAt(gate: DbEngagementGate): string {
  const now = Date.now();
  const interval=(base:number)=>Math.min(base*2**Math.max(0,(gate.consecutive_empty_polls ?? 0)-1),3600000)+Math.floor(Math.random()*30000);

  if (gate.polling_strategy === 'constant') {
    return new Date(now + interval(CONSTANT_INTERVAL_MS)).toISOString();
  }

  // hot_window: determine interval from current phase using expires_at
  const ageMs = getHotWindowAgeMs(gate);
  for (const phase of HOT_WINDOW_PHASES) {
    if (ageMs <= phase.maxAgeMs) {
      return new Date(now + interval(phase.intervalMs)).toISOString();
    }
  }

  // Past all phases — should be deactivated, but return far-future as safety
  return new Date(now + 24 * 60 * 60_000).toISOString();
}
