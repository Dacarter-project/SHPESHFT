import type { VectorObject } from '../core/document';

export type Bounds = { x: number; y: number; width: number; height: number };

export function localBounds(object: VectorObject): Bounds {
  if (object.geometry.kind === 'rect') return { x: 0, y: 0, width: object.geometry.width, height: object.geometry.height };
  if (object.geometry.kind === 'ellipse') return { x: -object.geometry.rx, y: -object.geometry.ry, width: object.geometry.rx * 2, height: object.geometry.ry * 2 };
  const points = object.geometry.nodes.map((node) => node.anchor);
  const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

export function hitTest(object: VectorObject, worldX: number, worldY: number): boolean {
  const { transform } = object;
  const x = (worldX - transform.x) / transform.scaleX;
  const y = (worldY - transform.y) / transform.scaleY;
  if (object.geometry.kind === 'ellipse') return (x * x) / (object.geometry.rx ** 2) + (y * y) / (object.geometry.ry ** 2) <= 1;
  const bounds = localBounds(object);
  return x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height;
}
