import satori, { init as initLayout } from 'satori/standalone';
export async function gateOgSvg(
  data: { remaining: number | null; endsAt: string; consolation: boolean },
  font: ArrayBuffer,
) {
  const deadline = new Date(data.endsAt).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const label = data.remaining === null ? '受付中' : data.remaining > 0 ? '残り' : '先着枠終了';
  const tree = {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        background: '#08251e',
        color: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        padding: '62px 76px',
        fontFamily: 'GateSans',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              width: 1048,
              justifyContent: 'space-between',
              alignItems: 'center',
            },
            children: [
              { type: 'div', props: { style: { fontSize: 34 }, children: 'X × LINE' } },
              {
                type: 'div',
                props: {
                  style: {
                    background: '#c8f7ad',
                    color: '#153b24',
                    borderRadius: 40,
                    padding: '16px 28px',
                    fontSize: 28,
                  },
                  children: data.consolation ? '参加賞あり' : '限定特典',
                },
              },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', alignItems: 'baseline', gap: 28, marginTop: 70 },
            children: [
              { type: 'div', props: { style: { fontSize: 52 }, children: label } },
              {
                type: 'div',
                props: {
                  style: {
                    fontSize: Math.max(
                      54,
                      Math.min(150, 700 / String(data.remaining ?? '').length),
                    ),
                    lineHeight: 1,
                  },
                  children:
                    data.remaining === null || data.remaining === 0 ? '' : String(data.remaining),
                },
              },
              {
                type: 'div',
                props: {
                  style: { fontSize: 46 },
                  children: data.remaining && data.remaining > 0 ? '枠' : '',
                },
              },
            ],
          },
        },
        {
          type: 'div',
          props: { style: { fontSize: 34, marginTop: 40 }, children: `締切 ${deadline} JST` },
        },
        {
          type: 'div',
          props: {
            style: { fontSize: 22, color: '#b9d2c3', marginTop: 32 },
            children: `在庫表示・更新 ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} JST`,
          },
        },
      ],
    },
  };
  return satori(tree as any, {
    width: 1200,
    height: 630,
    fonts: [{ name: 'GateSans', data: font, weight: 600, style: 'normal' }],
  });
}
let ready: Promise<void> | undefined;
let layoutReady: Promise<void> | undefined;
export async function renderGateOgWithAssets(
  data: { remaining: number | null; endsAt: string; consolation: boolean },
  font: ArrayBuffer,
  wasm: WebAssembly.Module | Uint8Array,
  layoutWasm: WebAssembly.Module | Uint8Array,
): Promise<Uint8Array> {
  const { Resvg, initWasm } = await import('@resvg/resvg-wasm');
  layoutReady ??= initLayout(layoutWasm as unknown as ArrayBuffer).catch((error) => {
    layoutReady = undefined;
    throw error;
  });
  await layoutReady;
  ready ??= initWasm(wasm as WebAssembly.Module).catch((error) => {
    ready = undefined;
    throw error;
  });
  await ready;
  const svg = await gateOgSvg(data, font),
    renderer = new Resvg(svg),
    rendered = renderer.render();
  try {
    return new Uint8Array(rendered.asPng());
  } finally {
    rendered.free();
    renderer.free();
  }
}
export async function renderGateOg(data: {
  remaining: number | null;
  endsAt: string;
  consolation: boolean;
}): Promise<Uint8Array> {
  const [{ default: wasm }, { default: font }, { default: layout }] = await Promise.all([
    import('@resvg/resvg-wasm/index_bg.wasm'),
    import('../assets/gate-sans.ttf'),
    import('../assets/gate-layout.wasm'),
  ]);
  return renderGateOgWithAssets(data, font, wasm, layout);
}
