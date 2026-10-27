import { readFileSync } from "node:fs";
const bundled = readFileSync(
  "apps/worker/node_modules/satori/dist/index.js",
  "utf8",
).match(/AGFzb[A-Za-z0-9+/=]+/);
if (!bundled) throw new Error("Pinned Satori layout binary missing");
const source = Buffer.from(bundled[0], "base64"),
  asset = readFileSync("apps/worker/src/assets/gate-layout.wasm");
if (!WebAssembly.validate(asset) || !source.equals(asset))
  throw new Error(
    "Gate layout binary differs from the verified dependency payload",
  );
for (const file of ["OFL.txt", "LICENSE-yoga.txt", "LICENSE-satori.txt"])
  if (!readFileSync(`apps/worker/src/assets/${file}`, "utf8").trim())
    throw new Error("Missing font/layout license");
console.log(
  "Gate WASM matches the valid embedded Yoga payload; licenses present",
);
