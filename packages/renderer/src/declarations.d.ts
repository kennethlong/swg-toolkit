/**
 * packages/renderer/src/declarations.d.ts
 * Module type declarations for non-TypeScript imports.
 */

// CSS side-effect imports (Vite handles bundling; TypeScript just needs to allow them)
declare module '*.css' {
  const css: string;
  export default css;
}
