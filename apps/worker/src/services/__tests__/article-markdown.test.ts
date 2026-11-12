import { describe, it, expect } from 'vitest';
import {
  collectInlineImageUrls,
  convertMarkdownToArticle,
  parseInline,
  validateArticle,
  ARTICLE_MARKDOWN_MAX_WEIGHTED,
} from '../article-markdown.js';

const ALLOWED_BLOCK_TYPES = new Set([
  'unstyled',
  'header-one',
  'header-two',
  'unordered-list-item',
  'ordered-list-item',
  'blockquote',
  'atomic',
]);
const ALLOWED_ENTITY_TYPES = new Set(['post', 'link', 'image', 'emoji', 'markdown', 'divider', 'latex']);
const ALLOWED_BLOCK_KEYS = new Set(['text', 'type', 'entity_ranges', 'inline_style_ranges', 'key', 'data']);

function convert(md: string, mediaMap = {}, title?: string) {
  return convertMarkdownToArticle(md, { mediaMap, title });
}

describe('links → link entity (no text splitting)', () => {
  it('keeps the link text inline and attaches a link entity range', () => {
    const { contentState: cs } = convert('詳しくは[公式ドキュメント](https://docs.x.com/x-api)を参照');
    expect(cs.blocks).toHaveLength(1);
    const b = cs.blocks[0];
    expect(b).toMatchObject({ type: 'unstyled', text: '詳しくは公式ドキュメントを参照' });
    expect(b.entity_ranges).toEqual([{ offset: 4, length: 8, key: 0 }]);
    expect(cs.entities).toEqual([
      { key: '0', value: { type: 'link', mutability: 'mutable', data: { url: 'https://docs.x.com/x-api' } } },
    ]);
    expect(JSON.stringify(cs)).not.toContain('](');
  });

  it('gives each link its own entity key, including in lists and headings', () => {
    const { contentState: cs } = convert('## [A](https://a.example) と [B](https://b.example)\n\n- [C](https://c.example)');
    expect(cs.blocks[0].entity_ranges).toEqual([
      { offset: 0, length: 1, key: 0 },
      { offset: 4, length: 1, key: 1 },
    ]);
    expect(cs.blocks[1]).toMatchObject({ type: 'unordered-list-item', text: 'C', entity_ranges: [{ offset: 0, length: 1, key: 2 }] });
    expect(cs.entities.map((e) => e.value.data.url)).toEqual(['https://a.example', 'https://b.example', 'https://c.example']);
  });

  it('supports bold link text, URLs with parentheses and titles', () => {
    const { contentState: cs } = convert('[**強調**リンク](https://en.wikipedia.org/wiki/Foo_(bar) "title")です');
    const b = cs.blocks[0];
    expect(b.text).toBe('強調リンクです');
    expect(b.inline_style_ranges).toEqual([{ offset: 0, length: 2, style: 'bold' }]);
    expect(b.entity_ranges).toEqual([{ offset: 0, length: 5, key: 0 }]);
    expect(cs.entities[0].value.data.url).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
  });

  it('turns bare and <autolink> URLs into link entities without eating trailing punctuation', () => {
    const { contentState: cs } = convert('見て https://example.com/a_b_c. と <https://example.org/x>');
    const b = cs.blocks[0];
    expect(b.text).toBe('見て https://example.com/a_b_c. と https://example.org/x');
    expect(b.inline_style_ranges).toBeUndefined(); // "_" inside URL is not italic
    expect(cs.entities.map((e) => e.value.data.url)).toEqual(['https://example.com/a_b_c', 'https://example.org/x']);
    expect(b.entity_ranges?.[0]).toEqual({ offset: 3, length: 'https://example.com/a_b_c'.length, key: 0 });
  });

  it('does not link a truncated target when a bare URL continues with non-ASCII', () => {
    const { contentState: cs } = convert('https://example.com/日本語 を参照');
    expect(cs.entities).toEqual([]);
    expect(cs.blocks[0].text).toBe('https://example.com/日本語 を参照');
    // explicit markdown links with Unicode paths still work
    const md = convert('[記事](https://example.com/日本語)').contentState;
    expect(md.entities[0].value.data.url).toBe('https://example.com/日本語');
  });

  it('unescapes backslash escapes in link destinations', () => {
    const { contentState: cs } = convert('[wiki](https://example.com/Foo_\\(bar\\))');
    expect(cs.entities[0].value.data.url).toBe('https://example.com/Foo_(bar)');
  });

  it('does not create a link for unsafe schemes', () => {
    const { contentState: cs } = convert('[x](javascript:alert(1))');
    expect(cs.entities).toEqual([]);
    expect(cs.blocks[0].text).toBe('[x](javascript:alert(1))');
  });
});

