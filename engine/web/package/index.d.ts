// Types for @codefine/splat-renderer (index.js).

export declare const RenderMode: Readonly<{ PointCloud: 0; Gaussian: 1 }>;
export type RenderMode = (typeof RenderMode)[keyof typeof RenderMode];

/** Where dist/codefine-engine.js is expected to be served: "/engine/codefine-engine.js". */
export declare const DEFAULT_ENGINE_URL: string;

/** The engine can't run here: not built, or the browser has no WebGL2. */
export declare class EngineUnavailableError extends Error {}

export interface CreateSplatRendererOptions {
  /** URL of dist/codefine-engine.js as the page serves it. Default: DEFAULT_ENGINE_URL. */
  engineUrl?: string;
  /** Receives the engine's error output. Default: console.warn. */
  printErr?: (message: string) => void;
}

export interface SplatRenderer {
  /** Parses a Gaussian splat .ply and adds it as a model. Returns its splat count; throws if it can't be read. */
  loadPly(data: ArrayBuffer | Uint8Array | Uint8Array[], name?: string): number;
  /** Removes every model. */
  clear(): void;
  setRenderMode(mode: RenderMode): void;
  /** Splats across all loaded models. */
  readonly splatCount: number;
  /** Camera moves: CSS pixels for orbit / pan, wheel notches for zoom (same units as the desktop editor). */
  orbit(dx: number, dy: number): void;
  pan(dx: number, dy: number): void;
  zoom(notches: number): void;
  resetCamera(): void;
  /** Draws one frame; width and height are the canvas' drawing-buffer size in device pixels. */
  render(width: number, height: number): void;
  /** Frees the GPU resources and the WebGL context. Later calls do nothing. */
  dispose(): void;
}

/** Imports the Emscripten module factory once per URL. */
export declare function loadEngineFactory(engineUrl?: string): Promise<(options?: object) => Promise<unknown>>;

/** Starts an engine instance drawing into canvas. Rejects with EngineUnavailableError if it can't run here. */
export declare function createSplatRenderer(
  canvas: HTMLCanvasElement,
  options?: CreateSplatRendererOptions,
): Promise<SplatRenderer>;
