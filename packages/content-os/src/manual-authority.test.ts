import { describe, expect, it } from 'vitest';
import { authorizeManualProductionInput } from './manual-authority.js';

describe('authorizeManualProductionInput', () => {
  it('promotes a fully attested manual entry to a production authority record', () => {
    expect(authorizeManualProductionInput({
      contentId: 'content_1',
      attestedBy: 'operator_1',
      attestedAt: '2026-07-23T01:00:00.000Z',
      rightsConfirmed: true,
      privacyReviewCompleted: true,
      destinationUrl: 'https://cubelic-fan.com/events/event-1',
      linkValidated: true,
    })).toEqual({
      schema_version: 'cubelic.manual-production-authority.v1',
      content_id: 'content_1',
      source_type: 'manual',
      attested_by: 'operator_1',
      attested_at: '2026-07-23T01:00:00.000Z',
      rights_confirmed: true,
      privacy_review_completed: true,
      destination_url: 'https://cubelic-fan.com/events/event-1',
      link_validated: true,
    });
  });

  it.each([
    ['rights confirmation', { rightsConfirmed: false }, 'rights_confirmation_required'],
    ['privacy review', { privacyReviewCompleted: false }, 'privacy_review_required'],
    ['link validation', { linkValidated: false }, 'link_validation_required'],
    ['HTTPS destination', { destinationUrl: 'http://cubelic-fan.com/event' }, 'destination_url_invalid'],
  ])('rejects a manual entry without %s', (_name, override, code) => {
    expect(() => authorizeManualProductionInput({
      contentId: 'content_1',
      attestedBy: 'operator_1',
      attestedAt: '2026-07-23T01:00:00.000Z',
      rightsConfirmed: true,
      privacyReviewCompleted: true,
      destinationUrl: 'https://cubelic-fan.com/events/event-1',
      linkValidated: true,
      ...override,
    })).toThrow(expect.objectContaining({ code }));
  });
});
