// Readable text preview. React escapes all content; no HTML or remote images execute.
export default function ArticleReadingView({ title, body }: { title: string; body: string }) {
  const blocks = body.split(/\n\s*\n/).filter(Boolean)
  return <article className="min-h-[52vh] break-words">
    <p className="mb-6 text-xs text-kumo-subtle">読みやすさの確認用プレビュー · X上の表示とは異なる場合があります</p>
    <h1 className="mb-9 text-2xl font-bold leading-relaxed sm:text-3xl">{title || 'タイトル未入力'}</h1>
    <div className="space-y-6 text-base leading-8">{blocks.length ? blocks.map((block, i) => {
      const heading = block.match(/^(#{1,6}) +([^\n]+)$/)
      if (heading) return <h2 key={i} className="pt-4 text-xl font-semibold leading-8">{heading[2]}</h2>
      if (block.split('\n').every(line => /^[-*] +/.test(line))) return <ul key={i} className="list-disc space-y-2 pl-6">{block.split('\n').map((line, j) => <li key={j}>{line.replace(/^[-*] +/, '')}</li>)}</ul>
      if (block.startsWith('> ')) return <blockquote key={i} className="whitespace-pre-wrap border-l-4 border-kumo-line pl-5 text-kumo-subtle">{block.replace(/^> ?/gm, '')}</blockquote>
      return <p key={i} className="whitespace-pre-wrap">{block}</p>
    }) : <p className="text-kumo-subtle">本文を入力すると、ここで読み返せます。</p>}</div>
  </article>
}
