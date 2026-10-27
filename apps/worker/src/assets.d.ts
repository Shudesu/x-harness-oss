declare module '*.ttf' {
  const data: ArrayBuffer;
  export default data;
}
declare module '*.wasm' {
  const data: WebAssembly.Module;
  export default data;
}
