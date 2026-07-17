import { describe, it, expect } from 'vitest';
import { markdownToContentState } from '../articles.js';

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
  it('converts **bold** to a Bold range with correct offsets (Japanese)', async () => {
    const { parseInlineStyles } = await import('../articles.js');
    const out = parseInlineStyles('月額は**0円**のまま');
    expect(out.text).toBe('月額は0円のまま');
    expect(out.ranges).toEqual([{ offset: 3, length: 2, style: 'Bold' }]);
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
      { offset: 0, length: 1, style: 'Bold' },
      { offset: 2, length: 1, style: 'Bold' },
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
    expect(h.inline_style_ranges).toEqual([{ offset: 3, length: 2, style: 'Bold' }]);
    const li = cs.blocks[1];
    expect(li.inline_style_ranges).toEqual([{ offset: 2, length: 1, style: 'Bold' }]);
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
