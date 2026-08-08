import type { ShpeshftDocument } from '../core/document';

export type RenderViewport = Readonly<{ x: number; y: number; scale: number; width: number; height: number; pixelRatio: number }>;
export type RenderMetrics = Readonly<{ renderer: 'canvas2d' | 'pixi'; frameMs: number; objects: number }>;

/** Stable boundary for measuring Canvas2D against a future Pixi renderer. */
export interface VectorRenderer {
  readonly name: RenderMetrics['renderer'];
  render(document: ShpeshftDocument, viewport: RenderViewport): RenderMetrics;
  destroy(): void;
}
