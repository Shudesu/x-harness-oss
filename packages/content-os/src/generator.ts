import { ContentPolicyError } from './errors.js';
import { PHASE1_POLICY } from './policy.generated.js';
import { assertDraftableEventState, buildTrackedUrl, calculateFreshnessScore, calculateQualityScore, evaluateRights, validatePostText } from './rules.js';
import { scoreSetlistDraft, scoreVideoDraft } from './scoring.js';
import type { ContentItem, DraftCandidate, EventRecord, GasSetlistV1, MediaAsset, QualityBreakdown } from './types.js';

const TEMPLATE_VERSION = '1.0.0';

function compactSetlist(songs: GasSetlistV1['songs'], maxSongs = 5): string {
  const shown = songs.slice(0, maxSongs).map((song) => `${song.position}. ${song.title}`);
  if (songs.length > maxSongs) shown.push(`ほか${songs.length - maxSongs}曲`);
  return shown.join('\n');
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function draft(input: {
  content: ContentItem;
  event: EventRecord;
  text: string;
  templateId: string;
  variant: 'a' | 'b' | 'c';
  mediaAssetIds?: string[];
  mediaFingerprint?: string;
  qualityBreakdown: QualityBreakdown;
  freshnessScore: number;
  rightsGate: 'passed' | 'not_applicable';
  risks: string[];
  humanReview: string[];
  now: string;
}): Promise<DraftCandidate> {
  const destinationUrl = buildTrackedUrl({
    baseUrl: input.content.destination.base_url,
    campaignId: input.content.event_id ?? input.content.content_id,
    category: input.content.category,
    templateId: input.templateId,
    variant: input.variant,
  });
  const finalText = input.text.replace('{{tracked_url}}', destinationUrl);
  validatePostText(finalText);
  const qualityScore = calculateQualityScore(input.qualityBreakdown);
  const mediaHash = input.mediaFingerprint ?? 'none';
  const idempotencyKey = await sha256(`${PHASE1_POLICY.account.id}|${input.content.content_id}|${TEMPLATE_VERSION}|${mediaHash}|${input.variant}`);
  const draftId = makeId('drf');
  return {
    draft_id: draftId,
    content_id: input.content.content_id,
    account_id: PHASE1_POLICY.account.id,
    text: finalText,
    media_asset_ids: input.mediaAssetIds ?? [],
    category: input.content.category,
    template_id: input.templateId,
    template_version: TEMPLATE_VERSION,
    variant: input.variant,
    target_stage: input.content.target_stage,
    emotion_tags: input.content.emotion_tags,
    hashtags: ['CUBΣLIC'],
    destination_url: destinationUrl,
    utm: {
      source: 'x',
      medium: 'social',
      campaign: input.content.event_id ?? input.content.content_id,
      content: `${input.content.category}_${input.templateId}_${input.variant}`,
    },
    quality_score: qualityScore,
    quality_breakdown: input.qualityBreakdown,
    freshness_score: input.freshnessScore,
    rights_gate: input.rightsGate,
    approval_status: qualityScore >= 80 ? 'pending_review' : 'needs_revision',
    risks: input.risks,
    human_review_required: input.humanReview,
    idempotency_key: idempotencyKey,
    scheduled_at: null,
    published_post_id: null,
    created_at: input.now,
    updated_at: input.now,
  };
}

export async function generateSetlistDrafts(input: {
  setlist: GasSetlistV1;
  content: ContentItem;
  event: EventRecord;
  now: string;
}): Promise<DraftCandidate[]> {
  if (input.setlist.schema_version !== 'cubelic.gas-setlist.v1') {
    throw new ContentPolicyError('unsupported_setlist_contract', 'Unsupported GAS setlist schema version', ['incorrect_metadata']);
  }
  if (input.content.category !== 'setlist_flash' || input.content.target_stage !== 'interested') {
    throw new ContentPolicyError('invalid_setlist_content', 'Setlist flash must target the interested stage', ['incorrect_metadata']);
  }
  assertDraftableEventState(input.content, input.event);
  if (input.setlist.songs.length === 0 || input.setlist.songs.some((song, index) => song.position !== index + 1 || !song.song_id || !song.title)) {
    throw new ContentPolicyError('invalid_setlist', 'Setlist songs must be non-empty, identified and sequential', ['song_unknown']);
  }
  const freshnessScore = calculateFreshnessScore(input.event.ends_at, input.now);
  const list = compactSetlist(input.setlist.songs);
  const texts = [
    `【セトリ速報】\n${input.event.title} @ ${input.event.venue}\n${list}\n\n{{tracked_url}}\n#CUBΣLIC`,
    `${input.event.venue}でのCUBΣLIC、今日の曲順をまとめました。\n${list}\n\nセトリ詳細：{{tracked_url}}\n#CUBΣLIC`,
    `今日のライブを曲順で振り返り。\n${list}\n\n公演情報とセトリ：{{tracked_url}}\n#CUBΣLIC`,
  ] as const;

  return Promise.all(texts.slice(0, PHASE1_POLICY.content.maxGeneratedVariants).map((text, index) => {
    const variant = (['a', 'b', 'c'] as const)[index];
    return draft({
    content: input.content,
    event: input.event,
    text,
    templateId: 'setlist_flash_v1',
    variant,
    qualityBreakdown: scoreSetlistDraft({ ...input, variant }),
    freshnessScore,
    rightsGate: 'not_applicable',
    risks: ['曲名・曲順・公演名を一次情報と照合してください'],
    humanReview: ['本文を一文以上確認・必要に応じて修正してください', '公式発表と個人の感想が混同されていないこと'],
    now: input.now,
    });
  }));
}

export async function generateVideoDrafts(input: {
  content: ContentItem;
  event: EventRecord;
  media: MediaAsset;
  now: string;
}): Promise<DraftCandidate[]> {
  const category = input.content.category;
  if (category !== 'live_digest' && category !== 'member_focus' && category !== 'song_focus') {
    throw new ContentPolicyError('invalid_video_category', 'Media draft category is not video-compatible', ['incorrect_metadata']);
  }
  if (!input.content.event_id || input.content.event_id !== input.event.event_id || input.media.event_id !== input.event.event_id) {
    throw new ContentPolicyError('media_event_mismatch', 'Content, event, and media must reference the same event', ['incorrect_metadata']);
  }
  assertDraftableEventState(input.content, input.event);
  const rights = evaluateRights(input.event, input.media);
  if (!rights.passed) {
    throw new ContentPolicyError('rights_gate_failed', 'Media did not pass rights and privacy validation', rights.rejectReasons);
  }
  const freshnessScore = calculateFreshnessScore(input.event.ends_at, input.now);
  const templates = {
    live_digest: {
      id: 'live_digest_v1',
      texts: [
        `${input.event.title}のライブから、短い一場面を。\n映像と音でCUBΣLICの空気をどうぞ。\n#CUBΣLIC`,
        `今日の${input.event.venue}から。\nライブで伝わる表情と動きを、少しだけ切り取りました。\n#CUBΣLIC`,
        `CUBΣLICを初めて見る方へ。\nまずはこのライブ映像から雰囲気を受け取ってみてください。\n#CUBΣLIC`,
      ],
    },
    member_focus: {
      id: 'member_focus_v1',
      texts: [
        `${input.event.title}から、メンバーの印象的な一場面を。\n表情と動きに注目してみてください。\n#CUBΣLIC`,
        `${input.event.venue}のステージで見えた、ひとつの見せ場。\n短い映像でどうぞ。\n#CUBΣLIC`,
        `ライブで伝わるメンバーの魅力を、少しだけ切り取りました。\n#CUBΣLIC`,
      ],
    },
    song_focus: {
      id: 'song_focus_v1',
      texts: [
        `${input.event.title}から、楽曲の見どころが伝わる一場面を。\n#CUBΣLIC`,
        `${input.event.venue}で響いた一曲から、短いライブ映像をどうぞ。\n#CUBΣLIC`,
        `CUBΣLICの曲をライブ映像で。\n音とステージの空気を受け取ってみてください。\n#CUBΣLIC`,
      ],
    },
  } as const;
  const selectedTemplate = templates[category];

  return Promise.all(selectedTemplate.texts.slice(0, PHASE1_POLICY.content.maxGeneratedVariants).map((text, index) => {
    const variant = (['a', 'b', 'c'] as const)[index];
    return draft({
    content: input.content,
    event: input.event,
    text,
    templateId: selectedTemplate.id,
    variant,
    mediaAssetIds: [input.media.asset_id],
    mediaFingerprint: input.media.sha256,
    qualityBreakdown: scoreVideoDraft({ ...input, variant }),
    freshnessScore,
    rightsGate: 'passed',
    risks: [
      ...rights.reviewFlags,
      `公演の撮影許可証跡: ${input.event.filming_policy.evidence_url}`,
      `素材の掲載許可証跡: ${input.media.rights.evidence_url}`,
    ],
    humanReview: [
      '本文の温度感と事実関係を確認してください',
      '撮影・掲載許可の証跡を確認してください',
      '客席・第三者・スタッフ・他演者・掲示物の映り込みを目視確認してください',
    ],
    now: input.now,
    });
  }));
}
