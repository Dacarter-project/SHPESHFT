import { describe, expect, it } from 'vitest';
import { createRectangle, createTriangle } from '../core/document';
import { localBounds, localCenter, localToWorld, objectCenter, worldToLocal } from './geometry';

describe('centre-based object transforms', () => {
  it('keeps a rectangle centre fixed while rotating', () => {
    const rectangle = createRectangle(100, 200);
    const center = objectCenter(rectangle);
    const rotated = { ...rectangle, transform: { ...rectangle.transform, rotation: Math.PI / 2 } };
    expect(objectCenter(rotated)).toEqual(center);
    expect(localToWorld(rotated, localCenter(rotated).x, localCenter(rotated).y)).toEqual(center);
  });

  it('round-trips points on a resized and rotated path', () => {
    const triangle = createTriangle(30, 40);
    const transformed = { ...triangle, transform: { ...triangle.transform, scaleX: .08, scaleY: 2.4, rotation: .73 } };
    const world = localToWorld(transformed, 180, 160);
    const local = worldToLocal(transformed, world.x, world.y);
    expect(local.x).toBeCloseTo(180);
    expect(local.y).toBeCloseTo(160);
  });
  it('uses the visible curve extrema rather than distant control handles for bounds', () => {
    const triangle = createTriangle(0, 0); if (triangle.geometry.kind !== 'path') throw new Error('Expected path');
    const curved = { ...triangle, geometry: { ...triangle.geometry, nodes: triangle.geometry.nodes.map((node, index) => index === 0 ? { ...node, out: { x: 500, y: 0 } } : node) } };
    expect(localBounds(curved).width).toBeLessThan(500);
  });
});
