import { describe, it, expect } from 'vitest';
import { markdownToContentState, collectInlineImageUrls } from '../articles.js';

// Blocks carry the standard DraftJS raw fields (key/depth/...) — assertions
// simplify keeps assertions stable if the shape ever grows again.
function simplify(cs: ReturnType<typeof markdownToContentState>) {
  return cs.blocks.map((b) => ({ text: b.text, type: b.type }));
}

describe('markdownToContentState', () => {
  it('splits paragraphs on blank lines into unstyled blocks', () => {
    const cs = markdownToContentState('First paragraph.\n\nSecond paragraph.');
    expect(simplify(cs)).toEqual([
      { text: 'First paragraph.', type: 'unstyled' },
      { text: 'Second paragraph.', type: 'unstyled' },
    ]);
    expect(cs.entities).toEqual([]);
  });

  it('emits ONLY text/type per block — the live API rejects extra fields', () => {
    const [b] = markdownToContentState('hello').blocks;
    expect(Object.keys(b).sort()).toEqual(['text', 'type']);
  });

  it('converts headers', () => {
    const cs = markdownToContentState('# Title\n\n## Section\n\nBody text');
    expect(simplify(cs)).toEqual([
      { text: 'Title', type: 'header-one' },
      { text: 'Section', type: 'header-two' },
      { text: 'Body text', type: 'unstyled' },
    ]);
  });

  it('converts unordered and ordered lists (one block per item)', () => {
    const cs = markdownToContentState('- apple\n- banana\n\n1. first\n2. second');
    expect(simplify(cs)).toEqual([
      { text: 'apple', type: 'unordered-list-item' },
      { text: 'banana', type: 'unordered-list-item' },
      { text: 'first', type: 'ordered-list-item' },
      { text: 'second', type: 'ordered-list-item' },
    ]);
  });

  it('converts blockquotes and strips markers', () => {
    const cs = markdownToContentState('> quoted line one\n> quoted line two');
    expect(simplify(cs)).toEqual([
      { text: 'quoted line one\nquoted line two', type: 'blockquote' },
    ]);
  });

  it('keeps single newlines inside a paragraph', () => {
    const cs = markdownToContentState('line one\nline two');
    expect(simplify(cs)).toEqual([{ text: 'line one\nline two', type: 'unstyled' }]);
  });

  it('skips empty paragraphs and handles CRLF', () => {
    const cs = markdownToContentState('a\r\n\r\n\r\n\r\nb');
    expect(simplify(cs)).toEqual([
      { text: 'a', type: 'unstyled' },
      { text: 'b', type: 'unstyled' },
    ]);
  });

  it('returns no blocks for empty input', () => {
    expect(markdownToContentState('').blocks).toEqual([]);
    expect(markdownToContentState('   \n\n  ').blocks).toEqual([]);
  });
});

describe('parseInlineStyles', () => {
  it('converts **bold** to a bold range with correct offsets (Japanese)', async () => {
    const { parseInlineStyles } = await import('../articles.js');
    const out = parseInlineStyles('月額は**0円**のまま');
    expect(out.text).toBe('月額は0円のまま');
    expect(out.ranges).toEqual([{ offset: 3, length: 2, style: 'bold' }]);
  });

  it('strips inline backticks without styling', async () => {
    const { parseInlineStyles } = await import('../articles.js');
    const out = parseInlineStyles('`npx create-line-harness` を打つ');
    expect(out.text).toBe('npx create-line-harness を打つ');
    expect(out.ranges).toEqual([]);
  });

  it('handles multiple bolds and bold containing backticks', async () => {
    const { parseInlineStyles } = await import('../articles.js');
    const out = parseInlineStyles('**A**と**`B`**');
    expect(out.text).toBe('AとB');
    expect(out.ranges).toEqual([
      { offset: 0, length: 1, style: 'bold' },
      { offset: 2, length: 1, style: 'bold' },
    ]);
  });

  it('leaves unmatched markers as-is', async () => {
    const { parseInlineStyles } = await import('../articles.js');
    expect(parseInlineStyles('**未閉じ').text).toBe('**未閉じ');
  });
});

