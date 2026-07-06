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
