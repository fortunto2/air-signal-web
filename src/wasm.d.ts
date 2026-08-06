/**
 * A `.wasm` import inside the Worker resolves to the compiled module. Vite knows how to emit it;
 * TypeScript needs telling, because there is no ambient declaration for the Cloudflare form.
 */
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}

/** The browser island imports the same binary as a URL, which is a plain string. */
declare module "*.wasm?url" {
  const url: string;
  export default url;
}

/** Vite bundles a worker entry and returns its URL. Used for MapLibre's data worker. */
declare module "*?worker&url" {
  const url: string;
  export default url;
}
