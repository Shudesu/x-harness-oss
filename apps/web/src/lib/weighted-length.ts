// Same count as the worker (apps/worker/src/services/post-length.ts): X's own
// twitter-text parser — URL = 23, CJK / full-width / emoji = 2.
import twitterText from 'twitter-text'

export function weightedLength(text: string): number {
  return twitterText.parseTweet(text).weightedLength
}
