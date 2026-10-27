import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { it, expect } from 'vitest';
import { renderGateOgWithAssets } from '../../apps/worker/src/services/gate-og.js';
it('renders a real 1200x630 PNG with the bundled Japanese subset font', async () => {
  const bytes = readFileSync('apps/worker/src/assets/gate-sans.ttf'),
    font = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const wasm = readFileSync('apps/worker/node_modules/@resvg/resvg-wasm/index_bg.wasm');
  const png = await renderGateOgWithAssets(
    { remaining: 7, endsAt: '2026-11-03T14:59:00Z', consolation: true },
    font,
    await WebAssembly.compile(wasm),
    await WebAssembly.compile(readFileSync('apps/worker/src/assets/gate-layout.wasm')),
  );
  expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect(view.getUint32(16)).toBe(1200);
  expect(view.getUint32(20)).toBe(630);
  if (process.env.XH_SAVE_OG_PREVIEW === '1') {
    mkdirSync('.local', { recursive: true });
    writeFileSync('.local/gate-og-preview.png', png);
  }
});
