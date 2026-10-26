# LINE-first engagement gates — MVP implementation plan

Scope: supplied M1–M7. X user-ID input is removed from the new participant flow. Strict-winner OAuth, referrals/streaks, AI campaign copy and the full creation saga/live-preview wizard are explicitly post-MVP in the supplied roadmap. Existing business data is retained. No real messages, production DB mutations or deployment are part of local verification.

## Safety decisions

- LINE ID token is verified against the campaign's registered Login channel before resolving a friend. A submitted friendId/username is never identity proof.
- Partner URL/connection are configured server-side. HMAC binds method/path/time/delivery ID/body. Results are sent only to the LINE friend the code was issued to.
- Live claim uniqueness uses partial indexes so expired codes remain as history while reissue is possible. One X account and one LINE friend per gate.
- Settlement sorts observed posts by timestamp and numeric ID. Overlap reconciliation catches delayed search indexing. Already finalized rewards are not revoked by arbitrarily late posts; bounded waiting cannot guarantee globally perfect ordering.
- Inventory reservation, participant outcome and outbox insert use a D1 batch transaction. Reward-code ownership is unique. Cross-service retries reuse delivery IDs; LINE push retries reuse provider retry keys. Ambiguous sends are never blindly duplicated.
- New flow has no X auto-post/DM. Legacy loss mentions and public bearer-token links are disabled; legacy records/routes remain with an upgrade notice.
- API prices/latency/taps are estimates. Missing data is not rendered as a success or zero cost. No invented private-account diagnosis or future odds/offer promises.

## Work sequence

1. Shared signed protocol and additive schema; core claims/matcher/inventory/outbox tests.
2. Durable Object polling, scoped admin/partner APIs, public entry and safe OGP.
3. LINE partner inbox, scoped friend identity, reply/push delivery, LIFF and webhook entry.
4. Creator settings/funnel UI, removal of self-declared X-ID forms, legacy safety fixes.
5. Cross-repo synthetic integration tests, migrations, builds and release notes with remaining real-device/provider checks.

X base: 2152a58 (v0.6.1). LINE base: 06140ba (main). LINE migrations use the contributor-required NNN placeholder until merge.
