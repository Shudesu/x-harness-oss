import { PublicationPolicyError } from './errors.js';

export interface ManualProductionAuthorityInput {
  contentId: string;
  attestedBy: string;
  attestedAt: string;
  rightsConfirmed: boolean;
  privacyReviewCompleted: boolean;
  destinationUrl: string;
  linkValidated: boolean;
}

export interface ManualProductionAuthorityV1 {
  schema_version: 'cubelic.manual-production-authority.v1';
  content_id: string;
  source_type: 'manual';
  attested_by: string;
  attested_at: string;
  rights_confirmed: true;
  privacy_review_completed: true;
  destination_url: string;
  link_validated: true;
}

export function authorizeManualProductionInput(
  input: ManualProductionAuthorityInput,
): ManualProductionAuthorityV1 {
  if (!input.contentId || !input.attestedBy || !isIsoTimestamp(input.attestedAt)) {
    throw new PublicationPolicyError(
      'manual_attestation_invalid',
      'Manual production input requires a named operator and ISO 8601 attestation time',
    );
  }
  if (input.rightsConfirmed !== true) {
    throw new PublicationPolicyError('rights_confirmation_required', 'Rights confirmation is required');
  }
  if (input.privacyReviewCompleted !== true) {
    throw new PublicationPolicyError('privacy_review_required', 'Privacy review is required');
  }
  if (input.linkValidated !== true) {
    throw new PublicationPolicyError('link_validation_required', 'Link validation is required');
  }
  if (!isHttpsUrl(input.destinationUrl)) {
    throw new PublicationPolicyError('destination_url_invalid', 'Destination must be a valid HTTPS URL');
  }
  return {
    schema_version: 'cubelic.manual-production-authority.v1',
    content_id: input.contentId,
    source_type: 'manual',
    attested_by: input.attestedBy,
    attested_at: input.attestedAt,
    rights_confirmed: true,
    privacy_review_completed: true,
    destination_url: input.destinationUrl,
    link_validated: true,
  };
}

function isIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
