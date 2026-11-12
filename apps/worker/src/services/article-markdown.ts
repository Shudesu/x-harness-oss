// Markdown → X Articles content_state (DraftJS raw, snake_case) converter.
//
// Schema reference: POST /2/articles/draft on docs.x.com (re-checked
// 2026-11-12, OpenAPI v2.174):
//   block.type ∈ unstyled | header-one | header-two | unordered-list-item |
//                ordered-list-item | blockquote | atomic
//   inline_style_ranges[].style ∈ bold | italic | strikethrough (lowercase)
//   entity_ranges[] = { offset, length, key:int }   (key "0" → 0)
//   entity.value.type ∈ post | link | image | emoji | markdown | divider | latex
//   recommended mutability: immutable for post/image/divider/latex,
//                           mutable for link/markdown
//   data: link {url}, image {caption?, media_items[{media_id,media_category}]},
//         markdown {markdown} (code fences + GFM tables), post {post_id},
//         divider {}
//   atomic placeholder blocks carry text " ".
// Articles have only two heading levels — "###" and deeper fold into
// header-two (header-three is not in the enum and the API 5xx's on it).
// Offsets/lengths are UTF-16 code units (JS string indexing), which is how
// the Articles editor counts.

import twitterText from 'twitter-text';
import type { ArticleContentBlock, ArticleContentState, ArticleEntity } from '@x-harness/x-sdk';

export const INLINE_IMAGE_CATEGORY = 'tweet_image';
export const INLINE_GIF_CATEGORY = 'tweet_gif';
export const INLINE_VIDEO_CATEGORY = 'amplify_video';

export interface InlineMedia {
  media_id: string;
  media_category: string;
}

export type InlineStyle = 'bold' | 'italic' | 'strikethrough';

export interface InlineParseResult {
  text: string;
  styles: { offset: number; length: number; style: InlineStyle }[];
  links: { offset: number; length: number; url: string }[];
}

// ─── Inline parsing ────────────────────────────────────────────────────────

const ESCAPABLE = new Set('\\`*_{}[]()#+-.!|~<>'.split(''));
const SAFE_LINK_RE = /^(?:https?:\/\/|mailto:)\S+$/i;

const BARE_URL_RE = /^https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/i;

// Strip trailing sentence punctuation and unbalanced closing parens.
function trimUrl(url: string): string {
  let u = url;
  for (;;) {
    const last = u[u.length - 1];
    if (/[.,;:!?'*]/.test(last)) {
      u = u.slice(0, -1);
    } else if (last === ')' && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) {
      u = u.slice(0, -1);
    } else {
      return u;
    }
  }
}

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9]/.test(ch);
}

// Unicode-aware: "_" between letters of any script (売上_前年比_比較,
// snake_case) is part of an identifier, never emphasis.
function isLetterOrDigit(ch: string | undefined): boolean {
  return !!ch && /[\p{L}\p{N}]/u.test(ch);
}

// Skip an inline code span starting at i (a run of backticks). Returns the
// index just past the closing run, or -1 if the span is unclosed.
function codeSpanEnd(raw: string, i: number): number {
  let n = 0;
  while (raw[i + n] === '`') n++;
  const fence = '`'.repeat(n);
  let j = raw.indexOf(fence, i + n);
  while (j !== -1) {
    // the closing run must be exactly n long
    if (raw[j + n] !== '`') return j + n;
    let k = j;
    while (raw[k] === '`') k++;
    j = raw.indexOf(fence, k);
  }
  return -1;
}

// Find the closing delimiter for an emphasis run opened at `from`.
function findClosing(raw: string, from: number, delim: string): number {
  const ch = delim[0];
  let j = from;
  while (j < raw.length) {
    const c = raw[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '`') {
      const end = codeSpanEnd(raw, j);
      if (end !== -1) {
        j = end;
        continue;
      }
    }
    if (c === '[') {
      const link = matchLink(raw, j);
      if (link) {
        j = link.end;
        continue;
      }
    }
    if (raw.startsWith(delim, j) && !/\s/.test(raw[j - 1] ?? ' ')) {
      if (delim.length === 1) {
        // a single-char delimiter must not be part of a double run
        if (raw[j + 1] === ch) {
          j += 2;
          continue;
        }
        if (ch === '_' && isLetterOrDigit(raw[j + 1])) {
          j++;
          continue;
        }
      }
      return j;
    }
    if (delim.length === 1 && c === ch && raw[j + 1] === ch) {
      j += 2;
      continue;
    }
    j++;
  }
  return -1;
}

