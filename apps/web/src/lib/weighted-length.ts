// Mirrors apps/worker/src/services/post-compose.ts weightedLength(): X counts
// CJK / full-width / emoji as 2 and every http(s) URL as 23.
// http(s) URLs always weigh 23. Scheme-less domains (example.com/…, mit.edu)
// weigh min(length, 23): X shortens the ones it recognizes, and taking the
// smaller value means an unknown TLD can never make us reject a valid post.
const URL_RE = /https?:\/\/[^\s　-〿！-｠]+/giu
const BARE_DOMAIN_RE = /(?<![\w@.\/-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}\b(?:\/[^\s　-〿！-｠]*)?/giu
const LIGHT: Array<[number, number]> = [[0x0000, 0x10ff], [0x2000, 0x200d], [0x2010, 0x201f], [0x2032, 0x2037]]
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u

export function weightedLength(text: string): number {
  let urls = 0
  let bare = 0
  const rest = text.normalize('NFC')
    .replace(URL_RE, () => { urls += 1; return '' })
    .replace(BARE_DOMAIN_RE, (m) => { bare += Math.min(m.length, 23); return '' })
  let total = urls * 23 + bare
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter
  const parts = Seg ? Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(rest), (s) => s.segment) : Array.from(rest)
  for (const g of parts) {
    if (EMOJI.test(g)) { total += 2; continue }
    for (const ch of g) {
      const cp = ch.codePointAt(0)!
      total += LIGHT.some(([lo, hi]) => cp >= lo && cp <= hi) ? 1 : 2
    }
  }
  return total
}

export function endsWithStatusUrl(text: string): boolean {
  return /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:[A-Za-z0-9_]+|i(?:\/web)?)\/status\/\d+\S*\s*$/i.test(text)
}
