import ArticleBody, { ArticleImage } from './article-body'

// Reading preview shared by 記事スタジオ and the グロース画面: cover image,
// title and the body rendered the way the published X article reads.
export default function ArticleReadingView({ title, body, cover, note = true }: { title: string; body: string; cover?: string | null; note?: boolean }) {
  return <article className="min-h-[52vh] break-words">
    {note && <p className="mb-5 text-xs text-kumo-subtle">Xの記事に近い見た目のプレビューです · 実際の表示とは細部が異なる場合があります</p>}
    {cover && <ArticleImage src={cover} alt="表紙画像" className="aspect-[5/2] object-cover" />}
    <h1 className="mb-8 mt-6 text-2xl font-bold leading-relaxed sm:text-3xl">{title || 'タイトル未入力'}</h1>
    {body.trim() ? <ArticleBody md={body} /> : <p className="text-kumo-subtle">本文を入力すると、ここで読み返せます。</p>}
  </article>
}
