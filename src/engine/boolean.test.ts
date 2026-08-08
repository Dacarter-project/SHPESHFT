import { describe, expect, it } from 'vitest';
import { createRectangle } from '../core/document';
import { unionRectangles } from './boolean';

describe('rectangle union', () => {
  it('commits overlapping rectangles to one editable outline', () => {
    const left = createRectangle(0, 0), right = createRectangle(100, 60);
    const result = unionRectangles([left, right]);
    expect(result?.geometry.kind).toBe('path');
    if (result?.geometry.kind !== 'path') throw new Error('Expected path');
    expect(result.geometry.nodes.length).toBe(8);
    expect(result.geometry.nodes.every((node) => node.kind === 'corner')).toBe(true);
  });
});
