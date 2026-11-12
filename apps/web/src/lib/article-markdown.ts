// Dependency-free markdown parser for article previews. It produces plain data
// (no HTML strings) so React escapes all text; only http(s) URLs survive as
// links/images. Covers what our article pipeline writes: headings, paragraphs,
// bullet/numbered lists, quotes, standalone + inline images, ``` fences, rules,
// **bold**, *italic*, `code`, [links](url) and bare URLs.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; c: Inline[] }
  | { t: 'italic'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'image'; src: string; alt: string }
  | { t: 'misplacedImage'; src: string; alt: string }
  | { t: 'br' }

export type Block =
  | { t: 'heading'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'paragraph'; c: Inline[] }
  | { t: 'list'; ordered: boolean; items: Inline[][] }
  | { t: 'quote'; c: Inline[] }
  | { t: 'image'; src: string; alt: string; caption?: string }
  | { t: 'code'; v: string }
  | { t: 'rule' }

const SAFE_URL = /^https?:\/\/\S+$/i

export function safeUrl(url: string): string | null {
  const u = url.trim()
  return SAFE_URL.test(u) ? u : null
}

// Inline grammar: images first (they contain link syntax), then links, code,
// bold, italic, bare URLs.
const INLINE_RE = /!\[([^\]]*)\]\((\S+?)\)|\[([^\]]+)\]\((\S+?)\)|`([^`]+)`|\*\*([^*]+?)\*\*|(?<![*\w])\*([^*\s][^*]*?)\*(?!\*)|(https?:\/\/[^\s<>()（）「」、。]+)/g

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  const lines = text.split('\n')
  lines.forEach((line, li) => {
    if (li > 0) out.push({ t: 'br' })
    let last = 0
    for (const m of line.matchAll(INLINE_RE)) {
      const idx = m.index ?? 0
      if (idx > last) out.push({ t: 'text', v: line.slice(last, idx) })
      if (m[2] !== undefined) {
        const src = safeUrl(m[2])
        // X only renders images that sit alone in their own paragraph; an
        // image inside a sentence is published as literal text, so the
        // preview flags it instead of pretending it will show.
        out.push(src ? { t: 'misplacedImage', src, alt: m[1] } : { t: 'text', v: m[0] })
      } else if (m[4] !== undefined) {
        const href = safeUrl(m[4])
        out.push(href ? { t: 'link', href, c: parseInline(m[3]) } : { t: 'text', v: m[3] })
      } else if (m[5] !== undefined) out.push({ t: 'code', v: m[5] })
      else if (m[6] !== undefined) out.push({ t: 'bold', c: parseInline(m[6]) })
      else if (m[7] !== undefined) out.push({ t: 'italic', c: parseInline(m[7]) })
      else if (m[8] !== undefined) out.push({ t: 'link', href: m[8], c: [{ t: 'text', v: m[8] }] })
      last = idx + m[0].length
    }
    if (last < line.length) out.push({ t: 'text', v: line.slice(last) })
  })
  return out
}

// `![alt](url)` or `![alt](url "title")` alone on a line.
const STANDALONE_IMAGE = /^!\[([^\]]*)\]\((\S+)(?:\s+"[^"]*")?\)$/

function parseChunk(chunk: string, blocks: Block[]) {
  const lines = chunk.split('\n')
  const first = lines[0]

  // Same rule as the X converter: an image line (the whole line is the image)
  // renders as an image block, even without blank lines around it. Images
  // inside other text are flagged inline.
  const img = chunk.trim().match(STANDALONE_IMAGE)
  if (img) {
    const src = safeUrl(img[2])
    if (src) { blocks.push({ t: 'image', src, alt: img[1] }); return }
  }
  if (lines.length > 1 && lines.some((l) => STANDALONE_IMAGE.test(l.trim()))) {
    let run: string[] = []
    const flush = () => { if (run.length) parseChunk(run.join('\n'), blocks); run = [] }
    for (const l of lines) {
      if (STANDALONE_IMAGE.test(l.trim())) { flush(); parseChunk(l.trim(), blocks) } else run.push(l)
    }
    flush()
    return
  }
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(chunk)) { blocks.push({ t: 'rule' }); return }

  const h = first.match(/^(#{1,6})\s+(.+)$/)
  if (h) {
    const level = Math.min(3, h[1].length) as 1 | 2 | 3
    blocks.push({ t: 'heading', level, c: parseInline(h[2].replace(/\s+#+\s*$/, '')) })
    if (lines.length > 1) parseChunk(lines.slice(1).join('\n'), blocks)
    return
  }
  if (lines.every((l) => /^\s*>/.test(l))) {
    blocks.push({ t: 'quote', c: parseInline(lines.map((l) => l.replace(/^\s*>\s?/, '')).join('\n')) })
    return
  }
  const bullet = /^\s*[-*・]\s+/
  const numbered = /^\s*\d+[.)]\s+/
  if (lines.every((l) => bullet.test(l))) {
    blocks.push({ t: 'list', ordered: false, items: lines.map((l) => parseInline(l.replace(bullet, ''))) })
    return
  }
  if (lines.every((l) => numbered.test(l))) {
    blocks.push({ t: 'list', ordered: true, items: lines.map((l) => parseInline(l.replace(numbered, ''))) })
    return
  }
  // A paragraph followed directly by a list (no blank line) — split them.
  const listStart = lines.findIndex((l, i) => i > 0 && (bullet.test(l) || numbered.test(l)) && lines.slice(i).every((x) => bullet.test(x) || numbered.test(x)))
  if (listStart > 0) {
    parseChunk(lines.slice(0, listStart).join('\n'), blocks)
    parseChunk(lines.slice(listStart).join('\n'), blocks)
    return
  }
  blocks.push({ t: 'paragraph', c: parseInline(chunk) })
}

export function parseArticleMarkdown(md: string): Block[] {
  const blocks: Block[] = []
  const src = md.replace(/\r\n/g, '\n')
  // ``` fences first so their content is never parsed.
  const parts = src.split(/^```[^\n]*\n([\s\S]*?)^```\s*$/m)
  parts.forEach((part, i) => {
    if (i % 2 === 1) { blocks.push({ t: 'code', v: part.replace(/\n$/, '') }); return }
    for (const raw of part.split(/\n{2,}/)) {
      const chunk = raw.replace(/^\n+|\s+$/g, '')
      if (chunk.trim()) parseChunk(chunk, blocks)
    }
  })
  return blocks
}

/** Image URLs in reading order (cover excluded). */
export function articleImageUrls(md: string): string[] {
  const urls: string[] = []
  const walk = (c: Inline[]) => c.forEach((n) => {
    if (n.t === 'image' || n.t === 'misplacedImage') urls.push(n.src)
    else if (n.t === 'bold' || n.t === 'italic' || n.t === 'link') walk(n.c)
  })
  for (const b of parseArticleMarkdown(md)) {
    if (b.t === 'image') urls.push(b.src)
    else if (b.t === 'paragraph' || b.t === 'quote' || b.t === 'heading') walk(b.c)
    else if (b.t === 'list') b.items.forEach(walk)
  }
  return urls
}

/** True when the URL is not served by the harness itself (needs import). */
export function isExternalImage(url: string, apiBase: string): boolean {
  return !url.startsWith(`${apiBase.replace(/\/$/, '')}/api/growth/img/`)
}
