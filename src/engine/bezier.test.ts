import { describe, expect, it } from 'vitest';
import { createBezierPath } from '../core/document';
import { cubicPoint, splitCubicSegment } from './bezier';

describe('touch-first Bézier editing', () => {
  it('splits a cubic without changing its geometry', () => {
    const path = createBezierPath(0, 0); if (path.geometry.kind !== 'path') throw new Error('Expected path'); const geometry = path.geometry;
    const before = Array.from({ length: 21 }, (_, i) => cubicPoint(geometry.nodes, 0, i / 20));
    const split = splitCubicSegment(geometry.nodes, 0, .4, 'inserted');
    const after = before.map((_, i) => { const originalT = i / 20; return originalT <= .4 ? cubicPoint(split, 0, originalT / .4) : cubicPoint(split, 1, (originalT - .4) / .6); });
    after.forEach((point, i) => { expect(point.x).toBeCloseTo(before[i].x, 8); expect(point.y).toBeCloseTo(before[i].y, 8); });
  });
});