describe('headings', () => {
  it('# → header-one, ## and ### (and deeper) → header-two', () => {
    const { contentState: cs } = convert('# H1\n\n## H2\n\n### H3\n\n#### H4\n\n#hashtag');
    expect(cs.blocks.map((b) => [b.type, b.text])).toEqual([
      ['header-one', 'H1'],
      ['header-two', 'H2'],
      ['header-two', 'H3'],
      ['header-two', 'H4'],
      ['unstyled', '#hashtag'],
    ]);
  });

  it('headings directly after a paragraph line still break out', () => {
    const { contentState: cs } = convert('本文\n### 小見出し\n続き');
    expect(cs.blocks.map((b) => b.type)).toEqual(['unstyled', 'header-two', 'unstyled']);
  });
});

describe('lists and quotes', () => {
  it('- / * / + and 1. / 1) become one list block per item', () => {
    const { contentState: cs } = convert('- a\n* b\n+ c\n\n1. one\n2) two');
    expect(cs.blocks.map((b) => [b.type, b.text])).toEqual([
      ['unordered-list-item', 'a'],
      ['unordered-list-item', 'b'],
      ['unordered-list-item', 'c'],
      ['ordered-list-item', 'one'],
      ['ordered-list-item', 'two'],
    ]);
  });

  it('an indented fence right after a list item is a code block, not item text', () => {
    const { contentState: cs } = convert('- 手順\n  ```ts\n  const a = 1;\n\n  a++;\n  ```\n\n## 次の章');
    expect(cs.blocks.map((b) => [b.type, b.text])).toEqual([
      ['unordered-list-item', '手順'],
      ['atomic', ' '],
      ['header-two', '次の章'],
    ]);
    expect(cs.entities[0].value.data.markdown).toBe('```ts\n  const a = 1;\n\n  a++;\n```');
  });

  it('flattens nested lists (schema has no depth)', () => {
    const { contentState: cs } = convert('- 親\n  - 子\n- 次');
    expect(cs.blocks.map((b) => b.text)).toEqual(['親', '子', '次']);
  });

  it('> lines become a blockquote with inline styles', () => {
    const { contentState: cs } = convert('> 引用**太字**\n> 二行目\n>\n> 別段落');
    expect(cs.blocks.map((b) => [b.type, b.text])).toEqual([
      ['blockquote', '引用太字\n二行目'],
      ['blockquote', '別段落'],
    ]);
    expect(cs.blocks[0].inline_style_ranges).toEqual([{ offset: 2, length: 2, style: 'bold' }]);
  });
});

describe('inline styles', () => {
  it('bold / italic / strikethrough with UTF-16 offsets', () => {
    const r = parseInline('**太字** と *斜体* と ~~取消~~ と __下線太字__ と _斜め_');
    expect(r.text).toBe('太字 と 斜体 と 取消 と 下線太字 と 斜め');
    expect(r.styles).toEqual([
      { offset: 0, length: 2, style: 'bold' },
      { offset: 5, length: 2, style: 'italic' },
      { offset: 10, length: 2, style: 'strikethrough' },
      { offset: 15, length: 4, style: 'bold' },
      { offset: 22, length: 2, style: 'italic' },
    ]);
  });

  it('nests italic inside bold and counts emoji as 2 code units', () => {
    const r = parseInline('🎉**a *b* c**');
    expect(r.text).toBe('🎉a b c');
    expect(r.styles).toEqual(
      expect.arrayContaining([
        { offset: 2, length: 5, style: 'bold' },
        { offset: 4, length: 1, style: 'italic' },
      ]),
    );
  });

  it('leaves snake_case, lone asterisks and escapes alone', () => {
    expect(parseInline('snake_case_name').styles).toEqual([]);
    expect(parseInline('売上_前年比_比較')).toEqual({ text: '売上_前年比_比較', styles: [], links: [] });
    expect(parseInline('2 * 3 = 6').text).toBe('2 * 3 = 6');
    const esc = parseInline('\\*not italic\\*');
    expect(esc.text).toBe('*not italic*');
    expect(esc.styles).toEqual([]);
  });

  it('strips inline code backticks and does not style inside them', () => {
    const r = parseInline('`a*b*c` と `x_y_z`');
    expect(r.text).toBe('a*b*c と x_y_z');
    expect(r.styles).toEqual([]);
  });
});

