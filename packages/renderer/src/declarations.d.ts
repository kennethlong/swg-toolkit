/**
 * packages/renderer/src/declarations.d.ts
 * Module type declarations for non-TypeScript imports.
 */

// CSS side-effect imports (Vite handles bundling; TypeScript just needs to allow them)
declare module '*.css' {
  const css: string;
  export default css;
}

// Electron-specific process properties not in @types/node.
// Available in the renderer when nodeIntegration:true (Path B).
declare global {
  interface NodeJS {
    ProcessEnv: { NODE_ENV?: string };
  }
}
declare namespace NodeJS {
  interface Process {
    /** Absolute path to the resources/ dir in a packaged Electron app. */
    resourcesPath: string;
  }
}
