import { describe, it, expect } from 'vitest'
import { parseArticleMarkdown, parseInline, articleImageUrls, isExternalImage, safeUrl } from './article-markdown'

describe('parseArticleMarkdown', () => {
  it('parses the structures our article pipeline writes', () => {
    const md = [
      '## 使い方は3ステップ',
      '![使い方の図](https://xh.dev/api/growth/img/a.png)',
      '**ステップ1：リポスト**',
      '> 引用の1行目\n> 2行目',
      '- 項目A\n- **項目B**',
      '1. 一つ目\n2. 二つ目',
      '---',
      '```\nconst a = 1\n\nconst b = 2\n```',
      '普通の段落と [リンク](https://example.com) と `code`',
    ].join('\n\n')
    const b = parseArticleMarkdown(md)
    expect(b.map((x) => x.t)).toEqual(['heading', 'image', 'paragraph', 'quote', 'list', 'list', 'rule', 'code', 'paragraph'])
    expect(b[0]).toMatchObject({ t: 'heading', level: 2 })
    expect(b[1]).toEqual({ t: 'image', src: 'https://xh.dev/api/growth/img/a.png', alt: '使い方の図' })
    expect(b[2]).toMatchObject({ t: 'paragraph', c: [{ t: 'bold' }] })
    expect(b[4]).toMatchObject({ t: 'list', ordered: false })
    expect(b[5]).toMatchObject({ t: 'list', ordered: true })
    expect(b[7]).toEqual({ t: 'code', v: 'const a = 1\n\nconst b = 2' })
  })

  it('never turns javascript: URLs into links or images', () => {
    expect(parseArticleMarkdown('![x](javascript:alert(1))')[0].t).toBe('paragraph')
    expect(parseInline('[x](javascript:alert(1))').some((n) => n.t === 'link')).toBe(false)
    expect(safeUrl('data:image/png;base64,AAA')).toBeNull()
  })

  it('splits a paragraph that runs straight into a list', () => {
    const b = parseArticleMarkdown('ポイントは3つです。\n- A\n- B')
    expect(b.map((x) => x.t)).toEqual(['paragraph', 'list'])
  })

  it('flags images placed inside a sentence (X publishes those as text)', () => {
    const b = parseArticleMarkdown('前 ![x](https://a.dev/2.png) 後')
    expect(b[0]).toMatchObject({ t: 'paragraph', c: [{ t: 'text' }, { t: 'misplacedImage', src: 'https://a.dev/2.png' }, { t: 'text' }] })
  })

  it('lists every image in reading order', () => {
    const md = '![cover-ish](https://a.dev/1.png)\n\n文中 ![x](https://a.dev/2.png) です\n\n![y](https://a.dev/3.png)\n![z](https://a.dev/4.png)'
    expect(articleImageUrls(md)).toEqual(['https://a.dev/1.png', 'https://a.dev/2.png', 'https://a.dev/3.png', 'https://a.dev/4.png'])
  })

  it('flags images not served by the harness', () => {
    expect(isExternalImage('https://drive.google.com/uc?id=1', 'https://xh.dev')).toBe(true)
    expect(isExternalImage('https://xh.dev/api/growth/img/a.png', 'https://xh.dev/')).toBe(false)
  })

  it('renders consecutive image lines as images (same as the X converter)', () => {
    const b = parseArticleMarkdown('![a](https://e.com/a.png)\n![b](https://e.com/b.png "cap")\ntext after')
    expect(b.map((x) => x.t)).toEqual(['image', 'image', 'paragraph'])
  })
})