describe('GFM tables and fenced code → markdown entity atomic blocks', () => {
  it('converts a pipe table into one markdown entity', () => {
    const md = '前\n\n| 項目 | 値 |\n| --- | :-: |\n| A | 1 |\n| B | 2 |\n\n後';
    const { contentState: cs } = convert(md);
    expect(cs.blocks.map((b) => [b.type, b.text])).toEqual([
      ['unstyled', '前'],
      ['atomic', ' '],
      ['unstyled', '後'],
    ]);
    expect(cs.blocks[1].entity_ranges).toEqual([{ offset: 0, length: 1, key: 0 }]);
    expect(cs.entities[0].value).toEqual({
      type: 'markdown',
      mutability: 'mutable',
      data: { markdown: '| 項目 | 値 |\n| --- | :-: |\n| A | 1 |\n| B | 2 |' },
    });
  });

  it('a table glued to a paragraph line still becomes a table', () => {
    const { contentState: cs } = convert('説明:\n|a|b|\n|-|-|\n|1|2|');
    expect(cs.blocks.map((b) => b.type)).toEqual(['unstyled', 'atomic']);
    expect(cs.entities[0].value.data.markdown).toBe('|a|b|\n|-|-|\n|1|2|');
  });

  it('keeps fenced code (language, blank lines, markdown-looking content) verbatim', () => {
    const md = '```ts\nconst a = 1;\n\n# not a heading\n- not a list\n![](https://x.example/i.png)\n```';
    const { contentState: cs } = convert(md);
    expect(cs.blocks).toEqual([{ text: ' ', type: 'atomic', entity_ranges: [{ offset: 0, length: 1, key: 0 }] }]);
    expect(cs.entities[0].value.data.markdown).toBe(md);
    expect(collectInlineImageUrls(md)).toEqual([]);
  });

  it('supports ~~~ fences and unclosed fences', () => {
    expect(convert('~~~\ncode\n~~~').contentState.entities[0].value.data.markdown).toBe('~~~\ncode\n~~~');
    expect(convert('```\nopen').contentState.entities[0].value.data.markdown).toBe('```\nopen\n```');
  });

  it('drops empty fences', () => {
    expect(convert('```\n\n```').contentState.blocks).toEqual([]);
  });
});

describe('divider', () => {
  it('--- / *** / ___ → divider entity atomic block', () => {
    const { contentState: cs } = convert('上\n\n---\n\n中\n\n***\n\n___\n\n下');
    expect(cs.blocks.map((b) => b.type)).toEqual(['unstyled', 'atomic', 'unstyled', 'atomic', 'atomic', 'unstyled']);
    expect(cs.entities.map((e) => e.value)).toEqual([
      { type: 'divider', mutability: 'immutable', data: {} },
      { type: 'divider', mutability: 'immutable', data: {} },
      { type: 'divider', mutability: 'immutable', data: {} },
    ]);
  });
});

describe('images (standalone line)', () => {
  const URL = 'https://cdn.example.com/a.png';

  it('https URL uses the uploaded media from mediaMap', () => {
    const { contentState: cs, warnings } = convert(`![図1](${URL})`, {
      [URL]: { media_id: '42', media_category: 'tweet_image' },
    });
    expect(warnings).toEqual([]);
    expect(cs.blocks[0]).toEqual({ text: ' ', type: 'atomic', entity_ranges: [{ offset: 0, length: 1, key: 0 }] });
    expect(cs.entities[0].value).toEqual({
      type: 'image',
      mutability: 'immutable',
      data: { caption: '図1', media_items: [{ media_id: '42', media_category: 'tweet_image' }] },
    });
  });

  it('media:<id> references are used directly (no upload), with optional category', () => {
    const md = '![](media:1234567890)\n\n![アニメ](media:987#tweet_gif)';
    expect(collectInlineImageUrls(md)).toEqual([]);
    const { contentState: cs } = convert(md);
    expect(cs.entities.map((e) => e.value.data.media_items)).toEqual([
      [{ media_id: '1234567890', media_category: 'tweet_image' }],
      [{ media_id: '987', media_category: 'tweet_gif' }],
    ]);
  });

  it('skips a failed/missing image with a warning instead of failing the whole article', () => {
    const { contentState: cs, warnings } = convert(`前\n\n![](${URL})\n\n後`);
    expect(cs.blocks.map((b) => b.text)).toEqual(['前', '後']);
    expect(cs.entities).toEqual([]);
    expect(warnings).toEqual([`画像をスキップしました（アップロードされていません）: ${URL}`]);
  });
});

describe('embedded posts', () => {
  it('a standalone x.com / twitter.com status URL becomes a post entity', () => {
    const { contentState: cs } = convert('https://x.com/user_1/status/2078366204960596165\n\n<https://twitter.com/a/status/99?s=20>');
    expect(cs.blocks.map((b) => b.type)).toEqual(['atomic', 'atomic']);
    expect(cs.entities.map((e) => e.value)).toEqual([
      { type: 'post', mutability: 'immutable', data: { post_id: '2078366204960596165' } },
      { type: 'post', mutability: 'immutable', data: { post_id: '99' } },
    ]);
  });
});

