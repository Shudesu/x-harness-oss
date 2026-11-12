'use client'

// Renders article markdown the way the published X article reads: real
// headings, lists, quotes, bold, and images inline at full column width.
// Built from parsed data (lib/article-markdown) — React escapes all text and
// only http(s) URLs become links or images.
import { Fragment, useState } from 'react'
import { parseArticleMarkdown, type Inline } from '@/lib/article-markdown'

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return <>{nodes.map((n, i) => {
    switch (n.t) {
      case 'text': return <Fragment key={i}>{n.v}</Fragment>
      case 'br': return <br key={i} />
      case 'bold': return <strong key={i} className="font-bold text-kumo-default"><InlineNodes nodes={n.c} /></strong>
      case 'italic': return <em key={i}><InlineNodes nodes={n.c} /></em>
      case 'code': return <code key={i} className="rounded bg-kumo-tint px-1.5 py-0.5 font-mono text-[0.88em]">{n.v}</code>
      case 'link': return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className="break-all text-kumo-link underline underline-offset-2">{<InlineNodes nodes={n.c} />}</a>
      case 'image': return <ArticleImage key={i} src={n.src} alt={n.alt} inline />
      case 'misplacedImage': return <span key={i} className="mx-1 inline-block rounded bg-kumo-warning-tint px-2 py-0.5 text-xs text-kumo-warning">⚠ 文中の画像「{n.alt || '画像'}」はXでは表示されません（画像は1行に単独で置いてください）</span>
    }
  })}</>
}

export function ArticleImage({ src, alt, caption, inline, className = '' }: { src: string; alt: string; caption?: string; inline?: boolean; className?: string }) {
  // Keyed by src so a corrected / re-imported URL gets a fresh attempt.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (failedSrc === src) {
    return <span className={`my-2 flex items-center justify-center rounded-xl border border-dashed border-kumo-line bg-kumo-tint p-6 text-center text-xs text-kumo-subtle ${inline ? '' : 'w-full'}`}>
      画像を表示できません{alt ? `（${alt}）` : ''}<br />外部URLの画像はブラウザで開けないことがあります
    </span>
  }
  const img = <img src={src} alt={alt} loading="lazy" onError={() => setFailedSrc(src)} className={`w-full rounded-xl border border-kumo-line bg-kumo-tint ${className}`} />
  if (inline) return <span className="my-3 block">{img}</span>
  return <figure className="my-2">
    {img}
    {(caption || alt) && <figcaption className="mt-2 text-center text-xs leading-5 text-kumo-subtle">{caption || alt}</figcaption>}
  </figure>
}

export default function ArticleBody({ md }: { md: string }) {
  const blocks = parseArticleMarkdown(md)
  return <div className="space-y-5 break-words text-[16px] leading-[1.95] text-kumo-default">
    {blocks.map((b, i) => {
      switch (b.t) {
        case 'heading':
          return b.level === 1
            ? <h2 key={i} className="pt-5 text-2xl font-bold leading-snug"><InlineNodes nodes={b.c} /></h2>
            : b.level === 2
              ? <h2 key={i} className="pt-5 text-xl font-bold leading-snug"><InlineNodes nodes={b.c} /></h2>
              : <h3 key={i} className="pt-3 text-lg font-bold leading-snug"><InlineNodes nodes={b.c} /></h3>
        case 'paragraph': return <p key={i}><InlineNodes nodes={b.c} /></p>
        case 'list': {
          const Tag = b.ordered ? 'ol' : 'ul'
          return <Tag key={i} className={`space-y-1.5 pl-6 ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
            {b.items.map((item, j) => <li key={j} className="pl-1"><InlineNodes nodes={item} /></li>)}
          </Tag>
        }
        case 'quote': return <blockquote key={i} className="border-l-4 border-kumo-line pl-4 text-kumo-subtle"><InlineNodes nodes={b.c} /></blockquote>
        case 'image': return <ArticleImage key={i} src={b.src} alt={b.alt} caption={b.caption} />
        case 'code': return <pre key={i} className="overflow-x-auto rounded-lg bg-kumo-tint p-4 font-mono text-sm leading-6"><code>{b.v}</code></pre>
        case 'rule': return <hr key={i} className="border-kumo-line" />
      }
    })}
  </div>
}