describe('markdownToContentState inline/fence handling', () => {
  it('code fences become plain paragraphs, markers removed', async () => {
    const { markdownToContentState } = await import('../articles.js');
    const cs = markdownToContentState('前段\n\n```bash\nnpx create-line-harness\n```\n\n後段');
    const texts = cs.blocks.map((b) => b.text);
    expect(texts).toEqual(['前段', 'npx create-line-harness', '後段']);
    expect(JSON.stringify(cs)).not.toContain('```');
  });

  it('bold in headers and lists carries inline_style_ranges', async () => {
    const { markdownToContentState } = await import('../articles.js');
    const cs = markdownToContentState('## 見出し**強調**\n\n- 項目**A**\n- 普通');
    const h = cs.blocks[0];
    expect(h.type).toBe('header-two');
    expect(h.text).toBe('見出し強調');
    expect(h.inline_style_ranges).toEqual([{ offset: 3, length: 2, style: 'bold' }]);
    const li = cs.blocks[1];
    expect(li.inline_style_ranges).toEqual([{ offset: 2, length: 1, style: 'bold' }]);
    expect(cs.blocks[2].inline_style_ranges).toBeUndefined();
  });

  it('no stray ** or backticks survive anywhere', async () => {
    const { markdownToContentState } = await import('../articles.js');
    const cs = markdownToContentState('**太字**と`コード`\n\n> 引用の**強調**\n\n```\nraw fence ** kept\n```');
    const prose = cs.blocks.slice(0, 2).map((b) => b.text).join('');
    expect(prose).not.toContain('**');
    expect(prose).not.toContain('`');
    expect(cs.blocks[2].text).toBe('raw fence ** kept');  // fence内はそのまま
  });
});

describe('markdownToContentState inline images', () => {
  const URL = 'https://example.com/img/a.png';

  it('converts a standalone image paragraph into an atomic block + image entity', () => {
    const cs = markdownToContentState(`前段\n\n![図解](${URL})\n\n後段`, { [URL]: '111' });
    expect(cs.blocks.map((b) => b.type)).toEqual(['unstyled', 'atomic', 'unstyled']);
    const atomic = cs.blocks[1];
    expect(atomic.text).toBe(' ');
    expect(atomic.entity_ranges).toEqual([{ offset: 0, length: 1, key: 0 }]);
    expect(cs.entities).toEqual([
      {
        key: '0',
        value: {
          type: 'image',
          mutability: 'immutable',
          data: {
            caption: '図解',
            media_items: [{ media_id: '111', media_category: 'tweet_image' }],
          },
        },
      },
    ]);
  });

  it('omits caption when alt text is empty', () => {
    const cs = markdownToContentState(`![](${URL})`, { [URL]: '111' });
    expect(cs.entities[0].value.data).toEqual({
      media_items: [{ media_id: '111', media_category: 'tweet_image' }],
    });
  });

  it('throws when an inline image has no uploaded media_id', () => {
    expect(() => markdownToContentState(`![](${URL})`)).toThrow(/No uploaded media/);
  });

  it('matches URLs containing parentheses', () => {
    const parenUrl = 'https://cdn.example.com/img_(1).png';
    const cs = markdownToContentState(`![](${parenUrl})`, { [parenUrl]: '9' });
    expect(cs.blocks[0].type).toBe('atomic');
    expect(cs.entities[0].value.data.media_items).toEqual([
      { media_id: '9', media_category: 'tweet_image' },
    ]);
  });

  it('drops a leading H1 that duplicates the article title', () => {
    const cs = markdownToContentState('# タイトル\n\n本文', {}, 'タイトル');
    expect(cs.blocks).toEqual([{ text: '本文', type: 'unstyled' }]);
  });

  it('keeps a leading H1 that differs from the title', () => {
    const cs = markdownToContentState('# 別見出し\n\n本文', {}, 'タイトル');
    expect(cs.blocks[0]).toEqual({ text: '別見出し', type: 'header-one' });
  });

  it('keeps a duplicate H1 that is NOT the first paragraph (only the lead is dropped)', () => {
    const cs = markdownToContentState(`![](${URL})\n\n# タイトル\n\n本文`, { [URL]: '111' }, 'タイトル');
    expect(cs.blocks.map((b) => b.type)).toEqual(['atomic', 'header-one', 'unstyled']);
  });
});

describe('collectInlineImageUrls', () => {
  const URL = 'https://example.com/img/a.png';

  it('collects exactly the URLs the converter will turn into entities', () => {
    const body = `前段\n\n![](${URL})\n\n後段`;
    expect(collectInlineImageUrls(body)).toEqual([URL]);
  });

  it('ignores image syntax inside code fences (converter renders it as code)', () => {
    const body = '```\n![](https://example.com/in-fence.png)\n```';
    expect(collectInlineImageUrls(body)).toEqual([]);
    expect(() => markdownToContentState(body)).not.toThrow();
  });

  it('ignores an image line glued to other text by a single newline (not a standalone paragraph)', () => {
    const body = `テキスト\n![](${URL})`;
    expect(collectInlineImageUrls(body)).toEqual([]);
    // converter keeps it as literal text in the same paragraph — consistent
    const cs = markdownToContentState(body);
    expect(cs.blocks[0].type).toBe('unstyled');
  });

  it('agrees with the converter on multi-line alt text', () => {
    const body = `![一行目\n二行目](${URL})`;
    const urls = collectInlineImageUrls(body);
    expect(urls).toEqual([URL]);
    const cs = markdownToContentState(body, { [URL]: '5' });
    expect(cs.blocks[0].type).toBe('atomic');
  });

  it('dedupes repeated URLs', () => {
    expect(collectInlineImageUrls(`![](${URL})\n\n![](${URL})`)).toEqual([URL]);
  });
});
