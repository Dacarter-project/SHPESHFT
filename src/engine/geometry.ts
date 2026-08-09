import type { VectorObject } from '../core/document';

export type Bounds = { x: number; y: number; width: number; height: number };

export function localCenter(object: VectorObject) {
  const bounds = localBounds(object);
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

/** The transform position remains the unrotated local origin for project compatibility. */
export function objectCenter(object: VectorObject) {
  const center = localCenter(object);
  return {
    x: object.transform.x + center.x * object.transform.scaleX,
    y: object.transform.y + center.y * object.transform.scaleY
  };
}

export function worldToLocal(object: VectorObject, worldX: number, worldY: number) {
  const center = localCenter(object), worldCenter = objectCenter(object);
  const dx = worldX - worldCenter.x, dy = worldY - worldCenter.y;
  const cos = Math.cos(-object.transform.rotation), sin = Math.sin(-object.transform.rotation);
  return { x: center.x + (dx * cos - dy * sin) / object.transform.scaleX, y: center.y + (dx * sin + dy * cos) / object.transform.scaleY };
}

export function localToWorld(object: VectorObject, localX: number, localY: number) {
  const center = localCenter(object), worldCenter = objectCenter(object);
  const x = (localX - center.x) * object.transform.scaleX, y = (localY - center.y) * object.transform.scaleY;
  const cos = Math.cos(object.transform.rotation), sin = Math.sin(object.transform.rotation);
  return { x: worldCenter.x + x * cos - y * sin, y: worldCenter.y + x * sin + y * cos };
}

export function localBounds(object: VectorObject): Bounds {
  if (object.geometry.kind === 'rect') return { x: 0, y: 0, width: object.geometry.width, height: object.geometry.height };
  if (object.geometry.kind === 'ellipse') return { x: -object.geometry.rx, y: -object.geometry.ry, width: object.geometry.rx * 2, height: object.geometry.ry * 2 };
  const points = object.geometry.nodes.flatMap((node) => [
    node.anchor,
    node.in ? { x: node.anchor.x + node.in.x, y: node.anchor.y + node.in.y } : node.anchor,
    node.out ? { x: node.anchor.x + node.out.x, y: node.anchor.y + node.out.y } : node.anchor
  ]);
  const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

export function tracePath(context: CanvasRenderingContext2D, object: VectorObject): void {
  if (object.geometry.kind !== 'path' || object.geometry.nodes.length === 0) return;
  const nodes = object.geometry.nodes;
  context.moveTo(nodes[0].anchor.x, nodes[0].anchor.y);
  const last = object.geometry.closed ? nodes.length : nodes.length - 1;
  for (let index = 0; index < last; index += 1) {
    const from = nodes[index];
    const to = nodes[(index + 1) % nodes.length];
    const cp1 = from.out ? { x: from.anchor.x + from.out.x, y: from.anchor.y + from.out.y } : from.anchor;
    const cp2 = to.in ? { x: to.anchor.x + to.in.x, y: to.anchor.y + to.in.y } : to.anchor;
    context.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, to.anchor.x, to.anchor.y);
  }
  if (object.geometry.closed) context.closePath();
}

export function hitTest(object: VectorObject, worldX: number, worldY: number): boolean {
  const { x, y } = worldToLocal(object, worldX, worldY);
  if (object.geometry.kind === 'ellipse') return (x * x) / (object.geometry.rx ** 2) + (y * y) / (object.geometry.ry ** 2) <= 1;
  const bounds = localBounds(object);
  return x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height;
}
