declare module '*.wasm?module' {
  const wasm: WebAssembly.Module;
  export default wasm;
}
declare module 'cloudflare:workers' {
  export const env: {
    ASSETS: { fetch(request: Request): Promise<Response> };
  };
}
