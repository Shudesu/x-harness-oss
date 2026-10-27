# Gate image assets

`gate-sans.ttf` is a static 600-weight subset of Google Fonts' Noto Sans JP (`ofl/notosansjp/NotoSansJP[wght].ttf`), renamed GateSans. It contains ASCII and the fixed Japanese gate-card labels; arbitrary campaign titles are in escaped OGP metadata, not silently rendered with missing glyphs. The OFL license is included.

`gate-layout.wasm` is decoded from the valid base64 Yoga payload in pinned `satori@0.18.3/dist/index.js`. That release's separately shipped yoga.wasm contains UTF-8 replacement bytes and fails WebAssembly validation. `scripts/check-gate-assets.mjs` verifies exact correspondence to the embedded payload. Yoga's MIT license is included.

Satori is pinned and patched for the Workers compiled-WASM ABI: preserve WebAssembly.Module/Instance values instead of converting them to an empty byte array, and normalize the instantiate(Module) Instance return to the expected `{instance}` shape. The patch is in `patches/satori@0.18.3.patch`. A newer tested package introduced a browser-location dependency through HarfBuzz, so it is not used here. Both Node PNG tests and the local workerd HTTP smoke test cover the shipping renderer. Changes to this dependency must rerun those checks, not just a bundle dry-run.

License/source references: Yoga v3.2.1 (`https://github.com/facebook/yoga/tree/v3.2.1`, MIT); Satori v0.18.3 (`https://github.com/vercel/satori/tree/0.18.3`, MPL-2.0). Satori's license and the exact modifications are distributed in this repository. The embedded Yoga payload includes Satori's upstream yoga-layout 3.2.1 patch, available in that Satori source tag.