// [label](url "title") starting at i. Handles nested brackets in the label
// and balanced parentheses in the URL.
function matchLink(raw: string, i: number): { label: string; url: string; end: number } | null {
  if (raw[i] !== '[') return null;
  let depth = 0;
  let j = i;
  for (; j < raw.length; j++) {
    const c = raw[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0 || raw[j + 1] !== '(') return null;
  const label = raw.slice(i + 1, j);
  let k = j + 2;
  let parens = 1;
  for (; k < raw.length; k++) {
    const c = raw[k];
    if (c === '\\') {
      k++;
      continue;
    }
    if (c === '(') parens++;
    else if (c === ')') {
      parens--;
      if (parens === 0) break;
    }
    if (c === '\n') return null;
  }
  if (parens !== 0) return null;
  let target = raw.slice(j + 2, k).trim();
  // drop an optional "title"
  const titled = target.match(/^(\S+)\s+(?:"[^"]*"|'[^']*')$/);
  if (titled) target = titled[1];
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  // CommonMark backslash escapes in the destination (Foo_\(bar\) → Foo_(bar))
  target = target.replace(/\\([!-/:-@[-`{-~])/g, '$1');
  return { label, url: target, end: k + 1 };
}

// Parse inline markdown: **bold** / __bold__, *italic* / _italic_,
// ~~strike~~, [text](url) links, <https://…> autolinks, `code` (markers
// stripped — Articles have no inline code style), backslash escapes.
// Inline images (![alt](url) inside prose) render as a link on the alt text.
export function parseInline(raw: string): InlineParseResult {
  const out: InlineParseResult = { text: '', styles: [], links: [] };

  const append = (inner: InlineParseResult) => {
    const base = out.text.length;
    out.text += inner.text;
    for (const s of inner.styles) out.styles.push({ ...s, offset: s.offset + base });
    for (const l of inner.links) out.links.push({ ...l, offset: l.offset + base });
  };

  let i = 0;
  while (i < raw.length) {
    const c = raw[i];

    if (c === '\\' && i + 1 < raw.length && ESCAPABLE.has(raw[i + 1])) {
      out.text += raw[i + 1];
      i += 2;
      continue;
    }

    if (c === '`') {
      const end = codeSpanEnd(raw, i);
      if (end !== -1) {
        let n = 0;
        while (raw[i + n] === '`') n++;
        let code = raw.slice(i + n, end - n);
        if (code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
        out.text += code;
        i = end;
        continue;
      }
    }

    const isImage = c === '!' && raw[i + 1] === '[';
    if (c === '[' || isImage) {
      const link = matchLink(raw, isImage ? i + 1 : i);
      if (link && SAFE_LINK_RE.test(link.url)) {
        const inner = link.label.trim() ? parseInline(link.label) : { text: link.url, styles: [], links: [] };
        const offset = out.text.length;
        append(inner);
        // nested links are not meaningful — the outer link wins
        out.links = out.links.filter((l) => l.offset < offset || l.offset >= offset + inner.text.length);
        if (inner.text.length > 0) out.links.push({ offset, length: inner.text.length, url: link.url });
        i = link.end;
        continue;
      }
    }

    // bare URLs become link entities and are copied verbatim so "_" or "*"
    // inside them is never read as emphasis
    if ((c === 'h' || c === 'H') && !isWordChar(raw[i - 1])) {
      const m = raw.slice(i).match(BARE_URL_RE);
      if (m) {
        const url = trimUrl(m[0]);
        const next = raw[i + m[0].length];
        // a URL that continues with non-ASCII (e.g. https://ex.com/日本語) is
        // ambiguous in CJK prose — keep it as plain text rather than linking a
        // truncated target
        if (next && /[^\x00-\x7F]/.test(next) && url === m[0]) {
          out.text += m[0];
          i += m[0].length;
          continue;
        }
        if (url.length > 'https://'.length) {
          out.links.push({ offset: out.text.length, length: url.length, url });
          out.text += url;
          i += url.length;
          continue;
        }
      }
    }

    if (c === '<') {
      const m = raw.slice(i).match(/^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i);
      if (m) {
        out.links.push({ offset: out.text.length, length: m[1].length, url: m[1] });
        out.text += m[1];
        i += m[0].length;
        continue;
      }
    }

    const pair = raw.slice(i, i + 2);
    if (pair === '**' || pair === '__' || pair === '~~') {
      const opensOk = !/\s/.test(raw[i + 2] ?? ' ') && !(c === '_' && isLetterOrDigit(raw[i - 1]));
      const end = opensOk ? findClosing(raw, i + 2, pair) : -1;
      if (end > i + 2 && !(c === '_' && isLetterOrDigit(raw[end + 2]))) {
        const inner = parseInline(raw.slice(i + 2, end));
        const offset = out.text.length;
        append(inner);
        if (inner.text.length > 0) {
          out.styles.push({ offset, length: inner.text.length, style: pair === '~~' ? 'strikethrough' : 'bold' });
        }
        i = end + 2;
        continue;
      }
      out.text += pair;
      i += 2;
      continue;
    }

    if (c === '*' || c === '_') {
      const opensOk = !/\s/.test(raw[i + 1] ?? ' ') && !(c === '_' && isLetterOrDigit(raw[i - 1]));
      const end = opensOk ? findClosing(raw, i + 1, c) : -1;
      if (end > i + 1 && !(c === '_' && isLetterOrDigit(raw[end + 1]))) {
        const inner = parseInline(raw.slice(i + 1, end));
        const offset = out.text.length;
        append(inner);
        if (inner.text.length > 0) out.styles.push({ offset, length: inner.text.length, style: 'italic' });
        i = end + 1;
        continue;
      }
    }

    out.text += c;
    i++;
  }
  return out;
}

// Back-compat shape used by older callers/tests: text + style ranges only.
export function parseInlineStyles(raw: string): {
  text: string;
  ranges: { offset: number; length: number; style: string }[];
} {
  const { text, styles } = parseInline(raw);
  return { text, ranges: styles };
}

// ─── Block-level recognizers ───────────────────────────────────────────────

// Standalone image line: ![alt](src). src is an https URL (uploaded by the
// caller) or a direct media reference "media:<media_id>" with an optional
// "#<media_category>" suffix (e.g. media:1234567890#tweet_gif). The URL is
// captured greedily to the final ')' so URLs containing parens still match.
export const IMAGE_LINE_RE = /^!\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)$/;
// kept for callers that imported the old name
export const IMAGE_PARAGRAPH_RE = IMAGE_LINE_RE;
const MEDIA_REF_RE = /^media:(\d{1,19})(?:#([a-z_]+))?$/;

// A line that is exactly one X status URL (optionally <wrapped>) becomes an
// embedded-post entity. Strict so prose containing links stays text.
export const POST_PARAGRAPH_RE = /^<?https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/(\d+)(?:[/?#]\S*?)?>?$/;

const FENCE_OPEN_RE = /^(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const DIVIDER_RE = /^(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP_RE = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/;

function isTableStart(lines: string[], i: number): boolean {
  const head = lines[i]?.trim() ?? '';
  const sep = lines[i + 1]?.trim() ?? '';
  return head.includes('|') && sep.includes('|') && TABLE_SEP_RE.test(sep);
}

// Lines that open a block of their own (used to stop list continuation).
function isBlockStart(lines: string[], i: number): boolean {
  const t = lines[i].trim();
  return (
    FENCE_OPEN_RE.test(t) ||
    HEADING_RE.test(t) ||
    DIVIDER_RE.test(t) ||
    QUOTE_RE.test(lines[i]) ||
    IMAGE_LINE_RE.test(t) ||
    POST_PARAGRAPH_RE.test(t) ||
    isTableStart(lines, i)
  );
}

export function parseImageLine(line: string): { alt: string; src: string } | null {
  const m = line.trim().match(IMAGE_LINE_RE);
  if (!m) return null;
  // greedy fallback for URLs with parentheses, e.g. img_(1).png
  const greedy = line.trim().match(/^!\[([^\]]*)\]\((\S+)\)$/);
  const src = greedy && greedy[2].length > m[2].length && !/\s/.test(greedy[2]) ? greedy[2] : m[2];
  return { alt: m[1], src };
}

export function parseMediaRef(src: string): InlineMedia | null {
  const m = src.match(MEDIA_REF_RE);
  if (!m) return null;
  return { media_id: m[1], media_category: m[2] ?? INLINE_IMAGE_CATEGORY };
}

// ─── Tokenizer ─────────────────────────────────────────────────────────────

type Token =
  | { kind: 'text'; type: string; raw: string }
  | { kind: 'markdown'; markdown: string }
  | { kind: 'divider' }
  | { kind: 'image'; alt: string; src: string }
  | { kind: 'post'; postId: string };

function tokenize(body: string): Token[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const tokens: Token[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) tokens.push({ kind: 'text', type: 'unstyled', raw: para.join('\n') });
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (!t) {
      flush();
      i++;
      continue;
    }

    const fence = t.match(FENCE_OPEN_RE);
    if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) {
      flush();
      const marker = fence[1];
      const content: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const c = lines[j].trim();
        if (c.startsWith(marker[0].repeat(marker.length)) && /^[`~]+$/.test(c)) break;
        content.push(lines[j]);
      }
      // emit the fence verbatim (an unclosed fence runs to the end of the body)
      if (content.some((l) => l.trim())) {
        tokens.push({ kind: 'markdown', markdown: [marker + fence[2].trim(), ...content, marker].join('\n') });
      }
      i = j + 1;
      continue;
    }

    if (isTableStart(lines, i)) {
      flush();
      const rows: string[] = [];
      let j = i;
      while (j < lines.length && lines[j].trim() && lines[j].includes('|')) {
        rows.push(lines[j].trim());
        j++;
      }
      tokens.push({ kind: 'markdown', markdown: rows.join('\n') });
      i = j;
      continue;
    }

    if (DIVIDER_RE.test(t)) {
      flush();
      tokens.push({ kind: 'divider' });
      i++;
      continue;
    }

    const image = parseImageLine(t);
    if (image) {
      flush();
      tokens.push({ kind: 'image', alt: image.alt, src: image.src });
      i++;
      continue;
    }

    const post = t.match(POST_PARAGRAPH_RE);
    if (post) {
      flush();
      tokens.push({ kind: 'post', postId: post[1] });
      i++;
      continue;
    }

    const heading = t.match(HEADING_RE);
    if (heading) {
      flush();
      tokens.push({ kind: 'text', type: heading[1].length === 1 ? 'header-one' : 'header-two', raw: heading[2] });
      i++;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      flush();
      const quote: string[] = [];
      let j = i;
      while (j < lines.length && QUOTE_RE.test(lines[j])) {
        const inner = lines[j].match(QUOTE_RE)![1];
        if (inner.trim()) {
          quote.push(inner);
        } else if (quote.length) {
          tokens.push({ kind: 'text', type: 'blockquote', raw: quote.join('\n') });
          quote.length = 0;
        }
        j++;
      }
      if (quote.length) tokens.push({ kind: 'text', type: 'blockquote', raw: quote.join('\n') });
      i = j;
      continue;
    }

    const li = line.match(LIST_RE);
    if (li && !DIVIDER_RE.test(t)) {
      flush();
      const ordered = /\d/.test(li[2]);
      const item: string[] = [li[3]];
      let j = i + 1;
      // indented continuation lines belong to the item (nested lists are
      // flattened — the Articles schema has no depth field)
      while (
        j < lines.length &&
        lines[j].trim() &&
        !LIST_RE.test(lines[j]) &&
        /^\s{2,}/.test(lines[j]) &&
        !isBlockStart(lines, j)
      ) {
        item.push(lines[j].trim());
        j++;
      }
      tokens.push({ kind: 'text', type: ordered ? 'ordered-list-item' : 'unordered-list-item', raw: item.join('\n') });
      i = j;
      continue;
    }

    para.push(t);
    i++;
  }
  flush();
  return tokens;
}

// Every https image URL the converter will turn into an entity (media:<id>
// references need no upload). Same tokenizer as the converter, so the
// uploaded set and the converted set always agree.
export function collectInlineImageUrls(body: string): string[] {
  const urls = new Set<string>();
  for (const tok of tokenize(body)) {
    if (tok.kind === 'image' && !parseMediaRef(tok.src)) urls.add(tok.src);
  }
  return [...urls];
}

// ─── Converter ─────────────────────────────────────────────────────────────

export interface ConvertOptions {
  // image src (as written in the markdown) → uploaded X media. A bare
  // string value is shorthand for a tweet_image media_id.
  mediaMap?: Record<string, string | InlineMedia>;
  // when given, a leading "# <title>" heading is dropped — the Articles API
  // renders the title separately, so keeping it duplicates the H1.
  title?: string;
}

export interface ConvertResult {
  contentState: ArticleContentState;
  warnings: string[];
}

export function convertMarkdownToArticle(body: string, opts: ConvertOptions = {}): ConvertResult {
  const mediaMap = opts.mediaMap ?? {};
  const blocks: ArticleContentBlock[] = [];
  const entities: ArticleEntity[] = [];
  const warnings: string[] = [];

  const addEntity = (type: string, mutability: string, data: Record<string, unknown>): number => {
    const key = entities.length;
    entities.push({ key: String(key), value: { type, mutability, data } });
    return key;
  };
  const atomic = (key: number) => {
    blocks.push({ text: ' ', type: 'atomic', entity_ranges: [{ offset: 0, length: 1, key }] });
  };

  const tokens = tokenize(body);
  for (const [index, tok] of tokens.entries()) {
    switch (tok.kind) {
      case 'markdown':
        atomic(addEntity('markdown', 'mutable', { markdown: tok.markdown }));
        break;
      case 'divider':
        atomic(addEntity('divider', 'immutable', {}));
        break;
      case 'post':
        atomic(addEntity('post', 'immutable', { post_id: tok.postId }));
        break;
      case 'image': {
        const entry = parseMediaRef(tok.src) ?? mediaMap[tok.src];
        if (!entry) {
          warnings.push(`画像をスキップしました（アップロードされていません）: ${tok.src}`);
          break;
        }
        const media: InlineMedia =
          typeof entry === 'string' ? { media_id: entry, media_category: INLINE_IMAGE_CATEGORY } : entry;
        const alt = tok.alt.replace(/\s+/g, ' ').trim();
        atomic(
          addEntity('image', 'immutable', {
            ...(alt ? { caption: alt } : {}),
            media_items: [{ media_id: media.media_id, media_category: media.media_category }],
          }),
        );
        break;
      }
      case 'text': {
        const { text, styles, links } = parseInline(tok.raw);
        if (
          opts.title &&
          index === 0 &&
          tok.type === 'header-one' &&
          text.trim() === opts.title.trim()
        ) {
          break;
        }
        if (!text.trim()) break;
        const b: ArticleContentBlock = { text, type: tok.type };
        if (styles.length) b.inline_style_ranges = styles;
        if (links.length) {
          b.entity_ranges = links.map((l) => ({
            offset: l.offset,
            length: l.length,
            key: addEntity('link', 'mutable', { url: l.url }),
          }));
        }
        blocks.push(b);
        break;
      }
    }
  }

  return { contentState: { blocks, entities }, warnings };
}

// Back-compat wrapper: content_state only (missing images are skipped).
export function markdownToContentState(
  body: string,
  mediaMap: Record<string, string | InlineMedia> = {},
  title?: string,
): ArticleContentState {
  return convertMarkdownToArticle(body, { mediaMap, title }).contentState;
}

// ─── Validation ────────────────────────────────────────────────────────────

// Titles over this many characters create a draft (201) but the publish
// call then fails with "article not found" (44 chars verified OK live).
export const ARTICLE_TITLE_WARN_LENGTH = 60;
// docs.x.com (data.markdown): "Max weighted length is enforced by the
// Articles backend (10,000 per article)" — applies to markdown entities.
export const ARTICLE_MARKDOWN_MAX_WEIGHTED = 10_000;

export function weightedLength(text: string): number {
  return twitterText.parseTweet(text).weightedLength;
}

export interface ArticleValidation {
  errors: string[];
  warnings: string[];
  stats: { titleLength: number; bodyWeightedLength: number; markdownWeightedLength: number };
}

export function validateArticle(title: string, contentState: ArticleContentState): ArticleValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const titleLength = [...title.trim()].length;
  if (!titleLength) errors.push('タイトルが空です');
  if (titleLength > ARTICLE_TITLE_WARN_LENGTH) {
    warnings.push(
      `タイトルが${titleLength}文字です（${ARTICLE_TITLE_WARN_LENGTH}文字超）。下書きは作成されても公開APIが「article not found」で失敗することがあります`,
    );
  }

  let bodyWeightedLength = 0;
  for (const b of contentState.blocks) {
    if (b.type !== 'atomic') bodyWeightedLength += weightedLength(b.text);
  }
  let markdownWeightedLength = 0;
  for (const e of contentState.entities) {
    if (e.value.type === 'markdown' && typeof e.value.data.markdown === 'string') {
      markdownWeightedLength += weightedLength(e.value.data.markdown);
    }
  }
  if (markdownWeightedLength > ARTICLE_MARKDOWN_MAX_WEIGHTED) {
    errors.push(
      `コードブロック/表(markdown)の加重文字数が${markdownWeightedLength}です（上限${ARTICLE_MARKDOWN_MAX_WEIGHTED}）。分割・削減してください`,
    );
  }
  if (!contentState.blocks.length) errors.push('本文が空です');

  return { errors, warnings, stats: { titleLength, bodyWeightedLength, markdownWeightedLength } };
}