describe('full document conforms to the published schema', () => {
  const doc = [
    '# 記事タイトル',
    '',
    '導入文。[リンク](https://example.com)と**太字**。',
    '',
    '## 章1',
    '',
    '### 節1-1',
    '',
    '- 項目1',
    '- 項目2',
    '',
    '1. 手順1',
    '2. 手順2',
    '',
    '> 引用',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '```js',
    'console.log(1)',
    '```',
    '',
    '---',
    '',
    '![キャプション](https://cdn.example.com/x.png)',
    '',
    'https://x.com/a/status/1',
    '',
    '~~旧~~ *新*',
  ].join('\n');

  it('only uses allowed block/entity types and keys, with integer entity_range keys that resolve', () => {
    const { contentState: cs, warnings } = convert(doc, { 'https://cdn.example.com/x.png': '5' }, '記事タイトル');
    expect(warnings).toEqual([]);
    expect(cs.blocks[0]).toMatchObject({ type: 'unstyled' }); // duplicate title H1 dropped
    for (const b of cs.blocks) {
      expect(ALLOWED_BLOCK_TYPES.has(b.type)).toBe(true);
      for (const k of Object.keys(b)) expect(ALLOWED_BLOCK_KEYS.has(k)).toBe(true);
      if (b.type === 'atomic') expect(b.text).toBe(' ');
      for (const r of b.entity_ranges ?? []) {
        expect(Number.isInteger(r.key)).toBe(true);
        expect(cs.entities.find((e) => e.key === String(r.key))).toBeDefined();
        expect(r.offset + r.length).toBeLessThanOrEqual(b.text.length);
      }
      for (const s of b.inline_style_ranges ?? []) {
        expect(['bold', 'italic', 'strikethrough']).toContain(s.style);
        expect(s.offset + s.length).toBeLessThanOrEqual(b.text.length);
      }
    }
    for (const e of cs.entities) expect(ALLOWED_ENTITY_TYPES.has(e.value.type)).toBe(true);
    expect(cs.entities.map((e) => e.value.type)).toEqual(['link', 'markdown', 'markdown', 'divider', 'image', 'post']);
    expect(cs.blocks.map((b) => b.type)).toEqual([
      'unstyled',
      'header-two',
      'header-two',
      'unordered-list-item',
      'unordered-list-item',
      'ordered-list-item',
      'ordered-list-item',
      'blockquote',
      'atomic',
      'atomic',
      'atomic',
      'atomic',
      'atomic',
      'unstyled',
    ]);
    const json = JSON.stringify(cs);
    for (const marker of ['**', '](', '~~', '###', '```js\\nconsole']) {
      if (marker === '```js\\nconsole') continue; // lives inside the markdown entity
      expect(cs.blocks.map((b) => b.text).join('\n')).not.toContain(marker);
    }
    expect(json).toContain('```js\\nconsole.log(1)\\n```');
  });
});

describe('validateArticle', () => {
  const okState = convert('本文').contentState;

  it('passes a normal article and reports weighted length', () => {
    const v = validateArticle('普通のタイトル', okState);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(v.stats.bodyWeightedLength).toBe(4); // CJK counts double
  });

  it('warns (not errors) when the title exceeds 60 characters', () => {
    const v = validateArticle('あ'.repeat(61), okState);
    expect(v.errors).toEqual([]);
    expect(v.warnings[0]).toMatch(/61文字/);
    expect(validateArticle('あ'.repeat(60), okState).warnings).toEqual([]);
  });

  it('counts title length in code points (emoji = 1)', () => {
    expect(validateArticle('🎉'.repeat(60), okState).warnings).toEqual([]);
  });

  it('errors on empty title or empty body', () => {
    expect(validateArticle('  ', okState).errors).toContain('タイトルが空です');
    expect(validateArticle('t', { blocks: [], entities: [] }).errors).toContain('本文が空です');
  });

  it('errors when markdown entities exceed the 10,000 weighted-length cap', () => {
    const big = convert('```\n' + 'あ'.repeat(ARTICLE_MARKDOWN_MAX_WEIGHTED / 2 + 1) + '\n```').contentState;
    const v = validateArticle('t', big);
    expect(v.errors.join()).toMatch(/上限10000/);
    const fits = convert('```\n' + 'a'.repeat(9000) + '\n```').contentState;
    expect(validateArticle('t', fits).errors).toEqual([]);
  });
});
