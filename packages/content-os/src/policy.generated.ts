// Generated contract projection. Run `pnpm check:config` after editing config YAML.
export const PHASE1_POLICY = {
  account: {
    id: 'tubelic_cube',
    officialAccount: false,
    timezone: 'Asia/Tokyo',
  },
  publishing: {
    maxPostsPerDay: 2,
    maxPostsPerWeek: 10,
    minimumIntervalMinutes: 240,
    publishNowEnabled: false,
    autoScheduleEnabled: false,
    autoDmEnabled: false,
    autoReplyEnabled: false,
    autoLikeEnabled: false,
    autoFollowEnabled: false,
  },
  content: {
    maxHashtags: 3,
    maxGeneratedVariants: 3,
    duplicateSimilarityThreshold: 0.82,
    minimumQualityScore: 80,
  },
} as const;
