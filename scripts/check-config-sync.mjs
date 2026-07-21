import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function scalar(file, section, key) {
  const source = await readFile(join(root, file), 'utf8');
  const sectionMatch = source.match(new RegExp(`^${section}:\\r?\\n((?: {2}.*(?:\\r?\\n|$))*)`, 'm'));
  if (!sectionMatch) throw new Error(`${file}: missing section ${section}`);
  const keyMatch = sectionMatch[1].match(new RegExp(`^  ${key}:\\s*(.+?)\\s*$`, 'm'));
  if (!keyMatch) throw new Error(`${file}: missing ${section}.${key}`);
  const raw = keyMatch[1];
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw.replace(/^(["'])(.*)\1$/, '$2');
}

const account = {
  id: await scalar('config/account-profile.yaml', 'account', 'id'),
  officialAccount: await scalar('config/account-profile.yaml', 'account', 'official_account'),
  timezone: await scalar('config/account-profile.yaml', 'account', 'timezone'),
};
const publishing = {
  maxPostsPerDay: await scalar('config/strategy.yaml', 'publishing', 'max_posts_per_day'),
  maxPostsPerWeek: await scalar('config/strategy.yaml', 'publishing', 'max_posts_per_week'),
  minimumIntervalMinutes: await scalar('config/strategy.yaml', 'publishing', 'minimum_interval_minutes'),
  publishNowEnabled: await scalar('config/strategy.yaml', 'publishing', 'publish_now_enabled'),
  autoScheduleEnabled: await scalar('config/strategy.yaml', 'publishing', 'auto_schedule_enabled'),
  autoDmEnabled: await scalar('config/strategy.yaml', 'publishing', 'auto_dm_enabled'),
  autoReplyEnabled: await scalar('config/strategy.yaml', 'publishing', 'auto_reply_enabled'),
  autoLikeEnabled: await scalar('config/strategy.yaml', 'publishing', 'auto_like_enabled'),
  autoFollowEnabled: await scalar('config/strategy.yaml', 'publishing', 'auto_follow_enabled'),
};
const content = {
  maxHashtags: await scalar('config/strategy.yaml', 'content', 'max_hashtags'),
  maxGeneratedVariants: await scalar('config/strategy.yaml', 'content', 'max_generated_variants'),
  duplicateSimilarityThreshold: await scalar('config/strategy.yaml', 'content', 'duplicate_similarity_threshold'),
  minimumQualityScore: await scalar('config/strategy.yaml', 'content', 'minimum_quality_score'),
};

const quote = (value) => typeof value === 'string' ? `'${value.replaceAll("'", "\\'")}'` : String(value);
const expected = `// Generated contract projection. Run \`pnpm check:config\` after editing config YAML.
export const PHASE1_POLICY = {
  account: {
    id: ${quote(account.id)},
    officialAccount: ${quote(account.officialAccount)},
    timezone: ${quote(account.timezone)},
  },
  publishing: {
    maxPostsPerDay: ${quote(publishing.maxPostsPerDay)},
    maxPostsPerWeek: ${quote(publishing.maxPostsPerWeek)},
    minimumIntervalMinutes: ${quote(publishing.minimumIntervalMinutes)},
    publishNowEnabled: ${quote(publishing.publishNowEnabled)},
    autoScheduleEnabled: ${quote(publishing.autoScheduleEnabled)},
    autoDmEnabled: ${quote(publishing.autoDmEnabled)},
    autoReplyEnabled: ${quote(publishing.autoReplyEnabled)},
    autoLikeEnabled: ${quote(publishing.autoLikeEnabled)},
    autoFollowEnabled: ${quote(publishing.autoFollowEnabled)},
  },
  content: {
    maxHashtags: ${quote(content.maxHashtags)},
    maxGeneratedVariants: ${quote(content.maxGeneratedVariants)},
    duplicateSimilarityThreshold: ${quote(content.duplicateSimilarityThreshold)},
    minimumQualityScore: ${quote(content.minimumQualityScore)},
  },
} as const;
`;

const generatedPath = join(root, 'packages/content-os/src/policy.generated.ts');
const actual = await readFile(generatedPath, 'utf8');
const errors = [];
if (actual !== expected) errors.push('packages/content-os/src/policy.generated.ts is out of sync with config YAML');
if (Object.values(publishing).filter((value) => typeof value === 'boolean').some(Boolean)) {
  errors.push('Phase 1 automatic publishing controls must all remain false');
}
if (content.maxGeneratedVariants > 3 || content.maxHashtags > 3 || content.minimumQualityScore < 80) {
  errors.push('Phase 1 content safety limits were weakened');
}
const schema = await readFile(join(root, 'packages/db/migrations/018-cubelic-content-os.sql'), 'utf8');
if (!schema.includes(`CHECK (account_id = '${account.id}')`)) errors.push('D1 account constraint is out of sync with account-profile.yaml');

if (errors.length) {
  console.error(`Config sync check failed:\n- ${errors.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log('Config sync check passed. Runtime policy matches the Phase 1 YAML contract.');
}
