import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import analyticsSchema from '../cubelic/analytics-event.schema.json';
import auditSchema from '../cubelic/audit-log.schema.json';
import contentSchema from '../cubelic/content-item.schema.json';
import draftSchema from '../cubelic/draft-post.schema.json';
import eventSchema from '../cubelic/event.schema.json';
import gasSchema from '../cubelic/gas-setlist.schema.json';
import hermesSchema from '../cubelic/hermes-output.schema.json';
import incidentSchema from '../cubelic/incident.schema.json';
import lpSchema from '../cubelic/lp-event.schema.json';
import lpMappingApprovalSchema from '../cubelic/lp-mapping-approval.schema.json';
import mediaSchema from '../cubelic/media-asset.schema.json';
import metricsSchema from '../cubelic/metrics.schema.json';
import memberMasterSchema from '../cubelic/member-master.schema.json';
import resolveSchema from '../cubelic/resolve-metadata.schema.json';
import rightsSchema from '../cubelic/rights-evidence.schema.json';
import songMasterSchema from '../cubelic/song-master.schema.json';
import inertDraftSchema from '../cubelic/x-harness-inert-draft.schema.json';
import postMappingSchema from '../cubelic/published-post-mapping.schema.json';
import analyticsFixture from '../../test-fixtures/contracts/analytics-event-v1.json';
import gasFixture from '../../test-fixtures/contracts/gas-setlist-v1.json';
import hermesFixture from '../../test-fixtures/contracts/hermes-output-v1.json';
import lpFixture from '../../test-fixtures/contracts/lp-event-v1.json';
import lpMappingApprovalFixture from '../../test-fixtures/contracts/lp-mapping-approval-v1.json';
import memberMasterFixture from '../../test-fixtures/contracts/member-master-v1.json';
import resolveFixture from '../../test-fixtures/contracts/resolve-metadata-v1.json';
import songMasterFixture from '../../test-fixtures/contracts/song-master-v1.json';
import inertDraftFixture from '../../test-fixtures/contracts/x-harness-inert-draft-v1.json';
import postMappingFixture from '../../test-fixtures/contracts/published-post-mapping-v1.json';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const schema of [rightsSchema, eventSchema, mediaSchema, contentSchema, draftSchema, metricsSchema, incidentSchema, auditSchema, gasSchema, lpSchema, lpMappingApprovalSchema, resolveSchema, hermesSchema, analyticsSchema, songMasterSchema, memberMasterSchema, inertDraftSchema, postMappingSchema]) {
  ajv.addSchema(schema);
}

describe('Phase 1 contract fixtures', () => {
  const contracts = [
    [gasSchema.$id, gasFixture],
    [lpSchema.$id, lpFixture],
    [lpMappingApprovalSchema.$id, lpMappingApprovalFixture],
    [resolveSchema.$id, resolveFixture],
    [hermesSchema.$id, hermesFixture],
    [analyticsSchema.$id, analyticsFixture],
    [songMasterSchema.$id, songMasterFixture],
    [memberMasterSchema.$id, memberMasterFixture],
    [inertDraftSchema.$id, inertDraftFixture],
    [postMappingSchema.$id, postMappingFixture],
  ] as const;

  it.each(contracts)('validates %s', (schemaId, fixture) => {
    const validate = ajv.getSchema(schemaId);
    expect(validate, `schema ${schemaId} is registered`).toBeTypeOf('function');
    expect(validate?.(fixture), JSON.stringify(validate?.errors)).toBe(true);
  });

  it('fails closed on an unknown GAS schema version', () => {
    const validate = ajv.getSchema(gasSchema.$id)!;
    expect(validate({ ...gasFixture, schema_version: 'unknown' })).toBe(false);
  });

  it('closes the root of alias contracts', () => {
    expect(ajv.getSchema(lpSchema.$id)?.({ ...lpFixture, unexpected: true })).toBe(false);
    expect(ajv.getSchema(resolveSchema.$id)?.({ ...resolveFixture, unexpected: true })).toBe(false);
  });
});
