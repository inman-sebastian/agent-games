// WGSL shader sources are imported as plain strings through Vite's `?raw` suffix, so each shader lives
// in its own .wgsl file (readable, highlightable) instead of inside a template literal.
declare module '*.wgsl?raw' {
  const source: string;
  export default source;
}
